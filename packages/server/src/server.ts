// Fastify server factory (per WU-4). Returns an instance suitable for
// `app.inject()` (no port binding); production callers `listen()` it
// themselves in cli/serve.ts.

import Fastify, { type FastifyInstance } from 'fastify';

import { SnapshotReader } from './data/snapshot-reader.js';
import { registerMethodGuard } from './plugins/method-guard.js';
import { registerSpa } from './plugins/spa.js';
import { registerAgentsRoute } from './routes/agents.js';
import { registerProjectsByNameRoute } from './routes/projects-by-name.js';
import { registerProjectsRoute } from './routes/projects.js';

export interface BuildServerOptions {
  /** Where snapshots live. `<dataDir>/projects/<name>/daily/<key>.json`. */
  dataDir: string;
  /** Where the SPA build output (or test stub) lives. */
  staticRoot: string;
  /** Inject `now` for tests. */
  now?: () => Date;
  /** Override Fastify logger options. */
  logger?: boolean;
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  const reader = new SnapshotReader(opts.dataDir);

  // Method guard MUST be installed before route handlers so non-GET
  // requests on /api/* are rejected before any handler logic runs.
  registerMethodGuard(app);

  registerProjectsRoute(app, { reader });
  registerProjectsByNameRoute(app, { reader, ...(opts.now ? { now: opts.now } : {}) });
  registerAgentsRoute(app, { reader });

  // SPA static + fallback last (catch-all setNotFoundHandler).
  await registerSpa(app, { staticRoot: opts.staticRoot });

  return app;
}
