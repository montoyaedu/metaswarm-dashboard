// WU v5-9 — cost-format: pure USD / "n/a" formatting helpers (design §8.2).
// Unit-tested directly — no component mount needed.

import { describe, expect, it } from 'vitest';

import { formatTokenCount, formatUsd } from '../lib/cost-format.js';

describe('formatUsd', () => {
  it('renders "n/a" for a null cost (an unpriced / uncostable session)', () => {
    expect(formatUsd(null)).toBe('n/a');
  });

  it('renders "$0.00" for a genuine zero cost — distinct from null', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats at 4-decimal precision so sub-cent sessions are distinguishable', () => {
    expect(formatUsd(0.0123)).toBe('$0.0123');
  });

  it('formats a sub-cent fraction that would round to $0.00 at 2 decimals', () => {
    expect(formatUsd(0.0001)).toBe('$0.0001');
  });

  it('rounds to 4 decimals (half-up) for an over-precise input', () => {
    expect(formatUsd(0.123456)).toBe('$0.1235');
  });

  it('formats a multi-dollar cost with 4 decimals', () => {
    expect(formatUsd(4.2)).toBe('$4.2000');
  });
});

describe('formatTokenCount', () => {
  it('renders a plain integer count', () => {
    expect(formatTokenCount(512)).toBe('512');
  });

  it('groups thousands for readability', () => {
    expect(formatTokenCount(1234567)).toBe('1,234,567');
  });

  it('renders zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0');
  });
});
