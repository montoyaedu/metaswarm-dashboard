// Tests for the fixture-vendoring guards (sessions-spike WU-1, design §9.1).
//
// The marker-line assertion exercised here is the LOAD-BEARING privacy guard:
// it is what actually stops a real Claude Code transcript from landing in
// __tests__/fixtures/. The .gitignore rule and size cap are defense-in-depth.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FIXTURE_MARKER,
  FIXTURE_SIZE_CAP_BYTES,
  enforceFixtureMarker,
  findMarkerViolations,
  findOversizedFixtures,
  listJsonlFixtures,
} from './fixture-guards.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-fixture-guards-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A good multi-line fixture: marker line + a payload line. */
function writeGoodMultiLine(name: string): string {
  const file = join(TMP, name);
  writeFileSync(file, `${FIXTURE_MARKER}\n{"event":"x"}\n`, 'utf8');
  return file;
}

/** A good single-line fixture: marker only, no trailing newline. */
function writeGoodSingleLine(name: string): string {
  const file = join(TMP, name);
  writeFileSync(file, FIXTURE_MARKER, 'utf8');
  return file;
}

/** A bad fixture: first line is not the marker. */
function writeBadFixture(name: string): string {
  const file = join(TMP, name);
  writeFileSync(file, `{"event":"real-transcript"}\n{"event":"y"}\n`, 'utf8');
  return file;
}

describe('constants', () => {
  it('FIXTURE_MARKER is the exact synthetic-fixture marker line', () => {
    expect(FIXTURE_MARKER).toBe(
      '{"meta":"synthetic-fixture-do-not-replace-with-real-transcript","schemaVersion":1}',
    );
  });

  it('FIXTURE_SIZE_CAP_BYTES is 50 KiB', () => {
    expect(FIXTURE_SIZE_CAP_BYTES).toBe(50 * 1024);
  });
});

describe('listJsonlFixtures', () => {
  it('returns an empty array when the directory is absent', () => {
    expect(listJsonlFixtures(join(TMP, 'does-not-exist'))).toEqual([]);
  });

  it('lists only .jsonl files, sorted', () => {
    writeGoodMultiLine('b.jsonl');
    writeGoodMultiLine('a.jsonl');
    writeFileSync(join(TMP, 'note.txt'), 'ignore me', 'utf8');
    const found = listJsonlFixtures(TMP);
    expect(found).toEqual([join(TMP, 'a.jsonl'), join(TMP, 'b.jsonl')]);
  });
});

describe('findMarkerViolations', () => {
  it('reports nothing for a good multi-line fixture', () => {
    writeGoodMultiLine('good.jsonl');
    expect(findMarkerViolations(TMP)).toEqual([]);
  });

  it('reports nothing for a good single-line fixture (marker only, no newline)', () => {
    writeGoodSingleLine('good-single.jsonl');
    expect(findMarkerViolations(TMP)).toEqual([]);
  });

  it('reports a fixture whose first line is not the marker', () => {
    const bad = writeBadFixture('bad.jsonl');
    expect(findMarkerViolations(TMP)).toEqual([bad]);
  });

  it('reports a single-line file whose only line is not the marker', () => {
    const file = join(TMP, 'bad-single.jsonl');
    writeFileSync(file, '{"event":"real"}', 'utf8');
    expect(findMarkerViolations(TMP)).toEqual([file]);
  });

  it('returns an empty array when the directory is absent', () => {
    expect(findMarkerViolations(join(TMP, 'nope'))).toEqual([]);
  });
});

describe('findOversizedFixtures', () => {
  it('reports nothing for a small fixture', () => {
    writeGoodMultiLine('small.jsonl');
    expect(findOversizedFixtures(TMP)).toEqual([]);
  });

  it('reports a fixture larger than the cap', () => {
    const big = join(TMP, 'big.jsonl');
    writeFileSync(big, `${FIXTURE_MARKER}\n${'x'.repeat(60 * 1024)}\n`, 'utf8');
    expect(findOversizedFixtures(TMP)).toEqual([big]);
  });

  it('honours a custom cap argument', () => {
    const file = writeGoodMultiLine('tiny.jsonl');
    expect(findOversizedFixtures(TMP, 1)).toEqual([file]);
  });

  it('returns an empty array for an absent directory (vacuous pass)', () => {
    expect(findOversizedFixtures(join(TMP, 'absent'))).toEqual([]);
  });
});

describe('enforceFixtureMarker', () => {
  it('does not throw when every fixture has the marker', () => {
    writeGoodMultiLine('good.jsonl');
    expect(() => enforceFixtureMarker(TMP)).not.toThrow();
  });

  it('does not throw for an absent directory (vacuous pass)', () => {
    expect(() => enforceFixtureMarker(join(TMP, 'absent'))).not.toThrow();
  });

  it('throws listing the offending fixture when a violation exists', () => {
    const bad = writeBadFixture('bad.jsonl');
    expect(() => enforceFixtureMarker(TMP)).toThrow(bad);
  });
});

describe('the real fixtures directory (absent in WU-1)', () => {
  const realFixturesDir = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
  );

  it('has no oversized fixtures (vacuously, dir does not yet exist)', () => {
    expect(findOversizedFixtures(realFixturesDir)).toEqual([]);
  });

  it('passes the marker enforcement vacuously', () => {
    expect(() => enforceFixtureMarker(realFixturesDir)).not.toThrow();
  });
});
