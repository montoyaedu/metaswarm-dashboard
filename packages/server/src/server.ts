// Fastify server factory (per WU-4; extended for the v4-5 sessions API).
// Returns an instance suitable for `app.inject()` (no port binding);
// production callers `listen()` it themselves in cli/serve.ts.


import {
  discoverSessions,
  parseTranscript,
  readSessionRating,
  scoreTimeline,
} from '@metaswarm-dashboard/sessions';
import { loadConfig, type Config } from '@metaswarm-dashboard/types/config';
import {
  configFile,
  dataDir as resolveDataDir,
  defaultEnv,
  transcriptsDir as resolveTranscriptsDir,
  type PathsEnv,
} from '@metaswarm-dashboard/types/paths';
import Fastify, { type FastifyInstance } from 'fastify';

import { aggregateCalibration } from './data/calibration.js';
import { SnapshotReader } from './data/snapshot-reader.js';
import { createTranscriptCache } from './data/transcript-cache.js';
import { registerMethodGuard } from './plugins/method-guard.js';
import { registerSpa } from './plugins/spa.js';
import { registerAgentsRoute } from './routes/agents.js';
import { registerCalibrationRoute } from './routes/calibration.js';
import { registerProjectsByNameRoute } from './routes/projects-by-name.js';
import { registerProjectsRoute } from './routes/projects.js';
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

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const reader = new SnapshotReader(opts.dataDir);
  const now = opts.now ?? ((): Date => new Date());
  const sessionsOpts = opts.sessions ?? resolveSessionsOptions();

  // Method guard MUST be installed before route handlers so non-GET
  // requests on /api/* are rejected before any handler logic runs.
  registerMethodGuard(app);

  registerProjectsRoute(app, { reader });
  registerProjectsByNameRoute(app, { reader, ...(opts.now ? { now: opts.now } : {}) });
  registerAgentsRoute(app, { reader });

  // v4-5 sessions read API. The parse + score cache is per-server (its LRU
  // bound and mtime/size keying live in transcript-cache.ts).
  const cache = createTranscriptCache({
    parse: (transcriptPath) => parseTranscript(transcriptPath),
    score: (timeline) => scoreTimeline(timeline),
  });
  registerSessionsRoutes(app, {
    config: sessionsOpts.config,
    transcriptsDir: sessionsOpts.transcriptsDir,
    dataDir: sessionsOpts.dataDir,
    discoverSessions: (config, transcriptsDir) =>
      discoverSessions(config, transcriptsDir),
    readSessionRating: (dataDir, projectName, sessionId) =>
      readSessionRating(dataDir, projectName, sessionId),
    cache,
  });
  registerCalibrationRoute(app, {
    dataDir: sessionsOpts.dataDir,
    aggregateCalibration: (dataDir, asOf) => aggregateCalibration(dataDir, asOf),
    now,
  });

  // SPA static + fallback last (catch-all setNotFoundHandler).
  await registerSpa(app, { staticRoot: opts.staticRoot });

  return app;
}
