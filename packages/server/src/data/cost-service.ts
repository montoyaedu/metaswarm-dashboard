// Cost service — the route-layer cost seam (sessions-spike WU v5-7, design
// §7 / §5.4).
//
// `createCostService` wraps the v5 sessions-package cost surface
// (`parseTranscriptUsage`, `computeSessionCost`, `discoverCodexRuns`,
// `discoverGeminiRuns`, `aggregateProjectCost`, `loadPricingTable`,
// `pricingTableHash`), the two-level cost cache (`cost-cache.ts`), and the
// subagent-file resolver (`session-cost-source.ts`) into the three operations
// the GET routes need:
//
//   - `sessionCost(ref)`        — one Claude session's `SessionCost`. The
//     cost is computed over the session's main transcript AND its sibling
//     `subagents/agent-*.jsonl` files (the v5-2 subagent-file finding — see
//     `session-cost-source.ts`): each file's `AssistantUsageRecord[]` is
//     concatenated, then `computeSessionCost` prices the merged list.
//   - `sessionSummaryCost(ref)` — the `SessionSummary` cost fields.
//     `costUsd` is `null` IFF the session has no costable assistant records
//     (`byModel` empty); otherwise the priced-sum number (incl. `0`).
//   - `projectCosts()`          — the §7 namespace-keyed aggregate: a `Map`
//     of config-project name → `ProjectCostSummary`, the `unattributed`
//     bucket, and the pricing table's `pricingAsOf`.
//
// CACHING (design §5.4). Every per-file JSONL scan flows through the cost
// cache's leaf cache. Each project's `aggregateProjectCost` call flows
// through the aggregate cache, keyed on the project's source-file set + a
// composite hash that folds the pricing-table content hash with the
// project's delegation runs — so a changed transcript, a changed price
// table, or a changed Codex/Gemini run all invalidate the project's entry.

import { createHash } from 'node:crypto';

import {
  aggregateProjectCost as defaultAggregateProjectCost,
  computeSessionCost,
  discoverCodexRuns as defaultDiscoverCodexRuns,
  discoverGeminiRuns as defaultDiscoverGeminiRuns,
  discoverSessions as defaultDiscoverSessions,
  loadPricingTable,
  parseTranscriptUsage as defaultParseTranscriptUsage,
  pricingTableHash,
  type AggregateProjectCostInput,
  type AssistantUsageRecord,
  type ProjectSessionCosts,
  type SessionRef,
} from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import type {
  DelegationRun,
  ProjectCostSummary,
  SessionCost,
} from '@metaswarm-dashboard/types/cost';

import type { CostCache } from './cost-cache.js';
import { sessionCostSources } from './session-cost-source.js';

/** The `SessionSummary` cost projection — the `/api/sessions` row fields. */
export interface SessionSummaryCost {
  /**
   * The session's total AI cost in USD — `null` IFF the session has no
   * costable assistant records, otherwise the priced-sum number (incl. `0`).
   */
  costUsd: number | null;
  /** `true` when a model contributing to the session was unpriced. */
  hasUnpriced: boolean;
}

/** The §7 namespace-keyed result of `projectCosts()`. */
export interface ProjectCostsResult {
  /** config-project name → its `ProjectCostSummary`. */
  byProject: Map<string, ProjectCostSummary>;
  /**
   * The catch-all bucket for cost resolving to no config project, or `null`
   * when every delegation run was attributed (design §4.4 / §7).
   */
  unattributed: ProjectCostSummary | null;
  /** Echoed from the pricing table so the UI shows "prices as of …". */
  pricingAsOf: string;
}

