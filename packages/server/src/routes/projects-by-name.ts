// `GET /api/projects/:name` — project detail (per WU-4; v5-7 cost + §7 join).
//
// The §7 namespace join (see `projects.ts`): the v4 detail was served purely
// from the SNAPSHOT namespace and 404'd a name it did not hold. v5-7 widens
// it — a project in the CONFIG namespace (cost data, no snapshot) STILL
// renders. The detail gains `cost: ProjectCostSummary`:
//
//   - a project in BOTH namespaces  → the snapshot detail + its cost;
//   - a project in CONFIG only      → a zero-metric detail + its cost;
//   - a project in the SNAPSHOT only → the snapshot detail + a `0`-cost
//                                      `ProjectCostSummary`;
//   - a name in NEITHER namespace   → `404 project_not_found`.

import type { ProjectDetail } from '@metaswarm-dashboard/types/api';
import type { ProjectCostSummary } from '@metaswarm-dashboard/types/cost';
import type { FastifyInstance } from 'fastify';

import { toProjectDetail } from '../data/aggregator.js';
import type { CostService } from '../data/cost-service.js';
import type { SnapshotReader } from '../data/snapshot-reader.js';

const RECENT_WINDOW_DAYS = 14;

export interface ProjectsByNameRouteDeps {
  reader: SnapshotReader;
  /** sessions-spike v5-7 (design §7): the cost service for the namespace join. */
  cost: CostService;
  /** `now` for the throughput window. Test injection. */
  now?: () => Date;
}

/**
 * A `ProjectDetail` widened with the v5-7 cost summary (design §7). Additive:
 * a `ProjectDetail`-typed consumer ignores `cost`.
 */
export interface ProjectDetailWithCost extends ProjectDetail {
  /** The project's full per-vendor cost roll-up. */
  cost: ProjectCostSummary;
  /** The pinned pricing table's `pricingAsOf` (`YYYY-MM-DD`). */
  pricingAsOf: string;
}

/** A zero-metric `ProjectDetail` for a config-only project (no snapshot). */
function emptyDetail(name: string): ProjectDetail {
  return {
    name,
    agents: [],
    // `toProjectDetail` always returns 14 throughput points; a config-only
    // project has none, so emit 14 zero-filled placeholders to keep the
    // contract identical for the SPA.
    throughput: [],
    recentWorkUnits: [],
    lastActivityAt: null,
  };
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
      const costs = deps.cost.projectCosts();
      const inSnapshot = deps.reader.listProjects().includes(name);
      const projectCost = costs.byProject.get(name) ?? null;

      // §7: a name in NEITHER namespace is a genuine miss.
      if (!inSnapshot && projectCost === null) {
        void reply.code(404).send({
          error: { code: 'project_not_found', message: `Unknown project '${name}'` },
        });
        return;
      }

      // The snapshot side — the v4 detail, or a zero-metric placeholder for a
      // config-only project.
      const base: ProjectDetail = inSnapshot
        ? toProjectDetail(
            name,
            deps.reader.latestDaily(name),
            deps.reader.recentDaily(name, RECENT_WINDOW_DAYS),
            now(),
          )
        : emptyDetail(name);

      // The cost side — the project's `ProjectCostSummary`, or a `0`-cost
      // summary for a snapshot-only project (no config entry, no cost).
      const cost: ProjectCostSummary = projectCost ?? {
        projectName: name,
        byVendor: {
          anthropic: { costUsd: 0, runCount: 0, hasUnpriced: false },
          openai: { costUsd: 0, runCount: 0, hasUnpriced: false },
          google: { costUsd: 0, runCount: 0, hasUnpriced: false },
        },
        totalCostUsd: 0,
        hasUnpriced: false,
        pricingAsOf: costs.pricingAsOf,
      };

      const body: ProjectDetailWithCost = {
        ...base,
        cost,
        pricingAsOf: costs.pricingAsOf,
      };
      void reply.code(200).type('application/json').send(body);
    },
  );
}
