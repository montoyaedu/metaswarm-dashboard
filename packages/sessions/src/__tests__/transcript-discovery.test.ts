// Tests for session discovery (sessions-spike WU v4-4, design §3.6 / §8.2).
//
// Discovery maps each configured project to the Claude Code transcript files
// under `~/.claude/projects/<encoded-cwd>/`. It is read-only and path-safe.
//
// Two test styles are used:
//   - `encodeTranscriptDirName` is pinned with SYNTHETIC path assertions only
//     (no dependency on the operator's actual `~/.claude/projects/` state).
//   - `discoverSessions` is exercised over real `mkdtemp` temp trees so every
//     fs branch (ENOENT, symlink, non-dir, containment, bad basename) is
//     reachable without `/* v8 ignore */`. The injectable `DiscoveryFsHooks`
//     are used for the one branch a temp tree cannot reproduce.
//
// No `.jsonl` files are written under `__tests__/fixtures/` — that directory
// is marker-guarded by the vitest setup file; all scratch `.jsonl` files go
// to `mkdtemp` temp dirs instead.

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '@metaswarm-dashboard/types/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sessions from '../index.js';
import {
  discoverSessions,
  encodeTranscriptDirName,
  type SessionRef,
} from '../transcript-discovery.js';

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

describe('encodeTranscriptDirName', () => {
  // Claude Code stores each project's transcripts under
  // `~/.claude/projects/<encoded-cwd>/`. The encoding replaces EVERY
  // non-alphanumeric character of the absolute path with `-`:
  //   `encoded = absPath.replace(/[^a-zA-Z0-9]/g, '-')`.
  // This was reverse-engineered by matching all 19 directories under a real
  // `~/.claude/projects/` against their transcripts' `cwd` field (incl. a
  // path with underscores: `CR_20260228_PROD` → `CR-20260228-PROD`).

  it('replaces each path separator with a dash', () => {
    expect(encodeTranscriptDirName('/Users/x/ethiclab/repo')).toBe(
      '-Users-x-ethiclab-repo',
    );
  });

  it('preserves a dash already present in a path component', () => {
    expect(encodeTranscriptDirName('/Users/x/ethiclab/metaswarm-dashboard')).toBe(
      '-Users-x-ethiclab-metaswarm-dashboard',
    );
  });

  it('replaces underscores with dashes', () => {
    expect(encodeTranscriptDirName('/tmp/CR_20260228_PROD')).toBe(
      '-tmp-CR-20260228-PROD',
    );
  });

  it('replaces dots with dashes', () => {
    expect(encodeTranscriptDirName('/Users/x/my.project/v1.2')).toBe(
      '-Users-x-my-project-v1-2',
    );
  });

  it('preserves the case of alphanumeric characters', () => {
    expect(encodeTranscriptDirName('/Users/x/lab/Trish')).toBe(
      '-Users-x-lab-Trish',
    );
  });

  it('encodes a path containing spaces and other punctuation', () => {
    expect(encodeTranscriptDirName('/Users/x/My Repo (work)!')).toBe(
      '-Users-x-My-Repo--work--',
    );
  });

  it('encodes the filesystem root to a single dash', () => {
    expect(encodeTranscriptDirName('/')).toBe('-');
  });
});

