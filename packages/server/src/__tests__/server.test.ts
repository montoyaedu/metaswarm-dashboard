// WU-4.{7,8,9,10,11,13,14,15} — Fastify server end-to-end via app.inject().

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildServer } from '../server.js';

const DATA_DIR = resolve(import.meta.dirname, 'fixtures/data-dir');
const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');
const NOW = new Date('2026-05-06T12:00:00Z');

async function makeApp() {
  return buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT, now: () => NOW });
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
    // Covers projects-by-name.ts L19 default-arg branch.
    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
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

describe('Method guard — 405 on non-GET /api/* requests', () => {
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
