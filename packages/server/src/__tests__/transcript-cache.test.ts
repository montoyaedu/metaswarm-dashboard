// Tests for the mtime+size-keyed parse/score cache (sessions-spike WU v4-5,
// design §7). The cache memoizes "parse + score a transcript" results keyed
// by `(realpath, mtimeMs, size)`. There is NO time-based expiry — a key
// change (an in-flight session's transcript grew) or an LRU eviction is the
// only invalidation, so the cache is deterministically testable.

import { describe, expect, it, vi } from 'vitest';

import {
  CACHE_MAX_ENTRIES,
  createTranscriptCache,
  type TranscriptCacheFsHooks,
} from '../data/transcript-cache.js';

/** A `TranscriptCacheFsHooks` over an in-memory map of path → (mtime,size). */
function fakeFs(
  files: Record<string, { realpath?: string; mtimeMs: number; size: number }>,
): TranscriptCacheFsHooks {
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

describe('createTranscriptCache', () => {
  it('parses + scores on a miss and returns timeline + rubric', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const parse = vi.fn().mockReturnValue({ sessionId: 'a', eventCount: 1 });
    const score = vi.fn().mockReturnValue({ sessionId: 'a', overall: 'pass' });
    const cache = createTranscriptCache({ fs, parse, score });

    const result = cache.get('/t/a.jsonl');

    expect(result.timeline).toEqual({ sessionId: 'a', eventCount: 1 });
    expect(result.rubric).toEqual({ sessionId: 'a', overall: 'pass' });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledWith({ sessionId: 'a', eventCount: 1 });
  });

  it('serves a hit without re-parsing when the key is unchanged', () => {
    const fs = fakeFs({ '/t/a.jsonl': { mtimeMs: 100, size: 10 } });
    const parse = vi.fn().mockReturnValue({ sessionId: 'a' });
    const score = vi.fn().mockReturnValue({ sessionId: 'a' });
    const cache = createTranscriptCache({ fs, parse, score });

    cache.get('/t/a.jsonl');
    const second = cache.get('/t/a.jsonl');

    expect(second.timeline).toEqual({ sessionId: 'a' });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(score).toHaveBeenCalledTimes(1);
  });

  it('re-parses when mtimeMs changes (an in-flight session grew)', () => {
    const files = { '/t/a.jsonl': { mtimeMs: 100, size: 10 } };
    const fs = fakeFs(files);
    const parse = vi.fn().mockReturnValue({ sessionId: 'a' });
    const score = vi.fn().mockReturnValue({ sessionId: 'a' });
    const cache = createTranscriptCache({ fs, parse, score });

    cache.get('/t/a.jsonl');
    files['/t/a.jsonl'].mtimeMs = 200;
    cache.get('/t/a.jsonl');

    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('re-parses when size changes even if mtimeMs is unchanged', () => {
    const files = { '/t/a.jsonl': { mtimeMs: 100, size: 10 } };
    const fs = fakeFs(files);
    const parse = vi.fn().mockReturnValue({ sessionId: 'a' });
    const score = vi.fn().mockReturnValue({ sessionId: 'a' });
    const cache = createTranscriptCache({ fs, parse, score });

    cache.get('/t/a.jsonl');
    files['/t/a.jsonl'].size = 999;
    cache.get('/t/a.jsonl');

    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('keys on the realpath — two paths resolving to the same file share an entry', () => {
    const fs = fakeFs({
      '/t/link.jsonl': { realpath: '/t/real.jsonl', mtimeMs: 5, size: 3 },
      '/t/real.jsonl': { realpath: '/t/real.jsonl', mtimeMs: 5, size: 3 },
    });
    const parse = vi.fn().mockReturnValue({ sessionId: 'a' });
    const score = vi.fn().mockReturnValue({ sessionId: 'a' });
    const cache = createTranscriptCache({ fs, parse, score });

    cache.get('/t/link.jsonl');
    cache.get('/t/real.jsonl');

    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('passes the requested path (not the realpath) to parse', () => {
    const fs = fakeFs({
      '/t/link.jsonl': { realpath: '/t/real.jsonl', mtimeMs: 5, size: 3 },
    });
    const parse = vi.fn().mockReturnValue({ sessionId: 'a' });
    const score = vi.fn().mockReturnValue({ sessionId: 'a' });
    const cache = createTranscriptCache({ fs, parse, score });

    cache.get('/t/link.jsonl');

    expect(parse).toHaveBeenCalledWith('/t/link.jsonl');
  });

  it('evicts the least-recently-used entry past CACHE_MAX_ENTRIES', () => {
    const files: Record<string, { mtimeMs: number; size: number }> = {};
    for (let i = 0; i < CACHE_MAX_ENTRIES + 1; i++) {
      files[`/t/${i}.jsonl`] = { mtimeMs: 1, size: 1 };
    }
    const fs = fakeFs(files);
    const parse = vi.fn().mockImplementation((p: string) => ({ sessionId: p }));
    const score = vi.fn().mockImplementation((t: { sessionId: string }) => t);
    const cache = createTranscriptCache({ fs, parse, score });

    // Fill the cache to capacity.
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      cache.get(`/t/${i}.jsonl`);
    }
    expect(parse).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES);

    // One more get evicts the LRU entry (`/t/0.jsonl`).
    cache.get(`/t/${CACHE_MAX_ENTRIES}.jsonl`);
    expect(parse).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 1);

    // `/t/0.jsonl` was evicted → a re-get re-parses.
    cache.get('/t/0.jsonl');
    expect(parse).toHaveBeenCalledTimes(CACHE_MAX_ENTRIES + 2);
  });

  it('a cache hit refreshes recency — the hit entry is NOT the next eviction', () => {
    const files: Record<string, { mtimeMs: number; size: number }> = {};
    for (let i = 0; i <= CACHE_MAX_ENTRIES; i++) {
      files[`/t/${i}.jsonl`] = { mtimeMs: 1, size: 1 };
    }
    const fs = fakeFs(files);
    const parse = vi.fn().mockImplementation((p: string) => ({ sessionId: p }));
    const score = vi.fn().mockImplementation((t: { sessionId: string }) => t);
    const cache = createTranscriptCache({ fs, parse, score });

    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) {
      cache.get(`/t/${i}.jsonl`);
    }
    // Touch `/t/0.jsonl` — it becomes most-recently-used.
    cache.get('/t/0.jsonl');
    // Insert a new entry → LRU eviction now targets `/t/1.jsonl`, not 0.
    cache.get(`/t/${CACHE_MAX_ENTRIES}.jsonl`);

    const callsBefore = parse.mock.calls.length;
    cache.get('/t/0.jsonl'); // still cached → no re-parse
    expect(parse).toHaveBeenCalledTimes(callsBefore);

    cache.get('/t/1.jsonl'); // evicted → re-parse
    expect(parse).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('CACHE_MAX_ENTRIES is 256', () => {
    expect(CACHE_MAX_ENTRIES).toBe(256);
  });
});
