// Tests for the rating store (sessions-spike WU v4-5, design §13).
//
// Covers: the day-independent path layout
// (<dataDir>/projects/<name>/sessions/ratings/<sessionId>.rating.json),
// `projectName`/`sessionId` sanitization rejections, an absent rating file
// resolving to `null`, and a valid rating round-trip. The injectable fs
// hooks let every branch run without `/* v8 ignore */`.
//
// WU v4-6 will add `writeSessionRating` to the same module; this WU only
// exercises the read path.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import type { SessionRating } from '@metaswarm-dashboard/types/ratings';
import type { ProcessRubricScore, RubricKey } from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ratingPath,
  readSessionRating,
  type RatingStoreFsHooks,
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
