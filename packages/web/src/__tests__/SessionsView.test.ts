// WU v4-7 — SessionsView: list rendering, project filter, row-click nav,
// and the loading / empty / error states.

import type { SessionSummary } from '@metaswarm-dashboard/types/sessions';
import { flushPromises, mount } from '@vue/test-utils';
import { NSelect } from 'naive-ui';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import SessionsView from '../views/SessionsView.vue';

const App = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

const DetailStub = defineComponent({
  name: 'SessionDetailStub',
  template: '<main data-testid="session-detail-stub">stub</main>',
});

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/sessions', name: 'sessions', component: SessionsView },
      {
        path: '/sessions/:project/:sessionId',
        name: 'session-detail',
        component: DetailStub,
      },
    ],
  });
}

const ALPHA: SessionSummary = {
  projectName: 'alpha',
  sessionId: 'abcdef0123456789',
  startedAt: '2026-05-17T06:00:00.000Z',
  lastEventAt: '2026-05-17T06:30:00.000Z',
  eventCount: 12,
  rated: true,
};

const BETA: SessionSummary = {
  projectName: 'beta',
  sessionId: 'bbbbbb1111222233',
  startedAt: '2026-05-17T07:00:00.000Z',
  lastEventAt: '2026-05-17T07:05:00.000Z',
  eventCount: 4,
  rated: false,
};

/** An all-zero calibration summary — the SessionsView panel fetches this. */
const EMPTY_CALIBRATION = {
  schemaVersion: 1,
  generatedAt: '2026-05-17T12:00:00.000Z',
  ratedSessionCount: 0,
  perKpi: [],
};

/**
 * Stub fetch for /api/sessions; captures the URLs requested. The SessionsView
 * now also mounts the CalibrationSummaryPanel, which fetches /api/calibration
 * — that URL is answered with a benign empty summary so the panel renders its
 * empty state and never interferes with the list assertions.
 */
