// Typed GET-only read client for the v4-5 session endpoints (design §7).
// Mirrors `api/client.ts` but for the sessions/calibration surface. The PUT
// rating writer is added in WU v4-8 — this file stays read-only.

import type { CalibrationSummary, SessionRating } from '@metaswarm-dashboard/types/ratings';
import type {
  ProcessRubricScore,
  SessionSummary,
  SessionTimeline,
} from '@metaswarm-dashboard/types/sessions';

/** Thrown for any non-2xx response — views render `.message` + offer Retry. */
export class RatingsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'RatingsApiError';
  }
}

/** The detail endpoint's response: timeline + rubric + (maybe) a rating. */
export interface SessionDetail {
  timeline: SessionTimeline;
  rubric: ProcessRubricScore;
  rating: SessionRating | null;
}

/** Server envelope shapes (design §7) — unwrapped before returning. */
interface SessionsEnvelope {
  sessions: SessionSummary[];
}
interface CalibrationEnvelope {
  summary: CalibrationSummary;
}

async function getJson<T>(path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new RatingsApiError(`GET ${path} → ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export interface RatingsApi {
  /** `GET /api/sessions[?project=…]` → the `SessionSummary[]`. */
  getSessions(project?: string): Promise<SessionSummary[]>;
  /** `GET /api/sessions/:project/:sessionId` → `{ timeline, rubric, rating }`. */
  getSession(project: string, sessionId: string): Promise<SessionDetail>;
  /** `GET /api/calibration` → the derived `CalibrationSummary`. */
  getCalibration(): Promise<CalibrationSummary>;
}

export function createRatingsApi(
  baseUrl = '',
  fetchImpl: typeof fetch = fetch,
): RatingsApi {
  return {
    getSessions: async (project) => {
      const query =
        project === undefined ? '' : `?project=${encodeURIComponent(project)}`;
      const envelope = await getJson<SessionsEnvelope>(
        `${baseUrl}/api/sessions${query}`,
        fetchImpl,
      );
      return envelope.sessions;
    },
    getSession: (project, sessionId) =>
      getJson<SessionDetail>(
        `${baseUrl}/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}`,
        fetchImpl,
      ),
    getCalibration: async () => {
      const envelope = await getJson<CalibrationEnvelope>(
        `${baseUrl}/api/calibration`,
        fetchImpl,
      );
      return envelope.summary;
    },
  };
}
