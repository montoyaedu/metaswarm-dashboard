import type { ProjectCostSummary, VendorCostRollup } from '@metaswarm-dashboard/types/cost';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import type { GetProjectByNameResponse } from '../api/client.js';
import ProjectDetail from '../views/ProjectDetail.vue';
import ProjectsIndex from '../views/ProjectsIndex.vue';

const App = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

/** Build a `ProjectCostSummary` with per-vendor overrides. */
function costOf(
  overrides: Partial<{
    anthropic: VendorCostRollup;
    openai: VendorCostRollup;
    google: VendorCostRollup;
    totalCostUsd: number;
    hasUnpriced: boolean;
  }> = {},
): ProjectCostSummary {
  const zero: VendorCostRollup = { costUsd: 0, runCount: 0, hasUnpriced: false };
  return {
    projectName: 'alpha',
    byVendor: {
      anthropic: overrides.anthropic ?? zero,
      openai: overrides.openai ?? zero,
      google: overrides.google ?? zero,
    },
    totalCostUsd: overrides.totalCostUsd ?? 0,
    hasUnpriced: overrides.hasUnpriced ?? false,
    pricingAsOf: '2026-05-18',
  };
}

const SAMPLE: GetProjectByNameResponse = {
  name: 'alpha',
  agents: [{ agent: 'coder', tasksCompleted: 3, successRate: 1.0, avgDurationSeconds: 200 }],
  throughput: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
    closed: i,
  })),
  recentWorkUnits: [],
  lastActivityAt: '2026-05-06T10:00:00.000Z',
  cost: costOf({
    anthropic: { costUsd: 12.5, runCount: 4, hasUnpriced: false },
    totalCostUsd: 12.5,
  }),
  pricingAsOf: '2026-05-18',
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

  // --- v5-10: the fifth section — "AI cost" (design §8.2) -----------------

  async function mountDetail(detail: GetProjectByNameResponse) {
    const restore = withFetch((url) => (url.endsWith('/api/projects') ? [] : detail));
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push({ name: 'project-detail', params: { name: 'alpha' } });
    await router.isReady();
    await flushPromises();
    return { w, restore };
  }

  it('renders an "AI cost" section with a row for all three vendors', async () => {
    const { w, restore } = await mountDetail(SAMPLE);
    expect(w.find('[data-testid="project-cost-section"]').exists()).toBe(true);
    // All three vendors get a row — none is omitted (design §8.2).
    expect(w.find('[data-testid="cost-vendor-anthropic"]').exists()).toBe(true);
    expect(w.find('[data-testid="cost-vendor-openai"]').exists()).toBe(true);
    expect(w.find('[data-testid="cost-vendor-google"]').exists()).toBe(true);
    restore();
  });

  it('a vendor with no runs shows "$0.00 (0 runs)" — never omitted', async () => {
    const { w, restore } = await mountDetail(SAMPLE);
    // SAMPLE has no OpenAI / Google runs.
    expect(w.find('[data-testid="cost-vendor-openai"]').text()).toContain('$0.00');
    expect(w.find('[data-testid="cost-vendor-openai"]').text()).toContain('0 runs');
    expect(w.find('[data-testid="cost-vendor-google"]').text()).toContain('0 runs');
    restore();
  });

  it('a priced vendor row shows its USD cost and run count', async () => {
    const { w, restore } = await mountDetail(SAMPLE);
    const anthropic = w.find('[data-testid="cost-vendor-anthropic"]');
    expect(anthropic.text()).toContain('$12.5000');
    expect(anthropic.text()).toContain('4 runs');
    restore();
  });

  it('a vendor whose runs are all unpriced shows "n/a"', async () => {
    // openai: 2 runs, all unpriced → priced sum is 0, hasUnpriced true.
    const detail: GetProjectByNameResponse = {
      ...SAMPLE,
      cost: costOf({
        openai: { costUsd: 0, runCount: 2, hasUnpriced: true },
        hasUnpriced: true,
      }),
    };
    const { w, restore } = await mountDetail(detail);
    const openai = w.find('[data-testid="cost-vendor-openai"]');
    expect(openai.text()).toContain('n/a');
    expect(openai.text()).toContain('2 runs');
    restore();
  });

  it('a partly-unpriced vendor row shows "$X + unpriced"', async () => {
    const detail: GetProjectByNameResponse = {
      ...SAMPLE,
      cost: costOf({
        google: { costUsd: 3.25, runCount: 5, hasUnpriced: true },
        hasUnpriced: true,
      }),
    };
    const { w, restore } = await mountDetail(detail);
    const google = w.find('[data-testid="cost-vendor-google"]');
    expect(google.text()).toContain('$3.2500 + unpriced');
    expect(google.text()).toContain('5 runs');
    restore();
  });

  it('shows the project total cost; "$X + unpriced" when the total is a lower bound', async () => {
    const detail: GetProjectByNameResponse = {
      ...SAMPLE,
      cost: costOf({
        anthropic: { costUsd: 8, runCount: 3, hasUnpriced: true },
        totalCostUsd: 8,
        hasUnpriced: true,
      }),
    };
    const { w, restore } = await mountDetail(detail);
    expect(w.find('[data-testid="cost-project-total"]').text()).toContain('$8.0000 + unpriced');
    restore();
  });

  it('renders the "AI prices as of" footnote once in the cost section', async () => {
    const { w, restore } = await mountDetail(SAMPLE);
    const footnotes = w.findAll('[data-testid="cost-pricing-asof"]');
    expect(footnotes).toHaveLength(1);
    expect(footnotes[0]?.text()).toContain('AI prices as of 2026-05-18');
    restore();
  });

  it('omits the AI cost section when the detail carries no cost (v4-shaped detail)', async () => {
    const v4Detail: GetProjectByNameResponse = {
      name: 'alpha',
      agents: SAMPLE.agents,
      throughput: SAMPLE.throughput,
      recentWorkUnits: [],
      lastActivityAt: SAMPLE.lastActivityAt,
    };
    const { w, restore } = await mountDetail(v4Detail);
    expect(w.find('[data-testid="project-cost-section"]').exists()).toBe(false);
    restore();
  });
});
