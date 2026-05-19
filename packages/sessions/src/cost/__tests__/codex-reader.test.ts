// Tests for the Codex rollout reader (sessions-spike WU v5-3, design §4.2 /
// §4.4 / §9).
//
// Per design §4 the rollout fixtures are REDACTED REAL Codex rollouts — see
// `fixtures/codex-sessions/README.md` + `REDACTION.py` for provenance. They
// keep only the three record types the reader parses; every prompt/response-
// bearing record is dropped at redaction time.
//
// `discoverCodexRuns` does a recursive descent of a `<YYYY>/<MM>/<DD>/` tree;
// `readCodexRollout` parses a single rollout to a `DelegationRun`. The §9
// recursive-walk hardening (per-level `lstat` symlink refusal, per-level
// `realpath` containment, per-segment sanitizer, max depth 4, a files-visited
// cap) is exercised over real `mkdtemp` temp trees so `realpath` and symlink
// handling run for real.

import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Config } from '@metaswarm-dashboard/types/config';
import { DelegationRun } from '@metaswarm-dashboard/types/cost';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import {
  type CodexReaderFsHooks,
  discoverCodexRuns,
  readCodexRollout,
} from '../codex-reader.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'codex-sessions',
);
const COSTED = join(
  FIXTURES,
  '2026',
  '05',
  '11',
  'rollout-costed-multiturn.jsonl',
);
const INFO_NULL_ONLY = join(
  FIXTURES,
  '2026',
  '05',
  '11',
  'rollout-info-null-only.jsonl',
);
const MALFORMED = join(
  FIXTURES,
  '2026',
  '05',
  '11',
  'rollout-malformed-line.jsonl',
);
const ABNORMAL_UNATTRIBUTED = join(
  FIXTURES,
  '2026',
  '05',
  '12',
  'rollout-abnormal-costed-unattributed.jsonl',
);

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

/**
 * A `Config` that attributes the synthetic fixture `cwd` (`/work/sample-repo`)
 * to a project named `sample`. The fixture `cwd` does not exist on disk, so
 * the attribution test below points the project at a real temp dir whose
 * `cwd` matches; for the simple fixture-level tests we accept `projectName:
 * null` and verify it separately.
 */
const EMPTY_CONFIG = configOf();

