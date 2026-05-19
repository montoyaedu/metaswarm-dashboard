// Two-level, compute-on-read cost cache (sessions-spike WU v5-7, design §5.4).
//
// AI cost is DERIVED — never persisted (persisting would freeze a stale
// price). Two cache levels mirror the v4 `transcript-cache.ts` structure;
// both are in-memory and LRU-bounded at `COST_CACHE_MAX_ENTRIES` (256):
//
//   1. The LEAF cache — the parsed `AssistantUsageRecord[]` of ONE transcript
//      or subagent file, keyed `(realpath, mtimeMs, size)`. This is the
//      expensive part (a raw-Buffer JSONL scan). The file is `stat`'d on every
//      `usageFor` — if `mtimeMs` or `size` changed (an in-flight session's
//      transcript grew), the key changes and the file is re-parsed.
//
//   2. The AGGREGATE cache — a `ProjectCostSummary` for one project, keyed by
//      `(sorted source-path set, max mtime over the set, pricing-table content
//      hash)`. The price table's key is a CONTENT HASH, not a mtime: a `git
//      checkout` rewrites the JSON's mtime without changing content, and vice
//      versa (design §5.4). A touched source file moves the max mtime; a
//      touched price table changes the hash; either invalidates the entry.
//
// Both caches use the same insertion-ordered-`Map` LRU as `transcript-cache`:
// a hit deletes-and-re-inserts the entry so the most-recently-used is always
// last and the least-recently-used (the eviction target) always first.
//
// The cache is DECOUPLED from the domain functions: `usageFor` / `aggregateFor`
// each take the compute callback as a per-call argument, so this module
// imports neither a parser nor an aggregator — only the `fs` hooks (injectable
// so every branch is reachable without touching `~/.claude/` or `~/.codex/`).

import {
  realpathSync as nodeRealpathSync,
  statSync as nodeStatSync,
} from 'node:fs';

import type { AssistantUsageRecord } from '@metaswarm-dashboard/sessions';
import type { ProjectCostSummary } from '@metaswarm-dashboard/types/cost';

/** Hard upper bound on cached entries (per level) — past this, LRU-evict. */
export const COST_CACHE_MAX_ENTRIES = 256;

/** A minimal `fs.Stats`-like shape — only the fields the cache keys need. */
interface CacheStatsLike {
  mtimeMs: number;
  size: number;
}

/**
 * Injectable filesystem hooks for the cost cache. Defaults to `node:fs`.
 * Tests pass a stub backed by an in-memory file table.
 */
export interface CostCacheFsHooks {
  /** Resolve a path to its canonical location (follows symlinks). */
  realpathSync: (path: string) => string;
  /** `stat` a path — only `mtimeMs` + `size` are read. */
  statSync: (path: string) => CacheStatsLike;
}

const DEFAULT_FS: CostCacheFsHooks = {
  realpathSync: (path) => nodeRealpathSync(path),
  statSync: (path) => nodeStatSync(path),
};

/** Dependencies for `createCostCache`. */
export interface CostCacheDeps {
  /** Filesystem hooks (defaults to `node:fs`). */
  fs?: CostCacheFsHooks;
}

/** Parse one transcript / subagent file into its `AssistantUsageRecord[]`. */
export type ParseUsageFn = (filePath: string) => AssistantUsageRecord[];

/** Aggregate one project's cost from its source-path set. */
export type AggregateProjectFn = (
  projectName: string,
  sourcePaths: readonly string[],
) => ProjectCostSummary;

/** The public cost-cache surface. */
export interface CostCache {
  /**
   * Return the `AssistantUsageRecord[]` for `filePath`, parsing on a miss or
   * a stale `(mtime, size)` key, serving the memoized value on a fresh hit.
   *
   * @param filePath - The transcript / subagent file to parse.
   * @param parseUsage - The parser callback (`parseTranscriptUsage`).
   */
  usageFor: (filePath: string, parseUsage: ParseUsageFn) => AssistantUsageRecord[];
  /**
   * Return the `ProjectCostSummary` for `projectName`, computed from
   * `sourcePaths`. Re-computes only when a source file is added/changed (the
   * max mtime moves) or the price table changes (`pricingHash` differs).
   *
   * @param projectName - The config-namespace project name (the cache key).
   * @param sourcePaths - Every source file feeding the project's cost
   *   (transcripts, subagent files, Codex rollouts, the ledger). Order is
   *   irrelevant — the set is sorted before keying.
   * @param pricingHash - The pricing table's content hash (`pricingTableHash`).
   * @param compute - The aggregation callback, run on a miss / stale key.
   */
  aggregateFor: (
    projectName: string,
    sourcePaths: readonly string[],
    pricingHash: string,
    compute: AggregateProjectFn,
  ) => ProjectCostSummary;
}

