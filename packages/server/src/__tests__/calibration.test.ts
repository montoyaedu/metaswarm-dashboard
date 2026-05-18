// Tests for the calibration aggregator (sessions-spike WU v4-5, design §4 /
// §7). `aggregateCalibration` walks every `*.rating.json` in the datalake and
// reduces each `OperatorVerdict` into a per-`RubricKey` agreement tally:
//   - verdict `na`/`unsure`            → `naOrUnsure`
//   - else == the matching rubric item → `agree`
//   - else                            → `disagree`
// `agreementRatio = agree / (agree + disagree)`, or `null` when that
// denominator is 0. An empty datalake yields a valid all-zero summary.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CalibrationSummary } from '@metaswarm-dashboard/types/ratings';
import type {
  OperatorVerdict,
  SessionRating,
} from '@metaswarm-dashboard/types/ratings';
import type {
  ProcessRubricScore,
  RubricKey,
  RubricVerdict,
} from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aggregateCalibration,
  RUBRIC_KEYS,
  type CalibrationFsHooks,
} from '../data/calibration.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-calib-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const NOW = new Date('2026-05-17T12:00:00.000Z');

/** Build a `ProcessRubricScore` whose every item carries `verdict`. */
function rubricAll(verdict: RubricVerdict): ProcessRubricScore {
  return {
    schemaVersion: 1,
    sessionId: 'sess',
    scoredAt: '2026-05-17T08:00:00.000Z',
    items: RUBRIC_KEYS.map((key) => ({
      key,
      label: key,
      verdict,
      evidence: 'ok',
      pointer: null,
    })),
    overall: verdict === 'na' ? 'na' : verdict,
  };
}

/** Build a `SessionRating` from a rubric + a verdict list. */
function makeRating(
  projectName: string,
  sessionId: string,
  rubric: ProcessRubricScore,
  verdicts: OperatorVerdict[],
): SessionRating {
  return {
    schemaVersion: 1,
    sessionId,
    projectName,
    verdicts,
    ratedAt: '2026-05-17T09:00:00.000Z',
    rubricAtRating: rubric,
  };
}

