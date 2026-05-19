import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from '../api/client.js';

describe('ApiClient', () => {
  it('throws ApiClientError on non-ok responses', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    ) as unknown as typeof fetch;
    const client = createApiClient('', fetchImpl);
    await expect(client.getProjects()).rejects.toThrow(ApiClientError);
  });

  it('exposes the HTTP status on the thrown error', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('not found', { status: 404 })),
    ) as unknown as typeof fetch;
    const client = createApiClient('', fetchImpl);
    try {
      await client.getProject('nope');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(404);
    }
  });

  it('encodes the project name in the URL', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(new Response('[]', { status: 200 }));
    }) as unknown as typeof fetch;
    const client = createApiClient('http://server', fetchImpl);
    await client.getProject('weird name');
    expect(calls[0]).toBe('http://server/api/projects/weird%20name');
  });

  it('returns parsed JSON on success', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify([{ x: 1 }]), { status: 200 })),
    ) as unknown as typeof fetch;
    const client = createApiClient('', fetchImpl);
    const out = (await client.getAgents()) as unknown as { x: number }[];
    expect(out).toEqual([{ x: 1 }]);
  });

  // v5-10 (design §8.2): the v5-7 server attaches cost fields to the project
  // GETs (`totalCostUsd` / `hasUnpriced` / `pricingAsOf` on rows; `cost:
  // ProjectCostSummary` on detail). The client surfaces them verbatim — the
  // typed return shapes are `ProjectSummaryWithCost[]` / `ProjectDetailWithCost`.
  it('surfaces the v5-7 cost fields on /api/projects rows', async () => {
    const row = {
      name: 'alpha',
      path: '/tmp/p',
      category: 'metaswarm',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],
      totalCostUsd: 12.34,
      hasUnpriced: true,
      pricingAsOf: '2026-05-18',
    };
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify([row]), { status: 200 })),
    ) as unknown as typeof fetch;
    const client = createApiClient('', fetchImpl);
    const out = await client.getProjects();
    expect(out[0]?.totalCostUsd).toBe(12.34);
    expect(out[0]?.hasUnpriced).toBe(true);
    expect(out[0]?.pricingAsOf).toBe('2026-05-18');
  });

  it('surfaces the v5-7 cost summary on /api/projects/:name', async () => {
    const detail = {
      name: 'alpha',
      agents: [],
      throughput: [],
      recentWorkUnits: [],
      lastActivityAt: null,
      cost: {
        projectName: 'alpha',
        byVendor: {
          anthropic: { costUsd: 5, runCount: 2, hasUnpriced: false },
          openai: { costUsd: 0, runCount: 0, hasUnpriced: false },
          google: { costUsd: 0, runCount: 0, hasUnpriced: false },
        },
        totalCostUsd: 5,
        hasUnpriced: false,
        pricingAsOf: '2026-05-18',
      },
      pricingAsOf: '2026-05-18',
    };
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(detail), { status: 200 })),
    ) as unknown as typeof fetch;
    const client = createApiClient('', fetchImpl);
    const out = await client.getProject('alpha');
    expect(out.cost?.byVendor.anthropic.costUsd).toBe(5);
    expect(out.pricingAsOf).toBe('2026-05-18');
  });
});
