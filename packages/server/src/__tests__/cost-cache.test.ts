// Tests for the two-level cost cache (sessions-spike WU v5-7, design §5.4).
//
// The cost cache mirrors `transcript-cache.ts`. Two levels, both in-memory,
// both LRU-bounded at 256:
//
//   1. A per-file LEAF cache — the parsed `AssistantUsageRecord[]` of one
//      transcript / subagent file, keyed `(realpath, mtimeMs, size)`. A
//      touched source file changes the key and re-parses.
//   2. A per-project AGGREGATE cache — a `ProjectCostSummary`, keyed by
//      `(sorted source-path set, max mtime over the set, pricing hash)`.
//      A touched source file (max mtime moves) or a touched price table
//      (hash changes) invalidates the aggregate entry.
//
// Cost is computed on read, never persisted. The cache is DECOUPLED from the
// domain functions: `usageFor` / `aggregateFor` each take the compute
// callback as a per-call argument, so the cache itself imports no parser and
// no aggregator. The fs hooks are injected so every branch is reachable
// without touching `~/.claude/projects/` or `~/.codex/`.

import type { AssistantUsageRecord } from '@metaswarm-dashboard/sessions';
import type { ProjectCostSummary } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it, vi } from 'vitest';

import {
  COST_CACHE_MAX_ENTRIES,
  createCostCache,
  type CostCacheFsHooks,
} from '../data/cost-cache.js';

/** A `CostCacheFsHooks` over an in-memory map of path → (mtime,size). */
function fakeFs(
  files: Record<string, { realpath?: string; mtimeMs: number; size: number }>,
): CostCacheFsHooks {
  return {
    realpathSync: (p) => files[p]?.realpath ?? p,
    statSync: (p) => {
      const entry = files[p];
      if (entry === undefined) {
        const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: entry.mtimeMs, size: entry.size };
    },
  };
}

/** A trivial `AssistantUsageRecord` carrying a model id (usage is irrelevant). */
function rec(model: string): AssistantUsageRecord {
  return {
    model,
    isSidechain: false,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    },
  };
}

/** A minimal `ProjectCostSummary` for the aggregate-cache tests. */
function summary(projectName: string): ProjectCostSummary {
  const zero = { costUsd: 0, runCount: 0, hasUnpriced: false };
  return {
    projectName,
    byVendor: { anthropic: zero, openai: zero, google: zero },
    totalCostUsd: 0,
    hasUnpriced: false,
    pricingAsOf: '2026-05-18',
  };
}

