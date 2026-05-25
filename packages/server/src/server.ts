// Fastify server factory (per WU-4; extended for the v4-5 sessions API).
// Returns an instance suitable for `app.inject()` (no port binding);
// production callers `listen()` it themselves in cli/serve.ts.


import {
  discoverSessions,
  parseTranscript,
  readSessionRating,
  scoreTimeline,
  writeSessionRating,
} from '@metaswarm-dashboard/sessions';
import { loadConfig, type Config } from '@metaswarm-dashboard/types/config';
import {
  codexSessionsDir as resolveCodexSessionsDir,
  configFile,
  dataDir as resolveDataDir,
  defaultEnv,
  externalToolsLedger as resolveExternalToolsLedger,
  transcriptsDir as resolveTranscriptsDir,
  type PathsEnv,
} from '@metaswarm-dashboard/types/paths';
import Fastify, { type FastifyInstance } from 'fastify';

import { aggregateCalibration } from './data/calibration.js';
import { createCostCache } from './data/cost-cache.js';
import { createCostService } from './data/cost-service.js';
import { warnIfDataDirInGit } from './data/git-footgun.js';
import { SnapshotReader } from './data/snapshot-reader.js';
import { createTranscriptCache } from './data/transcript-cache.js';
import { registerMethodGuard } from './plugins/method-guard.js';
import { registerSpa } from './plugins/spa.js';
import { registerAgentsRoute } from './routes/agents.js';
import { registerVirtualFactoryRoutes } from './api/virtual-factory.js';
import { registerCalibrationRoute } from './routes/calibration.js';
import { registerProjectsByNameRoute } from './routes/projects-by-name.js';
import { registerProjectsRoute } from './routes/projects.js';
import { registerRatingWriteRoute } from './routes/rating-write.js';
import { registerSessionsRoutes } from './routes/sessions.js';

/**
 * Pre-resolved inputs for the v4-5 sessions API. When omitted from
 * `BuildServerOptions`, `buildServer` resolves them from `process.env` via
 * the `@metaswarm-dashboard/types` config + path helpers. Tests inject this
 * block directly so the live `~/.claude/projects/` scan is never touched.
 */
export interface SessionsServerOptions {
  /** The loaded dashboard config (its `projects[].path` are absolute). */
  config: Config;
  /** The transcripts root scanned by discovery. */
  transcriptsDir: string;
  /** The datalake root holding persisted ratings. */
  dataDir: string;
}

/**
 * Pre-resolved inputs for the v5-7 cost API (design §7). When omitted,
 * `buildServer` resolves them from `process.env` via the path helpers — the
 * Codex sessions tree and the metaswarm external-tools ledger. Tests inject
 * this block so the live `~/.codex/` / `~/.claude/sessions/` reads are
 * pointed at a temp tree.
 */
export interface CostServerOptions {
  /** The Codex sessions root (`~/.codex/sessions` or its override). */
  codexSessionsDir: string;
  /** The metaswarm external-tools ledger file path. */
  externalToolsLedger: string;
}

export interface BuildServerOptions {
  /** Where snapshots live. `<dataDir>/projects/<name>/daily/<key>.json`. */
  dataDir: string;
  /** Where the SPA build output (or test stub) lives. */
  staticRoot: string;
  /** Inject `now` for tests. */
  now?: () => Date;
  /** Override Fastify logger options. */
  logger?: boolean;
  /**
   * Pre-resolved sessions-API inputs. When omitted, `buildServer` resolves
   * the config / transcripts dir / datalake from `process.env`.
   */
  sessions?: SessionsServerOptions;
  /**
   * Pre-resolved v5-7 cost-API inputs. When omitted, `buildServer` resolves
   * the Codex sessions dir + the external-tools ledger from `process.env`.
   */
  cost?: CostServerOptions;
}

/**
 * Resolve the v4-5 sessions inputs from a `PathsEnv`: the config via
 * `loadConfig` (consumed through `@metaswarm-dashboard/types/config` — never
 * a deep import of collector internals, anti-goal §12.10), the transcripts
 * dir + datalake via `@metaswarm-dashboard/types/paths`.
 *
 * A missing or invalid config degrades to an empty project list — the
 * sessions endpoints then return an empty result rather than failing the
 * whole server (the snapshot routes remain usable).
 *
 * Exported for unit tests: the `env` parameter is injectable so both the
 * config-found and config-missing branches are deterministically coverable
 * without depending on the test machine's real config file.
 */
