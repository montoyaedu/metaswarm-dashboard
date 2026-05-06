// WU-3.{8,9,11,12} — agent edge cases, DST coverage (US + EU), ISO week boundaries.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type BeadsTaskRow,
  computeMetrics,
  isUtcMonday,
  isoWeekKey,
  previousIsoWeekKey,
  utcDayKey,
} from '../metrics.js';

const NOW = new Date('2026-05-06T12:00:00Z');

describe('utcDayKey', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    expect(utcDayKey(new Date('2026-05-06T23:30:00Z'))).toBe('2026-05-06');
  });

  // DoD #11 strict: each DST-transition day is exercised under three host
  // TZs (UTC, America/Los_Angeles, Europe/Berlin) to prove utcDayKey is
  // TZ-independent.
  const DST_DATES = [
    { label: 'EU DST spring-forward (2026-03-29)', iso: '2026-03-29T02:30:00Z', expected: '2026-03-29' },
    { label: 'US DST spring-forward (2026-03-08)', iso: '2026-03-08T07:30:00Z', expected: '2026-03-08' },
    { label: 'EU DST fall-back (2026-10-25)', iso: '2026-10-25T01:30:00Z', expected: '2026-10-25' },
    { label: 'US DST fall-back (2026-11-01)', iso: '2026-11-01T06:30:00Z', expected: '2026-11-01' },
  ];
  const TZ_ZONES = ['UTC', 'America/Los_Angeles', 'Europe/Berlin'];

  for (const tz of TZ_ZONES) {
    for (const c of DST_DATES) {
      it(`TZ=${tz}: ${c.label} produces exactly one daily key (${c.expected})`, () => {
        const saved = process.env.TZ;
        process.env.TZ = tz;
        try {
          expect(utcDayKey(new Date(c.iso))).toBe(c.expected);
        } finally {
          if (saved === undefined) delete process.env.TZ;
          else process.env.TZ = saved;
        }
      });
    }
  }
});

