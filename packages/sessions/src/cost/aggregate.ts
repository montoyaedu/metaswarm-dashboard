// Per-project per-vendor cost aggregation (sessions-spike WU v5-5,
// design §5.4 / §6 / §4.4).
//
// `aggregateProjectCost` combines, for each config-namespace project, the
// Claude `SessionCost`s computed for that project (v5-2 `computeSessionCost`)
// with the Codex / Gemini `DelegationRun`s attributed to it (v5-3
// `discoverCodexRuns`, v5-4 `discoverGeminiRuns`) into a `ProjectCostSummary`.
//
// PURE FUNCTION — no filesystem, no I/O. Its inputs are the already-costed
// outputs of the v5-2/3/4 readers; its only ambient read is the pinned
// pricing table's `pricingAsOf` string, which is echoed onto every summary
// (design §6). The §5.4 two-level cost cache lives in v5-7's `cost-cache.ts`,
// NOT here — this module recomputes deterministically from its inputs.
//
// Input-shape decision (§5.4 / the v5-7 server caller). `SessionCost` carries
// a `sessionId` but NOT a project name, so the session→project grouping must
// come from the caller. The v5-7 server already groups Claude transcripts by
// config project (`discoverSessions` walks per-project transcript dirs) and
// the Codex/Gemini readers already return a FLAT `DelegationRun[]` whose
// per-run `projectName` is the attribution. So the natural input is:
//
//   { projects: { projectName, sessionCosts }[], delegationRuns: DelegationRun[] }
//
// — a per-project session grouping plus the flat run list. This matches what
// the server has in hand with zero re-shaping, and keeps the `projects` array
// as the authoritative project ORDER (the server controls the config order).
//
// Attribution routing (§4.4):
//   - A `DelegationRun.projectName` that matches a listed project → that
//     project's rollup.
//   - A `DelegationRun.projectName` of `null`, OR a name that matches no
//     listed project, → the `unattributed` bucket — never silently dropped.
//   - Claude `SessionCost`s are always attributed (a v4 session maps to a
//     project), so they only ever feed a listed project's anthropic rollup.
//
// Roll-up semantics (§6):
//   - `VendorCostRollup.costUsd` is the PRICED-sum (a number, possibly 0);
//     `runCount` counts every contribution (priced or not); `hasUnpriced` is
//     true iff any contribution was unpriced.
//   - `ProjectCostSummary.totalCostUsd` is the sum of the three vendor
//     priced-sums; `hasUnpriced` is true iff ANY vendor rollup is unpriced —
//     a true total is then a lower bound.
//   - `byVendor` ALWAYS carries all three keys; a vendor with no
//     contributions is `{ costUsd: 0, runCount: 0, hasUnpriced: false }`.
//   - An `unattributed` bucket is emitted ONLY when at least one run is
//     unattributed; an all-attributed input yields no bucket.

import type {
  DelegationRun,
  ProjectCostSummary,
  SessionCost,
  VendorCostRollup,
} from '@metaswarm-dashboard/types/cost';

import { loadPricingTable } from './pricing.js';

/** The catch-all project name for cost that resolves to no config project. */
const UNATTRIBUTED = 'unattributed';

/**
 * One config-namespace project's Claude session costs, as supplied by the
 * caller. `sessionCosts` is that project's `computeSessionCost` outputs (v5-2)
 * — possibly empty for a config project with delegation runs but no Claude
 * transcripts.
 */
export interface ProjectSessionCosts {
  /** The config.yaml project name (the cost-aggregation key — design §4.4). */
  projectName: string;
  /** The project's Claude `SessionCost`s (`computeSessionCost` outputs). */
  sessionCosts: readonly SessionCost[];
}

/**
 * The input to `aggregateProjectCost`. `projects` is the config-namespace
 * project list (its order is preserved in the output); `delegationRuns` is
 * the flat, vendor-mixed list of Codex + Gemini runs from the v5-3 / v5-4
 * readers, each carrying its own `projectName` attribution.
 */
export interface AggregateProjectCostInput {
  /** The config projects, each with its Claude `SessionCost`s. */
  projects: readonly ProjectSessionCosts[];
  /** Every Codex/Gemini `DelegationRun` (mixed vendors, mixed projects). */
  delegationRuns: readonly DelegationRun[];
}

/** A zero `VendorCostRollup` — a vendor with no contributions (design §6). */
function zeroRollup(): VendorCostRollup {
  return { costUsd: 0, runCount: 0, hasUnpriced: false };
}

/**
 * Fold one Claude `SessionCost` into the anthropic rollup (mutating it).
 *
 * Each session is one `runCount` unit. `SessionCost.totalCostUsd` is already
 * the priced-sum lower bound (v5-2); `SessionCost.hasUnpriced` flags that the
 * session contained an unpriced model.
 */
function foldSessionCost(rollup: VendorCostRollup, session: SessionCost): void {
  rollup.costUsd += session.totalCostUsd;
  rollup.runCount += 1;
  if (session.hasUnpriced) {
    rollup.hasUnpriced = true;
  }
}

