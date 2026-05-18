// mtime+size-keyed parse/score cache (sessions-spike WU v4-5, design §7).
//
// Session discovery is a LIVE scan each request; turning each discovered
// transcript into a `{ timeline, rubric }` pair (parse + score) is the
// expensive part. This cache memoizes that pair, keyed by
// `(realpath, mtimeMs, size)`:
//
//   - the file is `stat`'d on EVERY `get` — if `mtimeMs` or `size` changed
//     (an in-flight session's transcript grew), the key changes and the
//     entry is re-parsed, so `eventCount` is never stale;
//   - there is NO time-based expiry — only a key change or an LRU eviction
//     invalidates an entry, which keeps the cache deterministically testable;
//   - the cache is bounded (`CACHE_MAX_ENTRIES`, LRU) so a long-lived server
//     scanning many sessions cannot grow it without bound (design §8.3
//     "unbounded cache" mitigation).
//
// The cache is filesystem-injectable (`TranscriptCacheFsHooks`) and the
// parse/score functions are injected too, so every branch is reachable in a
// unit test without touching `~/.claude/projects/`.

import {
  realpathSync as nodeRealpathSync,
  statSync as nodeStatSync,
} from 'node:fs';

import type {
  ProcessRubricScore,
  SessionTimeline,
} from '@metaswarm-dashboard/types/sessions';

/** Hard upper bound on cached entries — past this, the LRU entry is evicted. */
export const CACHE_MAX_ENTRIES = 256;

/** The parse + score result for one transcript. */
export interface TranscriptScore {
  timeline: SessionTimeline;
  rubric: ProcessRubricScore;
}

/** A minimal `fs.Stats`-like shape — only the fields the cache key needs. */
interface CacheStatsLike {
  mtimeMs: number;
  size: number;
}

/**
 * Injectable filesystem hooks for the cache. Defaults to `node:fs`. Tests
 * pass a stub backed by an in-memory file table.
 */
export interface TranscriptCacheFsHooks {
  /** Resolve a path to its canonical location (follows symlinks). */
  realpathSync: (path: string) => string;
  /** `stat` a path — only `mtimeMs` + `size` are read. */
  statSync: (path: string) => CacheStatsLike;
}

const DEFAULT_FS: TranscriptCacheFsHooks = {
  realpathSync: (path) => nodeRealpathSync(path),
  statSync: (path) => nodeStatSync(path),
};

/** Dependencies for `createTranscriptCache`. */
export interface TranscriptCacheDeps {
  /** Filesystem hooks (defaults to `node:fs`). */
  fs?: TranscriptCacheFsHooks;
  /** Parse a transcript file into a `SessionTimeline`. */
  parse: (transcriptPath: string) => SessionTimeline;
  /** Score a parsed timeline into a `ProcessRubricScore`. */
  score: (timeline: SessionTimeline) => ProcessRubricScore;
}

/** The public cache surface. */
export interface TranscriptCache {
  /**
   * Return the `{ timeline, rubric }` for `transcriptPath`, parsing + scoring
   * on a miss or a stale key, serving the memoized value on a fresh hit.
   */
  get: (transcriptPath: string) => TranscriptScore;
}

/** An entry's identity — a change in any field invalidates the cache slot. */
interface CacheKey {
  mtimeMs: number;
  size: number;
}

interface CacheEntry {
  key: CacheKey;
  value: TranscriptScore;
}

/**
 * Build a parse/score cache. The returned object exposes a single `get`.
 *
 * The cache is an insertion-ordered `Map` keyed by realpath; a hit deletes
 * and re-inserts the entry so the most-recently-used entry is always last
 * and the least-recently-used is always first (the eviction target).
 */
export function createTranscriptCache(deps: TranscriptCacheDeps): TranscriptCache {
  const fs = deps.fs ?? DEFAULT_FS;
  const entries = new Map<string, CacheEntry>();

  function get(transcriptPath: string): TranscriptScore {
    const realpath = fs.realpathSync(transcriptPath);
    const stats = fs.statSync(transcriptPath);
    const key: CacheKey = { mtimeMs: stats.mtimeMs, size: stats.size };

    const existing = entries.get(realpath);
    if (
      existing !== undefined &&
      existing.key.mtimeMs === key.mtimeMs &&
      existing.key.size === key.size
    ) {
      // Fresh hit — refresh recency by re-inserting at the tail.
      entries.delete(realpath);
      entries.set(realpath, existing);
      return existing.value;
    }

    // Miss or stale key — parse + score, then (re-)insert.
    const timeline = deps.parse(transcriptPath);
    const rubric = deps.score(timeline);
    const value: TranscriptScore = { timeline, rubric };
    // Drop a stale entry first so the re-insert lands at the tail.
    entries.delete(realpath);
    entries.set(realpath, { key, value });

    // Evict the least-recently-used entry (the Map's first key) if over cap.
    if (entries.size > CACHE_MAX_ENTRIES) {
      // The map has just exceeded the cap, so it is non-empty — the first
      // key the iterator yields is the LRU entry. The non-null assertion is
      // sound: `size > cap ≥ 0` guarantees at least one key.
      const lru = entries.keys().next().value!;
      entries.delete(lru);
    }

    return value;
  }

  return { get };
}
