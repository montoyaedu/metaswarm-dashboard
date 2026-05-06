import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import ProjectCard from '../components/ProjectCard.vue';

const HasMetrics: ProjectSummary = {
  name: 'alpha',
  activeTasks: 5,
  blockedTasks: 2,
  prsMergedLast7d: null,
  lastActivityAt: new Date(Date.now() - 90 * 60_000).toISOString(),
  hasMetrics: true,
};

const NeverActive: ProjectSummary = {
  name: 'beta',
  activeTasks: 0,
  blockedTasks: 0,
  prsMergedLast7d: null,
  lastActivityAt: null,
  hasMetrics: false,
};

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: { template: '<div/>' } },
      { path: '/projects/:name', name: 'project-detail', component: { template: '<div/>' } },
    ],
  });
}

describe('ProjectCard', () => {
  it('renders all 4 metrics with correct values', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: HasMetrics },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-active"]').text()).toBe('5');
    expect(w.find('[data-testid="metric-blocked"]').text()).toBe('2');
    expect(w.find('[data-testid="metric-prs"]').text()).toBe('—');
    expect(w.find('[data-testid="metric-last-activity"]').text()).toContain('h ago');
  });

  it('renders "—" for prsMergedLast7d when null (DoD: §2.6)', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: HasMetrics },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-prs"]').text()).toBe('—');
  });

  it('renders "Never" for lastActivityAt when null (DoD WU-5.2 round-4 fix)', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: NeverActive },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-last-activity"]').text()).toBe('Never');
  });

  it('navigates to project-detail on click (router.push asserted)', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: HasMetrics },
      global: { plugins: [router] },
    });
    await w.find('[data-testid="project-card-alpha"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-detail');
    expect(router.currentRoute.value.params.name).toBe('alpha');
  });
});