/** Dependencies for `createCostService`. */
export interface CostServiceDeps {
  /** The loaded dashboard config — the cost-aggregation namespace (§4.4). */
  config: Config;
  /** The two-level cost cache. */
  cache: CostCache;
  /** The transcripts root scanned by Claude-session discovery. */
  transcriptsDir: string;
  /** The Codex sessions root (`~/.codex/sessions` or its override). */
  codexSessionsDir: string;
  /** The metaswarm external-tools ledger file path. */
  externalToolsLedger: string;
  /** Parse one transcript/subagent file to `AssistantUsageRecord[]`. */
  parseTranscriptUsage?: (filePath: string) => AssistantUsageRecord[];
  /** Discover the configured projects' Claude session transcripts. */
  discoverSessions?: (config: Config, transcriptsDir: string) => SessionRef[];
  /** Discover Codex `DelegationRun`s under the sessions tree. */
  discoverCodexRuns?: (sessionsDir: string, config: Config) => DelegationRun[];
  /** Discover Gemini `DelegationRun`s from the external-tools ledger. */
  discoverGeminiRuns?: (ledgerPath: string) => DelegationRun[];
  /** Aggregate per-project per-vendor cost (the v5-5 pure function). */
  aggregateProjectCost?: (
    input: AggregateProjectCostInput,
  ) => ProjectCostSummary[];
}

/** The public cost-service surface. */
export interface CostService {
  /** One Claude session's `SessionCost` (main transcript + subagents). */
  sessionCost: (ref: SessionRef) => SessionCost;
  /** The `SessionSummary` cost fields for one session. */
  sessionSummaryCost: (ref: SessionRef) => SessionSummaryCost;
  /** The §7 namespace-keyed per-project cost aggregate. */
  projectCosts: () => ProjectCostsResult;
  /**
   * The pinned pricing table's `pricingAsOf` (`YYYY-MM-DD`). A cheap accessor
   * — it loads no transcripts — so a cost-bearing response can echo the
   * caveat without paying for a full `projectCosts()` scan (design §7 / §8.2).
   */
  pricingAsOf: () => string;
}

/** Stable short hash of a value — used to fold runs into the aggregate key. */
function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Build the cost service. All filesystem-touching collaborators default to
 * the real sessions-package functions but are injectable for unit tests.
 */
