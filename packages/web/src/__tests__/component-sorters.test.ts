// Coverage gap closure: keyboard handlers in ProjectCard + relative-time
// formatter branches. The NDataTable sorter callbacks themselves live in
// ../lib/table-sorters.ts (covered by table-sorters.test.ts).

import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import ProjectCard from '../components/ProjectCard.vue';

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: { template: '<div/>' } },
      { path: '/projects/:name', name: 'project-detail', component: { template: '<div/>' } },
    ],
  });
}

const SAMPLE: ProjectSummary = {
  name: 'alpha',
  activeTasks: 1,
  blockedTasks: 0,
  prsMergedLast7d: null,
  lastActivityAt: null,
  hasMetrics: true,
};

describe('ProjectCard keyboard handlers', () => {
  it('Enter key navigates to the detail route', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, { props: { project: SAMPLE }, global: { plugins: [router] } });
    await w
      .find('[data-testid="project-card-alpha"]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-detail');
  });

  it('Space key navigates to the detail route', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, { props: { project: SAMPLE }, global: { plugins: [router] } });
    await w
      .find('[data-testid="project-card-alpha"]')
      .trigger('keydown', { key: ' ' });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('project-detail');
  });
});

describe('ProjectCard relative-time formatter branches', () => {
  function project(at: string | null): ProjectSummary {
    return {
      name: 'p',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: at,
      hasMetrics: true,
    };
  }

  it('renders "just now" for very recent timestamps', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: project(new Date().toISOString()) },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-last-activity"]').text()).toBe('just now');
  });

  it('renders "Nm ago" for sub-hour activity', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: project(new Date(Date.now() - 30 * 60_000).toISOString()) },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-last-activity"]').text()).toBe('30m ago');
  });

  it('renders "Nd ago" for activity ≥24 hours old', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: project(new Date(Date.now() - 50 * 3_600_000).toISOString()) },
      global: { plugins: [router] },
    });
    expect(w.find('[data-testid="metric-last-activity"]').text()).toBe('2d ago');
  });
});
