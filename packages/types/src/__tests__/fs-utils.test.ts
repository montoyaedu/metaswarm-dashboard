// Coverage for the lifted atomic writer. The source moved from the collector
// to `@metaswarm-dashboard/types/fs-utils` in sessions-spike WU-1, so it needs
// coverage from the types project's own test run. Mirrors the four scenarios
// in packages/collector/src/__tests__/writer.test.ts.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WriterError, atomicWriteJson, type WriterFsHooks } from '../fs-utils.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-fs-utils-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('atomicWriteJson — happy path', () => {
  it('writes json content under a parent dir created on demand', () => {
    const target = join(TMP, 'a', 'b', 'c.json');
    atomicWriteJson(target, '{"hi":1}');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('{"hi":1}');
  });

  it('idempotent: rewriting overwrites without leaving a temp file', () => {
    const target = join(TMP, 'idempotent.json');
    atomicWriteJson(target, 'first');
    atomicWriteJson(target, 'second');
    expect(readFileSync(target, 'utf8')).toBe('second');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});

describe('atomicWriteJson — error paths', () => {
  it('throws WriterError when writeFileSync fails', () => {
    const target = join(TMP, 'wfail.json');
    const fs: WriterFsHooks = {
      mkdirSync: () => undefined,
      writeFileSync: () => {
        throw new Error('disk full');
      },
      renameSync: () => undefined,
      unlinkSync: () => undefined,
    };
    expect(() => atomicWriteJson(target, 'data', fs)).toThrow(WriterError);
  });

  it('throws WriterError + cleans up temp when rename fails', () => {
    const target = join(TMP, 'rfail.json');
    let unlinkCalled = false;
    const fs: WriterFsHooks = {
      mkdirSync: () => undefined,
      writeFileSync: () => undefined,
      renameSync: () => {
        throw new Error('EXDEV cross-device');
      },
      unlinkSync: () => {
        unlinkCalled = true;
      },
    };
    expect(() => atomicWriteJson(target, 'data', fs)).toThrow(WriterError);
    expect(unlinkCalled).toBe(true);
  });

  it('still throws WriterError if temp cleanup itself fails', () => {
    const target = join(TMP, 'cleanup-fail.json');
    const fs: WriterFsHooks = {
      mkdirSync: () => undefined,
      writeFileSync: () => undefined,
      renameSync: () => {
        throw new Error('EXDEV');
      },
      unlinkSync: () => {
        throw new Error('cleanup-also-fails');
      },
    };
    expect(() => atomicWriteJson(target, 'data', fs)).toThrow(WriterError);
  });
});
