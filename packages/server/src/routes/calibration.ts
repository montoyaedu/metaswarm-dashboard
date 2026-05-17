// The calibration summary endpoint (sessions-spike WU v4-5, design §7):
//   GET /api/calibration → { summary: CalibrationSummary }
//
// The summary is derived, never stored — it aggregates every persisted
// `SessionRating` in the datalake on each request. An empty datalake yields
// a valid all-zero summary (the no-ratings state the UI renders before the
// operator has rated anything).

import type { FastifyInstance } from 'fastify';

import { type CalibrationRouteDeps } from './sessions-deps.js';

export function registerCalibrationRoute(
  app: FastifyInstance,
  deps: CalibrationRouteDeps,
): void {
  app.get('/api/calibration', async (_req, reply) => {
    const summary = deps.aggregateCalibration(deps.dataDir, deps.now());
    void reply.code(200).type('application/json').send({ summary });
  });
}
