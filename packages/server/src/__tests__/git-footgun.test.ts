// Tests for the dataDir-inside-git footgun check (sessions-spike WU v4-6,
// design §8.3). The `existsSync` hook is injected so both the found and
// not-found ancestor-walk branches are reachable deterministically.

import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  findEnclosingGitDir,
  warnIfDataDirInGit,
  type GitFootgunFsHooks,
} from '../data/git-footgun.js';

/** An fs stub whose `.git` entries live at the given set of directories. */
function fsWithGitAt(...gitDirs: string[]): GitFootgunFsHooks {
  const gitPaths = new Set(gitDirs.map((d) => join(d, '.git')));
  return { existsSync: (p) => gitPaths.has(p) };
}

describe('findEnclosingGitDir', () => {
  it('returns dataDir itself when it directly contains a .git entry', () => {
    const dataDir = join('/home', 'me', 'datalake');
    expect(findEnclosingGitDir(dataDir, fsWithGitAt(dataDir))).toBe(dataDir);
  });

  it('returns an ancestor when a parent up the chain contains .git', () => {
    const repo = join('/home', 'me', 'project');
    const dataDir = join(repo, 'nested', 'datalake');
    expect(findEnclosingGitDir(dataDir, fsWithGitAt(repo))).toBe(repo);
  });

  it('returns null when no ancestor contains a .git entry', () => {
    const dataDir = join('/home', 'me', 'datalake');
    // fs with NO `.git` anywhere — the walk reaches the filesystem root.
    expect(findEnclosingGitDir(dataDir, { existsSync: () => false })).toBeNull();
  });

  it('terminates at the filesystem root (dirname fixed point)', () => {
    // `/` — `dirname('/')` is `'/'`, so the loop must break, not spin.
    expect(findEnclosingGitDir('/', { existsSync: () => false })).toBeNull();
  });

  it('finds .git at the filesystem root', () => {
    const root = dirname('/'); // '/'
    expect(findEnclosingGitDir('/', fsWithGitAt(root))).toBe(root);
  });
});

describe('warnIfDataDirInGit', () => {
  it('logs a one-line warning when dataDir is inside a git working tree', () => {
    const repo = join('/home', 'me', 'project');
    const dataDir = join(repo, 'datalake');
    const warn = vi.fn();
    warnIfDataDirInGit(dataDir, warn, fsWithGitAt(repo));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('git working tree');
    expect(warn.mock.calls[0]?.[0]).toContain(repo);
  });

  it('does NOT warn when dataDir is not inside a git working tree', () => {
    const warn = vi.fn();
    warnIfDataDirInGit('/home/me/datalake', warn, { existsSync: () => false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses node:fs by default when no fs hook is injected', () => {
    // A path that cannot exist — exercises the default-arg branch without
    // depending on the test machine's layout. Must not throw.
    const warn = vi.fn();
    expect(() =>
      warnIfDataDirInGit(
        '/nonexistent-metaswarm-dashboard-footgun-probe/x/y/z',
        warn,
      ),
    ).not.toThrow();
  });
});
