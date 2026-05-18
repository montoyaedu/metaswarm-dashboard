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
  path: '/tmp/p',
  category: 'metaswarm',
  hasMetrics: true,
      collectionStatus: 'ok',
      collectionWarnings: [],};

const NeverActive: ProjectSummary = {
  name: 'beta',
  activeTasks: 0,
  blockedTasks: 0,
  prsMergedLast7d: null,
  lastActivityAt: null,
  path: '/tmp/p',
  category: 'metaswarm',
  hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],};

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

  it('renders a "not yet managed" tag for a git-only project (no popover)', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const GitOnly: ProjectSummary = {
      name: 'vanilla',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      path: '/tmp/p',
      category: 'git-only',
      hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],
    };
    const w = mount(ProjectCard, {
      props: { project: GitOnly },
      global: { plugins: [router] },
    });
    const badge = w.find('[data-testid="status-badge-vanilla"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('not yet managed');
    // git-only cards do not render the advice popover.
    expect(w.find('[data-testid="collection-advice"]').exists()).toBe(false);
  });

  it('renders no status badge for a healthy metaswarm project', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const w = mount(ProjectCard, {
      props: { project: HasMetrics },
      global: { plugins: [router] },
    });
    // collectionStatus 'ok' on a metaswarm project → statusBadge is null.
    expect(w.find('[data-testid="status-badge-alpha"]').exists()).toBe(false);
  });

  it('renders a degraded badge + advice popover with per-warning help', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const Degraded: ProjectSummary = {
      name: 'gamma',
      activeTasks: 3,
      blockedTasks: 1,
      prsMergedLast7d: null,
      lastActivityAt: null,
      path: '/tmp/p',
      category: 'metaswarm',
      hasMetrics: true,
      collectionStatus: 'degraded',
      collectionWarnings: ['Dolt server unreachable on port 9001'],
    };
    const w = mount(ProjectCard, {
      props: { project: Degraded },
      global: { plugins: [router] },
      attachTo: document.body,
    });
    const badge = w.find('[data-testid="status-badge-gamma"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('degraded');

    // NPopover (trigger="click") renders its content into a teleport only
    // after the trigger tag is clicked.
    await badge.trigger('click');
    await flushPromises();
    const advice = document.querySelector('[data-testid="collection-advice"]');
    expect(advice).not.toBeNull();
    const adviceText = advice?.textContent ?? '';
    expect(adviceText).toContain('Collection succeeded with warnings');
    // The warning block renders the literal message + its mapped help label.
    expect(adviceText).toContain('Dolt server unreachable on port 9001');
    expect(adviceText).toContain('Dolt server not running');
    expect(adviceText).toContain('bd dolt start');
    w.unmount();
  });

  it('renders a failed badge with the FAILED advice summary', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const Failed: ProjectSummary = {
      name: 'delta',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      path: '/tmp/p',
      category: 'metaswarm',
      hasMetrics: false,
      collectionStatus: 'failed',
      collectionWarnings: ['no .beads/ directory at /tmp/p'],
    };
    const w = mount(ProjectCard, {
      props: { project: Failed },
      global: { plugins: [router] },
      attachTo: document.body,
    });
    const badge = w.find('[data-testid="status-badge-delta"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('failed');
    await badge.trigger('click');
    await flushPromises();
    const advice = document.querySelector('[data-testid="collection-advice"]');
    expect(advice).not.toBeNull();
    const adviceText = advice?.textContent ?? '';
    expect(adviceText).toContain('Collection FAILED');
    expect(adviceText).toContain('No `.beads/` directory');
    w.unmount();
  });

  it('clicking the status tag stops propagation so the card does not navigate', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();
    const Degraded: ProjectSummary = {
      name: 'gamma',
      activeTasks: 3,
      blockedTasks: 1,
      prsMergedLast7d: null,
      lastActivityAt: null,
      path: '/tmp/p',
      category: 'metaswarm',
      hasMetrics: true,
      collectionStatus: 'degraded',
      collectionWarnings: ['Dolt server unreachable'],
    };
    const w = mount(ProjectCard, {
      props: { project: Degraded },
      global: { plugins: [router] },
    });
    await w.find('[data-testid="status-badge-gamma"]').trigger('click');
    await flushPromises();
    // stopProp() prevents the card click handler → still on the index route.
    expect(router.currentRoute.value.name).toBe('projects-index');
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
