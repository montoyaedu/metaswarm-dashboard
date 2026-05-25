import { describe, expect, it, vi } from 'vitest';

import { createDanaClient, DanaClientError } from '../client.js';

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch;
}

function mockFetchRaw(body: string, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(body, { status })),
  ) as unknown as typeof fetch;
}

describe('DanaClient', () => {
  describe('listTasks', () => {
    it('returns parsed tasks', async () => {
      const tasks = [{ id: 't1', status: 'running', phase: 'plan', currentWuIndex: 0, attempt: 1, workUnits: [] }];
      const fetchImpl = mockFetch(200, tasks);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.listTasks();
      expect(result).toEqual(tasks);
    });

    it('appends ?status= when filtering', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('[]', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.listTasks('running');
      expect(calls[0]).toBe('http://dana/api/tasks?status=running');
    });
  });

  describe('getTask', () => {
    it('returns task detail', async () => {
      const detail = {
        id: 't1',
        status: 'running',
        phase: 'implement',
        currentWuIndex: 0,
        attempt: 1,
        workUnits: [{ id: 'WU-1', title: 'Setup', spec: 'spec', checkpoint: false }],
        wuResults: [],
        checkpoint: null,
        events: [],
      };
      const fetchImpl = mockFetch(200, detail);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.getTask('t1');
      expect(result.id).toBe('t1');
    });

    it('encodes task id in URL', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{"id":"t1"}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.getTask('task/1');
      expect(calls[0]).toBe('http://dana/api/tasks/task%2F1');
    });
  });

  describe('createTask', () => {
    it('sends goal and returns id', async () => {
      const fetchImpl = mockFetch(201, { id: 'new-task-id' });
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.createTask('my goal', [{ title: 'WU1', spec: 'spec' }], ['tag1']);
      expect(result.id).toBe('new-task-id');
    });

    it('sends JSON body', async () => {
      const bodies: unknown[] = [];
      const fetchImpl = vi.fn((_url: string, opts: RequestInit) => {
        bodies.push(JSON.parse(opts.body as string));
        return Promise.resolve(new Response('{"id":"x"}', { status: 201 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.createTask('goal');
      expect(bodies[0]).toMatchObject({ goal: 'goal' });
    });
  });

  describe('cancelTask', () => {
    it('sends POST to cancel endpoint', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.cancelTask('t1');
      expect(calls[0]).toBe('http://dana/api/tasks/t1/cancel');
    });

    it('resolves on success', async () => {
      const fetchImpl = mockFetch(200, {});
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.cancelTask('t1')).resolves.toBeDefined();
    });

    it('throws on error', async () => {
      const fetchImpl = mockFetch(409, { error: 'conflict' });
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.cancelTask('t1')).rejects.toThrow(DanaClientError);
    });

    it('encodes task id in URL', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.cancelTask('task/1');
      expect(calls[0]).toBe('http://dana/api/tasks/task%2F1/cancel');
    });
  });

  describe('deleteTask', () => {
    it('sends DELETE to task endpoint', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string, opts: RequestInit) => {
        calls.push(url);
        calls.push(opts.method ?? '');
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.deleteTask('t1');
      expect(calls[0]).toBe('http://dana/api/tasks/t1');
      expect(calls[1]).toBe('DELETE');
    });

    it('resolves on 200', async () => {
      const fetchImpl = mockFetch(200, {});
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.deleteTask('t1')).resolves.toBeDefined();
    });

    it('throws on 404', async () => {
      const fetchImpl = mockFetch(404, { error: 'not found' });
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.deleteTask('nope')).rejects.toThrow(DanaClientError);
    });

    it('encodes task id in URL', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.deleteTask('task/1');
      expect(calls[0]).toBe('http://dana/api/tasks/task%2F1');
    });
  });

  describe('listCheckpoints', () => {
    it('returns checkpoint list', async () => {
      const cps = [{ taskId: 't1', wuId: 'WU-2', phase: 'checkpoint:WU-2', reason: 'Review', prompt: 'Check' }];
      const fetchImpl = mockFetch(200, cps);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.listCheckpoints();
      expect(result).toEqual(cps);
    });
  });

  describe('approveCheckpoint', () => {
    it('sends approve action', async () => {
      const bodies: unknown[] = [];
      const fetchImpl = vi.fn((_url: string, opts: RequestInit) => {
        bodies.push(JSON.parse(opts.body as string));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await client.approveCheckpoint('t1', 'approve', 'looks good');
      expect(bodies[0]).toMatchObject({ action: 'approve', comment: 'looks good' });
    });

    it('works without comment', async () => {
      const fetchImpl = mockFetch(200, {});
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.approveCheckpoint('t1', 'reject')).resolves.toBeDefined();
    });
  });

  describe('getEvents', () => {
    it('returns events array', async () => {
      const events = [{ type: 'phase.start', phase: 'plan', ts: '2026-01-01T00:00:00Z' }];
      const fetchImpl = mockFetch(200, events);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.getEvents('t1');
      expect(result).toEqual(events);
    });
  });

  describe('getConfig', () => {
    it('returns config', async () => {
      const cfg = { provider: 'anthropic', checkpointSettings: { enabled: true } };
      const fetchImpl = mockFetch(200, cfg);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.getConfig();
      expect(result).toEqual(cfg);
    });
  });

  describe('getHealth', () => {
    it('returns health status', async () => {
      const health = { status: 'ok', uptime: 123 };
      const fetchImpl = mockFetch(200, health);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      const result = await client.getHealth();
      expect(result).toEqual(health);
    });
  });

  describe('error handling', () => {
    it('throws DanaClientError on non-ok response', async () => {
      const fetchImpl = mockFetch(500, { error: 'internal' });
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.getHealth()).rejects.toThrow(DanaClientError);
    });

    it('exposes status code', async () => {
      const fetchImpl = mockFetch(404, { error: 'not found' });
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      try {
        await client.getTask('nope');
      } catch (err) {
        expect(err).toBeInstanceOf(DanaClientError);
        expect((err as DanaClientError).status).toBe(404);
      }
    });

    it('throws on network error', async () => {
      const fetchImpl = vi.fn(() => Promise.reject(new Error('network error'))) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.getHealth()).rejects.toThrow('network error');
    });

    it('times out after configured timeout', async () => {
      const fetchImpl = vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            setTimeout(() => reject(new Error('timeout')), 1);
          }),
      ) as unknown as typeof fetch;
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.getHealth()).rejects.toThrow('timeout');
    }, 5000);

    it('handles non-JSON error response', async () => {
      const fetchImpl = mockFetchRaw('Internal Server Error', 500);
      const client = createDanaClient('http://dana', fetchImpl as unknown as typeof fetch);
      await expect(client.getHealth()).rejects.toThrow(DanaClientError);
    });
  });

  describe('baseUrl handling', () => {
    it('defaults to localhost:4173', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient(undefined, fetchImpl as unknown as typeof fetch);
      await client.getHealth();
      expect(calls[0]).toBe('http://localhost:4173/api/health');
    });

    it('strips trailing slash from baseUrl', async () => {
      const calls: string[] = [];
      const fetchImpl = vi.fn((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response('[]', { status: 200 }));
      }) as unknown as typeof fetch;
      const client = createDanaClient('http://dana:4173/', fetchImpl as unknown as typeof fetch);
      await client.listTasks();
      expect(calls[0]).toBe('http://dana:4173/api/tasks');
    });
  });
});