export function resolveSessionsOptions(
  env: PathsEnv = defaultEnv(),
): SessionsServerOptions {
  let config: Config;
  try {
    config = loadConfig(configFile(env), { env });
  } catch {
    config = { projects: [] };
  }
  return {
    config,
    transcriptsDir: resolveTranscriptsDir(env),
    dataDir: resolveDataDir(env),
  };
}

/**
 * Resolve the v5-7 cost inputs from a `PathsEnv`: the Codex sessions dir and
 * the metaswarm external-tools ledger. Exported for unit tests — the `env`
 * parameter is injectable so the resolution is coverable without depending
 * on the test machine's real `~/.codex/` / `~/.claude/sessions/`.
 */
export function resolveCostOptions(
  env: PathsEnv = defaultEnv(),
): CostServerOptions {
  return {
    codexSessionsDir: resolveCodexSessionsDir(env),
    externalToolsLedger: resolveExternalToolsLedger(env),
  };
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const reader = new SnapshotReader(opts.dataDir);
  const now = opts.now ?? ((): Date => new Date());
  const sessionsOpts = opts.sessions ?? resolveSessionsOptions();
  const costOpts = opts.cost ?? resolveCostOptions();

  // Method guard MUST be installed before route handlers so non-GET
  // requests on /api/* are rejected before any handler logic runs.
  registerMethodGuard(app);

  // v4-5 sessions read API. The parse + score cache is per-server (its LRU
  // bound and mtime/size keying live in transcript-cache.ts).
  const cache = createTranscriptCache({
    parse: (transcriptPath) => parseTranscript(transcriptPath),
    score: (timeline) => scoreTimeline(timeline),
  });

  // v5-7 cost API (design §7 / §5.4). The two-level cost cache + the cost
  // service are per-server, mirroring the `createTranscriptCache` wiring.
  const costCache = createCostCache();
  const costService = createCostService({
    config: sessionsOpts.config,
    cache: costCache,
    transcriptsDir: sessionsOpts.transcriptsDir,
    codexSessionsDir: costOpts.codexSessionsDir,
    externalToolsLedger: costOpts.externalToolsLedger,
  });

  registerProjectsRoute(app, { reader, cost: costService });
  registerProjectsByNameRoute(app, {
    reader,
    cost: costService,
    ...(opts.now ? { now: opts.now } : {}),
  });
  registerAgentsRoute(app, { reader });

  registerSessionsRoutes(app, {
    config: sessionsOpts.config,
    transcriptsDir: sessionsOpts.transcriptsDir,
    dataDir: sessionsOpts.dataDir,
    discoverSessions: (config, transcriptsDir) =>
      discoverSessions(config, transcriptsDir),
    readSessionRating: (dataDir, projectName, sessionId) =>
      readSessionRating(dataDir, projectName, sessionId),
    cache,
    cost: costService,
  });

  // v4-6 sessions WRITE API — the one write surface. `rubricAtRating` is
  // re-derived server-side from the shared parse+score `cache`; the client
  // body cannot inject it (design §8.3).
  registerRatingWriteRoute(app, {
    config: sessionsOpts.config,
    transcriptsDir: sessionsOpts.transcriptsDir,
    dataDir: sessionsOpts.dataDir,
    discoverSessions: (config, transcriptsDir) =>
      discoverSessions(config, transcriptsDir),
    cache,
    writeSessionRating: (rating, dataDir) => writeSessionRating(rating, dataDir),
    now,
    warnIfDataDirInGit: (dataDir) => {
      warnIfDataDirInGit(dataDir, (line) => app.log.warn(line));
    },
  });

  registerCalibrationRoute(app, {
    dataDir: sessionsOpts.dataDir,
    aggregateCalibration: (dataDir, asOf) => aggregateCalibration(dataDir, asOf),
    now,
  });

  // Virtual Software Factory control-plane (proxy to Dana Server).
  // Registered before the SPA fallback so its API routes take priority.
  registerVirtualFactoryRoutes(app);

  // SPA static + fallback last (catch-all setNotFoundHandler).
  await registerSpa(app, { staticRoot: opts.staticRoot });

  return app;
}
