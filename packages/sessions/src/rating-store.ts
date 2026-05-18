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
// This module exposes both the READ path (`ratingPath`, `readSessionRating`)
// the three GET endpoints need and (WU v4-6) the WRITE path
// (`writeSessionRating`) the `PUT .../rating` endpoint needs — the layout
// helper `ratingPath` is shared by both.
//
// `projectName` and `sessionId` are attacker-influenceable (they originate
// from route params / discovery), so they are sanitized against an allow-list
// BEFORE any path join — identical to `writer.ts`'s `sanitizeSegment` (design
// §8.2). A violation throws; it is never silently coerced.
//
// The write path additionally (a) validates the whole `SessionRating` against
// its Zod schema before persisting, (b) writes via the shared
// `atomicWriteJson` (temp-then-rename), and (c) re-checks containment against
// the *realpath* of `dataDir` (design §8.3 / §11.5) so a symlink at the
// dataDir root cannot redirect the write outside the resolved directory.
// Because the path is day-independent, writing twice for the same
// `(projectName, sessionId)` upserts the single file (design §13).

import {
  mkdirSync,
  readFileSync as nodeReadFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';

import {
  atomicWriteJson,
  type WriterFsHooks,
} from '@metaswarm-dashboard/types/fs-utils';
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

/**
 * Injectable filesystem hooks for the rating WRITE path. Extends the
 * `atomicWriteJson` hook set with `realpathSync` (used to resolve the real
 * `dataDir` for containment). Defaults to `node:fs`.
 *
 * Only the synchronous string-returning call signature of `realpathSync` is
 * required — the contract is intentionally narrower than `typeof realpathSync`
 * (which also carries `.native`) so test stubs need not reproduce it.
 */
export type RatingWriterFsHooks = WriterFsHooks & {
  realpathSync: (path: string) => string;
};

const DEFAULT_WRITER_FS: RatingWriterFsHooks = {
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  realpathSync,
};

/**
 * Defense-in-depth containment assertion: throw unless `target` is `root`
 * itself or sits strictly inside `root` (i.e. starts with `root + sep`).
 *
 * With sanitized segments this always holds for a well-formed `dataDir`, so
 * it is a guard against a symlinked dataDir root, not against the segments.
 *
 * Exported so it can be unit-tested directly (the throw branch is otherwise
 * unreachable for sanitized inputs) — mirroring `writer.ts`.
 */
export function assertRatingPathWithinRoot(target: string, root: string): void {
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(
      `rating path escapes data directory: ${JSON.stringify(target)} not within ${JSON.stringify(root)}`,
    );
  }
}

/**
 * Atomically persist a `SessionRating` to the datalake. Returns the absolute
 * path written.
 *
 * The layout is **day-independent** (design §13): one file per
 * `(projectName, sessionId)`, never bucketed by calendar day. Writing a
 * rating for the same `(projectName, sessionId)` twice therefore **upserts**
 * the single file (`atomicWriteJson`'s rename overwrites) — a cross-day
 * re-rate leaves exactly one file, not two.
 *
 * Steps: validate against the `SessionRating` Zod schema → sanitize the two
 * attacker-influenceable path segments → resolve the *realpath* of `dataDir`
 * → compose the target → re-assert containment → atomic write.
 *
 * @throws Error        if `rating` fails the `SessionRating` schema, if
 *                      `projectName`/`sessionId` fails sanitization, or if the
 *                      resolved target escapes the realpath of `dataDir`.
 * @throws WriterError  if the underlying atomic write fails.
 */
export function writeSessionRating(
  rating: SessionRating,
  dataDir: string,
  fs: RatingWriterFsHooks = DEFAULT_WRITER_FS,
): string {
  // 1. Validate the whole payload — never persist an off-schema rating.
  const parsed = SessionRating.safeParse(rating);
  if (!parsed.success) {
    throw new Error(
      `invalid SessionRating: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const validated = parsed.data;

  // 2. Sanitize attacker-influenceable segments BEFORE any path join. The
  //    day-independent path is keyed by (projectName, sessionId) only.
  const safeProject = sanitizeSegment('projectName', validated.projectName);
  const safeSession = sanitizeSegment('sessionId', validated.sessionId);

  // 3. Ensure dataDir exists so realpath can resolve it.
  fs.mkdirSync(dataDir, { recursive: true });

  // 4. Resolve the REAL root — defeats a symlink at the dataDir root (§11.5).
  const root = fs.realpathSync(dataDir);

  // 5. Compose the day-independent target path.
  const target = join(
    root,
    'projects',
    safeProject,
    'sessions',
    'ratings',
    `${safeSession}${RATING_FILE_SUFFIX}`,
  );

  // 6. Containment assertion (defense-in-depth — catches a symlinked root).
  assertRatingPathWithinRoot(target, root);

  // 7. Atomically write; the rename overwrites, so a re-rate upserts.
  atomicWriteJson(target, `${JSON.stringify(validated, null, 2)}\n`, fs);
  return target;
}
