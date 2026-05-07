// API response shapes (per plan §2.3). One source of truth — server writes
// these, web consumes them.

/** Status of the most recent `collect` run for this project. */
export type CollectionStatus = 'ok' | 'degraded' | 'failed';

/**
 * Whether the project is metaswarm-managed (has `.beads/`) or just a
 * vanilla git repo we surfaced for visibility. `git-only` projects are
 * rendered with a "not yet managed" badge and zero metrics — they're
 * placeholders that nudge the operator to either onboard them to
 * metaswarm or remove them from `config.yaml`.
 */
export type ProjectCategory = 'metaswarm' | 'git-only';

export interface ProjectSummary {
  name: string;
  /** Absolute filesystem path of the project root. Used for grouping by parent dir. */
  path: string;
  category: ProjectCategory;
  activeTasks: number;
  blockedTasks: number;
  prsMergedLast7d: number | null; // ALWAYS null in MVP (plan §2.6)
  lastActivityAt: string | null; // ISO-8601 UTC
  hasMetrics: boolean;
  /**
   * Status of the most recent collection. `ok` means no warnings were
   * raised. `degraded` means the collector got SOME data but logged
   * warnings. `failed` means the project was skipped entirely.
   *
   * For `git-only` projects, status is always `ok` and warnings is empty
   * — the placeholder card is the operator-facing signal, not a warning.
   */
  collectionStatus: CollectionStatus;
  /** Operator-readable warnings from the most recent collection. */
  collectionWarnings: string[];
}

export type GetProjectsResponse = ProjectSummary[];

export interface AgentBreakdown {
  agent: string;
  tasksCompleted: number;
  successRate: number; // 0..1
  avgDurationSeconds: number;
}

export interface RecentWorkUnit {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'blocked' | 'closed';
  agent: string | null;
  closedAt: string | null;
}

export interface ThroughputPoint {
  date: string; // YYYY-MM-DD UTC
  closed: number;
}

export interface ProjectDetail {
  name: string;
  agents: AgentBreakdown[];
  /** Always exactly 14 entries; missing days filled with closed: 0. */
  throughput: ThroughputPoint[];
  /** Newest first, max 25. */
  recentWorkUnits: RecentWorkUnit[];
  lastActivityAt: string | null;
}

export type GetProjectByNameResponse = ProjectDetail;

export interface AgentAggregate {
  agent: string;
  totalTasksCompleted: number;
  weightedSuccessRate: number;
  avgDurationSeconds: number;
  projects: { name: string; tasksCompleted: number }[];
}

export type GetAgentsResponse = AgentAggregate[];

export interface ApiError {
  error: { code: string; message: string; hint?: string };
}
