import type { GetAgentsResponse } from '@metaswarm-dashboard/types/api';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../api/client.js';
import { useAgents } from '../composables/useAgents.js';

const SAMPLE: GetAgentsResponse = [
  {
    agent: 'coder',
    totalTasksCompleted: 5,
    weightedSuccessRate: 0.8,
    avgDurationSeconds: 200,
    projects: [{ name: 'alpha', tasksCompleted: 5 }],
  },
];

function client(opts: { result?: GetAgentsResponse; error?: Error }): ApiClient {
  return {
    getProjects: () => Promise.reject(new Error('unused')),
    getProject: () => Promise.reject(new Error('unused')),
    getAgents: () => {
      if (opts.error) return Promise.reject(opts.error);
      return Promise.resolve(opts.result ?? []);
    },
  };
}

async function flushAll(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('useAgents', () => {
  it('fetches the agent aggregate on mount', async () => {
    const state = useAgents(client({ result: SAMPLE }));
    await flushAll();
    expect(state.agents.value).toHaveLength(1);
    expect(state.agents.value[0]?.agent).toBe('coder');
  });

  it('captures errors', async () => {
    const state = useAgents(client({ error: new Error('down') }));
    await flushAll();
    expect(state.error.value?.message).toBe('down');
  });

  it('reload refetches', async () => {
    let count = 0;
    const c: ApiClient = {
      getProjects: () => Promise.reject(new Error('unused')),
      getProject: () => Promise.reject(new Error('unused')),
      getAgents: () => {
        count += 1;
        return Promise.resolve([]);
      },
    };
    const state = useAgents(c);
    await flushAll();
    expect(count).toBe(1);
    await state.reload();
    expect(count).toBe(2);
  });
});
