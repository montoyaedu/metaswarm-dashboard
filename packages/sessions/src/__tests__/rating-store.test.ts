// Tests for the rating store (sessions-spike WU v4-5/v4-6, design §13).
//
// Covers: the day-independent path layout
// (<dataDir>/projects/<name>/sessions/ratings/<sessionId>.rating.json),
// `projectName`/`sessionId` sanitization rejections, an absent rating file
// resolving to `null`, and a valid rating round-trip. The injectable fs
// hooks let every branch run without `/* v8 ignore */`.
//
// WU v4-6 adds `writeSessionRating` to the same module — the write path:
// schema validation, sanitization, atomic write, realpath containment, and
// the **idempotent upsert** (a re-rate for the same (project, sessionId)
// overwrites the single day-independent file, never duplicating it).

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import type { SessionRating } from '@metaswarm-dashboard/types/ratings';
import type { ProcessRubricScore, RubricKey } from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertRatingPathWithinRoot,
  ratingPath,
  readSessionRating,
  writeSessionRating,
  type RatingStoreFsHooks,
  type RatingWriterFsHooks,
} from '../rating-store.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-rating-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const RUBRIC_KEYS: readonly RubricKey[] = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
];

/** A valid `ProcessRubricScore` (9 items) for use inside a `SessionRating`. */
function makeRubric(sessionId: string): ProcessRubricScore {
  return {
    schemaVersion: 1,
    sessionId,
    scoredAt: '2026-05-17T08:30:00.000Z',
    items: RUBRIC_KEYS.map((key) => ({
      key,
      label: key,
      verdict: 'pass' as const,
      evidence: 'ok',
      pointer: null,
    })),
    overall: 'pass',
  };
}

/** A valid `SessionRating` fixture. */
function makeRating(
  overrides: { projectName?: string; sessionId?: string } = {},
): SessionRating {
  const sessionId = overrides.sessionId ?? 'session-abc';
  return {
    schemaVersion: 1,
    sessionId,
    projectName: overrides.projectName ?? 'my-project',
    verdicts: [
      {
        key: 'tdd',
        verdict: 'pass',
        scoredAt: '2026-05-17T09:00:00.000Z',
      },
    ],
    ratedAt: '2026-05-17T09:00:00.000Z',
    rubricAtRating: makeRubric(sessionId),
  };
}

// --- ratingPath ------------------------------------------------------------

