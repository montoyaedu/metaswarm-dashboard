// Tests for the cost service (sessions-spike WU v5-7, design §7 / §5.4).
//
// `createCostService` is the route-layer seam: it wraps the v5 sessions-
// package cost surface (`parseTranscriptUsage`, `computeSessionCost`,
// `discoverCodexRuns`, `discoverGeminiRuns`, `aggregateProjectCost`,
// `loadPricingTable`, `pricingTableHash`) plus the two-level cost cache and
// the subagent-file resolver into the three operations the GET routes need:
//
//   - `sessionCost(ref)`                — one session's `SessionCost`,
//     computed over the main transcript AND its `subagents/agent-*.jsonl`.
//   - `sessionSummaryCost(ref)`         — the `SessionSummary` cost fields:
//     `costUsd` is `null` IFF the session has no costable assistant records.
//   - `projectCosts()`                  — the §7 namespace-keyed aggregate:
//     a `Map` of config-project name → `ProjectCostSummary`, plus the
//     `unattributed` bucket and the table's `pricingAsOf`.
//
// All filesystem-touching collaborators are injected, so no test reads
// `~/.claude/` or `~/.codex/`.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AssistantUsageRecord,
  SessionRef,
} from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import type { DelegationRun } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it, vi } from 'vitest';

import { createCostCache } from '../data/cost-cache.js';
import { createCostService } from '../data/cost-service.js';

let TMP: string;

function setup(): string {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-cost-service-'));
  return TMP;
}
function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

/** A record with `claude-opus-4-7` usage that prices to a known figure. */
function opusRecord(
  overrides: Partial<AssistantUsageRecord> = {},
): AssistantUsageRecord {
  return {
    model: 'claude-opus-4-7',
    isSidechain: false,
    usage: {
      // 1M input @ $15/M + 1M output @ $75/M = $90.
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    },
    ...overrides,
  };
}

/** A `Config` from `[name, absolutePath]` pairs. */
function configOf(...projects: ReadonlyArray<readonly [string, string]>): Config {
  return {
    projects: projects.map(([name, path]) => ({
      name,
      path,
      category: 'metaswarm' as const,
    })),
  };
}

/** Build a cost service over real fixture files with injectable readers. */
function makeService(opts: {
  config: Config;
  parseUsage?: (path: string) => AssistantUsageRecord[];
  codexRuns?: DelegationRun[];
  geminiRuns?: DelegationRun[];
  discoverSessions?: () => SessionRef[];
}) {
  return createCostService({
    config: opts.config,
    cache: createCostCache(),
    transcriptsDir: '/nonexistent/transcripts',
    codexSessionsDir: '/nonexistent/codex',
    externalToolsLedger: '/nonexistent/ledger',
    parseTranscriptUsage: opts.parseUsage ?? ((): AssistantUsageRecord[] => []),
    discoverCodexRuns: () => opts.codexRuns ?? [],
    discoverGeminiRuns: () => opts.geminiRuns ?? [],
    discoverSessions: opts.discoverSessions ?? ((): SessionRef[] => []),
  });
}

describe('createCostService — sessionCost (the subagent-file merge)', () => {
  it('costs a session over its main transcript only when no subagents/ exist', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: (p) => (p === main ? [opusRecord()] : []),
      });

      const cost = svc.sessionCost(ref);
      expect(cost.sessionId).toBe('sess-a1');
      expect(cost.vendor).toBe('anthropic');
      expect(cost.totalCostUsd).toBeCloseTo(90, 6);
    } finally {
      teardown();
    }
  });

  it('MERGES subagents/agent-*.jsonl usage into the session cost', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const subDir = join(dir, 'subagents');
      mkdirSync(subDir, { recursive: true });
      const agent = join(subDir, 'agent-001.jsonl');
      writeFileSync(agent, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      // Main: $90. Subagent: another $90. Merged session cost: $180.
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: (p) => {
          if (p === main) return [opusRecord()];
          if (p === agent) return [opusRecord({ isSidechain: true })];
          return [];
        },
      });

      const cost = svc.sessionCost(ref);
      // The session's cost INCLUDES its subagents (design §4.1).
      expect(cost.totalCostUsd).toBeCloseTo(180, 6);
    } finally {
      teardown();
    }
  });
});

describe('createCostService — sessionSummaryCost (the null/number contract)', () => {
  it('costUsd is a number (incl. the session total) for a costable session', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: () => [opusRecord()],
      });

      const summary = svc.sessionSummaryCost(ref);
      expect(summary.costUsd).toBeCloseTo(90, 6);
      expect(summary.hasUnpriced).toBe(false);
    } finally {
      teardown();
    }
  });

  it('costUsd is NULL for a session with no costable assistant records', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: () => [], // no assistant usage records at all
      });

      const summary = svc.sessionSummaryCost(ref);
      expect(summary.costUsd).toBeNull();
      expect(summary.hasUnpriced).toBe(false);
    } finally {
      teardown();
    }
  });

  it('costUsd is 0 (NOT null) for a session whose only record has zero usage', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: () => [
          {
            model: 'claude-opus-4-7',
            isSidechain: false,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              reasoningTokens: 0,
            },
          },
        ],
      });

      const summary = svc.sessionSummaryCost(ref);
      // A costable record priced at $0 — distinct from `null`.
      expect(summary.costUsd).toBe(0);
    } finally {
      teardown();
    }
  });

  it('hasUnpriced is true when the session uses a model absent from the table', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const ref: SessionRef = {
        projectName: 'alpha',
        sessionId: 'sess-a1',
        transcriptPath: main,
      };
      const svc = makeService({
        config: configOf(['alpha', join(dir, 'repo')]),
        parseUsage: () => [opusRecord({ model: 'some-unknown-model-9' })],
      });

      const summary = svc.sessionSummaryCost(ref);
      expect(summary.hasUnpriced).toBe(true);
      // The unpriced model contributes nothing — the priced sum is 0.
      expect(summary.costUsd).toBe(0);
    } finally {
      teardown();
    }
  });
});

