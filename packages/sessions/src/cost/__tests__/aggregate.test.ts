// Tests for `aggregateProjectCost` — per-project per-vendor cost aggregation
// (sessions-spike WU v5-5, design §5.4 / §6 / §4.4).
//
// `aggregateProjectCost` is a PURE function: it combines, per config project,
// the Claude `SessionCost`s for that project with the Codex/Gemini
// `DelegationRun`s attributed to it (`DelegationRun.projectName`), into a
// `ProjectCostSummary`. It performs NO filesystem / I/O — its inputs are the
// already-costed outputs of v5-2 (`computeSessionCost`), v5-3
// (`discoverCodexRuns`) and v5-4 (`discoverGeminiRuns`).
//
// These tests build `SessionCost` / `DelegationRun` values directly (the
// function under test is pure and vendor-shape-agnostic) and assert the
// roll-up arithmetic, the always-present three-vendor `byVendor`, the
// lower-bound `hasUnpriced` semantics, and the `unattributed` bucket.

import type {
  DelegationRun,
  SessionCost,
  TokenUsage,
} from '@metaswarm-dashboard/types/cost';
import { ProjectCostSummary } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import { aggregateProjectCost } from '../aggregate.js';
import { loadPricingTable } from '../pricing.js';

/** An all-zero `TokenUsage` — these tests do not exercise usage arithmetic. */
const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  reasoningTokens: 0,
};

/** Build a Claude `SessionCost` with a given priced total / unpriced flag. */
function sessionCost(
  sessionId: string,
  totalCostUsd: number,
  hasUnpriced = false,
): SessionCost {
  return {
    sessionId,
    vendor: 'anthropic',
    byModel: [],
    totalCostUsd,
    hasUnpriced,
  };
}

/** Build a Codex/Gemini `DelegationRun`. */
function delegationRun(
  vendor: DelegationRun['vendor'],
  projectName: string | null,
  costUsd: number | null,
): DelegationRun {
  return {
    vendor,
    model: vendor === 'openai' ? 'gpt-5.5' : 'gemini-pro',
    projectName,
    at: '2026-05-19T00:00:00',
    usage: ZERO_USAGE,
    costUsd,
  };
}

const PRICING_AS_OF = loadPricingTable().pricingAsOf;

describe('aggregateProjectCost — per-project per-vendor roll-up (§6)', () => {
  it('aggregates a project with Claude + Codex + Gemini cost', () => {
    const summaries = aggregateProjectCost({
      projects: [
        {
          projectName: 'repo',
          sessionCosts: [sessionCost('s1', 1.5), sessionCost('s2', 0.5)],
        },
      ],
      delegationRuns: [
        delegationRun('openai', 'repo', 0.25),
        delegationRun('openai', 'repo', 0.75),
        delegationRun('google', 'repo', 2),
      ],
    });

    expect(summaries).toHaveLength(1);
    const repo = summaries[0]!;
    expect(repo.projectName).toBe('repo');

    // anthropic rollup = the project's SessionCosts.
    expect(repo.byVendor.anthropic).toEqual({
      costUsd: 2, // 1.5 + 0.5
      runCount: 2, // two sessions
      hasUnpriced: false,
    });
    // openai rollup = the Codex DelegationRuns.
    expect(repo.byVendor.openai).toEqual({
      costUsd: 1, // 0.25 + 0.75
      runCount: 2,
      hasUnpriced: false,
    });
    // google rollup = the Gemini DelegationRuns.
    expect(repo.byVendor.google).toEqual({
      costUsd: 2,
      runCount: 1,
      hasUnpriced: false,
    });

    // totalCostUsd = sum of the three vendor costUsd.
    expect(repo.totalCostUsd).toBe(5);
    expect(repo.hasUnpriced).toBe(false);
    expect(repo.pricingAsOf).toBe(PRICING_AS_OF);
  });

  it('shows zero-run vendors as 0 / 0 — never omitted', () => {
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'claude-only', sessionCosts: [sessionCost('s1', 3)] },
      ],
      delegationRuns: [],
    });

    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    // byVendor ALWAYS has all three keys.
    expect(Object.keys(summary.byVendor).sort()).toEqual([
      'anthropic',
      'google',
      'openai',
    ]);
    expect(summary.byVendor.anthropic).toEqual({
      costUsd: 3,
      runCount: 1,
      hasUnpriced: false,
    });
    // openai / google have no runs → 0 / 0, present not omitted.
    expect(summary.byVendor.openai).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(summary.byVendor.google).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(summary.totalCostUsd).toBe(3);
    expect(summary.hasUnpriced).toBe(false);
  });

  it('treats an empty project as 0 / false across every vendor', () => {
    const summaries = aggregateProjectCost({
      projects: [{ projectName: 'empty', sessionCosts: [] }],
      delegationRuns: [],
    });

    expect(summaries).toHaveLength(1);
    const empty = summaries[0]!;
    expect(empty.byVendor.anthropic).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(empty.byVendor.openai).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(empty.byVendor.google).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(empty.totalCostUsd).toBe(0);
    expect(empty.hasUnpriced).toBe(false);
  });
});

