// Coverage gap closure: error state v-else-if branches in ProjectsIndex,
// AgentsView, and ProjectDetail.

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

import AgentsView from '../views/AgentsView.vue';
import ProjectDetail from '../views/ProjectDetail.vue';
import ProjectsIndex from '../views/ProjectsIndex.vue';

const TestApp = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

function withFailingFetch(): () => void {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response('boom', { status: 500 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
}

describe('Error state branches', () => {
  it('ProjectsIndex renders [data-testid="error"] when fetch fails', async () => {
    const restore = withFailingFetch();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'projects-index', component: ProjectsIndex }],
    });
    const w = mount(TestApp, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="error"]').exists()).toBe(true);
    restore();
  });

  it('AgentsView renders [data-testid="error"] when fetch fails', async () => {
    const restore = withFailingFetch();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'agents', component: AgentsView }],
    });
    const w = mount(TestApp, { global: { plugins: [router] } });
    await router.push('/');
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="error"]').exists()).toBe(true);
    restore();
  });

  it('ProjectDetail renders [data-testid="error"] when fetch fails', async () => {
    const restore = withFailingFetch();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/projects/:name', name: 'project-detail', component: ProjectDetail, props: true },
      ],
    });
    const w = mount(TestApp, { global: { plugins: [router] } });
    await router.push({ name: 'project-detail', params: { name: 'alpha' } });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="error"]').exists()).toBe(true);
    restore();
  });
});
