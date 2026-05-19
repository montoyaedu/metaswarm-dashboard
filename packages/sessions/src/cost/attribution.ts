// cwd→project attribution resolver (sessions-spike WU v5-1, design §4.4).
//
// `resolveProjectForCwd(cwd, config)` maps a delegation run's working
// directory to a configured project. It is the shared resolver reused by the
// Codex (v5-3) and ledger (v5-4) readers.
//
// Matching is an EXACT-or-PREFIX comparison on `realpath`-resolved absolute
// paths (design §4.4) — NEVER a substring match. Both the cwd and each
// configured project path are canonicalized first (so a symlinked cwd or a
// symlinked project dir resolves correctly), then compared at a path-segment
// boundary: project `repo` must NOT capture a cwd under `repo-secret`.
//
// A cwd matching no configured project resolves to `null` — the
// `unattributed` bucket (design §4.4): such a run is never silently dropped.

import { realpathSync as nodeRealpathSync } from 'node:fs';
import { sep } from 'node:path';

import type { Config } from '@metaswarm-dashboard/types/config';

/** Injectable `realpath`. Defaults to `node:fs` `realpathSync`. */
export interface AttributionFsHooks {
  /** Resolve a path to its canonical location (follows symlinks). */
  realpathSync: (path: string) => string;
}

const DEFAULT_FS: AttributionFsHooks = {
  realpathSync: (path) => nodeRealpathSync(path),
};

/**
 * Resolve a run's `cwd` to a configured project name (design §4.4).
 *
 * @param cwd - The run's working directory (from a Codex `session_meta` or a
 *   ledger entry). May be a symlink; it is `realpath`-resolved before
 *   matching.
 * @param config - The loaded dashboard config; its `projects[].path` values
 *   are absolute (expanded by the config loader) but may still be symlinks.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @returns The matching project's `name`, or `null` when the cwd is under no
 *   configured project (the `unattributed` bucket). If two configured
 *   projects both contain the cwd (a nested config), the FIRST in config
 *   order wins — deterministic and documented.
 */
export function resolveProjectForCwd(
  cwd: string,
  config: Config,
  fs: AttributionFsHooks = DEFAULT_FS,
): string | null {
  // Canonicalize the cwd. A path that cannot be resolved (does not exist,
  // empty string, permission error) cannot be attributed → unattributed.
  let resolvedCwd: string;
  try {
    resolvedCwd = fs.realpathSync(cwd);
  } catch {
    return null;
  }

  for (const project of config.projects) {
    // Canonicalize the project path too — it may itself be a symlink. A
    // project whose path no longer resolves is skipped, not fatal.
    let resolvedProject: string;
    try {
      resolvedProject = fs.realpathSync(project.path);
    } catch {
      continue;
    }
    if (isWithin(resolvedCwd, resolvedProject)) {
      return project.name;
    }
  }
  return null;
}

/**
 * True if `target` is `root` itself or a descendant of it. The comparison is
 * at a path-separator boundary so `/a/repo-secret` is NOT treated as inside
 * `/a/repo` — a substring match would wrongly capture it (design §4.4).
 */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}
