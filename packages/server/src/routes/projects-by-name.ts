import type { GetProjectByNameResponse } from '@metaswarm-dashboard/types/api';
import type { FastifyInstance } from 'fastify';

import { toProjectDetail } from '../data/aggregator.js';
import type { SnapshotReader } from '../data/snapshot-reader.js';

const RECENT_WINDOW_DAYS = 14;

export interface ProjectsByNameRouteDeps {
  reader: SnapshotReader;
  /** `now` for the throughput window. Test injection. */
  now?: () => Date;
}

export function registerProjectsByNameRoute(
  app: FastifyInstance,
  deps: ProjectsByNameRouteDeps,
): void {
  const now = deps.now ?? ((): Date => new Date());
  app.get<{ Params: { name: string } }>(
    '/api/projects/:name',
    async (req, reply) => {
      const { name } = req.params;
      const known = deps.reader.listProjects();
      if (!known.includes(name)) {
        void reply.code(404).send({
          error: { code: 'project_not_found', message: `Unknown project '${name}'` },
        });
        return;
      }
      const latest = deps.reader.latestDaily(name);
      const recent = deps.reader.recentDaily(name, RECENT_WINDOW_DAYS);
      const body: GetProjectByNameResponse = toProjectDetail(name, latest, recent, now());
      void reply.code(200).type('application/json').send(body);
    },
  );
}
