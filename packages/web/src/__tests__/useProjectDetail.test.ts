import type { GetProjectByNameResponse } from '@metaswarm-dashboard/types/api';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { ApiClient } from '../api/client.js';
import { useProjectDetail } from '../composables/useProjectDetail.js';

const SAMPLE: GetProjectByNameResponse = {
  name: 'alpha',
  agents: [
    { agent: 'coder', tasksCompleted: 3, successRate: 1.0, avgDurationSeconds: 200 },
  ],
  throughput: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
    closed: i,
  })),
  recentWorkUnits: [],
  lastActivityAt: '2026-05-06T10:00:00.000Z',
};

function fakeClient(opts: {
  result?: GetProjectByNameResponse;
  error?: Error;
}): ApiClient {
  return {
    getProjects: () => Promise.reject(new Error('unused')),
    getProject: (name) => {
      if (opts.error) return Promise.reject(opts.error);
      return Promise.resolve({ ...(opts.result ?? SAMPLE), name });
    },
    getAgents: () => Promise.reject(new Error('unused')),
  };
}

async function flushAll(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('useProjectDetail', () => {
  it('fetches detail for the initial name', async () => {
    const name = ref('alpha');
    const state = useProjectDetail(name, fakeClient({ result: SAMPLE }));
    await flushAll();
    expect(state.detail.value?.name).toBe('alpha');
    expect(state.error.value).toBeNull();
  });

  it('refetches when the name ref changes', async () => {
    const seen: string[] = [];
    const client: ApiClient = {
      getProjects: () => Promise.reject(new Error('unused')),
      getProject: (name) => {
        seen.push(name);
        return Promise.resolve({ ...SAMPLE, name });
      },
      getAgents: () => Promise.reject(new Error('unused')),
    };
    const name = ref('alpha');
    useProjectDetail(name, client);
    await flushAll();
    name.value = 'beta';
    await flushAll();
    expect(seen).toEqual(['alpha', 'beta']);
  });

  it('captures errors and resets detail to null', async () => {
    const name = ref('alpha');
    const state = useProjectDetail(name, fakeClient({ error: new Error('boom') }));
    await flushAll();
    expect(state.error.value?.message).toBe('boom');
    expect(state.detail.value).toBeNull();
  });
});
