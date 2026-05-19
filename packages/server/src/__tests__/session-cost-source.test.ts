// Tests for the per-session cost source resolver (sessions-spike WU v5-7).
//
// CRITICAL — the subagent-file merge (a v5-2 finding). Design §4.1 says a
// session's `isSidechain` subagent records "share one file" with the main
// thread. That is INACCURATE for real Claude Code: subagent records live in
// SEPARATE `subagents/agent-*.jsonl` files NEXT TO the main transcript. So a
// session's cost MUST be computed over the main file PLUS its sibling
// `subagents/agent-*.jsonl` files — `parseTranscriptUsage` over each, the
// `AssistantUsageRecord[]`s concatenated, then `computeSessionCost`.
//
// `sessionCostSources` resolves a transcript path to the ordered list of
// source files (main first, then each subagent file). It is filesystem-
// injectable so the `subagents/` discovery is testable on a temp tree.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  sessionCostSources,
  type SessionCostSourceFsHooks,
} from '../data/session-cost-source.js';

/** A minimal `fs.Stats`-like shape for the injected-hook tests. */
function statsLike(opts: {
  dir?: boolean;
  file?: boolean;
  symlink?: boolean;
}): {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
} {
  return {
    isDirectory: () => opts.dir ?? false,
    isFile: () => opts.file ?? false,
    isSymbolicLink: () => opts.symlink ?? false,
  };
}

let TMP: string;

function setup(): string {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-session-cost-src-'));
  return TMP;
}
function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

describe('sessionCostSources — subagent-file merge', () => {
  it('returns just the main transcript when no subagents/ dir exists', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');

      expect(sessionCostSources(main)).toEqual([main]);
    } finally {
      teardown();
    }
  });

  it('appends each subagents/agent-*.jsonl sibling, main file first', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const subDir = join(dir, 'subagents');
      mkdirSync(subDir, { recursive: true });
      const agent1 = join(subDir, 'agent-001.jsonl');
      const agent2 = join(subDir, 'agent-002.jsonl');
      writeFileSync(agent1, '{}\n', 'utf8');
      writeFileSync(agent2, '{}\n', 'utf8');

      const sources = sessionCostSources(main);
      expect(sources[0]).toBe(main);
      // The subagent files follow, in a deterministic (sorted) order.
      expect(sources.slice(1).sort()).toEqual([agent1, agent2].sort());
      expect(sources).toHaveLength(3);
    } finally {
      teardown();
    }
  });

  it('ignores non-agent files inside subagents/', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const subDir = join(dir, 'subagents');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, 'agent-001.jsonl'), '{}\n', 'utf8');
      // Not an `agent-*.jsonl` — must be skipped.
      writeFileSync(join(subDir, 'README.md'), 'hi\n', 'utf8');
      writeFileSync(join(subDir, 'notes.txt'), 'x\n', 'utf8');
      // Wrong extension.
      writeFileSync(join(subDir, 'agent-002.json'), '{}\n', 'utf8');

      const sources = sessionCostSources(main);
      expect(sources).toHaveLength(2); // main + agent-001 only
      expect(sources[1]).toBe(join(subDir, 'agent-001.jsonl'));
    } finally {
      teardown();
    }
  });

  it('returns just the main file when subagents/ is empty', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      mkdirSync(join(dir, 'subagents'), { recursive: true });

      expect(sessionCostSources(main)).toEqual([main]);
    } finally {
      teardown();
    }
  });

  it('rejects an agent file whose name fails the path-segment allow-list', () => {
    const dir = setup();
    try {
      const main = join(dir, 'sess-a1.jsonl');
      writeFileSync(main, '{}\n', 'utf8');
      const subDir = join(dir, 'subagents');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, 'agent-ok.jsonl'), '{}\n', 'utf8');
      // A name carrying a `..` traversal sequence is refused.
      writeFileSync(join(subDir, 'agent-..evil.jsonl'), '{}\n', 'utf8');

      const sources = sessionCostSources(main);
      expect(sources).toEqual([main, join(subDir, 'agent-ok.jsonl')]);
    } finally {
      teardown();
    }
  });
});

describe('sessionCostSources — path-safety (injected fs hooks)', () => {
  const MAIN = '/t/proj/sess-a1.jsonl';
  const SUBDIR = '/t/proj/subagents';

  it('refuses a SYMLINKED subagents/ directory (does not follow it)', () => {
    const fs: SessionCostSourceFsHooks = {
      lstatSync: (p) =>
        p === SUBDIR
          ? statsLike({ dir: true, symlink: true })
          : statsLike({ file: true }),
      readdirSync: () => {
        throw new Error('readdir must not be reached for a symlinked dir');
      },
    };
    expect(sessionCostSources(MAIN, fs)).toEqual([MAIN]);
  });

  it('returns the main file only when subagents/ is not a directory', () => {
    const fs: SessionCostSourceFsHooks = {
      lstatSync: (p) =>
        p === SUBDIR ? statsLike({ file: true }) : statsLike({ file: true }),
      readdirSync: () => {
        throw new Error('readdir must not be reached for a non-directory');
      },
    };
    expect(sessionCostSources(MAIN, fs)).toEqual([MAIN]);
  });

  it('returns the main file only when subagents/ cannot be read', () => {
    const fs: SessionCostSourceFsHooks = {
      lstatSync: () => statsLike({ dir: true }),
      readdirSync: () => {
        const err = new Error('EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    expect(sessionCostSources(MAIN, fs)).toEqual([MAIN]);
  });

  it('skips an agent file that cannot be lstat-ed', () => {
    const fs: SessionCostSourceFsHooks = {
      lstatSync: (p) => {
        if (p === SUBDIR) return statsLike({ dir: true });
        if (p.endsWith('agent-gone.jsonl')) {
          throw new Error('ENOENT');
        }
        return statsLike({ file: true });
      },
      readdirSync: () => ['agent-ok.jsonl', 'agent-gone.jsonl'],
    };
    expect(sessionCostSources(MAIN, fs)).toEqual([
      MAIN,
      join(SUBDIR, 'agent-ok.jsonl'),
    ]);
  });

  it('refuses a SYMLINKED agent file', () => {
    const fs: SessionCostSourceFsHooks = {
      lstatSync: (p) => {
        if (p === SUBDIR) return statsLike({ dir: true });
        if (p.endsWith('agent-link.jsonl')) {
          return statsLike({ file: true, symlink: true });
        }
        return statsLike({ file: true });
      },
      readdirSync: () => ['agent-ok.jsonl', 'agent-link.jsonl'],
    };
    expect(sessionCostSources(MAIN, fs)).toEqual([
      MAIN,
      join(SUBDIR, 'agent-ok.jsonl'),
    ]);
  });
});
