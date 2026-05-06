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
});
