// Typed fetch wrapper using @metaswarm-dashboard/types/api shapes.

import type {
  GetAgentsResponse,
  ProjectDetail,
  ProjectSummary,
} from '@metaswarm-dashboard/types/api';
import type { ProjectCostSummary } from '@metaswarm-dashboard/types/cost';

/**
 * A `ProjectSummary` widened with the v5-7 cost fields the server adds to
 * `GET /api/projects` rows (design §7 / §8.2). Additive — these mirror the
 * server-side `ProjectSummaryWithCost`; the v5-7 server always populates
 * them, but they are declared optional so a v4-shaped fixture (and the v4
 * `ProjectSummary` consumers) still type-check, exactly as v5-9 declared
 * `cost?` / `pricingAsOf?` on `SessionDetail`.
 */
export interface ProjectSummaryWithCost extends ProjectSummary {
  /** The project's total AI cost in USD (sum of priced contributions). */
  totalCostUsd?: number;
  /** `true` when a contributing model was unpriced — `totalCostUsd` is then a lower bound. */
  hasUnpriced?: boolean;
  /** The pinned pricing table's `pricingAsOf` (`YYYY-MM-DD`). */
  pricingAsOf?: string;
}

/**
 * A `ProjectDetail` widened with the v5-7 cost summary the server adds to
 * `GET /api/projects/:name` (design §7 / §8.2). Additive — mirrors the
 * server-side `ProjectDetailWithCost`.
 */
export interface ProjectDetailWithCost extends ProjectDetail {
  /** The project's full per-vendor cost roll-up. */
  cost?: ProjectCostSummary;
  /** The pinned pricing table's `pricingAsOf` (`YYYY-MM-DD`). */
  pricingAsOf?: string;
}

/** The cost-widened `GET /api/projects` response — a bare array of rows. */
export type GetProjectsResponse = ProjectSummaryWithCost[];

/** The cost-widened `GET /api/projects/:name` response. */
export type GetProjectByNameResponse = ProjectDetailWithCost;

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