describe('createCostCache — leaf (per-file) cache', () => {
  it('parses usage on a miss and returns the records', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const parseUsage = vi.fn().mockReturnValue([rec('claude-opus-4-7')]);
    const cache = createCostCache({ fs });

    const result = cache.usageFor('/t/a.jsonl', parseUsage);

    expect(result).toEqual([rec('claude-opus-4-7')]);
    expect(parseUsage).toHaveBeenCalledTimes(1);
    expect(parseUsage).toHaveBeenCalledWith('/t/a.jsonl');
  });

  it('serves a leaf hit without re-parsing when the key is unchanged', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const parseUsage = vi.fn().mockReturnValue([rec('m')]);
    const cache = createCostCache({ fs });

    cache.usageFor('/t/a.jsonl', parseUsage);
    cache.usageFor('/t/a.jsonl', parseUsage);

    expect(parseUsage).toHaveBeenCalledTimes(1);
  });

  it('re-parses a leaf when mtimeMs changes (a touched source file)', () => {
    const files = { '/t/a.jsonl': { mtimeMs: 100, size: 10 } };
    const fs = fakeFs(files);
    const parseUsage = vi.fn().mockReturnValue([rec('m')]);
    const cache = createCostCache({ fs });

    cache.usageFor('/t/a.jsonl', parseUsage);
    files['/t/a.jsonl'].mtimeMs = 200;
    cache.usageFor('/t/a.jsonl', parseUsage);

    expect(parseUsage).toHaveBeenCalledTimes(2);
  });

  it('re-parses a leaf when size changes even if mtimeMs is unchanged', () => {
    const files = { '/t/a.jsonl': { mtimeMs: 100, size: 10 } };
    const fs = fakeFs(files);
    const parseUsage = vi.fn().mockReturnValue([rec('m')]);
    const cache = createCostCache({ fs });

    cache.usageFor('/t/a.jsonl', parseUsage);
    files['/t/a.jsonl'].size = 999;
    cache.usageFor('/t/a.jsonl', parseUsage);

    expect(parseUsage).toHaveBeenCalledTimes(2);
  });

  it('keys the leaf cache on the realpath', () => {
    const fs = fakeFs({
      '/t/link.jsonl': { realpath: '/t/real.jsonl', mtimeMs: 5, size: 3 },
      '/t/real.jsonl': { realpath: '/t/real.jsonl', mtimeMs: 5, size: 3 },
    });
    const parseUsage = vi.fn().mockReturnValue([rec('m')]);
    const cache = createCostCache({ fs });

    cache.usageFor('/t/link.jsonl', parseUsage);
    cache.usageFor('/t/real.jsonl', parseUsage);

    expect(parseUsage).toHaveBeenCalledTimes(1);
  });

  it('evicts the least-recently-used leaf past COST_CACHE_MAX_ENTRIES', () => {
    const files: Record<string, { mtimeMs: number; size: number }> = {};
    for (let i = 0; i <= COST_CACHE_MAX_ENTRIES; i++) {
      files[`/t/${i}.jsonl`] = { mtimeMs: 1, size: 1 };
    }
    const fs = fakeFs(files);
    const parseUsage = vi.fn().mockImplementation((p: string) => [rec(p)]);
    const cache = createCostCache({ fs });

    for (let i = 0; i < COST_CACHE_MAX_ENTRIES; i++) {
      cache.usageFor(`/t/${i}.jsonl`, parseUsage);
    }
    expect(parseUsage).toHaveBeenCalledTimes(COST_CACHE_MAX_ENTRIES);

    // One more get evicts the LRU leaf (`/t/0.jsonl`).
    cache.usageFor(`/t/${COST_CACHE_MAX_ENTRIES}.jsonl`, parseUsage);
    cache.usageFor('/t/0.jsonl', parseUsage);
    expect(parseUsage).toHaveBeenCalledTimes(COST_CACHE_MAX_ENTRIES + 2);
  });

  it('a leaf hit refreshes recency — the hit entry is NOT the next eviction', () => {
    const files: Record<string, { mtimeMs: number; size: number }> = {};
    for (let i = 0; i <= COST_CACHE_MAX_ENTRIES; i++) {
      files[`/t/${i}.jsonl`] = { mtimeMs: 1, size: 1 };
    }
    const fs = fakeFs(files);
    const parseUsage = vi.fn().mockImplementation((p: string) => [rec(p)]);
    const cache = createCostCache({ fs });

    for (let i = 0; i < COST_CACHE_MAX_ENTRIES; i++) {
      cache.usageFor(`/t/${i}.jsonl`, parseUsage);
    }
    cache.usageFor('/t/0.jsonl', parseUsage); // 0 becomes MRU
    cache.usageFor(`/t/${COST_CACHE_MAX_ENTRIES}.jsonl`, parseUsage); // evicts /t/1

    const before = parseUsage.mock.calls.length;
    cache.usageFor('/t/0.jsonl', parseUsage); // still cached
    expect(parseUsage).toHaveBeenCalledTimes(before);
    cache.usageFor('/t/1.jsonl', parseUsage); // evicted → re-parse
    expect(parseUsage).toHaveBeenCalledTimes(before + 1);
  });

  it('COST_CACHE_MAX_ENTRIES is 256', () => {
    expect(COST_CACHE_MAX_ENTRIES).toBe(256);
  });
});

