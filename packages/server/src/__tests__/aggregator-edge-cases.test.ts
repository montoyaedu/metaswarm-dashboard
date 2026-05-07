// Coverage gap closure: aggregator weighted/avg edge branches.

import type { DailySnapshot } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';

import { toAgentAggregates } from '../data/aggregator.js';

function snap(agents: DailySnapshot['agents'], dayKey = '2026-05-06'): DailySnapshot {
  return {
    schemaVersion: 1,
    projectName: 'p',
    projectPath: '/tmp/p',
    category: 'metaswarm',    generatedAt: `${dayKey}T00:00:00.000Z`,
    dayKey,
    agents,
    totals: {
      totalActiveTasks: 0,
      totalBlockedTasks: 0,
      totalCompletedTasksLast7d: 0,
      lastActivityAt: null,
    },
    prsMergedLast7d: null,
    collectionStatus: 'ok',
    collectionWarnings: [],
  };
}

describe('toAgentAggregates — non-finite avgDurationSeconds is excluded', () => {
  it('skips infinite avgDurationSeconds in the durationSum', () => {
    const out = toAgentAggregates([
      {
        name: 'A',
        latest: snap([
          {
            agent: 'coder',
            tasksCompleted: 1,
            successRate: 1.0,
            avgDurationSeconds: Number.POSITIVE_INFINITY,
          },
        ]),
      },
    ]);
    // Only one project contributed and its duration was non-finite, so
    // durationCount stays 0 → avgDurationSeconds === 0.
    expect(out[0]?.avgDurationSeconds).toBe(0);
  });
});
