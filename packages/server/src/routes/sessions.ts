// The two session read endpoints (sessions-spike WU v4-5, design §7 / §8.2):
//   - GET /api/sessions[?project=]      → { sessions: SessionSummary[] }
//   - GET /api/sessions/:project/:id    → { timeline, rubric, rating }
//
// Discovery is a LIVE scan each request (`discoverSessions`); parse + score
// results flow through the mtime/size cache so an unchanged transcript is
// not re-parsed. `:project` / `:sessionId` (and `?project`) go through the
// design §8.2 allow-list + `..`-rejection BEFORE any filesystem access — a
// malformed value is `400`, a genuine miss is `404`.

import type { SessionSummary } from '@metaswarm-dashboard/types/sessions';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { type SessionsRouteDeps } from './sessions-deps.js';

/** Allow-list for a project name / session id (design §8.2). */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * True if `value` is a safe path-ish identifier: it matches the allow-list
 * and carries no `..` traversal sequence.
 */
function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && !value.includes('..');
}

/** Send a `400 bad_request` with a stable error envelope. */
function badRequest(reply: FastifyReply, message: string): void {
  void reply
    .code(400)
    .type('application/json')
    .send({ error: { code: 'bad_request', message } });
}

/** Send a `404 session_not_found` with a stable error envelope. */
function notFound(reply: FastifyReply, message: string): void {
  void reply
    .code(404)
    .type('application/json')
    .send({ error: { code: 'session_not_found', message } });
}

export function registerSessionsRoutes(
  app: FastifyInstance,
  deps: SessionsRouteDeps,
): void {
  // GET /api/sessions[?project=<name>]
  app.get<{ Querystring: { project?: string } }>(
    '/api/sessions',
    async (req, reply) => {
      const project = req.query.project;
      if (project !== undefined && !isSafeSegment(project)) {
        badRequest(reply, `invalid project query parameter ${JSON.stringify(project)}`);
        return;
      }

      const refs = deps.discoverSessions(deps.config, deps.transcriptsDir);
      const sessions: SessionSummary[] = [];
      for (const ref of refs) {
        if (project !== undefined && ref.projectName !== project) {
          continue;
        }
        const { timeline } = deps.cache.get(ref.transcriptPath);
        const rating = deps.readSessionRating(
          deps.dataDir,
          ref.projectName,
          ref.sessionId,
        );
        sessions.push({
          projectName: ref.projectName,
          sessionId: ref.sessionId,
          startedAt: timeline.startedAt,
          lastEventAt: timeline.lastEventAt,
          eventCount: timeline.eventCount,
          rated: rating !== null,
        });
      }
      void reply.code(200).type('application/json').send({ sessions });
    },
  );

  // GET /api/sessions/:project/:sessionId
  app.get<{ Params: { project: string; sessionId: string } }>(
    '/api/sessions/:project/:sessionId',
    async (req, reply) => {
      const { project, sessionId } = req.params;
      if (!isSafeSegment(project)) {
        badRequest(reply, `invalid project segment ${JSON.stringify(project)}`);
        return;
      }
      if (!isSafeSegment(sessionId)) {
        badRequest(reply, `invalid sessionId segment ${JSON.stringify(sessionId)}`);
        return;
      }

      const refs = deps.discoverSessions(deps.config, deps.transcriptsDir);
      const ref = refs.find(
        (r) => r.projectName === project && r.sessionId === sessionId,
      );
      if (ref === undefined) {
        notFound(reply, `no session ${sessionId} for project ${project}`);
        return;
      }

      const { timeline, rubric } = deps.cache.get(ref.transcriptPath);
      const rating = deps.readSessionRating(deps.dataDir, project, sessionId);
      void reply
        .code(200)
        .type('application/json')
        .send({ timeline, rubric, rating });
    },
  );
}