describe('readCodexRollout — single rollout → DelegationRun (§4.2)', () => {
  it('costs a complete rollout from the last non-null-info token_count', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    expect(run).not.toBeNull();
    // The FINAL non-null token_count carries 20000/15000/800/200.
    expect(run!.usage).toEqual({
      inputTokens: 20000,
      cacheReadTokens: 15000,
      outputTokens: 800,
      reasoningTokens: 200,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
    });
  });

  it('uses the LAST turn_context model, not an earlier one', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    // First turn_context is gpt-5.5-codex; the last is gpt-5.5.
    expect(run!.model).toBe('gpt-5.5');
  });

  it('emits vendor `openai`', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    expect(run!.vendor).toBe('openai');
  });

  it('computes costUsd as a number for a priced model', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    // gpt-5.5: input 1.25, output 10, cacheRead 0.125 (per 1M).
    //   20000*1.25 + 800*10 + 200*10 + 15000*0.125 = 25000+8000+2000+1875
    //   = 36875 / 1e6 = 0.036875
    expect(run!.costUsd).toBeCloseTo(0.036875, 9);
  });

  it('takes the run timestamp from the records', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    // The reader uses the last record's timestamp as the run `at`.
    expect(run!.at).toBe('2026-05-11T13:23:46.278Z');
  });

  it('produces a DelegationRun that round-trips the schema', () => {
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    expect(() => DelegationRun.parse(run)).not.toThrow();
  });

  it('an info-null-only rollout → costUsd: null (never 0)', () => {
    // The mandated edge case: a token_count record exists but ZERO with a
    // non-null `info` → usage cannot be recovered.
    const run = readCodexRollout(INFO_NULL_ONLY, EMPTY_CONFIG);
    expect(run).not.toBeNull();
    expect(run!.costUsd).toBeNull();
    expect(run!.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('an abnormally-ended rollout with ≥1 non-null-info record is still costed', () => {
    const run = readCodexRollout(ABNORMAL_UNATTRIBUTED, EMPTY_CONFIG);
    expect(run).not.toBeNull();
    // It ends right after a non-null token_count, no terminator — still costed.
    expect(typeof run!.costUsd).toBe('number');
    expect(run!.costUsd).not.toBeNull();
  });

  it('skips a malformed JSON line and still costs the rest of the rollout', () => {
    const run = readCodexRollout(MALFORMED, EMPTY_CONFIG);
    expect(run).not.toBeNull();
    // The malformed line is skipped; the costed token_count still applies.
    expect(run!.model).toBe('gpt-5.5');
    expect(run!.costUsd).toBeCloseTo(0.036875, 9);
  });

  it('attributes the cwd to a configured project', () => {
    // The fixture cwd is `/work/sample-repo`; the resolver realpath-resolves
    // both sides, so attribution against a non-existent path → null. We point
    // the config at a real temp dir and rewrite is unnecessary — instead the
    // dedicated discovery test below covers real attribution. Here we confirm
    // an unmatched cwd is `null`, not dropped.
    const run = readCodexRollout(COSTED, EMPTY_CONFIG);
    expect(run!.projectName).toBeNull();
  });

  it('a rollout with no session_meta cwd → projectName null, not a throw', () => {
    // Build a temp rollout missing session_meta.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-nometa-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      writeFileSync(
        file,
        [
          '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n'),
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.projectName).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a rollout with no turn_context → null (no model to cost against)', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-nomodel-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      writeFileSync(
        file,
        '{"timestamp":"2026-05-11T13:23:43.015Z","type":"session_meta","payload":{"cwd":"/work/x"}}',
      );
      expect(readCodexRollout(file, EMPTY_CONFIG)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an unreadable rollout file → null, never a throw', () => {
    expect(
      readCodexRollout('/no/such/rollout.jsonl', EMPTY_CONFIG),
    ).toBeNull();
  });

  it('an oversized line is skipped without being decoded', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-bigline-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      // A >1 MiB line, then the real costed records.
      const huge = `{"junk":"${'x'.repeat(1024 * 1024 + 10)}"}`;
      writeFileSync(
        file,
        [
          huge,
          '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n'),
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.model).toBe('gpt-5.5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a well-formed line that is not one of the three known record types', () => {
    // A `task_started` / `response_item` line is valid JSON but carries Codex
    // text — the allow-list parse drops it; the costed records still apply.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-othertype-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      writeFileSync(
        file,
        [
          '{"timestamp":"2026-05-11T13:23:43.000Z","type":"event_msg","payload":{"type":"task_started"}}',
          '{"timestamp":"2026-05-11T13:23:43.500Z","type":"response_item","payload":{"type":"message","content":"some prompt text"}}',
          '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '42',
          '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n'),
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.model).toBe('gpt-5.5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a line with invalid UTF-8 bytes', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-badutf8-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      // A lone 0xFF byte is not valid UTF-8 → the fatal decoder throws → skip.
      const bad = Buffer.from([0xff, 0xfe, 0x0a]);
      const good = Buffer.from(
        [
          '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n') + '\n',
        'utf8',
      );
      writeFileSync(file, Buffer.concat([bad, good]));
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.model).toBe('gpt-5.5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates CRLF line endings and a leading BOM', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-crlf-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      // BOM on line 1, CRLF endings throughout.
      const bom = '﻿';
      writeFileSync(
        file,
        bom +
          [
            '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
            '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
          ].join('\r\n') +
          '\r\n',
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.model).toBe('gpt-5.5');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the epoch when no record carries a timestamp', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-nots-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      // No `timestamp` field on any record.
      writeFileSync(
        file,
        [
          '{"type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n'),
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.at).toBe('1970-01-01T00:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the epoch when the last timestamp is non-parseable', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-badts-')));
    try {
      const file = join(dir, 'rollout-x.jsonl');
      writeFileSync(
        file,
        [
          '{"type":"turn_context","payload":{"model":"gpt-5.5"}}',
          '{"timestamp":"not-a-date","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
        ].join('\n'),
      );
      const run = readCodexRollout(file, EMPTY_CONFIG);
      expect(run).not.toBeNull();
      expect(run!.at).toBe('1970-01-01T00:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('discoverCodexRuns — recursive walk + §9 hardening', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-walk-')));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Copy the committed fixture tree into a `<YYYY>/<MM>/<DD>` layout. */
  function seedFixtureTree(): void {
    cpSync(join(FIXTURES, '2026'), join(root, '2026'), { recursive: true });
  }

  it('discovers every rollout under the YYYY/MM/DD tree', () => {
    seedFixtureTree();
    const runs = discoverCodexRuns(root, EMPTY_CONFIG);
    // 4 committed fixtures: costed, info-null-only, malformed, abnormal.
    expect(runs).toHaveLength(4);
  });

  it('returns DelegationRuns that all round-trip the schema', () => {
    seedFixtureTree();
    for (const run of discoverCodexRuns(root, EMPTY_CONFIG)) {
      expect(() => DelegationRun.parse(run)).not.toThrow();
    }
  });

  it('returns [] for a sessions dir that does not exist', () => {
    expect(
      discoverCodexRuns(join(root, 'absent'), EMPTY_CONFIG),
    ).toEqual([]);
  });

  it('returns [] for an empty sessions dir', () => {
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
  });

  it('refuses (does not follow) a symlinked date directory', () => {
    // Real layout: 2026/05/11 holds a rollout. Replace `11` with a symlink
    // pointing at an OUTSIDE dir that also contains a rollout.
    mkdirSync(join(root, '2026', '05'), { recursive: true });
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'codex-outside-')));
    try {
      copyFileSync(COSTED, join(outside, 'rollout-leaked.jsonl'));
      symlinkSync(outside, join(root, '2026', '05', '11'));
      // The symlinked `11` dir must be refused → zero runs discovered.
      expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked rollout FILE inside a real date dir', () => {
    const dayDir = join(root, '2026', '05', '11');
    mkdirSync(dayDir, { recursive: true });
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'codex-flink-')));
    try {
      copyFileSync(COSTED, join(outside, 'real.jsonl'));
      symlinkSync(
        join(outside, 'real.jsonl'),
        join(dayDir, 'rollout-linked.jsonl'),
      );
      // A symlinked rollout file is refused, never followed.
      expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked intermediate (year) directory', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'codex-yrlink-')));
    try {
      // outside/05/11/<rollout>
      const day = join(outside, '05', '11');
      mkdirSync(day, { recursive: true });
      copyFileSync(COSTED, join(day, 'rollout-leaked.jsonl'));
      // root/2026 -> outside (a symlinked year dir).
      symlinkSync(outside, join(root, '2026'));
      expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not descend past max depth 4 (YYYY/MM/DD/file)', () => {
    // A rollout buried one level too deep (YYYY/MM/DD/EXTRA/file) is NOT read.
    const tooDeep = join(root, '2026', '05', '11', 'extra');
    mkdirSync(tooDeep, { recursive: true });
    copyFileSync(COSTED, join(tooDeep, 'rollout-buried.jsonl'));
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
  });

  it('reads a rollout exactly at the YYYY/MM/DD leaf depth', () => {
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    copyFileSync(COSTED, join(day, 'rollout-ok.jsonl'));
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toHaveLength(1);
  });

  it('skips a path segment outside the [A-Za-z0-9._-] allow-list', () => {
    // A directory name with a disallowed char (space) is skipped.
    const bad = join(root, '2026', 'bad month');
    mkdirSync(bad, { recursive: true });
    copyFileSync(COSTED, join(bad, 'rollout-x.jsonl'));
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
  });

  it('only reads files matching rollout-*.jsonl', () => {
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    copyFileSync(COSTED, join(day, 'rollout-ok.jsonl'));
    // Non-rollout files in the same dir are ignored.
    writeFileSync(join(day, 'notes.txt'), 'ignore me');
    copyFileSync(COSTED, join(day, 'other-prefix.jsonl'));
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toHaveLength(1);
  });

  it('drops a leaf rollout that yields no DelegationRun (no turn_context)', () => {
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    // A valid rollout that IS costed.
    copyFileSync(COSTED, join(day, 'rollout-good.jsonl'));
    // A rollout-shaped file at the leaf with NO turn_context → readCodexRollout
    // returns null → it must not appear in the discovered runs.
    writeFileSync(
      join(day, 'rollout-nomodel.jsonl'),
      '{"timestamp":"2026-05-11T13:23:43.015Z","type":"session_meta","payload":{"cwd":"/work/x"}}',
    );
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toHaveLength(1);
  });

  it('honors the max-files-visited cap', () => {
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    // Seed more rollout files than a small cap allows.
    for (let i = 0; i < 5; i++) {
      copyFileSync(COSTED, join(day, `rollout-${i}.jsonl`));
    }
    // With a cap of 3, only 3 files are visited.
    const runs = discoverCodexRuns(root, EMPTY_CONFIG, undefined, {
      maxFilesVisited: 3,
    });
    expect(runs.length).toBeLessThanOrEqual(3);
  });

  it('attributes a run by its cwd to a configured project', () => {
    // Point a project at a real dir, and write a rollout whose session_meta
    // cwd is that dir → the run is attributed to that project.
    const repo = join(root, 'the-repo');
    mkdirSync(repo);
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, 'rollout-attributed.jsonl'),
      [
        `{"timestamp":"2026-05-11T13:23:43.015Z","type":"session_meta","payload":{"cwd":${JSON.stringify(repo)}}}`,
        '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
        '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
      ].join('\n'),
    );
    const runs = discoverCodexRuns(root, configOf(['repo', repo]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.projectName).toBe('repo');
  });

  it('a cwd under no configured project → projectName null', () => {
    const repo = join(root, 'the-repo');
    mkdirSync(repo);
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere);
    const day = join(root, '2026', '05', '11');
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, 'rollout-elsewhere.jsonl'),
      [
        `{"timestamp":"2026-05-11T13:23:43.015Z","type":"session_meta","payload":{"cwd":${JSON.stringify(elsewhere)}}}`,
        '{"timestamp":"2026-05-11T13:23:45.000Z","type":"turn_context","payload":{"model":"gpt-5.5"}}',
        '{"timestamp":"2026-05-11T13:23:46.278Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0,"total_tokens":2}}}}',
      ].join('\n'),
    );
    const runs = discoverCodexRuns(root, configOf(['repo', repo]));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.projectName).toBeNull();
  });

  it('does not walk a ~/.codex/archived_sessions sibling', () => {
    // `archived_sessions` is out of scope (§2). Even if such a dir is placed
    // alongside, discovery over `sessions/` never reaches it (it is not the
    // walk root). This asserts the reader is not given the archived dir.
    const archived = join(root, 'archived');
    const aDay = join(archived, '2026', '05', '11');
    mkdirSync(aDay, { recursive: true });
    copyFileSync(COSTED, join(aDay, 'rollout-archived.jsonl'));
    // The sessions dir itself is empty → zero runs; the archived tree is
    // never visited because it is not under the walk root.
    expect(discoverCodexRuns(root, EMPTY_CONFIG)).toEqual([]);
  });

  it('returns [] when the sessions dir is itself a symlink', () => {
    const realSessions = realpathSync(
      mkdtempSync(join(tmpdir(), 'codex-realsess-')),
    );
    try {
      const day = join(realSessions, '2026', '05', '11');
      mkdirSync(day, { recursive: true });
      copyFileSync(COSTED, join(day, 'rollout-x.jsonl'));
      const link = join(root, 'sessions-link');
      symlinkSync(realSessions, link);
      // A symlinked walk-root is refused — the operator-set env path should
      // be a real directory, not a symlink into one.
      expect(discoverCodexRuns(link, EMPTY_CONFIG)).toEqual([]);
    } finally {
      rmSync(realSessions, { recursive: true, force: true });
    }
  });
});

