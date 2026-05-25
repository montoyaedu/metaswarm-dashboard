// The server-side write guard (design §3.3, sessions-spike WU v4-6).
//
// An `onRequest` hook — running BEFORE routing — that rejects every write on
// `/api/*` with `405`, the load-bearing enforcement of the read-only stance.
// v4 re-scopes it from "block ALL non-GET" to "block all non-GET **except an
// explicit allow-list**". The allow-list has two entries:
//
//   1. PUT /api/sessions/:project/:sessionId/rating  (EXACT path match)
//   2. Any method on /api/virtual-factory/*           (prefix match)
//
// `GET` and `HEAD` continue to pass through unconditionally. The `PUT`
// allowance is an EXACT path match (`req.url` compared whole) so a trailing
// slash, a query string, extra path segments, or a case variant all FAIL the
// match and still 405 — the match must not re-open the write surface
// (design §3.3 `[gate-r3: SEC suggestion]`, plan R2). The virtual-factory
// prefix match is prefix-based so the full control-plane surface is open.
// Every other method/route still 405s.

import type { FastifyInstance } from 'fastify';

/**
 * Exact-match allow-list pattern for the one write route. Anchored start to
 * end, so the FULL `req.url` must equal `/api/sessions/<seg>/<seg>/rating`:
 *
 *   - `^…$` anchors reject extra leading/trailing characters;
 *   - each segment is the `[A-Za-z0-9._-]+` allow-list (no `/`, so extra
 *     path segments cannot smuggle in);
 *   - a trailing slash (`/rating/`) leaves a character past `$` → no match;
 *   - a query string (`/rating?x=1`) leaves `?x=1` past `$` → no match;
 *   - case variants (e.g. `/Rating`) do not match the literal `rating`.
 *
 * `req.url` carries the query string in Fastify, so testing it whole is what
 * makes `?x=1` fail closed.
 */
const RATING_WRITE_PATH = /^\/api\/sessions\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/rating$/;

/**
 * True iff `(method, url)` is an allow-listed write request:
 *   - `PUT` with a `req.url` that EXACTLY matches the rating-write path; or
 *   - any method whose url starts with `/api/virtual-factory/`.
 */
function isAllowedWrite(method: string, url: string): boolean {
  if (method === 'PUT' && RATING_WRITE_PATH.test(url)) return true;
  if (url.startsWith('/api/virtual-factory/')) return true;
  return false;
}

export function registerMethodGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (req, reply, done) => {
    const isApi = req.url.startsWith('/api/');
    const isRead = req.method === 'GET' || req.method === 'HEAD';
    if (isApi && !isRead && !isAllowedWrite(req.method, req.url)) {
      void reply
        .code(405)
        .header('Allow', 'GET')
        .send({
          error: {
            code: 'method_not_allowed',
            message: `Method ${req.method} is not allowed on ${req.url}. The dashboard is read-only.`,
          },
        });
      return;
    }
    done();
  });
}
