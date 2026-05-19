// `GET /api/projects` — the projects index (per WU-4; v5-7 cost + §7 join).
//
// The §7 NAMESPACE JOIN (Architect blocker A1). Cost aggregation keys on the
// CONFIG.yaml project namespace; the project index is served from the
// SNAPSHOT namespace (`SnapshotReader`, which lists datalake directories).
// The two are joined BY PROJECT NAME:
//
//   - a project in BOTH namespaces  → its snapshot row + its cost;
//   - a project in CONFIG only      → still rendered, as a cost-only row
//                                     (a zero-metric `ProjectSummary` with
//                                     its cost fields populated);
//   - a project in the SNAPSHOT only → still rendered, with cost `0` / not
//                                      unpriced;
//   - cost resolving to NO config project → the §7 `unattributed` bucket,
//     appended as a synthetic trailing row (`name: 'unattributed'`) ONLY
//     when that bucket carries cost.
//
// The response stays a bare `ProjectSummary[]` (the v4 shape the SPA consumes
// directly); the v5-7 cost fields (`totalCostUsd`, `hasUnpriced`,
// `pricingAsOf`) are ADDITIVE per row.

import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import type { FastifyInstance } from 'fastify';

import { toProjectSummary } from '../data/aggregator.js';
import type { CostService } from '../data/cost-service.js';
import type { SnapshotReader } from '../data/snapshot-reader.js';

export interface ProjectsRouteDeps {
  reader: SnapshotReader;
  /**
   * sessions-spike v5-7 (design §7): the cost service — the source of the
   * config-namespace cost rows joined onto the snapshot namespace.
   */
  cost: CostService;
}

/**
 * A `ProjectSummary` widened with the v5-7 cost fields (design §7). Additive:
 * a `ProjectSummary`-typed consumer ignores the extra keys, so the response
 * stays a structurally-valid `GetProjectsResponse`.
 */
export interface ProjectSummaryWithCost extends ProjectSummary {
  /** The project's total AI cost in USD (sum of priced contributions). */
  totalCostUsd: number;
  /** `true` when a contributing model was unpriced — `totalCostUsd` is then a lower bound. */
  hasUnpriced: boolean;
  /** The pinned pricing table's `pricingAsOf` (`YYYY-MM-DD`). */
  pricingAsOf: string;
}

export function registerProjectsRoute(
  app: FastifyInstance,
  deps: ProjectsRouteDeps,
): void {
  app.get('/api/projects', async (_req, reply) => {
    const costs = deps.cost.projectCosts();
    const snapshotNames = deps.reader.listProjects();

    // The join key set: every project in EITHER namespace, snapshot order
    // first (it is the v4-stable order), config-only projects appended.
    const seen = new Set<string>();
    const rows: ProjectSummaryWithCost[] = [];

    /** Build one row, joining the snapshot summary with the cost summary. */
    const pushRow = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      const base = toProjectSummary(name, deps.reader.latestDaily(name));
      const projectCost = costs.byProject.get(name);
      rows.push({
        ...base,
        // A snapshot-only project has no cost summary → `0 / false`.
        totalCostUsd: projectCost?.totalCostUsd ?? 0,
        hasUnpriced: projectCost?.hasUnpriced ?? false,
        pricingAsOf: costs.pricingAsOf,
      });
    };

    // 1. Every snapshot-namespace project (a project in BOTH, or SNAPSHOT
    //    only, joins here).
    for (const name of snapshotNames) {
      pushRow(name);
    }
    // 2. Every config-namespace project not already rendered — a CONFIG-only
    //    project still renders, as a cost-only row.
    for (const name of costs.byProject.keys()) {
      pushRow(name);
    }
    // 3. The §7 `unattributed` bucket — appended as a synthetic trailing row
    //    ONLY when cost resolved to no config project.
    if (costs.unattributed !== null) {
      rows.push({
        name: 'unattributed',
        path: '',
        category: 'metaswarm',
        activeTasks: 0,
        blockedTasks: 0,
        prsMergedLast7d: null,
        lastActivityAt: null,
        hasMetrics: false,
        collectionStatus: 'ok',
        collectionWarnings: [],
        totalCostUsd: costs.unattributed.totalCostUsd,
        hasUnpriced: costs.unattributed.hasUnpriced,
        pricingAsOf: costs.pricingAsOf,
      });
    }

    void reply.code(200).type('application/json').send(rows);
  });
}