/** A leaf entry's identity — a change in either field invalidates the slot. */
interface LeafKey {
  mtimeMs: number;
  size: number;
}

interface LeafEntry {
  key: LeafKey;
  value: AssistantUsageRecord[];
}

/** An aggregate entry's identity — the §5.4 three-part key. */
interface AggregateKey {
  /** The sorted source-path set, joined — a stable signature of the set. */
  pathSignature: string;
  /** The max `mtimeMs` over the source set (0 for an empty set). */
  maxMtimeMs: number;
  /** The pricing-table content hash. */
  pricingHash: string;
}

interface AggregateEntry {
  key: AggregateKey;
  value: ProjectCostSummary;
}

/**
 * Evict the least-recently-used entry (the Map's first key) when `entries`
 * has exceeded the cap. The Map is insertion-ordered, so the first key the
 * iterator yields is the LRU entry.
 */
function evictIfOverCap<V>(entries: Map<string, V>): void {
  if (entries.size > COST_CACHE_MAX_ENTRIES) {
    // `size > cap ≥ 0` guarantees at least one key — the assertion is sound.
    const lru = entries.keys().next().value!;
    entries.delete(lru);
  }
}

/**
 * Build the two-level cost cache. The returned object exposes `usageFor`
 * (the leaf cache) and `aggregateFor` (the aggregate cache).
 */
export function createCostCache(deps: CostCacheDeps = {}): CostCache {
  const fs = deps.fs ?? DEFAULT_FS;
  const leaves = new Map<string, LeafEntry>();
  const aggregates = new Map<string, AggregateEntry>();

  /** The leaf cache: parsed usage for one transcript/subagent file. */
  function usageFor(
    filePath: string,
    parseUsage: ParseUsageFn,
  ): AssistantUsageRecord[] {
    const realpath = fs.realpathSync(filePath);
    const stats = fs.statSync(filePath);
    const key: LeafKey = { mtimeMs: stats.mtimeMs, size: stats.size };

    const existing = leaves.get(realpath);
    if (
      existing !== undefined &&
      existing.key.mtimeMs === key.mtimeMs &&
      existing.key.size === key.size
    ) {
      // Fresh hit — refresh recency by re-inserting at the tail.
      leaves.delete(realpath);
      leaves.set(realpath, existing);
      return existing.value;
    }

    // Miss or stale key — parse, then (re-)insert at the tail.
    const value = parseUsage(filePath);
    leaves.delete(realpath);
    leaves.set(realpath, { key, value });
    evictIfOverCap(leaves);
    return value;
  }

  /**
   * Compute the `(pathSignature, maxMtimeMs)` portion of the aggregate key for
   * a source set. A source file that cannot be `stat`'d contributes a `NaN`
   * sentinel mtime so a vanished/added file always invalidates the entry.
   */
  function probeSources(sourcePaths: readonly string[]): {
    pathSignature: string;
    maxMtimeMs: number;
  } {
    const sorted = [...sourcePaths].sort();
    let maxMtimeMs = 0;
    for (const path of sorted) {
      try {
        const stats = fs.statSync(path);
        if (stats.mtimeMs > maxMtimeMs) {
          maxMtimeMs = stats.mtimeMs;
        }
      } catch {
        // An unstattable source (deleted between scans) must invalidate the
        // entry: a `NaN` mtime never `===` a prior (finite) key, forcing a
        // recompute.
        maxMtimeMs = Number.NaN;
      }
    }
    return { pathSignature: sorted.join(' '), maxMtimeMs };
  }

  /** The aggregate cache: a `ProjectCostSummary` for one project. */
  function aggregateFor(
    projectName: string,
    sourcePaths: readonly string[],
    pricingHash: string,
    compute: AggregateProjectFn,
  ): ProjectCostSummary {
    const { pathSignature, maxMtimeMs } = probeSources(sourcePaths);
    const key: AggregateKey = { pathSignature, maxMtimeMs, pricingHash };

    const existing = aggregates.get(projectName);
    if (
      existing !== undefined &&
      existing.key.pathSignature === key.pathSignature &&
      // `NaN !== NaN`, so an unstattable source (NaN mtime) never hits.
      existing.key.maxMtimeMs === key.maxMtimeMs &&
      existing.key.pricingHash === key.pricingHash
    ) {
      // Fresh hit — refresh recency.
      aggregates.delete(projectName);
      aggregates.set(projectName, existing);
      return existing.value;
    }

    // Miss or stale key — recompute, then (re-)insert at the tail.
    const value = compute(projectName, sourcePaths);
    aggregates.delete(projectName);
    aggregates.set(projectName, { key, value });
    evictIfOverCap(aggregates);
    return value;
  }

  return { usageFor, aggregateFor };
}
