import type {
  CheckpointSummary,
  DanaConfig,
  HealthResponse,
  TaskDetail,
  TaskEvent,
  TaskSummary,
  WorkUnitInput,
} from './types.js';

export class DanaClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'DanaClientError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

function createRequest(fetchImpl: typeof fetch) {
  return async function request<T>(
    baseUrl: string,
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
      const headers: Record<string, string> = {};
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }
      const res = await fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : null,
        signal: controller.signal,
      });
      if (!res.ok) {
        let errorBody: unknown;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text().catch(() => undefined);
        }
        throw new DanaClientError(
          `${method} ${path} → ${res.status}`,
          res.status,
          errorBody,
        );
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface DanaClient {
  listTasks(status?: string): Promise<TaskSummary[]>;
  getTask(id: string): Promise<TaskDetail>;
  createTask(goal: string, workUnits?: WorkUnitInput[], tags?: string[]): Promise<{ id: string }>;
  cancelTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  listCheckpoints(): Promise<CheckpointSummary[]>;
  approveCheckpoint(taskId: string, action: 'approve' | 'reject', comment?: string): Promise<void>;
  getEvents(taskId: string): Promise<TaskEvent[]>;
  getConfig(): Promise<DanaConfig>;
  getHealth(): Promise<HealthResponse>;
}

export function createDanaClient(
  baseUrl?: string,
  fetchImpl: typeof fetch = fetch,
): DanaClient {
  const url = baseUrl ?? 'http://localhost:4173';
  const request = createRequest(fetchImpl);

  return {
    listTasks: (status?: string) => {
      const qs = status !== undefined ? `?status=${encodeURIComponent(status)}` : '';
      return request<TaskSummary[]>(url, 'GET', `/api/tasks${qs}`);
    },
    getTask: (id: string) => request<TaskDetail>(url, 'GET', `/api/tasks/${encodeURIComponent(id)}`),
    createTask: (goal: string, workUnits?: WorkUnitInput[], tags?: string[]) =>
      request<{ id: string }>(url, 'POST', '/api/tasks', { goal, workUnits, tags }),
    cancelTask: (id: string) =>
      request<void>(url, 'POST', `/api/tasks/${encodeURIComponent(id)}/cancel`),
    deleteTask: (id: string) =>
      request<void>(url, 'DELETE', `/api/tasks/${encodeURIComponent(id)}`),
    listCheckpoints: () => request<CheckpointSummary[]>(url, 'GET', '/api/checkpoints'),
    approveCheckpoint: (taskId: string, action: 'approve' | 'reject', comment?: string) =>
      request<void>(url, 'POST', `/api/checkpoints/${encodeURIComponent(taskId)}/approve`, {
        action,
        ...(comment !== undefined ? { comment } : {}),
      }),
    getEvents: (taskId: string) =>
      request<TaskEvent[]>(url, 'GET', `/api/events/${encodeURIComponent(taskId)}`),
    getConfig: () => request<DanaConfig>(url, 'GET', '/api/config'),
    getHealth: () => request<HealthResponse>(url, 'GET', '/api/health'),
  };
}
