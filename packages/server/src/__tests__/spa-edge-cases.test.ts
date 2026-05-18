// Coverage gap closure: spa.ts setNotFoundHandler branches.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

let TMP: string;
let DATA_DIR: string;
let STATIC_ROOT: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'spa-edge-'));
  DATA_DIR = join(TMP, 'data');
  STATIC_ROOT = join(TMP, 'spa');
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('SPA fallback edge cases', () => {
  it('non-GET method on a non-/api path returns 404 (not 405, not index.html)', async () => {
    // Set up a usable static root.
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');

    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({ method: 'OPTIONS', url: '/some/path' });
    // OPTIONS isn't /api/* so the method-guard doesn't fire; the
    // setNotFoundHandler returns 404 because the method isn't GET/HEAD.
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('not_found');
    await app.close();
  });

  it('returns 500 when index.html is missing from staticRoot', async () => {
    // STATIC_ROOT exists but contains no index.html (we never created it).
    mkdirSync(STATIC_ROOT, { recursive: true });

    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('spa_missing');
    await app.close();
  });
});

describe('Method guard — v4-6 re-scope (allow-list)', () => {
  // The guard runs `onRequest`, before routing — these assertions exercise
  // it independent of whether a matching route exists.
  it('still 405s a non-allow-listed write on /api/* (HEAD pass-through preserved)', async () => {
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });

    const post = await app.inject({ method: 'POST', url: '/api/projects' });
    expect(post.statusCode).toBe(405);
    expect(post.headers.allow).toBe('GET');

    // HEAD is a read method — the guard must NOT 405 it.
    const head = await app.inject({ method: 'HEAD', url: '/api/projects' });
    expect(head.statusCode).not.toBe(405);
    await app.close();
  });

  it('does NOT 405 the one allow-listed PUT rating route', async () => {
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
    });
    // Past the guard — the route's §8.1 contract takes over (415 here, since
    // no Content-Type was sent). The point is it is NOT a 405.
    expect(res.statusCode).not.toBe(405);
    await app.close();
  });

  it('still 405s a PUT that only resembles the rating route (trailing slash / query / extra segment / case variant)', async () => {
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    for (const url of [
      '/api/sessions/alpha/sess-a1/rating/',
      '/api/sessions/alpha/sess-a1/rating?x=1',
      '/api/sessions/alpha/sess-a1/rating/extra',
      '/api/sessions/alpha/sess-a1/Rating',
    ]) {
      const res = await app.inject({ method: 'PUT', url });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('GET');
    }
    await app.close();
  });

  it('still 405s POST/DELETE/PATCH on the exact rating path (only PUT is allowed)', async () => {
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    for (const method of ['POST', 'DELETE', 'PATCH'] as const) {
      const res = await app.inject({
        method,
        url: '/api/sessions/alpha/sess-a1/rating',
      });
      expect(res.statusCode).toBe(405);
    }
    await app.close();
  });
});