describe('discoverSessions', () => {
  /** Scratch root, cleaned up after each test. */
  let scratch: string;
  /** The transcripts dir (`~/.claude/projects` analogue) inside `scratch`. */
  let transcriptsDir: string;
  /**
   * The canonical form of `transcriptsDir`. `discoverSessions` resolves the
   * transcripts root via `realpathSync` and builds `transcriptPath` from it,
   * so expected paths must be rooted here too (on macOS `mkdtemp` lands under
   * `/var/folders/...`, a symlink to `/private/var/folders/...`).
   */
  let resolvedTranscriptsDir: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'discovery-'));
    transcriptsDir = join(scratch, 'projects');
    mkdirSync(transcriptsDir, { recursive: true });
    resolvedTranscriptsDir = realpathSync(transcriptsDir);
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /**
   * Create `<transcriptsDir>/<encoded(absPath)>/` and return its canonical
   * path — the form `discoverSessions` builds `transcriptPath` values from.
   */
  function makeProjectDir(absPath: string): string {
    const dir = join(transcriptsDir, encodeTranscriptDirName(absPath));
    mkdirSync(dir, { recursive: true });
    return join(resolvedTranscriptsDir, encodeTranscriptDirName(absPath));
  }

  it('returns one SessionRef per .jsonl file in a project dir', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'aaa.jsonl'), '');
    writeFileSync(join(dir, 'bbb.jsonl'), '');

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'aaa',
        transcriptPath: join(dir, 'aaa.jsonl'),
      },
      {
        projectName: 'Repo A',
        sessionId: 'bbb',
        transcriptPath: join(dir, 'bbb.jsonl'),
      },
    ]);
  });

  it('returns [] when the transcripts dir does not exist', () => {
    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      join(scratch, 'does-not-exist'),
    );
    expect(refs).toEqual([]);
  });

  it('returns [] when there are no configured projects', () => {
    expect(discoverSessions(configOf(), transcriptsDir)).toEqual([]);
  });

  it('skips a project whose encoded dir is absent', () => {
    // Project B has a dir; project A does not.
    const dirB = makeProjectDir('/Users/x/repo-b');
    writeFileSync(join(dirB, 'sess.jsonl'), '');

    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a'], ['Repo B', '/Users/x/repo-b']),
      transcriptsDir,
    );

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo B',
        sessionId: 'sess',
        transcriptPath: join(dirB, 'sess.jsonl'),
      },
    ]);
  });

  it('skips a project whose encoded path is a symlink (does not follow it)', () => {
    // A real dir with a transcript, plus a symlink at the encoded location.
    const realDir = join(scratch, 'elsewhere');
    mkdirSync(realDir);
    writeFileSync(join(realDir, 'sess.jsonl'), '');

    const linkAt = join(transcriptsDir, encodeTranscriptDirName('/Users/x/repo-a'));
    symlinkSync(realDir, linkAt);

    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
    );
    expect(refs).toEqual([]);
  });

  it('skips a project whose encoded path is not a directory', () => {
    // A plain file sits where the project dir would be.
    const fileAt = join(transcriptsDir, encodeTranscriptDirName('/Users/x/repo-a'));
    writeFileSync(fileAt, 'not a dir');

    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
    );
    expect(refs).toEqual([]);
  });

  it('skips a project whose realpath escapes the transcripts root', () => {
    // The candidate dir resolves (via realpath) outside `transcriptsDir`.
    // A symlinked PARENT segment produces this: lstat on the candidate sees
    // a directory, but realpath of the candidate lands outside the root.
    const outside = join(scratch, 'outside');
    mkdirSync(outside, { recursive: true });
    const escapedProject = join(outside, 'repo-a');
    mkdirSync(escapedProject);
    writeFileSync(join(escapedProject, 'sess.jsonl'), '');

    const encoded = encodeTranscriptDirName('/Users/x/repo-a');
    // Inject fs hooks: lstat reports a real directory, but realpath of the
    // candidate points outside the resolved root → containment fails.
    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
      {
        readdirSync: () => {
          throw new Error('readdirSync must not be called when containment fails');
        },
        lstatSync: () => ({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        }),
        realpathSync: (p: string) =>
          p === transcriptsDir
            ? transcriptsDir
            : p === join(transcriptsDir, encoded)
              ? escapedProject
              : p,
      },
    );
    expect(refs).toEqual([]);
  });

  it('skips a project whose candidate dir cannot be realpath-resolved', () => {
    // `lstat` reports a real directory, but `realpathSync` of the candidate
    // throws (e.g. a race where the dir is removed between the two calls).
    const encoded = encodeTranscriptDirName('/Users/x/repo-a');
    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
      {
        readdirSync: () => {
          throw new Error('readdirSync must not run after a realpath failure');
        },
        lstatSync: () => ({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        }),
        realpathSync: (p: string) => {
          if (p === transcriptsDir) return resolvedTranscriptsDir;
          if (p === join(resolvedTranscriptsDir, encoded)) {
            throw new Error('ENOENT: candidate dir vanished');
          }
          return p;
        },
      },
    );
    expect(refs).toEqual([]);
  });

  it('skips a project whose contained dir cannot be read', () => {
    // The candidate dir passes lstat + containment, but `readdirSync` throws
    // (e.g. EACCES on a directory the operator cannot list).
    const encoded = encodeTranscriptDirName('/Users/x/repo-a');
    const contained = join(resolvedTranscriptsDir, encoded);
    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
      {
        readdirSync: () => {
          throw new Error('EACCES: permission denied');
        },
        lstatSync: () => ({
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        }),
        realpathSync: (p: string) =>
          p === transcriptsDir ? resolvedTranscriptsDir : contained,
      },
    );
    expect(refs).toEqual([]);
  });

  it('skips a .jsonl entry whose file cannot be lstat-ed', () => {
    // The directory lists a `.jsonl` entry, but `lstatSync` of that file
    // throws (e.g. a race where the file is removed before it is stat-ed).
    const encoded = encodeTranscriptDirName('/Users/x/repo-a');
    const contained = join(resolvedTranscriptsDir, encoded);
    const refs = discoverSessions(
      configOf(['Repo A', '/Users/x/repo-a']),
      transcriptsDir,
      {
        readdirSync: () => ['vanishing.jsonl'],
        lstatSync: (p: string) => {
          if (p === contained) {
            return {
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            };
          }
          throw new Error('ENOENT: transcript file vanished');
        },
        realpathSync: (p: string) =>
          p === transcriptsDir ? resolvedTranscriptsDir : contained,
      },
    );
    expect(refs).toEqual([]);
  });

  it('ignores non-.jsonl files in a project dir', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'real.jsonl'), '');
    writeFileSync(join(dir, 'notes.txt'), '');
    writeFileSync(join(dir, 'data.json'), '');
    mkdirSync(join(dir, 'subdir'));

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'real',
        transcriptPath: join(dir, 'real.jsonl'),
      },
    ]);
  });

  it('skips a .jsonl whose basename fails the allow-list', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'good.jsonl'), '');
    // A basename with a disallowed character (`/` is impossible in a single
    // filename, but `@` is a realistic disallowed char).
    writeFileSync(join(dir, 'bad@name.jsonl'), '');

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'good',
        transcriptPath: join(dir, 'good.jsonl'),
      },
    ]);
  });

  it('skips a .jsonl whose basename contains a `..` sequence', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'ok.jsonl'), '');
    // `..session` matches the char allow-list but carries a `..` run.
    writeFileSync(join(dir, '..session.jsonl'), '');

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'ok',
        transcriptPath: join(dir, 'ok.jsonl'),
      },
    ]);
  });

  it('skips a .jsonl that is a symlink', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'real.jsonl'), '');
    const target = join(scratch, 'target.jsonl');
    writeFileSync(target, '');
    symlinkSync(target, join(dir, 'linked.jsonl'));

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'real',
        transcriptPath: join(dir, 'real.jsonl'),
      },
    ]);
  });

  it('skips a .jsonl entry that is not a regular file (e.g. a directory)', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    writeFileSync(join(dir, 'real.jsonl'), '');
    // A directory whose name ends in `.jsonl`.
    mkdirSync(join(dir, 'weird.jsonl'));

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId: 'real',
        transcriptPath: join(dir, 'real.jsonl'),
      },
    ]);
  });

  it('sorts results deterministically by projectName then sessionId', () => {
    const pathB = '/Users/x/repo-b';
    const pathA = '/Users/x/repo-a';
    const dirB = makeProjectDir(pathB);
    const dirA = makeProjectDir(pathA);
    writeFileSync(join(dirB, 'zzz.jsonl'), '');
    writeFileSync(join(dirA, 'mmm.jsonl'), '');
    writeFileSync(join(dirA, 'aaa.jsonl'), '');

    // Config order is B, A — output must still be sorted A(aaa), A(mmm), B(zzz).
    const refs = discoverSessions(
      configOf(['Beta', pathB], ['Alpha', pathA]),
      transcriptsDir,
    );

    expect(refs.map((r) => `${r.projectName}/${r.sessionId}`)).toEqual([
      'Alpha/aaa',
      'Alpha/mmm',
      'Beta/zzz',
    ]);
  });

  it('accepts a basename matching the full allow-list charset', () => {
    const projPath = '/Users/x/repo-a';
    const dir = makeProjectDir(projPath);
    // Letters, digits, dot, underscore, dash — every allowed class, no `..`.
    const sessionId = 'Sess_01-9.alpha';
    writeFileSync(join(dir, `${sessionId}.jsonl`), '');

    const refs = discoverSessions(configOf(['Repo A', projPath]), transcriptsDir);

    expect(refs).toEqual<SessionRef[]>([
      {
        projectName: 'Repo A',
        sessionId,
        transcriptPath: join(dir, `${sessionId}.jsonl`),
      },
    ]);
  });
});

