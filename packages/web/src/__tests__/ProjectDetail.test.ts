import type { GetProjectByNameResponse } from '@metaswarm-dashboard/types/api';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import ProjectDetail from '../views/ProjectDetail.vue';
import ProjectsIndex from '../views/ProjectsIndex.vue';

const App = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

const SAMPLE: GetProjectByNameResponse = {
  name: 'alpha',
  agents: [{ agent: 'coder', tasksCompleted: 3, successRate: 1.0, avgDurationSeconds: 200 }],
  throughput: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
    closed: i,
  })),
  recentWorkUnits: [],
  lastActivityAt: '2026-05-06T10:00:00.000Z',
};

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: ProjectsIndex },
      { path: '/projects/:name', name: 'project-detail', component: ProjectDetail, props: true },
    ],
  });
}

function withFetch(handler: (url: string) => unknown): () => void {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(
      new Response(JSON.stringify(handler(url)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
}

describe('ProjectDetail', () => {
  it('renders agent table + sparkline + last activity', async () => {
    const restore = withFetch((url) => {
      if (url.endsWith('/api/projects')) return [];
      return SAMPLE;
    });
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push({ name: 'project-detail', params: { name: 'alpha' } });
    await router.isReady();
    await flushPromises();

    expect(w.find('[data-testid="project-detail"]').exists()).toBe(true);
    expect(w.find('[data-testid="agent-table"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-agent-coder"]').text()).toBe('coder');
    expect(w.find('[data-testid="throughput-sparkline"]').exists()).toBe(true);
    expect(w.find('[data-testid="detail-last-activity"]').text().length).toBeGreaterThan(0);
    restore();
  });

  it('renders empty state when project has no agents', async () => {
    const empty: GetProjectByNameResponse = { ...SAMPLE, agents: [] };
    const restore = withFetch((url) => (url.endsWith('/api/projects') ? [] : empty));
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push({ name: 'project-detail', params: { name: 'beta' } });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="agent-table"]').exists()).toBe(false);
    expect(w.text()).toContain('No agent activity yet');
    restore();
  });

  it('back button navigates to projects-index', async () => {
    const restore = withFetch((url) => (url.endsWith('/api/projects') ? [] : SAMPLE));
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push({ name: 'project-detail', params: { name: 'alpha' } });
    await router.isReady();
    await flushPromises();
    await w.find('[data-testid="back-btn"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('projects-index');
    restore();
  });
});
