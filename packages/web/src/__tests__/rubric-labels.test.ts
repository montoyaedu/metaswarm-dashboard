// WU v4-8 — the static RubricKey → label map for the survey + calibration UI.

import { describe, expect, it } from 'vitest';

import { RUBRIC_KEYS, rubricLabel } from '../lib/rubric-labels.js';

describe('rubric-labels', () => {
  it('RUBRIC_KEYS has all 9 keys in enum-declaration order', () => {
    expect(RUBRIC_KEYS).toEqual([
      'setup-discipline',
      'planning',
      'tdd',
      'error-handling',
      'thrashing',
      'cross-reference',
      'communication',
      'prompt-coherence',
      'workflow-touchpoints',
    ]);
  });

  it('rubricLabel returns a non-empty label for every key', () => {
    for (const key of RUBRIC_KEYS) {
      expect(rubricLabel(key)).toBeTruthy();
    }
  });

  it('rubricLabel maps a known key to its human label', () => {
    expect(rubricLabel('setup-discipline')).toBe('Setup discipline');
    expect(rubricLabel('tdd')).toBe('TDD discipline');
  });
});