describe('aggregateProjectCost — unpriced / lower-bound semantics (§5.3 / §6)', () => {
  it('flags hasUnpriced and keeps a lower-bound total when a session is unpriced', () => {
    const summaries = aggregateProjectCost({
      projects: [
        {
          projectName: 'repo',
          // s2 had an unpriced model; its totalCostUsd is already a lower
          // bound (the priced contributions only).
          sessionCosts: [sessionCost('s1', 4.2), sessionCost('s2', 0, true)],
        },
      ],
      delegationRuns: [],
    });

    const repo = summaries[0]!;
    expect(repo.byVendor.anthropic).toEqual({
      costUsd: 4.2, // priced-sum lower bound
      runCount: 2, // both sessions still counted
      hasUnpriced: true,
    });
    expect(repo.hasUnpriced).toBe(true);
    expect(repo.totalCostUsd).toBe(4.2);
  });

  it('flags hasUnpriced when a delegation run has a null costUsd', () => {
    const summaries = aggregateProjectCost({
      projects: [{ projectName: 'repo', sessionCosts: [] }],
      delegationRuns: [
        delegationRun('openai', 'repo', 1),
        // An unpriced Codex run — costUsd: null. Still counted in runCount,
        // excluded from the priced-sum.
        delegationRun('openai', 'repo', null),
        delegationRun('google', 'repo', null),
      ],
    });

    const repo = summaries[0]!;
    expect(repo.byVendor.openai).toEqual({
      costUsd: 1, // the priced run only
      runCount: 2, // both runs counted
      hasUnpriced: true,
    });
    expect(repo.byVendor.google).toEqual({
      costUsd: 0, // the only run was unpriced
      runCount: 1,
      hasUnpriced: true,
    });
    // anthropic had nothing → not a source of hasUnpriced.
    expect(repo.byVendor.anthropic.hasUnpriced).toBe(false);
    // ANY vendor unpriced ⇒ the project total is a lower bound.
    expect(repo.hasUnpriced).toBe(true);
    expect(repo.totalCostUsd).toBe(1);
  });
});

describe('aggregateProjectCost — the unattributed bucket (§4.4)', () => {
  it('routes a projectName:null run into an `unattributed` ProjectCostSummary', () => {
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'repo', sessionCosts: [sessionCost('s1', 1)] },
      ],
      delegationRuns: [
        delegationRun('openai', 'repo', 0.5),
        // These two have no configured project — the unattributed bucket.
        delegationRun('openai', null, 0.3),
        delegationRun('google', null, 0.2),
      ],
    });

    expect(summaries).toHaveLength(2);
    const byName = new Map(summaries.map((s) => [s.projectName, s]));

    const repo = byName.get('repo')!;
    expect(repo.byVendor.openai.runCount).toBe(1);
    expect(repo.totalCostUsd).toBe(1.5);

    const unattributed = byName.get('unattributed')!;
    expect(unattributed.byVendor.openai).toEqual({
      costUsd: 0.3,
      runCount: 1,
      hasUnpriced: false,
    });
    expect(unattributed.byVendor.google).toEqual({
      costUsd: 0.2,
      runCount: 1,
      hasUnpriced: false,
    });
    // No Claude sessions are ever unattributed (a v4 session always maps to a
    // project) — the anthropic rollup of the bucket is always 0 / 0.
    expect(unattributed.byVendor.anthropic).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(unattributed.totalCostUsd).toBeCloseTo(0.5, 9);
    expect(unattributed.hasUnpriced).toBe(false);
  });

  it('does not emit an `unattributed` bucket when every run is attributed', () => {
    const summaries = aggregateProjectCost({
      projects: [{ projectName: 'repo', sessionCosts: [] }],
      delegationRuns: [delegationRun('openai', 'repo', 1)],
    });
    expect(summaries.map((s) => s.projectName)).toEqual(['repo']);
  });

  it('emits ONLY the `unattributed` bucket when there are no configured projects', () => {
    const summaries = aggregateProjectCost({
      projects: [],
      delegationRuns: [delegationRun('google', null, 0.9)],
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.projectName).toBe('unattributed');
    expect(summaries[0]!.byVendor.google.costUsd).toBeCloseTo(0.9, 9);
  });

  it('returns an empty array for empty input', () => {
    expect(
      aggregateProjectCost({ projects: [], delegationRuns: [] }),
    ).toEqual([]);
  });
});