describe('createCostService — projectCosts (the §7 namespace join)', () => {
  it('aggregates Claude session cost per config project', () => {
    const dir = setup();
    try {
      const enc = (name: string): string =>
        join(dir, 'transcripts', `-repo-${name}`);
      mkdirSync(enc('alpha'), { recursive: true });
      const main = join(enc('alpha'), 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');

      const svc = createCostService({
        config: configOf(['alpha', `/repo/alpha`]),
        cache: createCostCache(),
        transcriptsDir: join(dir, 'transcripts'),
        codexSessionsDir: '/nonexistent',
        externalToolsLedger: '/nonexistent',
        parseTranscriptUsage: () => [opusRecord()],
        discoverCodexRuns: () => [],
        discoverGeminiRuns: () => [],
        // Inject discovery so the test controls the transcript set.
        discoverSessions: () => [
          { projectName: 'alpha', sessionId: 'sess-a1', transcriptPath: main },
        ],
      });

      const result = svc.projectCosts();
      const alpha = result.byProject.get('alpha');
      expect(alpha).toBeDefined();
      expect(alpha!.byVendor.anthropic.costUsd).toBeCloseTo(90, 6);
      expect(alpha!.totalCostUsd).toBeCloseTo(90, 6);
      expect(result.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      teardown();
    }
  });

  it('routes a Codex run to its attributed config project', () => {
    const svc = makeService({
      config: configOf(['alpha', '/repo/alpha']),
      codexRuns: [
        {
          vendor: 'openai',
          model: 'gpt-5.5',
          projectName: 'alpha',
          at: '2026-05-18T10:00:00',
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
          costUsd: 1.25,
        },
      ],
    });

    const result = svc.projectCosts();
    const alpha = result.byProject.get('alpha');
    expect(alpha!.byVendor.openai.runCount).toBe(1);
    expect(alpha!.byVendor.openai.costUsd).toBeCloseTo(1.25, 6);
  });

  it('surfaces a run resolving to no config project in the unattributed bucket', () => {
    const svc = makeService({
      config: configOf(['alpha', '/repo/alpha']),
      geminiRuns: [
        {
          vendor: 'google',
          model: 'gemini-3-pro',
          projectName: null, // resolved to no project
          at: '2026-05-18T11:00:00',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
          costUsd: 0,
        },
      ],
    });

    const result = svc.projectCosts();
    expect(result.unattributed).not.toBeNull();
    expect(result.unattributed!.byVendor.google.runCount).toBe(1);
    // alpha still appears, with zero google cost.
    expect(result.byProject.get('alpha')!.byVendor.google.runCount).toBe(0);
  });

  it('emits a config project with NO sessions as a 0-cost summary', () => {
    const svc = makeService({
      config: configOf(['alpha', '/repo/alpha']),
    });

    const result = svc.projectCosts();
    const alpha = result.byProject.get('alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.totalCostUsd).toBe(0);
    expect(alpha!.hasUnpriced).toBe(false);
  });

  it('has no unattributed bucket when every run is attributed', () => {
    const svc = makeService({
      config: configOf(['alpha', '/repo/alpha']),
      codexRuns: [
        {
          vendor: 'openai',
          model: 'gpt-5.5',
          projectName: 'alpha',
          at: '2026-05-18T10:00:00',
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreation5mTokens: 0,
            cacheCreation1hTokens: 0,
            reasoningTokens: 0,
          },
          costUsd: 0,
        },
      ],
    });

    expect(svc.projectCosts().unattributed).toBeNull();
  });

  it('serves a repeated projectCosts() call from the aggregate cache', () => {
    // Spy on the aggregation step so cache hits/misses are observable.
    const zero = { costUsd: 0, runCount: 0, hasUnpriced: false };
    const aggregateSpy = vi.fn().mockReturnValue([
      {
        projectName: 'alpha',
        byVendor: { anthropic: zero, openai: zero, google: zero },
        totalCostUsd: 0,
        hasUnpriced: false,
        pricingAsOf: '2026-05-18',
      },
    ]);
    const svc = createCostService({
      config: configOf(['alpha', '/repo/alpha']),
      cache: createCostCache(),
      transcriptsDir: '/nonexistent',
      codexSessionsDir: '/nonexistent',
      externalToolsLedger: '/nonexistent',
      parseTranscriptUsage: () => [],
      discoverCodexRuns: () => [],
      discoverGeminiRuns: () => [],
      discoverSessions: () => [],
      aggregateProjectCost: aggregateSpy,
    });

    svc.projectCosts();
    svc.projectCosts();
    // The aggregation ran once for `alpha`; the second call hit the cache.
    expect(aggregateSpy).toHaveBeenCalledTimes(1);
  });
});
