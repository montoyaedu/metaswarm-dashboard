// Opt-in `--persist` snapshot writer (sessions-spike WU-5, design §4 item 9,
// §11 mitigation #4, §13 Q3).
//
// `writeSessionSnapshot(snapshot, dataDir, fs?)` atomically persists a
// `SessionSnapshot` as JSON under the layout
//
//   <dataDir>/projects/<projectName>/sessions/<YYYY-MM-DD>/<sessionId>.json
//
// where <YYYY-MM-DD> is the date portion of `snapshot.generatedAt` (design
// §13 Q3 — multi-session days are keyed by `<sessionId>.json`). Persistence
// is OFF by default; only the `audit --persist` flag reaches this writer.
//
// A snapshot MAY CONTAIN OPERATOR SECRETS (design §11). The two filesystem-
// path inputs — `projectName` and `sessionId` — are attacker-influenceable,
// so they are sanitized against an allow-list BEFORE any path join (§11
// mitigation #4). Containment is then re-checked against the *realpath* of
// `dataDir` (§11.5) so a pre-existing symlink at the dataDir root cannot
// redirect writes outside the resolved directory — a lexical `path.resolve`
// would not catch that. The WU-5 bead predates design v3 and still says
// `path.resolve`; v3 §11.5 supersedes it with realpath.
//
// Uses the lifted `atomicWriteJson` from `@metaswarm-dashboard/types/fs-utils`
// (NOT a deep import from `@metaswarm-dashboard/collector` — anti-goal §12.10).

import {
  mkdirSync,
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
import type { SessionSnapshot } from '@metaswarm-dashboard/types/sessions';

/**
 * Injectable filesystem hooks for the snapshot writer. Extends the
 * `atomicWriteJson` hook set with `realpathSync` (used to resolve the real
 * `dataDir` for containment). Defaults to `node:fs`.
 *
 * Only the synchronous string-returning call signature of `realpathSync` is
 * required — the contract is intentionally narrower than `typeof realpathSync`
 * (which also carries `.native`) so test stubs need not reproduce it.
 */
export type SnapshotWriterFsHooks = WriterFsHooks & {
  realpathSync: (path: string) => string;
};

const DEFAULT_FS: SnapshotWriterFsHooks = {
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  realpathSync,
};

/** Allow-list for path segments. Excludes `/`, `\`, control chars, spaces. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

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
 * Defense-in-depth containment assertion: throw unless `target` is `root`
 * itself or sits strictly inside `root` (i.e. starts with `root + sep`).
 *
 * With sanitized segments this always holds, so the function is exported
 * and unit-tested directly (rather than relying on an unreachable inline
 * branch) to keep coverage honest.
 */
export function assertPathWithinRoot(target: string, root: string): void {
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(
      `snapshot path escapes data directory: ${JSON.stringify(target)} not within ${JSON.stringify(root)}`,
    );
  }
}

/**
 * Atomically persist `snapshot` under `dataDir`. Returns the absolute path
 * written. Idempotent — re-running with the same snapshot overwrites the
 * existing file (via `atomicWriteJson`'s temp-then-rename).
 *
 * @throws Error    if `projectName` or `sessionId` fails sanitization, or if
 *                  the resolved target escapes the realpath of `dataDir`.
 * @throws WriterError  if the underlying atomic write fails.
 */
export function writeSessionSnapshot(
  snapshot: SessionSnapshot,
  dataDir: string,
  fs: SnapshotWriterFsHooks = DEFAULT_FS,
): string {
  // 1. Sanitize attacker-influenceable segments BEFORE any path join.
  const projectName = sanitizeSegment('projectName', snapshot.projectName);
  const sessionId = sanitizeSegment('sessionId', snapshot.timeline.sessionId);

  // 2. Ensure dataDir exists so realpath can resolve it.
  fs.mkdirSync(dataDir, { recursive: true });

  // 3. Resolve the REAL root — defeats a symlink at the dataDir root (§11.5).
  const root = fs.realpathSync(dataDir);

  // 4. Day bucket = the YYYY-MM-DD of the ISO-8601 generatedAt.
  const dayKey = snapshot.generatedAt.slice(0, 10);

  // 5. Compose the target path.
  const target = join(
    root,
    'projects',
    projectName,
    'sessions',
    dayKey,
    `${sessionId}.json`,
  );

  // 6. Containment assertion (defense-in-depth — holds for sanitized input).
  assertPathWithinRoot(target, root);

  // 7. Atomically write; idempotent across re-runs. Return the path written.
  atomicWriteJson(target, `${JSON.stringify(snapshot, null, 2)}\n`, fs);
  return target;
}
