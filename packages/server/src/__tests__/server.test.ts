// WU-4.{7,8,9,10,11,13,14,15} — Fastify server end-to-end via app.inject().

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildServer } from '../server.js';

const DATA_DIR = resolve(import.meta.dirname, 'fixtures/data-dir');
const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');
const NOW = new Date('2026-05-06T12:00:00Z');

/**
 * Build a server with the v5-7 sessions + cost inputs injected to EMPTY — no
 * config projects, no Codex tree, no ledger. This pins `/api/projects` to the
 * snapshot fixtures alone (the v5-7 §7 namespace join would otherwise merge
 * in the test machine's real config-namespace projects).
 */
async function makeApp() {
  return buildServer({
    dataDir: DATA_DIR,
    staticRoot: STATIC_ROOT,
    now: () => NOW,
    sessions: { config: { projects: [] }, transcriptsDir: DATA_DIR, dataDir: DATA_DIR },
    cost: {
      codexSessionsDir: join(DATA_DIR, 'no-codex'),
      externalToolsLedger: join(DATA_DIR, 'no-ledger.jsonl'),
    },
  });
}

describe('GET /api/projects', () => {
  it('returns 200 + array of summaries', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    const Schema = z.array(
      z.object({
        name: z.string(),
        activeTasks: z.number(),
        blockedTasks: z.number(),
        prsMergedLast7d: z.literal(null),
        lastActivityAt: z.string().nullable(),
        hasMetrics: z.boolean(),
      }),
    );
    expect(Schema.safeParse(body).success).toBe(true);
    expect(body.length).toBe(2); // alpha + beta fixtures
    await app.close();
  });
});

describe('GET /api/projects/:name', () => {
  it('returns 200 + ProjectDetail for alpha', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects/alpha' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('alpha');
    expect(body.throughput).toHaveLength(14);
    expect(body.agents.length).toBeGreaterThan(0);
    await app.close();
  });

  it('returns 404 + ApiError for unknown project', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('project_not_found');
    await app.close();
  });

  it('uses the default now() when buildServer is called without a `now` option', async () => {
    // Covers projects-by-name.ts default-arg branch — `now` is omitted, but
    // the v5-7 sessions + cost inputs are injected EMPTY so the request does
    // not trigger a §7 cost scan of the test machine's real config.
    const app = await buildServer({
      dataDir: DATA_DIR,
      staticRoot: STATIC_ROOT,
      sessions: { config: { projects: [] }, transcriptsDir: DATA_DIR, dataDir: DATA_DIR },
      cost: {
        codexSessionsDir: join(DATA_DIR, 'no-codex'),
        externalToolsLedger: join(DATA_DIR, 'no-ledger.jsonl'),
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/projects/alpha' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.throughput).toHaveLength(14);
    await app.close();
  });
});

describe('GET /api/calibration — default wiring', () => {
  it('returns a valid empty summary when buildServer resolves its own deps', async () => {
    // No `sessions` / `now` injected → server.ts resolves the config + paths
    // from the env and uses its default `now()`. The fixture DATA_DIR has no
    // `sessions/ratings/` tree, so the summary is the empty/no-ratings state.
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({ method: 'GET', url: '/api/calibration' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.ratedSessionCount).toBe(0);
    expect(body.summary.perKpi).toHaveLength(9);
    await app.close();
  });
});

describe('GET /api/agents', () => {
  it('returns 200 + AgentAggregate[] across both fixture projects', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    // alpha has coder + reviewer-cto; beta has coder. Aggregated: 2 unique agents.
    expect(body.map((a: { agent: string }) => a.agent).sort()).toEqual(['coder', 'reviewer-cto']);
    await app.close();
  });
});

describe('Method guard — 405 on non-allow-listed /api/* writes', () => {
  // The v4-6 re-scope: GET + HEAD still pass through; exactly the one
  // `PUT .../rating` route is allow-listed; everything else still 405s.
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
    it(`${method} /api/projects returns 405 with Allow: GET`, async () => {
      const app = await makeApp();
      const res = await app.inject({ method, url: '/api/projects' });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('GET');
      const body = res.json();
      expect(body.error.code).toBe('method_not_allowed');
      await app.close();
    });
  }

  it('HEAD on an /api/* route still passes the guard (not 405)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'HEAD', url: '/api/projects' });
    expect(res.statusCode).not.toBe(405);
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('PUT on the exact rating route is NOT 405 (the allow-listed write)', async () => {
    // The method-guard lets the PUT reach the route; the route then applies
    // its own §8.1 contract. With no §8.1 headers it returns 415 — the point
    // is only that the *method-guard* did not 405 it.
    const app = await makeApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
    });
    expect(res.statusCode).not.toBe(405);
    await app.close();
  });

  for (const method of ['POST', 'DELETE', 'PATCH'] as const) {
    it(`${method} on the rating path is still 405 (only PUT is allow-listed)`, async () => {
      const app = await makeApp();
      const res = await app.inject({
        method,
        url: '/api/sessions/alpha/sess-a1/rating',
      });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('GET');
      await app.close();
    });
  }

  // Virtual-factory allow-list: POST and other methods must NOT 405 on
  // /api/virtual-factory/* paths.
  for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    it(`${method} /api/virtual-factory/tasks passes the guard (allow-listed prefix)`, async () => {
      const app = await makeApp();
      const res = await app.inject({ method, url: '/api/virtual-factory/tasks' });
      // The guard lets it through; the route itself may return 404/502 but
      // the point is it is NOT a 405.
      expect(res.statusCode).not.toBe(405);
      await app.close();
    });
  }

  it('POST /api/virtual-factory/checkpoints/:taskId/approve passes the guard', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/virtual-factory/checkpoints/t1/approve',
    });
    expect(res.statusCode).not.toBe(405);
    await app.close();
  });

  // Virtual-factory write on non-/api-vf path still 405s.
  it('POST /api/virtual-factory-not-real is still 405 (not a prefix match)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/virtual-factory-not-real/x' });
    expect(res.statusCode).toBe(405);
    await app.close();
  });

  // Exact-match rejections — the allow-list must not re-open the surface
  // (design §3.3, plan R2). Each of these is a PUT that LOOKS like the
  // rating route but is not an exact match → still 405.
  for (const { label, url } of [
    { label: 'a trailing slash', url: '/api/sessions/alpha/sess-a1/rating/' },
    { label: 'a query string', url: '/api/sessions/alpha/sess-a1/rating?x=1' },
    { label: 'an extra path segment', url: '/api/sessions/alpha/sess-a1/rating/extra' },
    { label: 'a case variant of the route', url: '/api/sessions/alpha/sess-a1/Rating' },
    { label: 'a missing trailing segment', url: '/api/sessions/alpha/sess-a1' },
    { label: 'an /api/sessions PUT (not a rating)', url: '/api/sessions' },
  ]) {
    it(`PUT with ${label} is still 405 (exact-match rejects it)`, async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'PUT', url });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('GET');
      await app.close();
    });
  }
});

describe('SPA fallback', () => {
  for (const url of ['/', '/projects/foo', '/agents']) {
    it(`GET ${url} returns the index.html fixture`, async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']?.toString()).toContain('text/html');
      expect(res.body).toContain('SPA fixture');
      await app.close();
    });
  }

  it('GET /api/missing returns 404 + ApiError, not index.html', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('not_found');
    await app.close();
  });
});