/**
 * Fold one `DelegationRun` into its vendor rollup (mutating it).
 *
 * Every run is one `runCount` unit, priced or not. A run with `costUsd: null`
 * is unpriced (design §5.3) — it does not enter the priced-sum and it sets
 * `hasUnpriced`.
 */
function foldDelegationRun(rollup: VendorCostRollup, run: DelegationRun): void {
  rollup.runCount += 1;
  if (run.costUsd === null) {
    rollup.hasUnpriced = true;
  } else {
    rollup.costUsd += run.costUsd;
  }
}

/** A per-project accumulator: the three vendor rollups, built incrementally. */
interface ProjectAccumulator {
  anthropic: VendorCostRollup;
  openai: VendorCostRollup;
  google: VendorCostRollup;
}

/** A fresh accumulator with all three vendor rollups zeroed. */
function newAccumulator(): ProjectAccumulator {
  return {
    anthropic: zeroRollup(),
    openai: zeroRollup(),
    google: zeroRollup(),
  };
}

/**
 * Finalize one project accumulator into a `ProjectCostSummary` (design §6).
 *
 * `totalCostUsd` is the sum of the three vendor priced-sums; `hasUnpriced` is
 * true iff ANY vendor rollup is unpriced. `pricingAsOf` is echoed from the
 * pinned pricing table so the UI can show "prices as of …".
 */
function finalize(
  projectName: string,
  acc: ProjectAccumulator,
  pricingAsOf: string,
): ProjectCostSummary {
  const totalCostUsd =
    acc.anthropic.costUsd + acc.openai.costUsd + acc.google.costUsd;
  const hasUnpriced =
    acc.anthropic.hasUnpriced ||
    acc.openai.hasUnpriced ||
    acc.google.hasUnpriced;
  return {
    projectName,
    byVendor: {
      anthropic: acc.anthropic,
      openai: acc.openai,
      google: acc.google,
    },
    totalCostUsd,
    hasUnpriced,
    pricingAsOf,
  };
}

/**
 * Aggregate per-project, per-vendor AI cost (design §5.4 / §6 / §4.4).
 *
 * For each listed config project, combine its Claude `SessionCost`s with the
 * Codex / Gemini `DelegationRun`s attributed to it into a `ProjectCostSummary`
 * whose `byVendor` carries all three vendors (a vendor with no contributions
 * shows `0 / 0`). Runs whose `projectName` is `null` — or names a project not
 * in `projects` — are collected into a single trailing `unattributed` bucket;
 * that bucket is emitted ONLY when at least one such run exists.
 *
 * Pure: no filesystem, no I/O. The output project order is `projects`' order,
 * with `unattributed` (when present) appended last.
 *
 * @param input - The config projects (each with its Claude session costs) and
 *   the flat list of every Codex/Gemini `DelegationRun`.
 * @returns One `ProjectCostSummary` per listed project, plus a trailing
 *   `unattributed` summary iff any run was unattributed. An empty input
 *   yields `[]`.
 */
export function aggregateProjectCost(
  input: AggregateProjectCostInput,
): ProjectCostSummary[] {
  const pricingAsOf = loadPricingTable().pricingAsOf;

  // Seed one accumulator per listed project, in input order. A `Map` keyed by
  // project name gives O(1) attribution routing while preserving that order.
  const accumulators = new Map<string, ProjectAccumulator>();
  for (const project of input.projects) {
    // A project listed twice: fold both groups into the same accumulator
    // rather than emitting a duplicate summary.
    let acc = accumulators.get(project.projectName);
    if (acc === undefined) {
      acc = newAccumulator();
      accumulators.set(project.projectName, acc);
    }
    for (const session of project.sessionCosts) {
      foldSessionCost(acc.anthropic, session);
    }
  }

  // Route each delegation run. A `null` projectName — or a name absent from
  // the listed projects — lands in the `unattributed` bucket (§4.4: cost is
  // never silently dropped). The bucket is created lazily so an all-attributed
  // input emits no `unattributed` summary.
  let unattributed: ProjectAccumulator | undefined;
  for (const run of input.delegationRuns) {
    let acc =
      run.projectName === null
        ? undefined
        : accumulators.get(run.projectName);
    if (acc === undefined) {
      unattributed ??= newAccumulator();
      acc = unattributed;
    }
    // `run.vendor` is a `VendorId` — exactly the three `byVendor` keys — so
    // this route is total. The v5-3/v5-4 readers only ever emit `openai` /
    // `google` runs; an `anthropic` `DelegationRun` (a reader contract
    // violation) would still fold into the anthropic rollup, never be lost.
    foldDelegationRun(acc[run.vendor], run);
  }

  const summaries: ProjectCostSummary[] = [];
  for (const [projectName, acc] of accumulators) {
    summaries.push(finalize(projectName, acc, pricingAsOf));
  }
  if (unattributed !== undefined) {
    summaries.push(finalize(UNATTRIBUTED, unattributed, pricingAsOf));
  }
  return summaries;
}
