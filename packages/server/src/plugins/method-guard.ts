// Rejects non-GET methods on /api/* with 405 + Allow: GET (per WU-4.11).

import type { FastifyInstance } from 'fastify';

export function registerMethodGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (req, reply, done) => {
    if (req.url.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD') {
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
