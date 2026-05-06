// Pure aggregator: snapshot rows → API response shapes (per plan §2.3, WU-4.3-5).

import type {
  AgentAggregate,
  ProjectDetail,
  ProjectSummary,
  ThroughputPoint,
} from '@metaswarm-dashboard/types/api';
import type { DailySnapshot } from '@metaswarm-dashboard/types/snapshots';

const THROUGHPUT_DAYS = 14;
const RECENT_WORK_UNITS_LIMIT = 25;

/** UTC daily key (`YYYY-MM-DD`) for the given Date. */
function utcDayKey(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toProjectSummary(
  projectName: string,
  latest: DailySnapshot | null,
): ProjectSummary {
  if (latest === null) {
    return {
      name: projectName,
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      hasMetrics: false,
    };
  }
  return {
    name: projectName,
    activeTasks: latest.totals.totalActiveTasks,
    blockedTasks: latest.totals.totalBlockedTasks,
    prsMergedLast7d: latest.prsMergedLast7d, // always null per §2.6
    lastActivityAt: latest.totals.lastActivityAt,
    hasMetrics: true,
  };
}

/**
 * Build the project-detail throughput sparkline: exactly 14 entries, anchored
 * at `today` (UTC). Missing days are filled with `closed: 0`. Server owns
 * the gap-fill so the SPA never needs to compute anything.
 */
export function buildThroughput(
  recent: DailySnapshot[],
  today: Date = new Date(),
): ThroughputPoint[] {
  // Map dayKey → totalCompletedTasksLast7d? No — we want per-day closed
  // counts. The DailySnapshot has `totalCompletedTasksLast7d` (sliding 7d
  // window) and per-agent `tasksCompleted`. Both are 7d aggregates, not
  // per-day. The MVP throughput chart uses `totalCompletedTasksLast7d`
  // bucketed by the snapshot's dayKey — i.e., the value-on-day rather than
  // a daily delta. This matches what the operator sees on the index card
  // and avoids inventing a derived metric.
  const byDay = new Map<string, number>();
  for (const snap of recent) byDay.set(snap.dayKey, snap.totals.totalCompletedTasksLast7d);

  const out: ThroughputPoint[] = [];
  for (let i = THROUGHPUT_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = utcDayKey(d);
    out.push({ date: key, closed: byDay.get(key) ?? 0 });
  }
  return out;
}

export function toProjectDetail(
  projectName: string,
  latest: DailySnapshot | null,
  recent: DailySnapshot[],
  today: Date = new Date(),
): ProjectDetail {
  const throughput = buildThroughput(recent, today);
  if (latest === null) {
    return {
      name: projectName,
      agents: [],
      throughput,
      recentWorkUnits: [],
      lastActivityAt: null,
    };
  }
  return {
    name: projectName,
    agents: latest.agents.slice(0, RECENT_WORK_UNITS_LIMIT * 100), // already small
    throughput,
    // Recent work units aren't part of DailySnapshot in the MVP — the
    // collector intentionally only writes rolled-up metrics. The MVP UI
    // therefore renders an empty list with a "no per-task detail in MVP"
    // empty state. A follow-up issue extends DailySnapshot to include
    // (anonymized) recent task IDs if needed.
    recentWorkUnits: [],
    lastActivityAt: latest.totals.lastActivityAt,
  };
}

/**
 * Cross-project aggregate. `weightedSuccessRate` is weighted by
 * `tasksCompleted` across all projects (per WU-4.5). `avgDurationSeconds` is
 * an unweighted mean of per-project values (the MVP doesn't keep raw counts
 * in the snapshot; this is a pragmatic approximation — documented).
 */
export function toAgentAggregates(
  perProject: { name: string; latest: DailySnapshot | null }[],
): AgentAggregate[] {
  const acc = new Map<
    string,
    {
      totalTasksCompleted: number;
      weightedSuccessRateNumerator: number;
      durationSum: number;
      durationCount: number;
      projects: { name: string; tasksCompleted: number }[];
    }
  >();

  for (const { name, latest } of perProject) {
    if (latest === null) continue;
    for (const a of latest.agents) {
      const cur =
        acc.get(a.agent) ??
        {
          totalTasksCompleted: 0,
          weightedSuccessRateNumerator: 0,
          durationSum: 0,
          durationCount: 0,
          projects: [],
        };
      cur.totalTasksCompleted += a.tasksCompleted;
      cur.weightedSuccessRateNumerator += a.successRate * a.tasksCompleted;
      if (Number.isFinite(a.avgDurationSeconds)) {
        cur.durationSum += a.avgDurationSeconds;
        cur.durationCount += 1;
      }
      cur.projects.push({ name, tasksCompleted: a.tasksCompleted });
      acc.set(a.agent, cur);
    }
  }

  return Array.from(acc.entries())
    .map(([agent, v]) => ({
      agent,
      totalTasksCompleted: v.totalTasksCompleted,
      weightedSuccessRate:
        v.totalTasksCompleted === 0 ? 0 : v.weightedSuccessRateNumerator / v.totalTasksCompleted,
      avgDurationSeconds: v.durationCount === 0 ? 0 : v.durationSum / v.durationCount,
      projects: v.projects.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
}