describe('aggregateProjectCost — multi-project & attribution routing', () => {
  it('keeps two projects separate and routes runs by projectName', () => {
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'alpha', sessionCosts: [sessionCost('a1', 1)] },
        { projectName: 'beta', sessionCosts: [sessionCost('b1', 2)] },
      ],
      delegationRuns: [
        delegationRun('openai', 'alpha', 0.1),
        delegationRun('google', 'beta', 0.2),
      ],
    });

    const byName = new Map(summaries.map((s) => [s.projectName, s]));
    expect(byName.get('alpha')!.byVendor.openai.runCount).toBe(1);
    expect(byName.get('alpha')!.byVendor.google.runCount).toBe(0);
    expect(byName.get('beta')!.byVendor.google.runCount).toBe(1);
    expect(byName.get('beta')!.byVendor.openai.runCount).toBe(0);
    expect(byName.get('alpha')!.totalCostUsd).toBeCloseTo(1.1, 9);
    expect(byName.get('beta')!.totalCostUsd).toBeCloseTo(2.2, 9);
  });

  it('preserves the input project order, with `unattributed` appended last', () => {
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'zeta', sessionCosts: [] },
        { projectName: 'alpha', sessionCosts: [] },
      ],
      delegationRuns: [delegationRun('openai', null, 0.5)],
    });
    expect(summaries.map((s) => s.projectName)).toEqual([
      'zeta',
      'alpha',
      'unattributed',
    ]);
  });

  it('folds a project listed twice into a single summary', () => {
    // A defensive contract: if the caller lists the same project name in two
    // `projects` entries, their session costs fold into ONE accumulator —
    // the output never carries a duplicate `ProjectCostSummary`.
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'repo', sessionCosts: [sessionCost('s1', 1)] },
        { projectName: 'repo', sessionCosts: [sessionCost('s2', 2)] },
      ],
      delegationRuns: [],
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.projectName).toBe('repo');
    expect(summaries[0]!.byVendor.anthropic).toEqual({
      costUsd: 3, // 1 + 2 folded into one accumulator
      runCount: 2,
      hasUnpriced: false,
    });
  });

  it('attributes a run to a project that has no Claude sessions of its own', () => {
    // A config project may have delegation runs but no Claude transcripts —
    // the caller still lists it in `projects` (it is a config namespace
    // entry); its anthropic rollup is then 0 / 0.
    const summaries = aggregateProjectCost({
      projects: [{ projectName: 'codex-only', sessionCosts: [] }],
      delegationRuns: [delegationRun('openai', 'codex-only', 3)],
    });
    const summary = summaries[0]!;
    expect(summary.byVendor.anthropic).toEqual({
      costUsd: 0,
      runCount: 0,
      hasUnpriced: false,
    });
    expect(summary.byVendor.openai.costUsd).toBe(3);
    expect(summary.totalCostUsd).toBe(3);
  });

  it('drops a delegation run whose projectName matches no listed project into `unattributed`', () => {
    // Defensive: a run names a project the caller did not list in `projects`.
    // It is NOT silently dropped — it lands in the unattributed bucket so the
    // cost still surfaces in the global total (§4.4: never silently dropped).
    const summaries = aggregateProjectCost({
      projects: [{ projectName: 'repo', sessionCosts: [] }],
      delegationRuns: [delegationRun('openai', 'ghost-project', 0.4)],
    });
    const byName = new Map(summaries.map((s) => [s.projectName, s]));
    expect(byName.has('repo')).toBe(true);
    expect(byName.get('repo')!.byVendor.openai.runCount).toBe(0);
    expect(byName.get('unattributed')!.byVendor.openai).toEqual({
      costUsd: 0.4,
      runCount: 1,
      hasUnpriced: false,
    });
  });
});

describe('v5-5 public surface', () => {
  it('re-exports aggregateProjectCost from the package index', () => {
    expect(sessions.aggregateProjectCost).toBe(aggregateProjectCost);
    expect(typeof sessions.aggregateProjectCost).toBe('function');
  });

  it('produces ProjectCostSummary values that round-trip through the Zod schema', () => {
    const summaries = aggregateProjectCost({
      projects: [
        { projectName: 'repo', sessionCosts: [sessionCost('s1', 1, true)] },
      ],
      delegationRuns: [
        delegationRun('openai', 'repo', null),
        delegationRun('google', null, 0.5),
      ],
    });
    for (const summary of summaries) {
      expect(() => ProjectCostSummary.parse(summary)).not.toThrow();
    }
  });
});
