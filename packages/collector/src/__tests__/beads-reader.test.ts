// WU-3.{5,6,7,14} — beads-reader: empty/missing/malformed handled cleanly,
// `bd` invoked safely with timeout, ENOENT surfaces actionable error.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type BeadsExecutor, readHostBeads } from '../beads-reader.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/host-repos');

const noopExec: BeadsExecutor = async () => Promise.resolve({ stdout: '' });

describe('readHostBeads', () => {
  it('skips a project whose path does not exist', async () => {
    const out = await readHostBeads(join(FIXTURES, 'does-not-exist'), {
      execute: noopExec,
      fs: { existsSync, readFileSync },
    });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toContain('does not exist');
    expect(out.rows).toEqual([]);
  });

  it('skips a project that has no .beads/ directory', async () => {
    const out = await readHostBeads(join(FIXTURES, 'empty-project'), {
      execute: noopExec,
      fs: { existsSync, readFileSync },
    });
    expect(out.skipped).toBe(true);
    expect(out.skipReason).toContain('no .beads/');
  });

  it('parses .beads/issues.jsonl rows', async () => {
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: noopExec,
      fs: { existsSync, readFileSync },
    });
    expect(out.skipped).toBe(false);
    expect(out.rows.length).toBeGreaterThan(0);
    expect(out.rows.some((r) => r.id === 'task-4')).toBe(true);
  });

  it('skips malformed JSONL rows with a warning, never crashes', async () => {
    const out = await readHostBeads(join(FIXTURES, 'malformed-jsonl'), {
      execute: noopExec,
      fs: { existsSync, readFileSync },
    });
    expect(out.skipped).toBe(false);
    // Three valid rows: task-1 (open), task-2 (closed), task-3 (closed)
    expect(out.rows.length).toBe(3);
    expect(out.warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
    expect(out.warnings.some((w) => w.includes('missing id or status'))).toBe(true);
  });

  it('appends bd list --json rows when the executor returns a JSON array', async () => {
    const exec: BeadsExecutor = async () =>
      Promise.resolve({
        stdout: JSON.stringify([
          { id: 'live-1', status: 'closed', closed_at: '2026-05-05T00:00:00Z' },
        ]),
      });
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.rows.some((r) => r.id === 'live-1')).toBe(true);
  });

  it('warns and continues if bd binary is missing (ENOENT)', async () => {
    const exec: BeadsExecutor = () => {
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      return Promise.reject(err);
    };
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.skipped).toBe(false);
    expect(out.warnings.some((w) => w.includes('not found on PATH'))).toBe(true);
  });

  it('warns when bd stdout is not valid JSON', async () => {
    const exec: BeadsExecutor = async () =>
      Promise.resolve({ stdout: 'not json' });
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
  });

  it('warns when bd stdout is JSON but not an array', async () => {
    const exec: BeadsExecutor = async () =>
      Promise.resolve({ stdout: JSON.stringify({ not: 'an array' }) });
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.warnings.some((w) => w.includes('expected an array'))).toBe(true);
  });

  it('skips bd rows missing id/status with a warning', async () => {
    const exec: BeadsExecutor = async () =>
      Promise.resolve({
        stdout: JSON.stringify([{ no: 'id' }, { id: 'ok', status: 'open' }]),
      });
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.warnings.some((w) => w.includes('malformed row'))).toBe(true);
    expect(out.rows.some((r) => r.id === 'ok')).toBe(true);
  });

  it('warns on generic bd errors (non-ENOENT)', async () => {
    const exec: BeadsExecutor = () => Promise.reject(new Error('boom'));
    const out = await readHostBeads(join(FIXTURES, 'mixed-tasks'), {
      execute: exec,
      fs: { existsSync, readFileSync },
    });
    expect(out.warnings.some((w) => w.includes('bd list --json failed'))).toBe(true);
  });

  it('warns when reading issues.jsonl fails for a non-ENOENT reason', async () => {
    const fakeFs = {
      existsSync: (p: string): boolean => p.endsWith('mixed-tasks') || p.endsWith('.beads') || p.endsWith('issues.jsonl'),
      readFileSync: (p: string, _encoding: string): string => {
        if (p.endsWith('issues.jsonl')) {
          throw new Error('EACCES: permission denied');
        }
        return '';
      },
    };
    const out = await readHostBeads('/synthetic/mixed-tasks', {
      execute: noopExec,
      fs: fakeFs as unknown as { existsSync: typeof existsSync; readFileSync: typeof readFileSync },
    });
    expect(out.warnings.some((w) => w.includes('failed to read'))).toBe(true);
  });
});