/** Write a `*.rating.json` into the datalake under `<TMP>/projects/...`. */
function writeRating(rating: SessionRating): void {
  const dir = join(TMP, 'projects', rating.projectName, 'sessions', 'ratings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${rating.sessionId}.rating.json`), JSON.stringify(rating), 'utf8');
}

/** One `OperatorVerdict`. */
function verdict(key: RubricKey, v: OperatorVerdict['verdict']): OperatorVerdict {
  return { key, verdict: v, scoredAt: '2026-05-17T09:00:00.000Z' };
}

describe('aggregateCalibration — empty datalake', () => {
  it('returns a valid all-zero summary when no ratings exist', () => {
    const summary = aggregateCalibration(TMP, NOW);
    expect(CalibrationSummary.safeParse(summary).success).toBe(true);
    expect(summary.ratedSessionCount).toBe(0);
    expect(summary.perKpi).toHaveLength(RUBRIC_KEYS.length);
    for (const kpi of summary.perKpi) {
      expect(kpi).toMatchObject({ agree: 0, disagree: 0, naOrUnsure: 0, total: 0 });
      expect(kpi.agreementRatio).toBeNull();
    }
    expect(summary.generatedAt).toBe('2026-05-17T12:00:00.000Z');
  });

  it('returns a valid all-zero summary when the projects dir is absent', () => {
    // TMP has no `projects/` subdir at all.
    const summary = aggregateCalibration(TMP, NOW);
    expect(summary.ratedSessionCount).toBe(0);
  });
});

describe('aggregateCalibration — counting', () => {
  it('counts an exact match as agree', () => {
    writeRating(
      makeRating('p', 's1', rubricAll('pass'), [verdict('tdd', 'pass')]),
    );
    const summary = aggregateCalibration(TMP, NOW);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 1, disagree: 0, naOrUnsure: 0, total: 1 });
    expect(tdd?.agreementRatio).toBe(1);
    expect(summary.ratedSessionCount).toBe(1);
  });

  it('counts a mismatch as disagree', () => {
    writeRating(
      makeRating('p', 's1', rubricAll('pass'), [verdict('tdd', 'fail')]),
    );
    const summary = aggregateCalibration(TMP, NOW);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 0, disagree: 1, naOrUnsure: 0, total: 1 });
    expect(tdd?.agreementRatio).toBe(0);
  });

  it('counts an operator `na` verdict as naOrUnsure, excluded from the ratio', () => {
    writeRating(
      makeRating('p', 's1', rubricAll('fail'), [verdict('tdd', 'na')]),
    );
    const summary = aggregateCalibration(TMP, NOW);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 0, disagree: 0, naOrUnsure: 1, total: 1 });
    expect(tdd?.agreementRatio).toBeNull();
  });

  it('counts an operator `unsure` verdict as naOrUnsure', () => {
    writeRating(
      makeRating('p', 's1', rubricAll('pass'), [verdict('tdd', 'unsure')]),
    );
    const summary = aggregateCalibration(TMP, NOW);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 0, disagree: 0, naOrUnsure: 1, total: 1 });
  });

  it('computes agreementRatio = agree / (agree + disagree)', () => {
    // 3 agree, 1 disagree across 4 sessions → ratio 0.75.
    writeRating(makeRating('p', 's1', rubricAll('pass'), [verdict('tdd', 'pass')]));
    writeRating(makeRating('p', 's2', rubricAll('pass'), [verdict('tdd', 'pass')]));
    writeRating(makeRating('p', 's3', rubricAll('pass'), [verdict('tdd', 'pass')]));
    writeRating(makeRating('p', 's4', rubricAll('pass'), [verdict('tdd', 'fail')]));
    const summary = aggregateCalibration(TMP, NOW);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 3, disagree: 1, naOrUnsure: 0, total: 4 });
    expect(tdd?.agreementRatio).toBe(0.75);
  });

  it('aggregates across multiple projects', () => {
    writeRating(makeRating('alpha', 's1', rubricAll('pass'), [verdict('tdd', 'pass')]));
    writeRating(makeRating('beta', 's1', rubricAll('pass'), [verdict('tdd', 'fail')]));
    const summary = aggregateCalibration(TMP, NOW);
    expect(summary.ratedSessionCount).toBe(2);
    const tdd = summary.perKpi.find((k) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 1, disagree: 1, total: 2 });
  });

  it('matches each verdict against its OWN rubric key', () => {
    // tdd verdict agrees, planning verdict disagrees.
    writeRating(
      makeRating('p', 's1', rubricAll('pass'), [
        verdict('tdd', 'pass'),
        verdict('planning', 'fail'),
      ]),
    );
    const summary = aggregateCalibration(TMP, NOW);
    expect(summary.perKpi.find((k) => k.key === 'tdd')).toMatchObject({ agree: 1 });
    expect(summary.perKpi.find((k) => k.key === 'planning')).toMatchObject({
      disagree: 1,
    });
  });

  it('ignores a rating file that fails Zod validation', () => {
    const dir = join(TMP, 'projects', 'p', 'sessions', 'ratings');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.rating.json'), JSON.stringify({ schemaVersion: 9 }), 'utf8');
    writeFileSync(join(dir, 'garbage.rating.json'), 'not-json', 'utf8');
    writeRating(makeRating('p', 'good', rubricAll('pass'), [verdict('tdd', 'pass')]));
    const summary = aggregateCalibration(TMP, NOW);
    // Only the valid file counts.
    expect(summary.ratedSessionCount).toBe(1);
  });

  it('ignores non-.rating.json files in the ratings dir', () => {
    writeRating(makeRating('p', 'good', rubricAll('pass'), [verdict('tdd', 'pass')]));
    const dir = join(TMP, 'projects', 'p', 'sessions', 'ratings');
    writeFileSync(join(dir, 'README.md'), 'notes', 'utf8');
    writeFileSync(join(dir, 'stray.json'), '{}', 'utf8');
    const summary = aggregateCalibration(TMP, NOW);
    expect(summary.ratedSessionCount).toBe(1);
  });

  it('handles a project whose ratings dir does not exist', () => {
    // `p` has a `sessions/` dir but no `ratings/` under it.
    mkdirSync(join(TMP, 'projects', 'p', 'sessions'), { recursive: true });
    writeRating(makeRating('q', 's1', rubricAll('pass'), [verdict('tdd', 'pass')]));
    const summary = aggregateCalibration(TMP, NOW);
    expect(summary.ratedSessionCount).toBe(1);
  });

  it('skips a rating file that becomes unreadable mid-walk (injected fs)', () => {
    // `readdirSync` lists the file, but `readFileSync` then fails (a race a
    // real fs could produce). The aggregation must not abort.
    const fs: CalibrationFsHooks = {
      readdirSync: (dir) => {
        if (dir.endsWith(join('projects'))) {
          return ['p'];
        }
        if (dir.endsWith(join('p', 'sessions', 'ratings'))) {
          return ['vanished.rating.json'];
        }
        return [];
      },
      readFileSync: () => {
        const err = new Error('ENOENT: vanished') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      },
    };
    const summary = aggregateCalibration(TMP, NOW, fs);
    expect(summary.ratedSessionCount).toBe(0);
  });

  it('counts a verdict whose key is absent from the rubric as disagree-safe', () => {
    // A rubric item is always present for all 9 keys, so every operator
    // verdict has a counterpart. This test confirms a full 9-key rating
    // tallies one verdict per KPI.
    const verdicts = RUBRIC_KEYS.map((key) => verdict(key, 'pass'));
    writeRating(makeRating('p', 's1', rubricAll('pass'), verdicts));
    const summary = aggregateCalibration(TMP, NOW);
    for (const kpi of summary.perKpi) {
      expect(kpi).toMatchObject({ agree: 1, total: 1 });
    }
  });
});