function withFetch(
  responder: (project: string | null) => { sessions: SessionSummary[] } | Response,
): { restore: () => void; urls: string[] } {
  const urls: string[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.includes('/api/calibration')) {
      return Promise.resolve(
        new Response(JSON.stringify({ summary: EMPTY_CALIBRATION }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    const project = new URL(url, 'http://x').searchParams.get('project');
    const out = responder(project);
    if (out instanceof Response) return Promise.resolve(out);
    return Promise.resolve(
      new Response(JSON.stringify(out), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { restore: () => vi.unstubAllGlobals(), urls };
}

async function mountAt(router: Router): Promise<ReturnType<typeof mount>> {
  const w = mount(App, { global: { plugins: [router] } });
  await router.push('/sessions');
  await router.isReady();
  await flushPromises();
  return w;
}

describe('SessionsView', () => {
  it('renders one table row per discovered session', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA, BETA] }));
    const w = await mountAt(makeRouter());

    expect(w.find('[data-testid="sessions-table"]').exists()).toBe(true);
    expect(w.find('[data-testid="session-row-alpha/abcdef0123456789"]').exists()).toBe(true);
    expect(w.find('[data-testid="session-row-beta/bbbbbb1111222233"]').exists()).toBe(true);
    restore();
  });

  it('shows the short sessionId suffix, not the full id', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA] }));
    const w = await mountAt(makeRouter());
    const sid = w.find('[data-testid="session-sid-alpha/abcdef0123456789"]');
    expect(sid.text()).toBe('abcdef01');
    restore();
  });

  it('shows a rated indicator for rated and unrated sessions', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA, BETA] }));
    const w = await mountAt(makeRouter());
    expect(w.find('[data-testid="session-rated-alpha/abcdef0123456789"]').text()).toContain(
      'Rated',
    );
    expect(w.find('[data-testid="session-rated-beta/bbbbbb1111222233"]').text()).toContain(
      'Unrated',
    );
    restore();
  });

  it('does NOT show any rubric verdict in the session list (anti-anchoring)', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA, BETA] }));
    const w = await mountAt(makeRouter());
    // Scope the assertion to the list table — the calibration panel above it
    // legitimately mentions the rubric (design §6.4); the per-session ROWS
    // must not, so the operator's list-level read stays unanchored.
    const tableText = w.find('[data-testid="sessions-table"]').text().toLowerCase();
    expect(tableText).not.toContain('verdict');
    expect(tableText).not.toContain('rubric');
    restore();
  });

  it('clicking a row navigates to the session detail route', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA] }));
    const router = makeRouter();
    const w = await mountAt(router);

    await w.find('[data-testid="session-row-alpha/abcdef0123456789"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('session-detail');
    expect(router.currentRoute.value.params).toMatchObject({
      project: 'alpha',
      sessionId: 'abcdef0123456789',
    });
    expect(w.find('[data-testid="session-detail-stub"]').exists()).toBe(true);
    restore();
  });

  it('re-fetches with a ?project filter when the select emits a project', async () => {
    const { restore, urls } = withFetch((project) => ({
      sessions: project === 'beta' ? [BETA] : [ALPHA, BETA],
    }));
    const w = await mountAt(makeRouter());
    expect(w.findAll('[data-testid^="session-row-"]')).toHaveLength(2);

    // Drive the v-model write-back through the NSelect's update:value event.
    w.findComponent(NSelect).vm.$emit('update:value', 'beta');
    await flushPromises();

    expect(urls.some((u) => u.includes('project=beta'))).toBe(true);
    expect(w.findAll('[data-testid^="session-row-"]')).toHaveLength(1);
    expect(w.find('[data-testid="session-row-beta/bbbbbb1111222233"]').exists()).toBe(true);
    restore();
  });

  it('offers an All-projects option plus every project with a session', async () => {
    const { restore } = withFetch(() => ({ sessions: [ALPHA, BETA] }));
    const w = await mountAt(makeRouter());
    const options = w.findComponent(NSelect).props('options') as { value: string }[];
    expect(options.map((o) => o.value)).toEqual(['', 'alpha', 'beta']);
    restore();
  });

  it('renders the empty state when no sessions are returned', async () => {
    const { restore } = withFetch(() => ({ sessions: [] }));
    const w = await mountAt(makeRouter());
    expect(w.find('[data-testid="sessions-table"]').exists()).toBe(false);
    expect(w.find('[data-testid="sessions-empty"]').exists()).toBe(true);
    expect(w.text()).toContain('No sessions found');
    restore();
  });

  it('renders an error state with the literal message and a Retry button', async () => {
    const { restore } = withFetch(() => new Response('boom', { status: 500 }));
    const w = await mountAt(makeRouter());
    const err = w.find('[data-testid="sessions-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('500');
    expect(w.find('[data-testid="sessions-retry"]').exists()).toBe(true);
    restore();
  });

  it('Retry re-fetches and recovers from a transient error', async () => {
    let fail = true;
    const { restore } = withFetch(() => {
      if (fail) {
        fail = false;
        return new Response('boom', { status: 500 });
      }
      return { sessions: [ALPHA] };
    });
    const w = await mountAt(makeRouter());
    expect(w.find('[data-testid="sessions-error"]').exists()).toBe(true);

    await w.find('[data-testid="sessions-retry"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="sessions-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="session-row-alpha/abcdef0123456789"]').exists()).toBe(true);
    restore();
  });

  it('shows a loading skeleton before the fetch resolves', async () => {
    // Only the /api/sessions request is held pending; /api/calibration (the
    // panel's fetch) is answered immediately so the SessionsView skeleton is
    // the only thing still loading.
    let resolve: ((r: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/calibration')) {
        return Promise.resolve(
          new Response(JSON.stringify({ summary: EMPTY_CALIBRATION }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return new Promise<Response>((r) => {
        resolve = r;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push('/sessions');
    await router.isReady();
    await flushPromises();
    // fetch is still pending — the skeleton is showing.
    expect(w.find('[data-testid="sessions-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="sessions-table"]').exists()).toBe(false);

    resolve?.(
      new Response(JSON.stringify({ sessions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await flushPromises();
    expect(w.find('[data-testid="sessions-loading"]').exists()).toBe(false);
    vi.unstubAllGlobals();
  });
});
