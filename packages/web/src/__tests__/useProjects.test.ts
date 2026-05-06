import type { GetProjectsResponse } from '@metaswarm-dashboard/types/api';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../api/client.js';
import { useProjects } from '../composables/useProjects.js';

function fakeClient(opts: {
  result?: GetProjectsResponse;
  error?: Error;
  delayMs?: number;
}): ApiClient {
  return {
    getProjects: async () => {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.error) throw opts.error;
      return opts.result ?? [];
    },
    getProject: () => Promise.reject(new Error('not used in this test')),
    getAgents: () => Promise.reject(new Error('not used in this test')),
  };
}

async function flushAll(): Promise<void> {
  // Give nextTick + microtasks a chance to settle.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('useProjects', () => {
  it('initial reload populates projects', async () => {
    const c = fakeClient({
      result: [
        {
          name: 'alpha',
          activeTasks: 1,
          blockedTasks: 0,
          prsMergedLast7d: null,
          lastActivityAt: null,
          hasMetrics: true,
        },
      ],
    });
    const state = useProjects(c);
    await flushAll();
    expect(state.projects.value).toHaveLength(1);
    expect(state.projects.value[0]?.name).toBe('alpha');
    expect(state.error.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it('error path captures and exposes the Error', async () => {
    const c = fakeClient({ error: new Error('network down') });
    const state = useProjects(c);
    await flushAll();
    expect(state.error.value?.message).toBe('network down');
    expect(state.projects.value).toEqual([]);
  });

  it('reload() refetches', async () => {
    let count = 0;
    const c: ApiClient = {
      getProjects: () => {
        count += 1;
        return Promise.resolve([]);
      },
      getProject: () => Promise.reject(new Error('unused')),
      getAgents: () => Promise.reject(new Error('unused')),
    };
    const state = useProjects(c);
    await flushAll();
    expect(count).toBe(1);
    await state.reload();
    expect(count).toBe(2);
  });
});
