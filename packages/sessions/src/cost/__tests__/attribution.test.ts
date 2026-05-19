// Tests for the cwd→project attribution resolver (sessions-spike WU v5-1,
// design §4.4).
//
// `resolveProjectForCwd` maps a run's `cwd` to a configured project by an
// exact-or-prefix comparison on `realpath`-resolved absolute paths. It is the
// shared resolver reused by the Codex (v5-3) and ledger (v5-4) readers.
//
// The matching MUST be a path-segment-boundary prefix, never a substring —
// project `repo` must NOT capture a cwd under `repo-secret`. A cwd matching
// no configured project resolves to `null` (the `unattributed` bucket).
//
// Tests run over real `mkdtemp` temp trees so `realpath` (symlink resolution)
// is exercised for real; the injectable `realpathSync` hook covers the
// resolve-failure branch a temp tree cannot reproduce.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '@metaswarm-dashboard/types/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import { resolveProjectForCwd } from '../attribution.js';

/** Build a `Config` from `[name, absolutePath]` pairs. */
function configOf(...projects: ReadonlyArray<readonly [string, string]>): Config {
  return {
    projects: projects.map(([name, path]) => ({
      name,
      path,
      category: 'metaswarm' as const,
    })),
  };
}

describe('resolveProjectForCwd', () => {
  let root: string;

  beforeEach(() => {
    // `realpathSync` so macOS `/var`→`/private/var` symlinking is pre-resolved.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'v5-attribution-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('matches a cwd exactly equal to a configured project path', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const config = configOf(['repo', repo]);
    expect(resolveProjectForCwd(repo, config)).toBe('repo');
  });

  it('matches a cwd that is a descendant of a configured project path', () => {
    const repo = join(root, 'repo');
    const sub = join(repo, 'packages', 'server');
    mkdirSync(sub, { recursive: true });
    const config = configOf(['repo', repo]);
    expect(resolveProjectForCwd(sub, config)).toBe('repo');
  });

  it('does NOT let project `repo` capture a sibling `repo-secret` cwd', () => {
    const repo = join(root, 'repo');
    const repoSecret = join(root, 'repo-secret');
    mkdirSync(repo);
    mkdirSync(repoSecret);
    const config = configOf(['repo', repo]);
    // `repo-secret` starts with the string `repo` but is NOT under it.
    expect(resolveProjectForCwd(repoSecret, config)).toBeNull();
  });

  it('does NOT let project `repo` capture a deeper `repo-secret/...` cwd', () => {
    const repo = join(root, 'repo');
    const deepSecret = join(root, 'repo-secret', 'src');
    mkdirSync(repo);
    mkdirSync(deepSecret, { recursive: true });
    const config = configOf(['repo', repo]);
    expect(resolveProjectForCwd(deepSecret, config)).toBeNull();
  });

  it('returns null for a cwd under no configured project (unattributed)', () => {
    const repo = join(root, 'repo');
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(repo);
    mkdirSync(elsewhere);
    const config = configOf(['repo', repo]);
    expect(resolveProjectForCwd(elsewhere, config)).toBeNull();
  });

  it('returns null when the config has no projects', () => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    expect(resolveProjectForCwd(elsewhere, configOf())).toBeNull();
  });

  it('resolves a symlinked cwd to its real path before matching', () => {
    const repo = join(root, 'repo');
    const real = join(repo, 'pkg');
    mkdirSync(real, { recursive: true });
    const link = join(root, 'link-into-repo');
    symlinkSync(real, link);
    const config = configOf(['repo', repo]);
    // The cwd is a symlink that resolves INTO `repo`.
    expect(resolveProjectForCwd(link, config)).toBe('repo');
  });

  it('resolves a symlinked configured project path before matching', () => {
    const realRepo = join(root, 'real-repo');
    const sub = join(realRepo, 'src');
    mkdirSync(sub, { recursive: true });
    const linkedRepo = join(root, 'linked-repo');
    symlinkSync(realRepo, linkedRepo);
    // The CONFIG points at the symlink; the cwd is under the real dir.
    const config = configOf(['repo', linkedRepo]);
    expect(resolveProjectForCwd(sub, config)).toBe('repo');
  });

  it('returns the first configured project when paths are nested', () => {
    // `outer` then `outer/inner` — a cwd inside `inner` matches whichever
    // project appears first in config order (deterministic, documented).
    const outer = join(root, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(inner, { recursive: true });
    const config = configOf(['outer', outer], ['inner', inner]);
    expect(resolveProjectForCwd(inner, config)).toBe('outer');
  });

  it('returns null when the cwd cannot be realpath-resolved', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const missing = join(root, 'this-path-does-not-exist');
    const config = configOf(['repo', repo]);
    // A non-existent cwd cannot be canonicalized → unattributed.
    expect(resolveProjectForCwd(missing, config)).toBeNull();
  });

  it('skips a configured project whose path cannot be realpath-resolved', () => {
    const gone = join(root, 'deleted-project');
    const repo = join(root, 'repo');
    mkdirSync(repo);
    // `gone` is configured but does not exist on disk; `repo` does.
    const config = configOf(['ghost', gone], ['repo', repo]);
    expect(resolveProjectForCwd(repo, config)).toBe('repo');
  });

  it('returns null with an empty-string cwd', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    expect(resolveProjectForCwd('', configOf(['repo', repo]))).toBeNull();
  });

  it('is re-exported from the package public surface', () => {
    expect(sessions.resolveProjectForCwd).toBe(resolveProjectForCwd);
  });
});
