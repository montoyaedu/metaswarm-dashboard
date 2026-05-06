import type { GetAgentsResponse } from '@metaswarm-dashboard/types/api';
import type { FastifyInstance } from 'fastify';

import { toAgentAggregates } from '../data/aggregator.js';
import type { SnapshotReader } from '../data/snapshot-reader.js';

export interface AgentsRouteDeps {
  reader: SnapshotReader;
}

export function registerAgentsRoute(
  app: FastifyInstance,
  deps: AgentsRouteDeps,
): void {
  app.get('/api/agents', async (_req, reply) => {
    const names = deps.reader.listProjects();
    const perProject = names.map((name) => ({
      name,
      latest: deps.reader.latestDaily(name),
    }));
    const body: GetAgentsResponse = toAgentAggregates(perProject);
    void reply.code(200).type('application/json').send(body);
  });
}
