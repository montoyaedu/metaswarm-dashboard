// Snapshot Zod schemas (per plan §2.3, WU-3.1).
//
// One source of truth: collector imports these to write, server imports them
// to read. Drift across the writer/reader boundary is impossible by
// construction.

import { z } from 'zod';

/** Per-agent rollup of a project's BEADS state at a given UTC instant. */
export const AgentMetrics = z.object({
  agent: z.string(),
  tasksCompleted: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgDurationSeconds: z.number().nonnegative(),
});
export type AgentMetrics = z.infer<typeof AgentMetrics>;

/** Project-wide rollup at a given UTC instant. */
export const SwarmMetrics = z.object({
  totalActiveTasks: z.number().int().nonnegative(),
  totalBlockedTasks: z.number().int().nonnegative(),
  totalCompletedTasksLast7d: z.number().int().nonnegative(),
  lastActivityAt: z.string().datetime({ offset: false }).nullable(),
});
export type SwarmMetrics = z.infer<typeof SwarmMetrics>;

/**
 * A daily snapshot of a single project. The collector writes one of these
 * per project per UTC day to `<data-dir>/projects/<name>/daily/YYYY-MM-DD.json`.
 *
 * `prsMergedLast7d` is hard-coded `null` in the MVP (see plan §2.6 — the
 * operator opted out of `gh` integration; the metric is left to a follow-up
 * issue once a viable data source is decided).
 */
export const DailySnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  /** UTC ISO-8601 instant the snapshot was generated. */
  generatedAt: z.string().datetime({ offset: false }),
  /** UTC daily key in `YYYY-MM-DD` format. */
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  agents: z.array(AgentMetrics),
  totals: SwarmMetrics,
  prsMergedLast7d: z.literal(null),
});
export type DailySnapshot = z.infer<typeof DailySnapshot>;

/**
 * A weekly snapshot. Written only on Monday-UTC runs for the prior ISO week
 * (see plan §2.2). `complete: false` when the prior week had no daily
 * snapshots (the row is still emitted; consumers know it's a "we have nothing
 * to say" placeholder, not a missing file).
 */
export const WeeklySnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  generatedAt: z.string().datetime({ offset: false }),
  /** ISO-8601 week-date in `YYYY-Www` format (e.g. `2026-W19`). */
  isoWeek: z.string().regex(/^\d{4}-W\d{2}$/),
  agents: z.array(AgentMetrics),
  totals: SwarmMetrics,
  prsMergedLast7d: z.literal(null),
  /** False when the prior week had no daily snapshots. */
  complete: z.boolean(),
});
export type WeeklySnapshot = z.infer<typeof WeeklySnapshot>;

// ---------------------------------------------------------------------------
// Marker — kept around for the WU-1 sanity tests; tiny and future-proof.
// ---------------------------------------------------------------------------

export const Marker = z.object({
  schemaVersion: z.literal(1),
});
export type MarkerType = z.infer<typeof Marker>;
