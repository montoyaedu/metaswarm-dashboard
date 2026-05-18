// The one write endpoint (sessions-spike WU v4-6, design §7 / §8.1):
//   PUT /api/sessions/:project/:sessionId/rating
//
// Request body — `{ verdicts: OperatorVerdict[], overallNote?: string }` ONLY.
// The server NEVER trusts a client-supplied rubric: it re-derives
// `rubricAtRating` from the live transcript (parse + score), and sets
// `ratedAt`, `sessionId`, `projectName`, `schemaVersion` itself. `200` returns
// the persisted `SessionRating` so the SPA can refresh agreement without a
// refetch (design §7 `[gate-r1: DES-S]`).
//
// §8.1 request contract (CSRF defenses for a no-auth localhost PUT):
//   - `Content-Type: application/json` is required          → else `415`
//   - same-origin, FAIL-CLOSED — `Sec-Fetch-Site: same-origin`, OR (if that
//     header is absent) an `Origin` exactly matching the server's own
//     loopback origin; a request with NEITHER header is rejected → else `403`
//   - a 64 KB body cap (`bodyLimit`)                          → over → `413`
//   - no `@fastify/cors` is registered (the default no-CORS posture stands).
//
// The §8.1 checks run in an `onRequest` route hook — BEFORE body parsing — so
// a cross-origin or wrong-content-type request is rejected without the body
// ever being read.

import { OperatorVerdict, type SessionRating } from '@metaswarm-dashboard/types/ratings';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { type WriteRatingRouteDeps } from './sessions-deps.js';

/** Allow-list for a project name / session id (design §8.2). */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The 64 KB body cap for the write route (design §8.1). */
const RATING_BODY_LIMIT = 64 * 1024;

/**
 * The request body schema — `{ verdicts, overallNote? }` ONLY. This is a
 * PARTIAL of `SessionRating`: the client supplies the operator's judgement;
 * the server derives everything else (`schemaVersion`, ids, `ratedAt`,
 * `rubricAtRating`). A client-sent `rubricAtRating` (or any other extra key)
 * is ignored — `z.object` strips unknown keys by default.
 */
const RatingWriteBody = z.object({
  verdicts: z
    .array(OperatorVerdict)
    .max(9)
    .refine((vs) => new Set(vs.map((v) => v.key)).size === vs.length, {
      message: 'duplicate RubricKey in verdicts',
    }),
  overallNote: z.string().max(2000).optional(),
});

/**
 * True if `value` is a safe path-ish identifier: matches the allow-list and
 * carries no `..` traversal sequence.
 */
function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && !value.includes('..');
}

/** Send an error with a stable envelope. */
function sendError(
  reply: FastifyReply,
  code: number,
  errorCode: string,
  message: string,
): void {
  void reply
    .code(code)
    .type('application/json')
    .send({ error: { code: errorCode, message } });
}

/**
 * Decide whether a write request satisfies the §8.1 same-origin contract.
 *
 * FAIL-CLOSED: the request is allowed ONLY when
 *   - `Sec-Fetch-Site` is present AND equals `same-origin`; OR
 *   - `Sec-Fetch-Site` is absent AND `Origin` is present and exactly equals
 *     a loopback origin for the server's own port.
 * A request carrying NEITHER header is rejected (design §8.1 `[gate-r2]`).
 */
function isSameOrigin(req: FastifyRequest): boolean {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string') {
    // `Sec-Fetch-Site` present → it is the sole authority (a cross-site
    // value like `cross-site`/`same-site`/`none` fails closed).
    return secFetchSite === 'same-origin';
  }
  // `Sec-Fetch-Site` absent → fall back to an exact `Origin` match against
  // the server's own loopback origin. `req.headers.host` is the authority
  // the request was actually sent to (host + port); a same-origin `Origin`
  // is exactly `http://<host>`. Both loopback spellings are accepted.
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') {
    // Neither header → reject (fail-closed).
    return false;
  }
  return origin === `http://${host}`;
}

export function registerRatingWriteRoute(
  app: FastifyInstance,
  deps: WriteRatingRouteDeps,
): void {
  app.put<{ Params: { project: string; sessionId: string } }>(
    '/api/sessions/:project/:sessionId/rating',
    {
      // A 64 KB cap — a `SessionRating` body is well under this; an over-cap
      // body is rejected by Fastify with `413` before the handler runs.
      bodyLimit: RATING_BODY_LIMIT,
      // §8.1 checks run BEFORE body parsing so a bad request never has its
      // body read.
      onRequest: (req, reply, done) => {
        // (a) Content-Type MUST be application/json.
        const contentType = req.headers['content-type'];
        if (
          typeof contentType !== 'string' ||
          !contentType.toLowerCase().startsWith('application/json')
        ) {
          sendError(
            reply,
            415,
            'unsupported_media_type',
            'Content-Type must be application/json.',
          );
          return;
        }
        // (b) Same-origin, fail-closed.
        if (!isSameOrigin(req)) {
          sendError(
            reply,
            403,
            'forbidden',
            'Cross-origin request rejected. The rating API is same-origin only.',
          );
          return;
        }
        done();
      },
    },
    async (req, reply) => {
      const { project, sessionId } = req.params;

      // 1. Sanitize the attacker-influenceable path params (design §8.2).
      if (!isSafeSegment(project)) {
        sendError(
          reply,
          400,
          'bad_request',
          `invalid project segment ${JSON.stringify(project)}`,
        );
        return;
      }
      if (!isSafeSegment(sessionId)) {
        sendError(
          reply,
          400,
          'bad_request',
          `invalid sessionId segment ${JSON.stringify(sessionId)}`,
        );
        return;
      }

      // 2. Validate the request body — `{ verdicts, overallNote? }` ONLY.
      //    Any client-sent `rubricAtRating` is stripped here and re-derived
      //    below — the client can never inject the persisted rubric (§8.3).
      const parsedBody = RatingWriteBody.safeParse(req.body);
      if (!parsedBody.success) {
        sendError(
          reply,
          400,
          'bad_request',
          `invalid rating body: ${parsedBody.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        );
        return;
      }
      const { verdicts, overallNote } = parsedBody.data;

      // 3. Resolve the session via live discovery — a 404 if it does not
      //    exist (the same posture as the GET detail endpoint).
      const refs = deps.discoverSessions(deps.config, deps.transcriptsDir);
      const ref = refs.find(
        (r) => r.projectName === project && r.sessionId === sessionId,
      );
      if (ref === undefined) {
        sendError(
          reply,
          404,
          'session_not_found',
          `no session ${sessionId} for project ${project}`,
        );
        return;
      }

      // 4. Re-derive `rubricAtRating` SERVER-SIDE from the live transcript
      //    (parse + score via the mtime/size cache). The client body is
      //    never trusted for the rubric (design §4 / §8.3).
      const { rubric } = deps.cache.get(ref.transcriptPath);

      // 5. Assemble the full `SessionRating`. `ratedAt` is the server clock.
      const rating: SessionRating = {
        schemaVersion: 1,
        sessionId,
        projectName: project,
        verdicts,
        ...(overallNote !== undefined ? { overallNote } : {}),
        ratedAt: deps.now().toISOString(),
        rubricAtRating: rubric,
      };

      // 6. Advisory footgun check, then persist atomically (upsert).
      deps.warnIfDataDirInGit(deps.dataDir);
      deps.writeSessionRating(rating, deps.dataDir);

      // 7. Return the persisted rating so the SPA refreshes without refetch.
      void reply.code(200).type('application/json').send(rating);
    },
  );
}
