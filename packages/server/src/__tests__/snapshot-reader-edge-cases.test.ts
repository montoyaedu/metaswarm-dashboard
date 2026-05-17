// Coverage gap closure: recentDaily / latestDaily / readDaily error paths.

import {
  type existsSync,
  type readFileSync,
  type readdirSync,
  type statSync,
} from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SnapshotReader } from '../data/snapshot-reader.js';

function fsThatThrows(throwFn: 'readdirSync' | 'readFileSync'): {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
  statSync: typeof statSync;
} {
  return {
    existsSync: () => true,
    readFileSync: () => {
      if (throwFn === 'readFileSync') throw new Error('EACCES');
      return '';
    },
    readdirSync: () => {
      if (throwFn === 'readdirSync') throw new Error('EACCES');
      return [];
    },
    statSync: () => ({}) as never,
  } as unknown as {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
    readdirSync: typeof readdirSync;
    statSync: typeof statSync;
  };
}

describe('SnapshotReader uncovered branches', () => {
  it('listProjects: readdir error on the projects/ root logs and returns []', () => {
    const logs: string[] = [];
    const r = new SnapshotReader('/x', fsThatThrows('readdirSync'), (m) => logs.push(m));
    expect(r.listProjects()).toEqual([]);
    expect(logs.some((l) => l.includes('projects/'))).toBe(true);
  });

  it('latestDaily: readdir error logs and returns null', () => {
    const logs: string[] = [];
    const r = new SnapshotReader('/x', fsThatThrows('readdirSync'), (m) => logs.push(m));
    expect(r.latestDaily('foo')).toBeNull();
    expect(logs.some((l) => l.includes('failed to read'))).toBe(true);
  });

  it('recentDaily: readdir error logs and returns []', () => {
    const logs: string[] = [];
    const r = new SnapshotReader('/x', fsThatThrows('readdirSync'), (m) => logs.push(m));
    expect(r.recentDaily('foo', 10)).toEqual([]);
    expect(logs.some((l) => l.includes('failed to read'))).toBe(true);
  });

  it('recentDaily: returns [] when no daily files match the YYYY-MM-DD regex', () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => '',
      readdirSync: (): string[] => ['nope.txt', 'README.md'],
      statSync: () => ({}) as never,
    };
    const r = new SnapshotReader('/x', fs as never);
    expect(r.recentDaily('foo', 10)).toEqual([]);
  });

  it('readDaily: file-read error (non-ENOENT) logs and returns null', () => {
    const logs: string[] = [];
    const fs = {
      existsSync: () => true,
      readFileSync: (): string => {
        throw new Error('EACCES boom');
      },
      readdirSync: (): string[] => [],
      statSync: () => ({}) as never,
    };
    const r = new SnapshotReader('/x', fs as never, (m) => logs.push(m));
    expect(r.readDaily('foo', '2026-05-06')).toBeNull();
    expect(logs.some((l) => l.includes('failed to read'))).toBe(true);
  });

  it('listProjects: skips a sub-dir whose readdir throws (continue path)', () => {
    let firstCall = true;
    const fs = {
      existsSync: () => true,
      readFileSync: () => '',
      readdirSync: (): string[] => {
        if (firstCall) {
          firstCall = false;
          return ['foo', 'bar'];
        }
        // Subsequent calls (per-project daily/) throw.
        throw new Error('EACCES');
      },
      statSync: () => ({}) as never,
    };
    const r = new SnapshotReader('/x', fs as never);
    expect(r.listProjects()).toEqual([]);
  });

  it('listProjects: skips a project whose daily/ directory does not exist', () => {
    // The project sub-dir exists but has no `daily/` child → `continue`.
    const fs = {
      existsSync: (p: string): boolean => !p.endsWith('daily'),
      readFileSync: () => '',
      readdirSync: (): string[] => ['proj-without-daily'],
      statSync: () => ({}) as never,
    };
    const r = new SnapshotReader('/x', fs as never);
    expect(r.listProjects()).toEqual([]);
  });

  it('listProjects: omits a project whose daily/ has no YYYY-MM-DD files', () => {
    // daily/ exists and reads fine, but nothing matches the date regex →
    // the `.some(DAILY_FILE_RE.test)` guard is false, project is skipped.
    const fs = {
      existsSync: () => true,
      readFileSync: () => '',
      readdirSync: (): string[] => ['proj-a'],
      statSync: () => ({}) as never,
    };
    // First readdir returns the project list, the second returns non-date files.
    let call = 0;
    fs.readdirSync = (): string[] => {
      call += 1;
      return call === 1 ? ['proj-a'] : ['README.md', 'notes.txt'];
    };
    const r = new SnapshotReader('/x', fs as never);
    expect(r.listProjects()).toEqual([]);
  });

  it('latestDaily: returns null when daily/ exists but has no YYYY-MM-DD files', () => {
    // dailyKeys is empty after filtering → the length-0 guard returns null.
    const fs = {
      existsSync: () => true,
      readFileSync: () => '',
      readdirSync: (): string[] => ['README.md', 'index.html'],
      statSync: () => ({}) as never,
    };
    const r = new SnapshotReader('/x', fs as never, () => undefined);
    expect(r.latestDaily('foo')).toBeNull();
  });

  it('recentDaily: drops daily files that fail to parse, keeps the valid ones', () => {
    // Two date-named files exist; the newer one is corrupt JSON (readDaily
    // returns null) so the `snap !== null` guard skips it, the older valid
    // one is kept.
    const valid = JSON.stringify({
      schemaVersion: 1,
      projectName: 'foo',
      projectPath: '/p/foo',
      category: 'metaswarm',
      generatedAt: '2026-05-05T00:00:00.000Z',
      dayKey: '2026-05-05',
      agents: [],
      totals: {
        totalActiveTasks: 0,
        totalBlockedTasks: 0,
        totalCompletedTasksLast7d: 0,
        lastActivityAt: null,
      },
      prsMergedLast7d: null,
      collectionStatus: 'ok',
      collectionWarnings: [],
    });
    const fs = {
      existsSync: () => true,
      readFileSync: (p: string): string =>
        p.endsWith('2026-05-06.json') ? '{ corrupt' : valid,
      readdirSync: (): string[] => ['2026-05-05.json', '2026-05-06.json'],
      statSync: () => ({}) as never,
    };
    const logs: string[] = [];
    const r = new SnapshotReader('/x', fs as never, (m) => logs.push(m));
    const recent = r.recentDaily('foo', 10);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.dayKey).toBe('2026-05-05');
    expect(logs.some((l) => l.includes('invalid JSON'))).toBe(true);
  });
});