describe('createCostCache — aggregate (per-project) cache', () => {
  it('computes the aggregate on a miss', () => {
    const fs = fakeFs({
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
      '/t/b.jsonl': { mtimeMs: 200, size: 20 },
    });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    const result = cache.aggregateFor(
      'alpha',
      ['/t/a.jsonl', '/t/b.jsonl'],
      'hash-1',
      compute,
    );

    expect(result).toEqual(summary('alpha'));
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('serves an aggregate hit when nothing changed', () => {
    const fs = fakeFs({
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
      '/t/b.jsonl': { mtimeMs: 200, size: 20 },
    });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);
    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('serves an aggregate hit regardless of the source-path ORDER', () => {
    const fs = fakeFs({
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
      '/t/b.jsonl': { mtimeMs: 200, size: 20 },
    });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);
    cache.aggregateFor('alpha', ['/t/b.jsonl', '/t/a.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes when a source file is TOUCHED (max mtime moves)', () => {
    const files = {
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
      '/t/b.jsonl': { mtimeMs: 200, size: 20 },
    };
    const fs = fakeFs(files);
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);
    files['/t/a.jsonl'].mtimeMs = 999; // a touched source file
    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('recomputes when a source file is ADDED to the set', () => {
    const fs = fakeFs({
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
      '/t/b.jsonl': { mtimeMs: 200, size: 20 },
      '/t/c.jsonl': { mtimeMs: 50, size: 5 },
    });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl', '/t/b.jsonl'], 'hash-1', compute);
    cache.aggregateFor(
      'alpha',
      ['/t/a.jsonl', '/t/b.jsonl', '/t/c.jsonl'],
      'hash-1',
      compute,
    );

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('recomputes when the PRICE TABLE hash changes', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);
    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-2', compute); // table changed

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('caches an empty-source-set project (max mtime of [] is 0)', () => {
    const fs = fakeFs({});
    const compute = vi.fn().mockReturnValue(summary('empty'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('empty', [], 'hash-1', compute);
    cache.aggregateFor('empty', [], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('keys aggregate entries per project name — distinct projects do not collide', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const compute = vi.fn().mockImplementation((name: string) => summary(name));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);
    cache.aggregateFor('beta', ['/t/a.jsonl'], 'hash-1', compute);
    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(2); // alpha + beta, then alpha hit
  });

  it('treats an unstattable source file as a key change (recomputes)', () => {
    const files: Record<string, { mtimeMs: number; size: number }> = {
      '/t/a.jsonl': { mtimeMs: 100, size: 10 },
    };
    const fs = fakeFs(files);
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);
    delete files['/t/a.jsonl']; // file vanished — stat now throws
    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('passes the project name + source paths through to the compute fn', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const compute = vi.fn().mockReturnValue(summary('alpha'));
    const cache = createCostCache({ fs });

    cache.aggregateFor('alpha', ['/t/a.jsonl'], 'hash-1', compute);

    expect(compute).toHaveBeenCalledWith('alpha', ['/t/a.jsonl']);
  });

  it('evicts the least-recently-used aggregate past COST_CACHE_MAX_ENTRIES', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 1, size: 1 } });
    const compute = vi.fn().mockImplementation((name: string) => summary(name));
    const cache = createCostCache({ fs });

    for (let i = 0; i < COST_CACHE_MAX_ENTRIES; i++) {
      cache.aggregateFor(`p${i}`, ['/t/a.jsonl'], 'h', compute);
    }
    expect(compute).toHaveBeenCalledTimes(COST_CACHE_MAX_ENTRIES);

    // A new project evicts the LRU aggregate (`p0`).
    cache.aggregateFor(`p${COST_CACHE_MAX_ENTRIES}`, ['/t/a.jsonl'], 'h', compute);
    cache.aggregateFor('p0', ['/t/a.jsonl'], 'h', compute); // re-computed
    expect(compute).toHaveBeenCalledTimes(COST_CACHE_MAX_ENTRIES + 2);
  });
});
