import { ApiClientError } from './client.js';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    let serverMsg: string | undefined;
    try {
      const errorBody: unknown = await res.json();
      if (typeof errorBody === 'object' && errorBody !== null) {
        const err = (errorBody as Record<string, unknown>).error;
        if (typeof err === 'object' && err !== null) {
          serverMsg = (err as Record<string, unknown>).message as string | undefined;
        }
      }
    } catch {
      // ignore parse failures
    }
    throw new ApiClientError(
      serverMsg ?? `${method} ${path} → ${res.status}`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TaskSummary {
  id: string;
  status: string;
  phase: string;
  currentWuIndex: number;
  attempt: number;
  goal?: string;
  workUnits: { id: string; title: string }[];
}

export interface WorkUnitDetail {
  id: string;
  title: string;
  spec: string;
  checkpoint: boolean;
}

export interface WuPhase {
  phase: string;
  provider?: string;
  duration?: number;
  filesChanged?: string[];
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentPrompt?: string;
  agentResponse?: string;
}

export interface PlanReviewer {
  id: string;
  approved: boolean;
  findings: string[];
  provider?: string;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentResponse?: string;
}

export interface WuResult {
  id: string;
  committed: boolean;
  implementAttempts: number;
  errors?: string[];
  reviewPassed?: boolean;
  phases?: WuPhase[];
}

export interface Checkpoint {
  wuId: string;
  phase: string;
  reason: string;
  prompt: string;
}

export interface TaskEvent {
  type: string;
  phase?: string;
  ts: string;
  verdict?: string;
  message?: string;
  wuId?: string;
  reviewer?: string;
  approved?: boolean;
  findings?: string[];
  provider?: string;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenTotal?: number;
  agentPrompt?: string;
  agentResponse?: string;
  wu?: string;
  filesChanged?: string[];
  commitHash?: string;
  message?: string;
  author?: string;
  insertions?: number;
  deletions?: number;
  output?: string;
  phases?: WuPhase[];
  planReview?: PlanReviewer[];
  directory?: string;
  branch?: string;
  fromRemote?: boolean;
}

export interface TaskDetail {
  id: string;
  status: string;
  phase: string;
  currentWuIndex: number;
  attempt: number;
  workUnits: WorkUnitDetail[];
  wuResults: WuResult[];
  checkpoint: Checkpoint | null;
  events: TaskEvent[];
}

export interface CheckpointSummary {
  taskId: string;
  wuId: string;
  phase: string;
  reason: string;
  prompt: string;
}

export interface WorkUnitInput {
  title: string;
  spec: string;
  checkpoint?: boolean;
}

export interface VirtualFactoryApiClient {
  listTasks(status?: string): Promise<TaskSummary[]>;
  getTask(id: string): Promise<TaskDetail>;
  createTask(goal: string, workUnits?: WorkUnitInput[], tags?: string[], workingDir?: string, gitRemote?: string): Promise<{ id: string }>;
  cancelTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listCheckpoints(): Promise<CheckpointSummary[]>;
  approveCheckpoint(taskId: string, action: 'approve' | 'reject', comment?: string): Promise<void>;
  getHealth(): Promise<{ status: string }>;
}

export function createVirtualFactoryClient(): VirtualFactoryApiClient {
  const base = '/api/virtual-factory';
  return {
    listTasks: (status?: string) => {
      const qs = status !== undefined ? `?status=${encodeURIComponent(status)}` : '';
      return request<TaskSummary[]>('GET', `${base}/tasks${qs}`);
    },
    getTask: (id: string) => request<TaskDetail>('GET', `${base}/tasks/${encodeURIComponent(id)}`),
    createTask: (goal, workUnits, tags, workingDir, gitRemote) =>
      request<{ id: string }>('POST', `${base}/tasks`, { goal, workUnits, tags, workingDir, gitRemote }),
    cancelTask: (id) =>
      request<void>('POST', `${base}/tasks/${encodeURIComponent(id)}/cancel`),
    deleteTask: (id) =>
      request<void>('DELETE', `${base}/tasks/${encodeURIComponent(id)}`),
    listCheckpoints: () => request<CheckpointSummary[]>('GET', `${base}/checkpoints`),
    approveCheckpoint: (taskId, action, comment) =>
      request<void>('POST', `${base}/checkpoints/${encodeURIComponent(taskId)}/approve`, {
        action,
        ...(comment !== undefined ? { comment } : {}),
      }),
    getHealth: () => request<{ status: string }>('GET', `${base}/health`),
  };
}
