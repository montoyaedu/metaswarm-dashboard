// Typed fetch wrapper using @metaswarm-dashboard/types/api shapes.

import type {
  GetAgentsResponse,
  GetProjectByNameResponse,
  GetProjectsResponse,
} from '@metaswarm-dashboard/types/api';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function getJson<T>(path: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(path, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new ApiClientError(`GET ${path} → ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export interface ApiClient {
  getProjects(): Promise<GetProjectsResponse>;
  getProject(name: string): Promise<GetProjectByNameResponse>;
  getAgents(): Promise<GetAgentsResponse>;
}

export function createApiClient(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  return {
    getProjects: () => getJson<GetProjectsResponse>(`${baseUrl}/api/projects`, fetchImpl),
    getProject: (name) =>
      getJson<GetProjectByNameResponse>(
        `${baseUrl}/api/projects/${encodeURIComponent(name)}`,
        fetchImpl,
      ),
    getAgents: () => getJson<GetAgentsResponse>(`${baseUrl}/api/agents`, fetchImpl),
  };
}
