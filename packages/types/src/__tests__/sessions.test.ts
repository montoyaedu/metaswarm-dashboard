// Coverage for the sessions-observability Zod schemas added in sessions-spike
// WU-2. These are pure schema declarations; importing and parsing them here
// exercises every line. Cases mirror design §10 WU-2.

import { describe, expect, it } from 'vitest';

import {
  ProcessRubricScore,
  RubricItem,
  RubricKey,
  RubricPointer,
  RubricVerdict,
  SessionSnapshot,
  SessionTimeline,
  ToolUseEvent,
  ToolUseEventKind,
} from '../sessions.js';

// --- shared valid fixtures -------------------------------------------------

const validEvent = {
  at: '2026-05-17T12:00:00.000Z',
  kind: 'tool-use' as const,
  toolName: 'Read',
  summary: 'Read packages/types/src/sessions.ts',
  redactionApplied: [],
  uuid: 'event-uuid-1',
};

function validRubricItem(key: RubricKey): unknown {
  return {
    key,
    label: `Label for ${key}`,
    verdict: 'pass' as const,
    evidence: 'Observed the expected behaviour in the transcript.',
    pointer: { kind: 'uuid' as const, value: 'event-uuid-1' },
  };
}

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

const validRubricItems = allRubricKeys.map(validRubricItem);

const validTimeline = {
  schemaVersion: 1 as const,
  transcriptPath: '/tmp/transcript.jsonl',
  sessionId: 'session-1',
  projectCwd: '/repo',
  startedAt: '2026-05-17T11:59:00.000Z',
  lastEventAt: '2026-05-17T12:00:00.000Z',
  eventCount: 1,
  skippedLineCount: 0,
  events: [validEvent],
};

const validRubricScore = {
  schemaVersion: 1 as const,
  sessionId: 'session-1',
  scoredAt: '2026-05-17T12:01:00.000Z',
  items: validRubricItems,
  overall: 'pass' as const,
};

const validSnapshot = {
  schemaVersion: 1 as const,
  projectName: 'metaswarm-dashboard',
  generatedAt: '2026-05-17T12:02:00.000Z',
  persistedWithSanitization: false,
  timeline: validTimeline,
  rubric: validRubricScore,
};

// --- valid round-trips -----------------------------------------------------

describe('valid round-trips', () => {
  it('ToolUseEvent parses and round-trips', () => {
    const result = ToolUseEvent.safeParse(validEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validEvent);
    }
  });

  it('SessionTimeline parses and round-trips', () => {
    const result = SessionTimeline.safeParse(validTimeline);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validTimeline);
    }
  });

  it('RubricItem parses and round-trips', () => {
    const item = validRubricItem('tdd');
    const result = RubricItem.safeParse(item);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(item);
    }
  });

  it('ProcessRubricScore parses and round-trips', () => {
    const result = ProcessRubricScore.safeParse(validRubricScore);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validRubricScore);
    }
  });

  it('SessionSnapshot parses and round-trips', () => {
    const result = SessionSnapshot.safeParse(validSnapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validSnapshot);
    }
  });
});

// --- defaults --------------------------------------------------------------

/** Returns a shallow copy of `obj` with `key` removed — used to assert that
 *  a Zod `.default()` fills the field back in. */
function omit<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe('defaults', () => {
  it('ToolUseEvent.redactionApplied defaults to [] when omitted', () => {
    const result = ToolUseEvent.safeParse(omit(validEvent, 'redactionApplied'));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redactionApplied).toEqual([]);
    }
  });

  it('SessionTimeline.skippedLineCount defaults to 0 when omitted', () => {
    const result = SessionTimeline.safeParse(
      omit(validTimeline, 'skippedLineCount'),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skippedLineCount).toBe(0);
    }
  });
});

// --- enums -----------------------------------------------------------------

