// WU v4-7 — pure formatting helpers for the Sessions UI. Extracted so the
// branchy formatting logic is unit-tested directly rather than only through
// the mounted views.

import { describe, expect, it } from 'vitest';

import {
  durationBetween,
  isInProgress,
  sessionIdSuffix,
  truncateSummary,
} from '../lib/session-format.js';

describe('durationBetween', () => {
  it('formats a sub-minute span in seconds', () => {
    expect(
      durationBetween('2026-05-17T06:00:00.000Z', '2026-05-17T06:00:42.000Z'),
    ).toBe('42s');
  });

  it('formats a multi-minute span in minutes', () => {
    expect(
      durationBetween('2026-05-17T06:00:00.000Z', '2026-05-17T06:30:00.000Z'),
    ).toBe('30.0m');
  });

  it('formats a multi-hour span in hours', () => {
    expect(
      durationBetween('2026-05-17T06:00:00.000Z', '2026-05-17T08:30:00.000Z'),
    ).toBe('2.5h');
  });

  it('clamps a negative span (lastEventAt before startedAt) to 0s', () => {
    expect(
      durationBetween('2026-05-17T06:30:00.000Z', '2026-05-17T06:00:00.000Z'),
    ).toBe('0s');
  });
});

describe('sessionIdSuffix', () => {
  it('returns the first 8 characters for a long id', () => {
    expect(sessionIdSuffix('abcdef0123456789')).toBe('abcdef01');
  });

  it('returns the whole id when it is 8 chars or shorter', () => {
    expect(sessionIdSuffix('short')).toBe('short');
  });
});

describe('truncateSummary', () => {
  it('leaves a short summary untouched', () => {
    expect(truncateSummary('hello', 20)).toBe('hello');
  });

  it('truncates a long summary and appends an ellipsis', () => {
    expect(truncateSummary('abcdefghij', 5)).toBe('abcde…');
  });

  it('collapses embedded newlines to single spaces', () => {
    expect(truncateSummary('line1\nline2', 50)).toBe('line1 line2');
  });
});

describe('isInProgress', () => {
  const now = new Date('2026-05-17T12:00:00.000Z');

  it('is true when the last event is within the last 60s', () => {
    expect(isInProgress('2026-05-17T11:59:30.000Z', now)).toBe(true);
  });

  it('is false when the last event is older than 60s', () => {
    expect(isInProgress('2026-05-17T11:58:00.000Z', now)).toBe(false);
  });

  it('is false for a last event in the future beyond the window', () => {
    expect(isInProgress('2026-05-17T13:00:00.000Z', now)).toBe(false);
  });
});
