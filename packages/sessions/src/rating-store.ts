// Rating store — datalake read access for operator `SessionRating`s
// (sessions-spike WU v4-5, design §7 / §13).
//
// A rating is mutable operator state, NOT a point-in-time artifact, so its
// file is **day-independent** (design §13): one file per `(project,
// sessionId)`, never bucketed by calendar day. A cross-day re-rate therefore
// upserts the single file rather than leaving two.
//
//   <dataDir>/projects/<projectName>/sessions/ratings/<sessionId>.rating.json
//
// This WU v4-5 module exposes the READ path (`ratingPath`, `readSessionRating`)
// the three GET endpoints need. WU v4-6 adds `writeSessionRating` here as a
// sibling — the layout helper `ratingPath` is shared by both.
//
// `projectName` and `sessionId` are attacker-influenceable (they originate
// from route params / discovery), so they are sanitized against an allow-list
// BEFORE any path join — identical to `writer.ts`'s `sanitizeSegment` (design
// §8.2). A violation throws; it is never silently coerced.

import { readFileSync as nodeReadFileSync } from 'node:fs';
import { join } from 'node:path';

import { SessionRating } from '@metaswarm-dashboard/types/ratings';

/** Allow-list for a path segment. Excludes `/`, `\`, control chars, spaces. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The fixed filename suffix for a persisted rating. */
const RATING_FILE_SUFFIX = '.rating.json';

/**
 * Injectable filesystem hooks for the rating store. Defaults to `node:fs`.
 * Tests pass a stub so the read path's error/JSON/validation branches are
 * all reachable without touching the real datalake.
 */
export interface RatingStoreFsHooks {
  /** Read a file as a UTF-8 string. */
  readFileSync: (path: string) => string;
}

const DEFAULT_FS: RatingStoreFsHooks = {
  readFileSync: (path) => nodeReadFileSync(path, 'utf8'),
};

/**
 * Validate an attacker-influenceable path segment. Throws a clear `Error`
 * naming the field and the offending value on any violation.
 *
 * The regex already rejects path separators and control characters; the
 * `..` check is separate because `..` itself matches `^[A-Za-z0-9._-]+$`.
 */
function sanitizeSegment(field: string, value: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(
      `invalid ${field} ${JSON.stringify(value)}: must match ${String(SAFE_SEGMENT)}`,
    );
  }
  if (value.includes('..')) {
    throw new Error(
      `invalid ${field} ${JSON.stringify(value)}: must not contain ".."`,
    );
  }
  return value;
}

/**
 * Resolve the absolute path of the rating file for a `(project, sessionId)`.
 * The layout is day-independent (design §13).
 *
 * @throws Error if `projectName` or `sessionId` fails sanitization.
 */
export function ratingPath(
  dataDir: string,
  projectName: string,
  sessionId: string,
): string {
  const safeProject = sanitizeSegment('projectName', projectName);
  const safeSession = sanitizeSegment('sessionId', sessionId);
  return join(
    dataDir,
    'projects',
    safeProject,
    'sessions',
    'ratings',
    `${safeSession}${RATING_FILE_SUFFIX}`,
  );
}

/**
 * Read the persisted `SessionRating` for a `(project, sessionId)`.
 *
 * @returns the validated `SessionRating`, or `null` when no rating file
 *   exists, the file is unreadable, the content is not JSON, or the content
 *   fails the `SessionRating` Zod schema.
 * @throws Error if `projectName` or `sessionId` fails sanitization.
 */
export function readSessionRating(
  dataDir: string,
  projectName: string,
  sessionId: string,
  fs: RatingStoreFsHooks = DEFAULT_FS,
): SessionRating | null {
  // Sanitization throws (a programmer error) — it is NOT folded into `null`.
  const path = ratingPath(dataDir, projectName, sessionId);

  let raw: string;
  try {
    raw = fs.readFileSync(path);
  } catch {
    // Absent file (ENOENT) or any other read failure → the session is
    // simply unrated. Either way the caller sees `null`.
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = SessionRating.safeParse(parsed);
  return result.success ? result.data : null;
}