export function createCostService(deps: CostServiceDeps): CostService {
  const parseUsage = deps.parseTranscriptUsage ?? defaultParseTranscriptUsage;
  const discoverSessions = deps.discoverSessions ?? defaultDiscoverSessions;
  const discoverCodexRuns = deps.discoverCodexRuns ?? defaultDiscoverCodexRuns;
  const discoverGeminiRuns =
    deps.discoverGeminiRuns ?? defaultDiscoverGeminiRuns;
  const aggregateProjectCost =
    deps.aggregateProjectCost ?? defaultAggregateProjectCost;

  /**
   * Compute one session's `SessionCost`. The session's source files — its
   * main transcript and every sibling `subagents/agent-*.jsonl` — are each
   * parsed through the leaf cache; the records are concatenated so the
   * session's cost includes its subagents (design §4.1 / the v5-2 finding).
   */
  function sessionCost(ref: SessionRef): SessionCost {
    const sources = sessionCostSources(ref.transcriptPath);
    const merged: AssistantUsageRecord[] = [];
    for (const sourcePath of sources) {
      for (const record of deps.cache.usageFor(sourcePath, parseUsage)) {
        merged.push(record);
      }
    }
    return computeSessionCost(ref.sessionId, merged);
  }

  /**
   * Derive a session's `SessionSummary` cost fields. `costUsd` is `null` IFF
   * the session has no costable assistant records (`byModel` empty) — `0`
   * and `null` are distinct (design §6 / §5.3).
   */
  function sessionSummaryCost(ref: SessionRef): SessionSummaryCost {
    const cost = sessionCost(ref);
    return {
      costUsd: cost.byModel.length === 0 ? null : cost.totalCostUsd,
      hasUnpriced: cost.hasUnpriced,
    };
  }

  /**
   * Aggregate per-project, per-vendor cost across all three vendors, keyed on
   * the config namespace (design §7). Claude session cost is grouped by the
   * `SessionRef.projectName` discovery already assigns; Codex/Gemini runs are
   * routed by their cwd-attributed `projectName`. A run resolving to no config
   * project lands in the `unattributed` bucket.
   */
  function projectCosts(): ProjectCostsResult {
    const table = loadPricingTable();
    const tableHash = pricingTableHash();

    // 1. Group each config project's Claude session costs. `discoverSessions`
    //    only ever returns refs whose `projectName` is one of the configured
    //    projects (it walks `config.projects`), so a ref always lands in a
    //    seeded bucket — a ref for an unknown project is contractually
    //    impossible and is therefore not defended against here.
    const refs = discoverSessions(deps.config, deps.transcriptsDir);
    const sessionsByProject = new Map<string, SessionCost[]>();
    const sourcesByProject = new Map<string, string[]>();
    for (const project of deps.config.projects) {
      sessionsByProject.set(project.name, []);
      sourcesByProject.set(project.name, []);
    }
    for (const ref of refs) {
      const bucket = sessionsByProject.get(ref.projectName);
      const sources = sourcesByProject.get(ref.projectName);
      // A ref outside the config namespace cannot occur (see above); skip
      // defensively rather than crash if a custom discovery injection lies.
      /* v8 ignore next */
      if (bucket === undefined || sources === undefined) continue;
      bucket.push(sessionCost(ref));
      for (const sourcePath of sessionCostSources(ref.transcriptPath)) {
        sources.push(sourcePath);
      }
    }

    // 2. Discover every delegation run once, then route by project name.
    const codexRuns = discoverCodexRuns(deps.codexSessionsDir, deps.config);
    const geminiRuns = discoverGeminiRuns(deps.externalToolsLedger);
    const allRuns: DelegationRun[] = [...codexRuns, ...geminiRuns];
    const runsByProject = new Map<string | null, DelegationRun[]>();
    for (const run of allRuns) {
      const bucket = runsByProject.get(run.projectName) ?? [];
      bucket.push(run);
      runsByProject.set(run.projectName, bucket);
    }

    // 3. Per project, run the v5-5 aggregation through the aggregate cache.
    //    The cache key folds the project's delegation runs into the pricing
    //    hash, so a changed run invalidates the project's entry too.
    const byProject = new Map<string, ProjectCostSummary>();
    for (const project of deps.config.projects) {
      // `sessionsByProject` / `sourcesByProject` were seeded for EVERY config
      // project in step 1, so `.get` is always defined here (the `!` is
      // sound). `runsByProject` is NOT pre-seeded — `?? []` is real there.
      const sessionCosts = sessionsByProject.get(project.name)!;
      const projectRuns = runsByProject.get(project.name) ?? [];
      const sources = sourcesByProject.get(project.name)!;
      const compositeHash = `${tableHash}:${hashOf(projectRuns)}`;
      const summary = deps.cache.aggregateFor(
        project.name,
        sources,
        compositeHash,
        (projectName) => {
          const input: AggregateProjectCostInput = {
            projects: [{ projectName, sessionCosts } satisfies ProjectSessionCosts],
            delegationRuns: projectRuns,
          };
          // `aggregateProjectCost` emits exactly one summary per listed
          // project (v5-5), so a one-project input always yields `[summary]`
          // — the `[0]` is sound.
          return aggregateProjectCost(input)[0]!;
        },
      );
      byProject.set(project.name, summary);
    }

    // 4. The unattributed bucket: runs whose `projectName` matched no config
    //    project (`null`, or a name not in the config list). Computed
    //    directly (it has no stable source-file set to key a cache on).
    const unattributedRuns: DelegationRun[] = [];
    for (const [projectName, runs] of runsByProject) {
      if (projectName === null || !sessionsByProject.has(projectName)) {
        unattributedRuns.push(...runs);
      }
    }
    let unattributed: ProjectCostSummary | null = null;
    if (unattributedRuns.length > 0) {
      // With `projects: []` and ≥1 run, every run is unattributed, so the
      // v5-5 aggregator always emits exactly the trailing `unattributed`
      // summary — `[0]` is sound.
      unattributed = aggregateProjectCost({
        projects: [],
        delegationRuns: unattributedRuns,
      })[0]!;
    }

    return { byProject, unattributed, pricingAsOf: table.pricingAsOf };
  }

  /** The pinned pricing table's `pricingAsOf` — a cheap, no-I/O accessor. */
  function pricingAsOf(): string {
    return loadPricingTable().pricingAsOf;
  }

  return { sessionCost, sessionSummaryCost, projectCosts, pricingAsOf };
}
