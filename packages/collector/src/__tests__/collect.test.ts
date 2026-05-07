// WU-3.{1,2,3,4,5,17} — collect orchestration + Monday-only weekly write.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BeadsExecutor } from '../beads-reader.js';
import { runCollect } from '../cli/collect.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/host-repos');

let TMP_HOME: string;
let DATA_DIR: string;
let CONFIG_PATH: string;

const noopExec: BeadsExecutor = async () => Promise.resolve({ stdout: '' });

function envFor(home: string): PathsEnv {
  return { platform: 'linux', homeDir: home, env: { METASWARM_DASHBOARD_DATA_DIR: DATA_DIR, METASWARM_DASHBOARD_CONFIG: CONFIG_PATH } };
}

beforeEach(() => {
  TMP_HOME = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-collect-'));
  DATA_DIR = join(TMP_HOME, 'data');
  CONFIG_PATH = join(TMP_HOME, 'config.yaml');
  // Write a config that points at the mixed-tasks fixture.
  mkdirSync(TMP_HOME, { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    `projects:\n  - name: mixed\n    path: ${join(FIXTURES, 'mixed-tasks')}\n  - name: empty\n    path: ${join(FIXTURES, 'empty-project')}\n`,
    'utf8',
  );
});

afterEach(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

describe('runCollect — happy path', () => {
  it('--all collects every project and writes daily snapshots', async () => {
    const result = await runCollect({
      all: true,
      now: new Date('2026-05-06T12:00:00Z'), // Wednesday
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(result.projectsProcessed).toContain('mixed');
    expect(result.projectsSkipped.map((p) => p.name)).toContain('empty');

    const dailyPath = join(DATA_DIR, 'projects/mixed/daily/2026-05-06.json');
    expect(existsSync(dailyPath)).toBe(true);
    const json = JSON.parse(readFileSync(dailyPath, 'utf8'));
    expect(json.projectName).toBe('mixed');
    expect(json.dayKey).toBe('2026-05-06');
    expect(json.prsMergedLast7d).toBeNull();
    expect(json.agents.length).toBeGreaterThan(0);
  });

  it('--project <name> targets a single project', async () => {
    const result = await runCollect({
      project: 'mixed',
      now: new Date('2026-05-06T12:00:00Z'),
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(result.projectsProcessed).toEqual(['mixed']);
  });

  it('Monday-UTC run also writes a weekly snapshot for the prior week', async () => {
    // 2026-05-04 is a Monday UTC.
    const result = await runCollect({
      all: true,
      now: new Date('2026-05-04T12:00:00Z'),
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    const weeklyPath = join(DATA_DIR, 'projects/mixed/weekly/2026-W18.json');
    expect(existsSync(weeklyPath)).toBe(true);
    const json = JSON.parse(readFileSync(weeklyPath, 'utf8'));
    expect(json.isoWeek).toBe('2026-W18');
    // No prior-week daily snapshots existed → complete: false (per DoD #10).
    // The dedicated "complete: true" case is in a separate test that
    // pre-populates a daily file in the prior week.
    expect(json.complete).toBe(false);
    expect(json.prsMergedLast7d).toBeNull();
  });

  it('non-Monday run does NOT write a weekly file', async () => {
    await runCollect({
      all: true,
      now: new Date('2026-05-06T12:00:00Z'), // Wed
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(existsSync(join(DATA_DIR, 'projects/mixed/weekly'))).toBe(false);
  });

  it('Tuesday run does NOT write a weekly file (DoD #4 strict)', async () => {
    await runCollect({
      all: true,
      now: new Date('2026-05-05T12:00:00Z'), // Tue
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(existsSync(join(DATA_DIR, 'projects/mixed/weekly'))).toBe(false);
  });

  it('Sunday run does NOT write a weekly file (DoD #4 strict)', async () => {
    await runCollect({
      all: true,
      now: new Date('2026-05-10T12:00:00Z'), // Sun
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(existsSync(join(DATA_DIR, 'projects/mixed/weekly'))).toBe(false);
  });

  it('weekly fallback: Monday run with no prior-week daily snapshots → complete: false (DoD #10)', async () => {
    // First call: collect on a Monday with no preceding daily snapshots in
    // the prior week. The data dir is empty before the call, so the prior
    // week (week 18 = 2026-04-27..2026-05-03) has zero daily files.
    const result = await runCollect({
      all: true,
      now: new Date('2026-05-04T12:00:00Z'), // Mon
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    const weeklyPath = join(DATA_DIR, 'projects/mixed/weekly/2026-W18.json');
    expect(existsSync(weeklyPath)).toBe(true);
    const json = JSON.parse(readFileSync(weeklyPath, 'utf8'));
    expect(json.complete).toBe(false);
  });

  it('weekly: Monday run WITH prior-week daily snapshots → complete: true', async () => {
    // Pre-populate a daily snapshot from the prior ISO week (2026-W18).
    // 2026-04-27 (Mon) lives in W18.
    const dailyDir = join(DATA_DIR, 'projects/mixed/daily');
    mkdirSync(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, '2026-04-27.json'), '{}', 'utf8');

    const result = await runCollect({
      all: true,
      now: new Date('2026-05-04T12:00:00Z'), // Mon
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    const weeklyPath = join(DATA_DIR, 'projects/mixed/weekly/2026-W18.json');
    const json = JSON.parse(readFileSync(weeklyPath, 'utf8'));
    expect(json.complete).toBe(true);
  });

  it('re-running same UTC day overwrites idempotently (no duplicates)', async () => {
    const stamp = new Date('2026-05-06T12:00:00Z');
    await runCollect({ all: true, now: stamp, env: envFor(TMP_HOME), execute: noopExec, stdout: () => undefined, stderr: () => undefined });
    const dailyPath = join(DATA_DIR, 'projects/mixed/daily/2026-05-06.json');
    const first = readFileSync(dailyPath, 'utf8');
    await runCollect({ all: true, now: stamp, env: envFor(TMP_HOME), execute: noopExec, stdout: () => undefined, stderr: () => undefined });
    const second = readFileSync(dailyPath, 'utf8');
    expect(second).toBe(first);
  });
});

describe('runCollect — exits non-zero on bad config + unknown project', () => {
  it('returns exit 1 when config file is missing', async () => {
    rmSync(CONFIG_PATH);
    const result = await runCollect({
      all: true,
      now: new Date('2026-05-06T12:00:00Z'),
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns exit 1 when --project names something not in config.yaml', async () => {
    const result = await runCollect({
      project: 'nope',
      now: new Date('2026-05-06T12:00:00Z'),
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns exit 1 when neither --project nor --all is given', async () => {
    const result = await runCollect({
      now: new Date('2026-05-06T12:00:00Z'),
      env: envFor(TMP_HOME),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(1);
  });
});
