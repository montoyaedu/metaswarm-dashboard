// API response shapes (per plan §2.3). One source of truth — server writes
// these, web consumes them.

export interface ProjectSummary {
  name: string;
  activeTasks: number;
  blockedTasks: number;
  prsMergedLast7d: number | null; // ALWAYS null in MVP (plan §2.6)
  lastActivityAt: string | null; // ISO-8601 UTC
  hasMetrics: boolean;
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
