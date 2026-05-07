// WU-4.{3,4,5} — aggregator: summary / detail (gap-filled throughput) / agents.

import type { DailySnapshot } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';


import {
  buildThroughput,
  toAgentAggregates,
  toProjectDetail,
  toProjectSummary,
} from '../data/aggregator.js';

const TODAY = new Date('2026-05-06T12:00:00Z');

function snap(dayKey: string, completed7d = 5, agents: DailySnapshot['agents'] = []): DailySnapshot {
  return {
    schemaVersion: 1,
    projectName: 'p',
    generatedAt: `${dayKey}T00:00:00.000Z`,
    dayKey,
    agents,
    totals: {
      totalActiveTasks: 3,
      totalBlockedTasks: 1,
      totalCompletedTasksLast7d: completed7d,
      lastActivityAt: `${dayKey}T10:00:00.000Z`,
    },
    prsMergedLast7d: null,
    collectionStatus: 'ok',
    collectionWarnings: [],
  };
}

describe('toProjectSummary', () => {
  it('hasMetrics: false when no snapshot exists', () => {
    const s = toProjectSummary('p', null);
    expect(s).toEqual({
      name: 'p',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],
    });
  });

  it('echoes prsMergedLast7d (always null in MVP) and totals when latest exists', () => {
    const latest = snap('2026-05-06', 7);
    const s = toProjectSummary('p', latest);
    expect(s.hasMetrics).toBe(true);
    expect(s.prsMergedLast7d).toBeNull();
    expect(s.activeTasks).toBe(3);
    expect(s.blockedTasks).toBe(1);
    expect(s.lastActivityAt).toBe('2026-05-06T10:00:00.000Z');
  });
});

describe('buildThroughput — exact-14 invariant + gap-fill', () => {
  it('returns exactly 14 entries when 0 snapshots provided', () => {
    const t = buildThroughput([], TODAY);
    expect(t).toHaveLength(14);
    expect(t.every((p) => p.closed === 0)).toBe(true);
  });

  it('returns exactly 14 entries when 1 snapshot provided (only that day non-zero)', () => {
    const t = buildThroughput([snap('2026-05-06', 9)], TODAY);
    expect(t).toHaveLength(14);
    expect(t[13]?.date).toBe('2026-05-06');
    expect(t[13]?.closed).toBe(9);
    expect(t.slice(0, 13).every((p) => p.closed === 0)).toBe(true);
  });

  it('returns exactly 14 entries when 14 snapshots provided', () => {
    const snaps: DailySnapshot[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(TODAY.getTime() - i * 86_400_000);
      const k = `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
      snaps.push(snap(k, i + 1));
    }
    const t = buildThroughput(snaps, TODAY);
    expect(t).toHaveLength(14);
    expect(t[13]?.closed).toBe(1);
    expect(t[0]?.closed).toBe(14);
  });
});

describe('toProjectDetail', () => {
  it('returns empty agents + recentWorkUnits when latest is null', () => {
    const d = toProjectDetail('p', null, [], TODAY);
    expect(d.agents).toEqual([]);
    expect(d.recentWorkUnits).toEqual([]);
    expect(d.lastActivityAt).toBeNull();
    expect(d.throughput).toHaveLength(14);
  });

  it('passes through latest.agents and lastActivityAt', () => {
    const latest = snap('2026-05-06', 7, [
      { agent: 'coder', tasksCompleted: 3, successRate: 1.0, avgDurationSeconds: 200 },
    ]);
    const d = toProjectDetail('p', latest, [latest], TODAY);
    expect(d.agents).toHaveLength(1);
    expect(d.lastActivityAt).toBe('2026-05-06T10:00:00.000Z');
  });
});

describe('toAgentAggregates', () => {
  it('weights successRate by tasksCompleted across projects (hand-computed)', () => {
    // Project A: coder tasksCompleted=4 successRate=1.0  → contribution 4×1.0 = 4.0
    // Project B: coder tasksCompleted=6 successRate=0.5  → contribution 6×0.5 = 3.0
    // Total tasksCompleted = 10; weighted = (4 + 3) / 10 = 0.7
    const a = snap('2026-05-06', 4, [
      { agent: 'coder', tasksCompleted: 4, successRate: 1.0, avgDurationSeconds: 100 },
    ]);
    const b = snap('2026-05-06', 6, [
      { agent: 'coder', tasksCompleted: 6, successRate: 0.5, avgDurationSeconds: 200 },
    ]);
    const out = toAgentAggregates([
      { name: 'A', latest: a },
      { name: 'B', latest: b },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.agent).toBe('coder');
    expect(out[0]?.totalTasksCompleted).toBe(10);
    expect(out[0]?.weightedSuccessRate).toBeCloseTo(0.7, 6);
    expect(out[0]?.avgDurationSeconds).toBe(150); // mean of 100 and 200
    expect(out[0]?.projects).toEqual([
      { name: 'A', tasksCompleted: 4 },
      { name: 'B', tasksCompleted: 6 },
    ]);
  });

  it('returns empty when no projects have latest snapshots', () => {
    expect(toAgentAggregates([{ name: 'A', latest: null }])).toEqual([]);
  });

  it('handles projects with zero agents', () => {
    expect(toAgentAggregates([{ name: 'A', latest: snap('2026-05-06', 0, []) }])).toEqual([]);
  });

  it('weightedSuccessRate is 0 when totalTasksCompleted is 0', () => {
    const s = snap('2026-05-06', 0, [
      { agent: 'idle', tasksCompleted: 0, successRate: 0, avgDurationSeconds: 0 },
    ]);
    const out = toAgentAggregates([{ name: 'A', latest: s }]);
    expect(out[0]?.weightedSuccessRate).toBe(0);
  });
});
