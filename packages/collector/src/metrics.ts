// Pure metric computation: BEADS rows → AgentMetrics / SwarmMetrics +
// UTC daily key + ISO-8601 week-year/week (per plan §2.2 / WU-3 metrics).

import type { AgentMetrics, SwarmMetrics } from '@metaswarm-dashboard/types/snapshots';

/** Minimal shape we need from a BEADS task row to compute metrics. */
export interface BeadsTaskRow {
  id: string;
  status: 'open' | 'in_progress' | 'blocked' | 'closed' | 'deferred';
  assignee?: string | null;
  agent?: string | null;
  /** ISO-8601 timestamp; UTC. */
  closed_at?: string | null;
  /** ISO-8601 timestamp; UTC. */
  updated_at?: string | null;
  /** Seconds between assignment and closure, when known. */
  duration_seconds?: number | null;
  /** Whether the task ended in a success terminal state. */
  succeeded?: boolean | null;
}

const UNKNOWN_AGENT = 'unknown';

/**
 * Return the UTC daily key (`YYYY-MM-DD`) for the given instant.
 *
 * Always UTC (per plan §2.2 — "eliminates DST-induced double-day or
 * skipped-day bugs").
 */
export function utcDayKey(at: Date): string {
  const yyyy = at.getUTCFullYear().toString().padStart(4, '0');
  const mm = (at.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = at.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Return the ISO-8601 `YYYY-Www` week-key for the given instant. Per ISO,
 * weeks start on Monday and week 1 is the week containing the year's first
 * Thursday.
 */
export function isoWeekKey(at: Date): string {
  // Algorithm: shift to the nearest Thursday of the week, then count weeks
  // since the Thursday of week 1. This is the canonical ISO-8601 algorithm.
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to Thursday of this week
  const weekYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil(
    (Math.round((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7,
  );
  return `${weekYear.toString().padStart(4, '0')}-W${weekNumber.toString().padStart(2, '0')}`;
}

/** True when `at` is a Monday in UTC. */
export function isUtcMonday(at: Date): boolean {
  return at.getUTCDay() === 1;
}

/** Returns the ISO-8601 week-key for the prior ISO week relative to `at`. */
export function previousIsoWeekKey(at: Date): string {
  const sevenDaysBefore = new Date(at.getTime() - 7 * 86_400_000);
  return isoWeekKey(sevenDaysBefore);
}

/** True when the row was closed within the 7 days ending at `at` (inclusive). */
function closedWithinLast7d(row: BeadsTaskRow, at: Date): boolean {
  if (!row.closed_at) return false;
  const closed = new Date(row.closed_at);
  const sevenDaysAgo = new Date(at.getTime() - 7 * 86_400_000);
  return closed.getTime() >= sevenDaysAgo.getTime() && closed.getTime() <= at.getTime();
}

/**
 * Roll up rows into per-agent + total metrics, anchored at `at` (UTC).
 *
 * This is the only place metric semantics live. Reader-side aggregation
 * (server) reads precomputed snapshots and never recomputes.
 */
export function computeMetrics(
  rows: BeadsTaskRow[],
  at: Date,
): { agents: AgentMetrics[]; totals: SwarmMetrics } {
  const perAgent = new Map<
    string,
    { completed: number; succeeded: number; durationSecondsSum: number; durationCount: number }
  >();

  let activeOpen = 0;
  let blocked = 0;
  let completedLast7d = 0;
  let lastActivityMs = -Infinity;

  for (const row of rows) {
    if (row.status === 'open' || row.status === 'in_progress') activeOpen += 1;
    if (row.status === 'blocked') blocked += 1;

    const updatedRaw = row.closed_at ?? row.updated_at;
    if (updatedRaw) {
      const t = new Date(updatedRaw).getTime();
      if (Number.isFinite(t) && t > lastActivityMs) lastActivityMs = t;
    }

    if (row.status === 'closed' && closedWithinLast7d(row, at)) {
      completedLast7d += 1;

      const agent = (row.agent ?? row.assignee ?? UNKNOWN_AGENT).trim() || UNKNOWN_AGENT;
      const acc =
        perAgent.get(agent) ??
        { completed: 0, succeeded: 0, durationSecondsSum: 0, durationCount: 0 };
      acc.completed += 1;
      if (row.succeeded === true) acc.succeeded += 1;
      if (typeof row.duration_seconds === 'number' && Number.isFinite(row.duration_seconds)) {
        acc.durationSecondsSum += row.duration_seconds;
        acc.durationCount += 1;
      }
      perAgent.set(agent, acc);
    }
  }

  const agents: AgentMetrics[] = Array.from(perAgent.entries())
    .map(([agent, acc]) => ({
      agent,
      tasksCompleted: acc.completed,
      successRate: acc.completed === 0 ? 0 : acc.succeeded / acc.completed,
      avgDurationSeconds:
        acc.durationCount === 0 ? 0 : acc.durationSecondsSum / acc.durationCount,
    }))
    .sort((a, b) => a.agent.localeCompare(b.agent));

  const totals: SwarmMetrics = {
    totalActiveTasks: activeOpen,
    totalBlockedTasks: blocked,
    totalCompletedTasksLast7d: completedLast7d,
    lastActivityAt:
      lastActivityMs === -Infinity ? null : new Date(lastActivityMs).toISOString(),
  };

  return { agents, totals };
}
