// Coverage for the operator-rating Zod schemas added in sessions-spike WU v4-1.
// These are pure schema declarations; importing and parsing them here exercises
// every line. Cases mirror design §4 / plan §v4-1.

import { describe, expect, it } from 'vitest';

import {
  CalibrationSummary,
  KpiAgreement,
  OperatorVerdict,
  SessionRating,
} from '../ratings.js';
import type { RubricKey } from '../sessions.js';

// --- shared valid fixtures -------------------------------------------------

const allRubricKeys: RubricKey[] = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
];

function validVerdict(key: RubricKey): unknown {
  return {
    key,
    verdict: 'pass' as const,
    note: `Operator note for ${key}`,
    scoredAt: '2026-05-17T12:00:00.000Z',
  };
}

const validRubricItem = (key: RubricKey): unknown => ({
  key,
  label: `Label for ${key}`,
  verdict: 'pass' as const,
  evidence: 'Observed the expected behaviour in the transcript.',
  pointer: { kind: 'uuid' as const, value: 'event-uuid-1' },
});

const validRubricAtRating = {
  schemaVersion: 1 as const,
  sessionId: 'session-1',
  scoredAt: '2026-05-17T12:01:00.000Z',
  items: allRubricKeys.map(validRubricItem),
  overall: 'pass' as const,
};

const validRating = {
  schemaVersion: 1 as const,
  sessionId: 'session-1',
  projectName: 'metaswarm-dashboard',
  verdicts: [validVerdict('tdd'), validVerdict('planning')],
  overallNote: 'Solid session overall.',
  ratedAt: '2026-05-17T12:05:00.000Z',
  rubricAtRating: validRubricAtRating,
};

const validKpiAgreement = {
  key: 'tdd' as const,
  agree: 4,
  disagree: 1,
  naOrUnsure: 2,
  total: 7,
  agreementRatio: 0.8,
};

const validCalibrationSummary = {
  schemaVersion: 1 as const,
  generatedAt: '2026-05-17T12:10:00.000Z',
  ratedSessionCount: 3,
  perKpi: allRubricKeys.map((key) => ({ ...validKpiAgreement, key })),
};

// --- valid round-trips -----------------------------------------------------

describe('valid round-trips', () => {
  it('OperatorVerdict parses and round-trips', () => {
    const verdict = validVerdict('tdd');
    const result = OperatorVerdict.safeParse(verdict);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(verdict);
    }
  });

  it('SessionRating parses and round-trips', () => {
    const result = SessionRating.safeParse(validRating);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validRating);
    }
  });

  it('KpiAgreement parses and round-trips', () => {
    const result = KpiAgreement.safeParse(validKpiAgreement);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validKpiAgreement);
    }
  });

  it('CalibrationSummary parses and round-trips', () => {
    const result = CalibrationSummary.safeParse(validCalibrationSummary);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validCalibrationSummary);
    }
  });
});

// --- OperatorVerdict.verdict enum ------------------------------------------

describe('OperatorVerdict.verdict enum', () => {
  it.each(['pass', 'watch', 'fail', 'na', 'unsure'])(
    'accepts the member %s',
    (member) => {
      const result = OperatorVerdict.safeParse({
        ...(validVerdict('tdd') as object),
        verdict: member,
      });
      expect(result.success).toBe(true);
    },
  );

  it('rejects an invalid string', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      verdict: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});

// --- OperatorVerdict.note max(500) / optional ------------------------------

describe('OperatorVerdict.note max(500)', () => {
  it('parses a 500-char note', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      note: 'n'.repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a 501-char note', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      note: 'n'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('parses with note omitted (optional)', () => {
    const { key, verdict, scoredAt } = validVerdict('tdd') as {
      key: RubricKey;
      verdict: string;
      scoredAt: string;
    };
    const result = OperatorVerdict.safeParse({ key, verdict, scoredAt });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBeUndefined();
    }
  });
});

// --- SessionRating.verdicts ------------------------------------------------

describe('SessionRating.verdicts', () => {
  it('parses an array of 9 distinct-key verdicts', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      verdicts: allRubricKeys.map(validVerdict),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an array of 10 verdicts (max 9)', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      verdicts: [...allRubricKeys.map(validVerdict), validVerdict('tdd')],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an array with a duplicate key (refinement)', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      verdicts: [validVerdict('tdd'), validVerdict('tdd')],
    });
    expect(result.success).toBe(false);
  });

  it('parses an empty verdicts array (partial rating)', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      verdicts: [],
    });
    expect(result.success).toBe(true);
  });
});

// --- SessionRating string constraints --------------------------------------

describe('SessionRating string constraints', () => {
  it('parses a 2000-char overallNote', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      overallNote: 'o'.repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a 2001-char overallNote', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      overallNote: 'o'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty projectName (min 1)', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      projectName: '',
    });
    expect(result.success).toBe(false);
  });
});

// --- datetime fields -------------------------------------------------------

describe('datetime fields (offset:false)', () => {
  it('accepts a valid UTC Z timestamp', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      scoredAt: '2026-05-17T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a timestamp with a timezone offset', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      scoredAt: '2026-05-17T12:00:00.000+02:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-date string', () => {
    const result = OperatorVerdict.safeParse({
      ...(validVerdict('tdd') as object),
      scoredAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('SessionRating.ratedAt rejects an offset timestamp', () => {
    const result = SessionRating.safeParse({
      ...validRating,
      ratedAt: '2026-05-17T12:05:00.000+02:00',
    });
    expect(result.success).toBe(false);
  });

  it('CalibrationSummary.generatedAt rejects a non-date string', () => {
    const result = CalibrationSummary.safeParse({
      ...validCalibrationSummary,
      generatedAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

// --- KpiAgreement.agreementRatio -------------------------------------------

describe('KpiAgreement.agreementRatio', () => {
  it('accepts null', () => {
    const result = KpiAgreement.safeParse({
      ...validKpiAgreement,
      agreementRatio: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a number in 0..1', () => {
    const result = KpiAgreement.safeParse({
      ...validKpiAgreement,
      agreementRatio: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a number above 1', () => {
    const result = KpiAgreement.safeParse({
      ...validKpiAgreement,
      agreementRatio: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