describe('ToolUseEventKind enum', () => {
  it('accepts a valid member', () => {
    expect(ToolUseEventKind.safeParse('assistant-thinking').success).toBe(true);
  });

  it('rejects an invalid string', () => {
    expect(ToolUseEventKind.safeParse('not-a-kind').success).toBe(false);
  });
});

describe('RubricVerdict enum', () => {
  it('accepts a valid member', () => {
    expect(RubricVerdict.safeParse('watch').success).toBe(true);
  });

  it('rejects an invalid string', () => {
    expect(RubricVerdict.safeParse('maybe').success).toBe(false);
  });
});

describe('RubricKey enum', () => {
  it('accepts a valid member', () => {
    expect(RubricKey.safeParse('prompt-coherence').success).toBe(true);
  });

  it('rejects an invalid string', () => {
    expect(RubricKey.safeParse('scope-drift').success).toBe(false);
  });

  it('has exactly the 9 expected keys', () => {
    expect(RubricKey.options).toEqual(allRubricKeys);
    expect(RubricKey.options).toHaveLength(9);
  });
});

// --- ProcessRubricScore.items length ---------------------------------------

describe('ProcessRubricScore.items length(9)', () => {
  it('parses an array of exactly 9 items', () => {
    expect(ProcessRubricScore.safeParse(validRubricScore).success).toBe(true);
  });

  it('rejects an array of 8 items', () => {
    const result = ProcessRubricScore.safeParse({
      ...validRubricScore,
      items: validRubricItems.slice(0, 8),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an array of 10 items', () => {
    const result = ProcessRubricScore.safeParse({
      ...validRubricScore,
      items: [...validRubricItems, validRubricItem('tdd')],
    });
    expect(result.success).toBe(false);
  });
});

// --- RubricPointer discriminated union -------------------------------------

describe('RubricPointer discriminated union', () => {
  it('parses a valid uuid pointer', () => {
    const result = RubricPointer.safeParse({ kind: 'uuid', value: 'abc-123' });
    expect(result.success).toBe(true);
  });

  it('parses a valid index pointer', () => {
    const result = RubricPointer.safeParse({ kind: 'index', value: 3 });
    expect(result.success).toBe(true);
  });

  it('rejects an object missing the discriminator', () => {
    expect(RubricPointer.safeParse({ value: 'x' }).success).toBe(false);
  });

  it('rejects an invalid discriminator value', () => {
    expect(RubricPointer.safeParse({ kind: 'bogus', value: 'x' }).success).toBe(
      false,
    );
  });
});

// --- RubricItem field constraints ------------------------------------------

describe('RubricItem.evidence max(200)', () => {
  it('parses a 200-char evidence string', () => {
    const result = RubricItem.safeParse({
      ...(validRubricItem('tdd') as object),
      evidence: 'e'.repeat(200),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a 201-char evidence string', () => {
    const result = RubricItem.safeParse({
      ...(validRubricItem('tdd') as object),
      evidence: 'e'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('RubricItem.pointer', () => {
  it('accepts a null pointer', () => {
    const result = RubricItem.safeParse({
      ...(validRubricItem('tdd') as object),
      pointer: null,
    });
    expect(result.success).toBe(true);
  });
});

// --- datetime fields -------------------------------------------------------

describe('datetime fields (offset:false)', () => {
  it('accepts a valid UTC Z timestamp', () => {
    const result = ToolUseEvent.safeParse({
      ...validEvent,
      at: '2026-05-17T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a timestamp with a timezone offset', () => {
    const result = ToolUseEvent.safeParse({
      ...validEvent,
      at: '2026-05-17T12:00:00.000+02:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-date string', () => {
    const result = ToolUseEvent.safeParse({
      ...validEvent,
      at: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });
});

// --- SessionSnapshot.projectName min(1) ------------------------------------

describe('SessionSnapshot.projectName min(1)', () => {
  it('rejects an empty project name', () => {
    const result = SessionSnapshot.safeParse({
      ...validSnapshot,
      projectName: '',
    });
    expect(result.success).toBe(false);
  });
});
