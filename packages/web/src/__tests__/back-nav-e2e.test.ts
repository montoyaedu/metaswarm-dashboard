// WU-6.5 — full back-nav cycle with the REAL ProjectDetail mounted
// (closes round-3 → v4 Comp-1).

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import App from '../App.vue';
import ProjectDetail from '../views/ProjectDetail.vue';
import ProjectsIndex from '../views/ProjectsIndex.vue';

const TestApp = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

const SUMMARY = {
  name: 'alpha',
  activeTasks: 5,
  blockedTasks: 1,
  prsMergedLast7d: null,
  lastActivityAt: '2026-05-06T10:00:00.000Z',
  hasMetrics: true,
      collectionStatus: 'ok',
      collectionWarnings: [],};

const DETAIL = {
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

function withFetch(): () => void {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/projects')) {
      return Promise.resolve(
        new Response(JSON.stringify([SUMMARY]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(DETAIL), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
}

describe('back-nav E2E with the real ProjectDetail (WU-6.5)', () => {
  it('Index → click card → Detail → router.back() → Index re-renders', async () => {
    const restore = withFetch();
    const router = makeRouter();
    const w = mount(TestApp, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();

    // 1. We're on the index with one card.
    expect(w.find('[data-testid="projects-index"]').exists()).toBe(true);
    const card = w.find('[data-testid="project-card-alpha"]');
    expect(card.exists()).toBe(true);

    // 2. Click navigates to the REAL ProjectDetail (not a stub).
    await card.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-detail');
    expect(w.find('[data-testid="project-detail"]').exists()).toBe(true);
    expect(w.find('[data-testid="agent-table"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-agent-coder"]').text()).toBe('coder');

    // 3. router.back() returns to the index AND the cards re-render.
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('projects-index');
    expect(w.find('[data-testid="projects-index"]').exists()).toBe(true);
    expect(w.find('[data-testid="project-card-alpha"]').exists()).toBe(true);

    restore();
  });

  it('App.vue mounts the real darkTheme provider for the cycle', async () => {
    // App.vue wraps RouterView with NConfigProvider darkTheme. This test
    // confirms the App component (used by main.ts) doesn't crash when
    // mounted with the real router.
    const restore = withFetch();
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.html()).toContain('Projects');
    restore();
  });
});
