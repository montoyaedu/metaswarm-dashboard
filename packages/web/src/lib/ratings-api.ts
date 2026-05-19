// Typed read client for the v4-5 session endpoints + the v4-6 write endpoint
// (design §7). Mirrors `api/client.ts` but for the sessions/calibration
// surface.
//
// WRITE GUARD: this is the ONE file in `packages/web/src` sanctioned to use a
// write-method literal. The eslint `no-restricted-syntax` rule (design §3.4)
// bans `'POST'`/`'PUT'`/`'DELETE'`/`'PATCH'` literals everywhere else in the
// SPA; this module is the rule's single `ignores` entry. Keeping the write
// path in exactly one typed module is the SPA-side defense-in-depth.

import type { SessionCost } from '@metaswarm-dashboard/types/cost';
import type {
  CalibrationSummary,
  OperatorVerdict,
  SessionRating,
} from '@metaswarm-dashboard/types/ratings';
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

/**
 * The detail endpoint's response: timeline + rubric + (maybe) a rating.
 *
 * v5-7 / v5-9 (design §7, §8.2): the server detail response additionally
 * carries `cost: SessionCost` (the per-model breakdown) and the
 * `pricingAsOf` caveat date. Both are additive — they are declared
 * `.optional()`-style here as `cost?` / `pricingAsOf?` so the v4
 * `SessionDetail` consumers (and v4 test fixtures that construct a detail
 * without cost) still type-check; the v5-7 server always populates them.
 */
export interface SessionDetail {
  timeline: SessionTimeline;
  rubric: ProcessRubricScore;
  rating: SessionRating | null;
  cost?: SessionCost;
  pricingAsOf?: string;
}

/** Server envelope shapes (design §7) — unwrapped before returning. */
interface SessionsEnvelope {
  sessions: SessionSummary[];
}
interface CalibrationEnvelope {
  summary: CalibrationSummary;
}

/** The PUT-rating request body — the server derives everything else (§7). */
export interface PutRatingBody {
  verdicts: OperatorVerdict[];
  overallNote?: string;
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
  /**
   * `PUT /api/sessions/:project/:sessionId/rating` → the persisted
   * `SessionRating`. The body carries only `{ verdicts, overallNote? }`; the
   * server re-derives `rubricAtRating`, `ratedAt`, `sessionId`, `projectName`.
   * A re-rate upserts. Non-2xx → `RatingsApiError`.
   */
  putRating(
    project: string,
    sessionId: string,
    body: PutRatingBody,
  ): Promise<SessionRating>;
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
    putRating: async (project, sessionId, body) => {
      const path = `${baseUrl}/api/sessions/${encodeURIComponent(project)}/${encodeURIComponent(sessionId)}/rating`;
      // The browser adds `Sec-Fetch-Site: same-origin` itself for a
      // same-origin SPA fetch — the server's §8.1 CSRF contract is satisfied.
      const res = await fetchImpl(path, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new RatingsApiError(`PUT ${path} → ${res.status}`, res.status);
      }
      return (await res.json()) as SessionRating;
    },
  };
}
