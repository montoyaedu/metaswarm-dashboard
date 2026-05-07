// WU-5.{2,3,4,5} — ProjectsIndex view: card-per-project rendering, click→detail
// nav, back-nav minimal (with stub ProjectDetail), empty state, dark theme provider.

import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import ProjectsIndex from '../views/ProjectsIndex.vue';

function makeRouterWithProjectsIndex(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: ProjectsIndex },
      {
        path: '/projects/:name',
        name: 'project-detail',
        component: defineComponent({
          name: 'ProjectDetailStub',
          template: '<main data-testid="project-detail-stub">stub</main>',
        }),
      },
    ],
  });
}

const App = defineComponent({
  name: 'TestApp',
  render: () => h(RouterView),
});

function withFetch(payload: ProjectSummary[]): () => void {
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

describe('ProjectsIndex', () => {
  it('renders one ProjectCard per project (DoD #2)', async () => {
    const restore = withFetch([
      {
        name: 'alpha',
        activeTasks: 1,
        blockedTasks: 0,
        prsMergedLast7d: null,
        lastActivityAt: null,
        path: '/tmp/p',
        category: 'metaswarm',
        hasMetrics: true,
      collectionStatus: 'ok',
      collectionWarnings: [],      },
      {
        name: 'beta',
        activeTasks: 2,
        blockedTasks: 1,
        prsMergedLast7d: null,
        lastActivityAt: null,
        path: '/tmp/p',
        category: 'metaswarm',
        hasMetrics: true,
      collectionStatus: 'ok',
      collectionWarnings: [],      },
    ]);
    const router = makeRouterWithProjectsIndex();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.findAll('[data-testid^="project-card-"]')).toHaveLength(2);
    restore();
  });

  it('shows "no projects configured" empty state when API returns []', async () => {
    const restore = withFetch([]);
    const router = makeRouterWithProjectsIndex();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="empty-no-projects"]').exists()).toBe(true);
    restore();
  });

  it('shows "no metrics yet" empty state when every project has hasMetrics: false (DoD #4)', async () => {
    const restore = withFetch([
      {
        name: 'alpha',
        activeTasks: 0,
        blockedTasks: 0,
        prsMergedLast7d: null,
        lastActivityAt: null,
        path: '/tmp/p',
        category: 'metaswarm',
        hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],      },
    ]);
    const router = makeRouterWithProjectsIndex();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    const empty = w.find('[data-testid="empty-no-metrics"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('metaswarm-dashboard collect');
    restore();
  });

  it('clicking a card navigates to project-detail AND back-nav returns to index (DoD #3 minimal)', async () => {
    const restore = withFetch([
      {
        name: 'alpha',
        activeTasks: 1,
        blockedTasks: 0,
        prsMergedLast7d: null,
        lastActivityAt: null,
        path: '/tmp/p',
        category: 'metaswarm',
        hasMetrics: true,
      collectionStatus: 'ok',
      collectionWarnings: [],      },
    ]);
    const router = makeRouterWithProjectsIndex();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();

    expect(w.find('[data-testid="projects-index"]').exists()).toBe(true);
    await w.find('[data-testid="project-card-alpha"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-detail');
    expect(w.find('[data-testid="project-detail-stub"]').exists()).toBe(true);

    // Back-nav minimal: router.back() returns to projects-index
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('projects-index');
    expect(w.find('[data-testid="projects-index"]').exists()).toBe(true);
    restore();
  });
});