describe('ratingPath', () => {
  it('builds <dataDir>/projects/<name>/sessions/ratings/<id>.rating.json', () => {
    const path = ratingPath('/data', 'my-project', 'session-abc');
    expect(path).toBe(
      join('/data', 'projects', 'my-project', 'sessions', 'ratings', 'session-abc.rating.json'),
    );
  });

  it('is day-independent — no YYYY-MM-DD segment in the path', () => {
    const path = ratingPath('/data', 'p', 's');
    expect(path).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('rejects a projectName with a path separator', () => {
    expect(() => ratingPath('/data', `bad${sep}name`, 'sess')).toThrow(/projectName/);
  });

  it('rejects a sessionId with a path separator', () => {
    expect(() => ratingPath('/data', 'proj', `bad${sep}id`)).toThrow(/sessionId/);
  });

  it('rejects a projectName containing ".."', () => {
    expect(() => ratingPath('/data', '..', 'sess')).toThrow(/projectName/);
  });

  it('rejects a sessionId containing ".."', () => {
    expect(() => ratingPath('/data', 'proj', 'a..b')).toThrow(/sessionId/);
  });

  it('rejects a projectName with a forbidden character', () => {
    expect(() => ratingPath('/data', 'has space', 'sess')).toThrow(/projectName/);
  });

  it('rejects an empty sessionId', () => {
    expect(() => ratingPath('/data', 'proj', '')).toThrow(/sessionId/);
  });
});

// --- readSessionRating -----------------------------------------------------

describe('readSessionRating', () => {
  it('returns null when the rating file is absent', () => {
    const result = readSessionRating(TMP, 'my-project', 'never-rated');
    expect(result).toBeNull();
  });

  it('reads + validates a valid rating file', () => {
    const rating = makeRating();
    const path = ratingPath(TMP, 'my-project', 'session-abc');
    mkdirSync(join(TMP, 'projects', 'my-project', 'sessions', 'ratings'), {
      recursive: true,
    });
    writeFileSync(path, JSON.stringify(rating), 'utf8');

    const result = readSessionRating(TMP, 'my-project', 'session-abc');
    expect(result).toEqual(rating);
  });

  it('returns null when the file content fails Zod validation', () => {
    const path = ratingPath(TMP, 'my-project', 'broken');
    mkdirSync(join(TMP, 'projects', 'my-project', 'sessions', 'ratings'), {
      recursive: true,
    });
    writeFileSync(path, JSON.stringify({ schemaVersion: 99 }), 'utf8');

    expect(readSessionRating(TMP, 'my-project', 'broken')).toBeNull();
  });

  it('returns null when the file content is not valid JSON', () => {
    const path = ratingPath(TMP, 'my-project', 'garbage');
    mkdirSync(join(TMP, 'projects', 'my-project', 'sessions', 'ratings'), {
      recursive: true,
    });
    writeFileSync(path, 'not-json-at-all', 'utf8');

    expect(readSessionRating(TMP, 'my-project', 'garbage')).toBeNull();
  });

  it('propagates a sanitization error for a malformed projectName', () => {
    expect(() => readSessionRating(TMP, '..', 'sess')).toThrow(/projectName/);
  });

  it('propagates a sanitization error for a malformed sessionId', () => {
    expect(() => readSessionRating(TMP, 'proj', `a${sep}b`)).toThrow(/sessionId/);
  });

  it('returns null on a non-ENOENT read error (via injected fs)', () => {
    const fs: RatingStoreFsHooks = {
      readFileSync: () => {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    expect(readSessionRating(TMP, 'proj', 'sess', fs)).toBeNull();
  });

  it('reads via injected fs hooks', () => {
    const rating = makeRating({ projectName: 'proj', sessionId: 'sess' });
    const fs: RatingStoreFsHooks = {
      readFileSync: () => JSON.stringify(rating),
    };
    expect(readSessionRating(TMP, 'proj', 'sess', fs)).toEqual(rating);
  });
});

// --- writeSessionRating ----------------------------------------------------

describe('writeSessionRating', () => {
  it('atomically persists a valid rating and returns the written path', () => {
    const rating = makeRating();
    const written = writeSessionRating(rating, TMP);
    // The returned path is rooted at the *realpath* of dataDir (macOS
    // resolves /var → /private/var); compose the expected path from that.
    expect(written).toBe(
      ratingPath(realpathSync(TMP), 'my-project', 'session-abc'),
    );

    const onDisk = JSON.parse(readFileSync(written, 'utf8')) as SessionRating;
    expect(onDisk).toEqual(rating);
  });

  it('round-trips through readSessionRating', () => {
    const rating = makeRating({ projectName: 'proj', sessionId: 'sess' });
    writeSessionRating(rating, TMP);
    expect(readSessionRating(TMP, 'proj', 'sess')).toEqual(rating);
  });

  it('is an idempotent upsert — writing twice leaves exactly ONE file', () => {
    const first = makeRating({ projectName: 'proj', sessionId: 'sess' });
    writeSessionRating(first, TMP);

    // Re-rate the SAME (project, sessionId) with different verdicts.
    const second: SessionRating = {
      ...first,
      verdicts: [
        { key: 'planning', verdict: 'fail', scoredAt: '2026-05-18T10:00:00.000Z' },
      ],
      ratedAt: '2026-05-18T10:00:00.000Z',
    };
    writeSessionRating(second, TMP);

    const ratingsDir = join(TMP, 'projects', 'proj', 'sessions', 'ratings');
    const files = readdirSync(ratingsDir);
    expect(files).toEqual(['sess.rating.json']);

    // The single file holds the SECOND (latest) rating, not a duplicate.
    expect(readSessionRating(TMP, 'proj', 'sess')).toEqual(second);
  });

  it('upsert is day-independent — a cross-day re-rate does not bucket by date', () => {
    const day1: SessionRating = {
      ...makeRating({ projectName: 'p', sessionId: 's' }),
      ratedAt: '2026-01-01T00:00:00.000Z',
    };
    const day2: SessionRating = {
      ...makeRating({ projectName: 'p', sessionId: 's' }),
      ratedAt: '2026-12-31T23:59:59.000Z',
    };
    const p1 = writeSessionRating(day1, TMP);
    const p2 = writeSessionRating(day2, TMP);
    // Same path regardless of `ratedAt` — no YYYY-MM-DD segment.
    expect(p1).toBe(p2);
    expect(p1).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const ratingsDir = join(TMP, 'projects', 'p', 'sessions', 'ratings');
    expect(readdirSync(ratingsDir)).toHaveLength(1);
  });

  it('rejects a rating that fails the SessionRating Zod schema', () => {
    const bad = { ...makeRating(), schemaVersion: 99 } as unknown as SessionRating;
    expect(() => writeSessionRating(bad, TMP)).toThrow(/SessionRating/);
  });

  it('rejects a rating whose verdicts contain a duplicate key', () => {
    const bad: SessionRating = {
      ...makeRating(),
      verdicts: [
        { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
        { key: 'tdd', verdict: 'fail', scoredAt: '2026-05-17T09:00:00.000Z' },
      ],
    };
    expect(() => writeSessionRating(bad, TMP)).toThrow(/SessionRating/);
  });

  it('rejects a projectName with a path separator', () => {
    const bad = makeRating({ projectName: `bad${sep}name` });
    expect(() => writeSessionRating(bad, TMP)).toThrow(/projectName/);
  });

  it('rejects a sessionId containing ".."', () => {
    const bad = makeRating({ sessionId: 'a..b' });
    expect(() => writeSessionRating(bad, TMP)).toThrow(/sessionId/);
  });

  it('rejects a projectName containing ".."', () => {
    const bad = makeRating({ projectName: '..' });
    expect(() => writeSessionRating(bad, TMP)).toThrow(/projectName/);
  });

  it('writes via injected fs hooks (atomic + realpath stubbed)', () => {
    const rating = makeRating({ projectName: 'proj', sessionId: 'sess' });
    const writes = new Map<string, string>();
    const fs: RatingWriterFsHooks = {
      mkdirSync: () => undefined,
      writeFileSync: ((p: string, data: string) => {
        writes.set(p, data);
      }) as RatingWriterFsHooks['writeFileSync'],
      renameSync: ((from: string, to: string) => {
        writes.set(to, writes.get(from) ?? '');
        writes.delete(from);
      }) as RatingWriterFsHooks['renameSync'],
      unlinkSync: () => undefined,
      realpathSync: (p: string) => p,
    };
    const written = writeSessionRating(rating, TMP, fs);
    expect(JSON.parse(writes.get(written) ?? '')).toEqual(rating);
  });

});

// --- assertRatingPathWithinRoot --------------------------------------------

describe('assertRatingPathWithinRoot', () => {
  it('accepts the root itself', () => {
    expect(() => assertRatingPathWithinRoot('/data', '/data')).not.toThrow();
  });

  it('accepts a target strictly inside the root', () => {
    expect(() =>
      assertRatingPathWithinRoot(join('/data', 'projects', 'p'), '/data'),
    ).not.toThrow();
  });

  it('throws when the target escapes the root', () => {
    expect(() => assertRatingPathWithinRoot('/elsewhere/x', '/data')).toThrow(
      /escapes/,
    );
  });

  it('throws on a sibling whose name shares the root prefix', () => {
    // `/data-evil` starts with `/data` but is NOT inside `/data/`.
    expect(() => assertRatingPathWithinRoot('/data-evil', '/data')).toThrow(
      /escapes/,
    );
  });
});