describe('isoWeekKey', () => {
  it('returns YYYY-Www', () => {
    expect(isoWeekKey(new Date('2026-05-06T00:00:00Z'))).toBe('2026-W19');
  });

  it('boundary: 2024-12-30 belongs to 2025-W01 (Mon-start)', () => {
    expect(isoWeekKey(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
  });

  it('boundary: 2026-12-31 belongs to 2026-W53 (long year)', () => {
    expect(isoWeekKey(new Date('2026-12-31T00:00:00Z'))).toBe('2026-W53');
  });

  it('boundary: 2025-01-01 (Wed) belongs to 2025-W01', () => {
    expect(isoWeekKey(new Date('2025-01-01T00:00:00Z'))).toBe('2025-W01');
  });
});

describe('isUtcMonday', () => {
  it('Monday UTC returns true', () => {
    // 2026-05-04 is a Monday.
    expect(isUtcMonday(new Date('2026-05-04T12:00:00Z'))).toBe(true);
  });

  it('non-Monday UTC returns false', () => {
    expect(isUtcMonday(new Date('2026-05-06T12:00:00Z'))).toBe(false); // Wed
    expect(isUtcMonday(new Date('2026-05-05T12:00:00Z'))).toBe(false); // Tue
    expect(isUtcMonday(new Date('2026-05-10T12:00:00Z'))).toBe(false); // Sun
  });
});

describe('previousIsoWeekKey', () => {
  it('Monday 2026-05-04 → previous week 2026-W18', () => {
    expect(previousIsoWeekKey(new Date('2026-05-04T00:00:00Z'))).toBe('2026-W18');
  });
});

describe('computeMetrics — DST + TZ stability', () => {
  // The metric anchor (`at`) is UTC. We additionally pin process.env.TZ to
  // multiple zones (LA, Berlin, UTC) to confirm TZ has no effect on output.
  const ZONES = ['UTC', 'America/Los_Angeles', 'Europe/Berlin'];

  for (const tz of ZONES) {
    describe(`TZ=${tz}`, () => {
      let savedTz: string | undefined;

      beforeEach(() => {
        savedTz = process.env.TZ;
        process.env.TZ = tz;
      });
      afterEach(() => {
        if (savedTz === undefined) delete process.env.TZ;
        else process.env.TZ = savedTz;
      });

      it('produces stable agent rollup', () => {
        const rows: BeadsTaskRow[] = [
          {
            id: 't1',
            status: 'closed',
            agent: 'coder',
            closed_at: '2026-05-04T12:00:00Z',
            duration_seconds: 600,
            succeeded: true,
          },
        ];
        const out = computeMetrics(rows, NOW);
        expect(out.agents).toEqual([
          {
            agent: 'coder',
            tasksCompleted: 1,
            successRate: 1.0,
            avgDurationSeconds: 600,
          },
        ]);
      });
    });
  }
});

describe('computeMetrics — agent edge cases', () => {
  it('agent with 0 completed tasks does not appear in agents array', () => {
    const rows: BeadsTaskRow[] = [{ id: 't1', status: 'open', agent: 'coder' }];
    const out = computeMetrics(rows, NOW);
    expect(out.agents).toEqual([]);
  });

  it('agent with 100% success → successRate 1.0, no division-by-zero', () => {
    const rows: BeadsTaskRow[] = [
      {
        id: 't1',
        status: 'closed',
        agent: 'coder',
        closed_at: '2026-05-05T12:00:00Z',
        succeeded: true,
        duration_seconds: 100,
      },
      {
        id: 't2',
        status: 'closed',
        agent: 'coder',
        closed_at: '2026-05-05T13:00:00Z',
        succeeded: true,
        duration_seconds: 200,
      },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.agents).toEqual([
      {
        agent: 'coder',
        tasksCompleted: 2,
        successRate: 1.0,
        avgDurationSeconds: 150,
      },
    ]);
  });

  it('agent with all-failures → successRate 0', () => {
    const rows: BeadsTaskRow[] = [
      {
        id: 't1',
        status: 'closed',
        agent: 'coder',
        closed_at: '2026-05-05T12:00:00Z',
        succeeded: false,
      },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.agents[0]?.successRate).toBe(0);
  });

  it('row with no agent attribution → grouped under "unknown"', () => {
    const rows: BeadsTaskRow[] = [
      {
        id: 't1',
        status: 'closed',
        closed_at: '2026-05-05T12:00:00Z',
        succeeded: true,
      },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.agents[0]?.agent).toBe('unknown');
  });

  it('only counts closures within the last 7d window', () => {
    const rows: BeadsTaskRow[] = [
      {
        id: 'old',
        status: 'closed',
        agent: 'coder',
        closed_at: '2025-01-01T00:00:00Z',
        succeeded: true,
      },
      {
        id: 'recent',
        status: 'closed',
        agent: 'coder',
        closed_at: '2026-05-04T00:00:00Z',
        succeeded: true,
      },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.totals.totalCompletedTasksLast7d).toBe(1);
    expect(out.agents[0]?.tasksCompleted).toBe(1);
  });
});

describe('computeMetrics — totals', () => {
  it('counts active vs blocked correctly', () => {
    const rows: BeadsTaskRow[] = [
      { id: '1', status: 'open' },
      { id: '2', status: 'in_progress' },
      { id: '3', status: 'blocked' },
      { id: '4', status: 'blocked' },
      { id: '5', status: 'closed', closed_at: '2026-05-05T00:00:00Z' },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.totals.totalActiveTasks).toBe(2);
    expect(out.totals.totalBlockedTasks).toBe(2);
    expect(out.totals.totalCompletedTasksLast7d).toBe(1);
  });

  it('lastActivityAt uses the most recent activity timestamp', () => {
    const rows: BeadsTaskRow[] = [
      { id: '1', status: 'open', updated_at: '2026-05-01T12:00:00Z' },
      { id: '2', status: 'closed', closed_at: '2026-05-05T15:00:00Z' },
    ];
    const out = computeMetrics(rows, NOW);
    expect(out.totals.lastActivityAt).toBe('2026-05-05T15:00:00.000Z');
  });

  it('lastActivityAt is null when no rows have timestamps', () => {
    const rows: BeadsTaskRow[] = [{ id: '1', status: 'open' }];
    const out = computeMetrics(rows, NOW);
    expect(out.totals.lastActivityAt).toBeNull();
  });
});
