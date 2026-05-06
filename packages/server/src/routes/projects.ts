import type {
  GetProjectsResponse,
  ProjectSummary,
} from '@metaswarm-dashboard/types/api';
import type { FastifyInstance } from 'fastify';

import { toProjectSummary } from '../data/aggregator.js';
import type { SnapshotReader } from '../data/snapshot-reader.js';

export interface ProjectsRouteDeps {
  reader: SnapshotReader;
}

export function registerProjectsRoute(
  app: FastifyInstance,
  deps: ProjectsRouteDeps,
): void {
  app.get('/api/projects', async (_req, reply) => {
    const names = deps.reader.listProjects();
    const summaries: ProjectSummary[] = names.map((name) =>
      toProjectSummary(name, deps.reader.latestDaily(name)),
    );
    const body: GetProjectsResponse = summaries;
    void reply.code(200).type('application/json').send(body);
  });
}
