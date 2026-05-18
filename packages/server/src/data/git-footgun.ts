// dataDir-inside-git footgun check (design §8.3, sessions-spike WU v4-6).
//
// A rating write persists operator notes into the datalake. If the datalake
// sits inside a git working tree, those notes could be accidentally committed
// and pushed. On every rating write the server checks whether `dataDir` is
// inside a git working tree and logs a one-line warning if so — it does NOT
// refuse the write (the operator may have a deliberate setup).
//
// The check is a pure FILESYSTEM walk: starting at `dataDir`, walk up the
// ancestor chain looking for a `.git` entry. It deliberately does NOT spawn
// `git` (anti-goal §12.12 — no subprocess) — it only `existsSync`-checks for
// a `.git` entry, which covers both a `.git` directory and a `.git` file
// (git worktrees / submodules use a `.git` file).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Injectable filesystem hook for the footgun check. Defaults to `node:fs`.
 * Tests pass a stub so both the found and not-found branches are reachable
 * without depending on the test machine's directory layout.
 */
export interface GitFootgunFsHooks {
  /** True iff a filesystem entry exists at `path`. */
  existsSync: (path: string) => boolean;
}

const DEFAULT_FS: GitFootgunFsHooks = { existsSync };

/**
 * Walk up from `dataDir` through its ancestors; return the first ancestor
 * (inclusive of `dataDir` itself) that contains a `.git` entry, or `null`
 * if none does before the filesystem root.
 *
 * The walk terminates at the filesystem root because `dirname('/')` is `'/'`
 * (a fixed point) — the loop breaks once `dirname` stops changing the path.
 */
export function findEnclosingGitDir(
  dataDir: string,
  fs: GitFootgunFsHooks = DEFAULT_FS,
): string | null {
  let current = dataDir;
  for (;;) {
    if (fs.existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * If `dataDir` sits inside a git working tree, log a one-line warning via
 * `warn`. Never throws and never refuses — purely advisory (design §8.3).
 */
export function warnIfDataDirInGit(
  dataDir: string,
  warn: (line: string) => void,
  fs: GitFootgunFsHooks = DEFAULT_FS,
): void {
  const gitDir = findEnclosingGitDir(dataDir, fs);
  if (gitDir !== null) {
    warn(
      `dataDir ${dataDir} sits inside a git working tree (${gitDir}); ` +
        'rating notes may contain secrets — exclude the datalake from version control.',
    );
  }
}