describe('@metaswarm-dashboard/sessions public surface', () => {
  it('exports exactly the v5-4 public value set', () => {
    // After WU v4-4 the barrel re-exports the v3-built modules plus the
    // discovery module; WU v4-5 added the rating-store read helpers
    // (`ratingPath`, `readSessionRating`); WU v4-6 added the write helper
    // `writeSessionRating`; WU v5-1 added the cost-foundation surface
    // (`costFor`, `CANONICAL_MODEL_ALIASES`, `loadPricingTable`,
    // `pricingTableHash`, `resolveProjectForCwd`); WU v5-2 added the Claude
    // usage carrier `parseTranscriptUsage` and `computeSessionCost`; WU v5-3
    // added the Codex rollout reader (`discoverCodexRuns`, `readCodexRollout`);
    // WU v5-4 adds the Gemini ledger reader (`discoverGeminiRuns`).
    // (`assertRatingPathWithinRoot` is a `rating-store` internal —
    // unit-tested directly, NOT re-exported from the barrel.)
    const valueExports = Object.keys(sessions).sort();
    expect(valueExports).toEqual([
      'CANONICAL_MODEL_ALIASES',
      'computeSessionCost',
      'costFor',
      'discoverCodexRuns',
      'discoverGeminiRuns',
      'discoverSessions',
      'encodeTranscriptDirName',
      'loadPricingTable',
      'parseTranscript',
      'parseTranscriptUsage',
      'pricingTableHash',
      'ratingPath',
      'readCodexRollout',
      'readSessionRating',
      'resolveProjectForCwd',
      'scoreTimeline',
      'writeSessionRating',
    ]);
  });

  it('exposes callable functions for each public export', () => {
    expect(typeof sessions.parseTranscript).toBe('function');
    expect(typeof sessions.scoreTimeline).toBe('function');
    expect(typeof sessions.discoverSessions).toBe('function');
    expect(typeof sessions.encodeTranscriptDirName).toBe('function');
    expect(typeof sessions.ratingPath).toBe('function');
    expect(typeof sessions.readSessionRating).toBe('function');
    expect(typeof sessions.writeSessionRating).toBe('function');
    expect(typeof sessions.costFor).toBe('function');
    expect(typeof sessions.loadPricingTable).toBe('function');
    expect(typeof sessions.pricingTableHash).toBe('function');
    expect(typeof sessions.resolveProjectForCwd).toBe('function');
    expect(typeof sessions.parseTranscriptUsage).toBe('function');
    expect(typeof sessions.computeSessionCost).toBe('function');
  });
});