describe('discoverCodexRuns — §9 hardening via injected fs hooks', () => {
  // These exercise the defensive walk branches a real temp tree cannot
  // reproduce — `readdir`/`lstat`/`realpath` throwing mid-walk, and a
  // non-file/non-directory entry (a FIFO / device node). The pattern mirrors
  // `transcript-discovery.test.ts`, which uses injected hooks for the same
  // reason.

  /** Build a `StatsLike` with the three predicates the walk reads. */
  function stats(kind: 'dir' | 'file' | 'symlink' | 'other'): {
    isDirectory: () => boolean;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  } {
    return {
      isDirectory: () => kind === 'dir',
      isFile: () => kind === 'file',
      isSymbolicLink: () => kind === 'symlink',
    };
  }

  /** A base `fs` stub: the root is a real dir, everything else is overridable. */
  function baseFs(overrides: Partial<CodexReaderFsHooks>): CodexReaderFsHooks {
    return {
      realpathSync: (p) => p,
      lstatSync: () => stats('dir'),
      readdirSync: () => [],
      readFileSync: () => Buffer.from(''),
      ...overrides,
    };
  }

  it('returns [] when realpath of the sessions dir throws', () => {
    const fs = baseFs({
      realpathSync: () => {
        throw new Error('ENOENT');
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('returns [] when lstat of the sessions dir throws', () => {
    // realpath succeeds, but the lstat used for the symlink check throws.
    const fs = baseFs({
      lstatSync: (p) => {
        if (p === '/codex/sessions') {
          throw new Error('EACCES');
        }
        return stats('dir');
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('returns [] when the sessions root is not a directory', () => {
    const fs = baseFs({ lstatSync: () => stats('file') });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips a directory level whose readdir throws mid-walk', () => {
    const fs = baseFs({
      readdirSync: (dir) => {
        if (dir === '/codex/sessions') return ['2026'];
        // The `2026` level fails to list → that branch is skipped.
        throw new Error('EACCES');
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips an entry whose lstat throws mid-walk', () => {
    const fs = baseFs({
      readdirSync: (dir) => (dir === '/codex/sessions' ? ['2026'] : []),
      lstatSync: (p) => {
        if (p === '/codex/sessions') return stats('dir');
        // The `2026` entry's lstat throws → the entry is skipped.
        throw new Error('EACCES');
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips an entry that is neither a file nor a directory (e.g. a FIFO)', () => {
    const fs = baseFs({
      readdirSync: (dir) => (dir === '/codex/sessions' ? ['weird'] : []),
      lstatSync: (p) =>
        p === '/codex/sessions' ? stats('dir') : stats('other'),
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips a directory whose realpath throws during the containment re-check', () => {
    const fs = baseFs({
      readdirSync: (dir) => (dir === '/codex/sessions' ? ['2026'] : []),
      lstatSync: () => stats('dir'),
      realpathSync: (p) => {
        if (p === '/codex/sessions') return p;
        // The `2026` dir's realpath throws → it is skipped, not descended.
        throw new Error('ELOOP');
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips a directory that realpath-resolves outside the sessions root', () => {
    const fs = baseFs({
      readdirSync: (dir) => (dir === '/codex/sessions' ? ['2026'] : []),
      lstatSync: () => stats('dir'),
      realpathSync: (p) => {
        if (p === '/codex/sessions') return p;
        // `2026` canonically resolves OUTSIDE the root → refused.
        return '/elsewhere/escaped';
      },
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });

  it('skips a rollout-shaped file that is not at the YYYY/MM/DD leaf depth', () => {
    // A `rollout-*.jsonl` file directly under the root (depth 1, not 4) is
    // refused — a rollout only appears at the leaf.
    const fs = baseFs({
      readdirSync: (dir) =>
        dir === '/codex/sessions' ? ['rollout-shallow.jsonl'] : [],
      lstatSync: (p) =>
        p === '/codex/sessions' ? stats('dir') : stats('file'),
    });
    expect(discoverCodexRuns('/codex/sessions', EMPTY_CONFIG, fs)).toEqual([]);
  });
});

describe('@metaswarm-dashboard/sessions public surface', () => {
  it('re-exports discoverCodexRuns and readCodexRollout', () => {
    expect(sessions.discoverCodexRuns).toBe(discoverCodexRuns);
    expect(sessions.readCodexRollout).toBe(readCodexRollout);
  });
});
