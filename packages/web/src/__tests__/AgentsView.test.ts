import type { GetAgentsResponse } from '@metaswarm-dashboard/types/api';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import AgentsView from '../views/AgentsView.vue';

const App = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

const SAMPLE: GetAgentsResponse = [
  {
    agent: 'coder',
    totalTasksCompleted: 7,
    weightedSuccessRate: 0.857,
    avgDurationSeconds: 600,
    projects: [
      { name: 'alpha', tasksCompleted: 5 },
      { name: 'beta', tasksCompleted: 2 },
    ],
  },
  {
    agent: 'reviewer-cto',
    totalTasksCompleted: 3,
    weightedSuccessRate: 0.5,
    avgDurationSeconds: 200,
    projects: [{ name: 'alpha', tasksCompleted: 3 }],
  },
];

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'agents', component: AgentsView }],
  });
}

function withFetch(payload: GetAgentsResponse): () => void {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
}

describe('AgentsView', () => {
  it('renders aggregate table with one row per agent', async () => {
    const restore = withFetch(SAMPLE);
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();

    expect(w.find('[data-testid="agents-aggregate-table"]').exists()).toBe(true);
    expect(w.find('[data-testid="agg-agent-coder"]').text()).toBe('coder');
    expect(w.find('[data-testid="agg-tasks-coder"]').text()).toBe('7');
    expect(w.find('[data-testid="agg-rate-coder"]').text()).toBe('86%');
    expect(w.find('[data-testid="agg-projects-coder"]').text()).toBe('alpha (5), beta (2)');
    restore();
  });

  it('renders empty state when no agents are returned', async () => {
    const restore = withFetch([]);
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="agents-aggregate-table"]').exists()).toBe(false);
    expect(w.text()).toContain('No agent activity across configured projects');
    restore();
  });
});
