// Serves the built SPA from a configurable static root, with a not-found
// handler that returns index.html for non-/api, non-asset GETs (per WU-4.13-14).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export interface SpaPluginOptions {
  staticRoot: string;
}

export async function registerSpa(
  app: FastifyInstance,
  opts: SpaPluginOptions,
): Promise<void> {
  await app.register(fastifyStatic, {
    root: opts.staticRoot,
    prefix: '/',
    wildcard: false,
    decorateReply: true,
  });

  // SPA fallback: any GET that didn't match /api/* or a static asset → index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      void reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    if (req.url.startsWith('/api/')) {
      void reply
        .code(404)
        .send({ error: { code: 'not_found', message: `Unknown route ${req.url}` } });
      return;
    }
    const indexPath = join(opts.staticRoot, 'index.html');
    if (!existsSync(indexPath)) {
      void reply
        .code(500)
        .send({ error: { code: 'spa_missing', message: 'index.html not found in staticRoot' } });
      return;
    }
    void reply
      .code(200)
      .type('text/html; charset=utf-8')
      .send(readFileSync(indexPath, 'utf8'));
  });
}
