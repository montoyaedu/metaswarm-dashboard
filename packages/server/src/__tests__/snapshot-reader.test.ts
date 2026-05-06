// WU-4.{1,2,6} — snapshot-reader: list / latest / readDaily, skip on bad JSON.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SnapshotReader } from '../data/snapshot-reader.js';

const FIXTURE_DATA_DIR = resolve(import.meta.dirname, 'fixtures/data-dir');

describe('SnapshotReader — fixture data', () => {
  it('lists projects with ≥1 daily snapshot', () => {
    const r = new SnapshotReader(FIXTURE_DATA_DIR, undefined, () => undefined);
    expect(r.listProjects()).toEqual(['alpha', 'beta']);
  });

  it('latestDaily returns the lex-greatest YYYY-MM-DD snapshot', () => {
    const r = new SnapshotReader(FIXTURE_DATA_DIR, undefined, () => undefined);
    const latest = r.latestDaily('alpha');
    expect(latest).not.toBeNull();
    expect(latest?.dayKey).toBe('2026-05-06');
  });

  it('latestDaily returns null when no snapshots exist', () => {
    const r = new SnapshotReader(FIXTURE_DATA_DIR, undefined, () => undefined);
    expect(r.latestDaily('does-not-exist')).toBeNull();
  });

  it('recentDaily returns up to N most-recent snapshots, newest first', () => {
    const r = new SnapshotReader(FIXTURE_DATA_DIR, undefined, () => undefined);
    const recent = r.recentDaily('alpha', 3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.dayKey).toBe('2026-05-06');
    expect(recent[1]?.dayKey).toBe('2026-05-05');
    expect(recent[2]?.dayKey).toBe('2026-05-04');
  });

  it('recentDaily caps to fewer entries when project has < N snapshots', () => {
    const r = new SnapshotReader(FIXTURE_DATA_DIR, undefined, () => undefined);
    const recent = r.recentDaily('beta', 14);
    expect(recent).toHaveLength(3);
  });
});

describe('SnapshotReader — error paths', () => {
  let TMP: string;
  beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'snapshot-reader-'));
  });
  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('lists nothing when projects/ dir does not exist', () => {
    const logs: string[] = [];
    const r = new SnapshotReader(TMP, undefined, (m) => logs.push(m));
    expect(r.listProjects()).toEqual([]);
  });

  it('skips a corrupt snapshot file with a log line, returns null', () => {
    const dailyDir = join(TMP, 'projects/foo/daily');
    mkdirSync(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, '2026-05-06.json'), '{ not json', 'utf8');
    const logs: string[] = [];
    const r = new SnapshotReader(TMP, undefined, (m) => logs.push(m));
    expect(r.readDaily('foo', '2026-05-06')).toBeNull();
    expect(logs.some((l) => l.includes('invalid JSON'))).toBe(true);
  });

  it('skips a snapshot whose shape does not match DailySnapshot', () => {
    const dailyDir = join(TMP, 'projects/foo/daily');
    mkdirSync(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, '2026-05-06.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8');
    const logs: string[] = [];
    const r = new SnapshotReader(TMP, undefined, (m) => logs.push(m));
    expect(r.readDaily('foo', '2026-05-06')).toBeNull();
    expect(logs.some((l) => l.includes('schema mismatch'))).toBe(true);
  });

  it('returns null for a missing dayKey', () => {
    const r = new SnapshotReader(TMP, undefined, () => undefined);
    expect(r.readDaily('whatever', '2026-05-06')).toBeNull();
  });
});
