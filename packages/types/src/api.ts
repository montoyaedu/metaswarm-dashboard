// API response shapes (per plan §2.3). Populated fully in WU-3/WU-4 — for now
// this skeleton is enough to prove the workspace dep + exports map are healthy
// (see WU-1 sanity tests).

export interface ProjectSummary {
  name: string;
  activeTasks: number;
  blockedTasks: number;
  prsMergedLast7d: number | null;
  lastActivityAt: string | null;
  hasMetrics: boolean;
}

export type GetProjectsResponse = ProjectSummary[];

export interface ApiError {
  error: { code: string; message: string; hint?: string };
}
