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
});
