// WU-3.13 — zero-footprint guarantee: collecting must not modify the host
// repo's `.beads/` (or anything else) byte-for-byte.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BeadsExecutor } from '../beads-reader.js';
import { runCollect } from '../cli/collect.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/host-repos');

const noopExec: BeadsExecutor = async () => Promise.resolve({ stdout: '' });

function snapshotDir(root: string): Map<string, string> {
  const out = new Map<string, string>();
  function walk(p: string): void {
    const stat = statSync(p);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else {
      const rel = relative(root, p);
      const hash = createHash('sha256').update(readFileSync(p)).digest('hex');
      out.set(rel, hash);
    }
  }
  walk(root);
  return out;
}

let TMP_HOME: string;
let DATA_DIR: string;
let CONFIG_PATH: string;

beforeEach(() => {
  TMP_HOME = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-zf-'));
  DATA_DIR = join(TMP_HOME, 'data');
  CONFIG_PATH = join(TMP_HOME, 'config.yaml');
});
afterEach(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

function env(): PathsEnv {
  return {
    platform: 'linux',
    homeDir: TMP_HOME,
    env: { METASWARM_DASHBOARD_DATA_DIR: DATA_DIR, METASWARM_DASHBOARD_CONFIG: CONFIG_PATH },
  };
}

const FIXTURE_NAMES = ['mixed-tasks', 'malformed-jsonl', 'empty-project'] as const;

describe('zero-footprint guarantee', () => {
  it('collect --all does not modify any fixture host repo (sha256 stable)', async () => {
    writeFileSync(
      CONFIG_PATH,
      FIXTURE_NAMES.map((n) => `  - name: ${n}\n    path: ${join(FIXTURES, n)}\n`).join('').replace(/^/, 'projects:\n'),
      'utf8',
    );

    const before = new Map<string, Map<string, string>>();
    for (const name of FIXTURE_NAMES) {
      const root = join(FIXTURES, name);
      if (existsSync(root)) before.set(name, snapshotDir(root));
    }

    await runCollect({
      all: true,
      now: new Date('2026-05-06T12:00:00Z'),
      env: env(),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    for (const name of FIXTURE_NAMES) {
      const root = join(FIXTURES, name);
      if (!existsSync(root)) continue;
      const after = snapshotDir(root);
      const beforeMap = before.get(name)!;
      expect([...after.entries()].sort()).toEqual([...beforeMap.entries()].sort());
    }
  });

  it('collect --project mixed does not modify the mixed-tasks fixture (sha256 stable)', async () => {
    writeFileSync(
      CONFIG_PATH,
      `projects:\n  - name: mixed\n    path: ${join(FIXTURES, 'mixed-tasks')}\n`,
      'utf8',
    );
    const root = join(FIXTURES, 'mixed-tasks');
    const before = snapshotDir(root);

    await runCollect({
      project: 'mixed',
      now: new Date('2026-05-06T12:00:00Z'),
      env: env(),
      execute: noopExec,
      stdout: () => undefined,
      stderr: () => undefined,
    });

    const after = snapshotDir(root);
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });
});
