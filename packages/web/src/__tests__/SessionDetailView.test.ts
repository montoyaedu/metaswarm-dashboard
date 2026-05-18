// WU v4-7 — SessionDetailView: header, event timeline (rendering + truncation
// + the no-v-html safety guard), the in-progress badge, and the loading /
// error / 404 states.

import type {
  ProcessRubricScore,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';

import SessionDetailView from '../views/SessionDetailView.vue';

const App = defineComponent({ name: 'TestApp', render: () => h(RouterView) });

const RUBRIC_KEYS = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
] as const;

const RUBRIC: ProcessRubricScore = {
  schemaVersion: 1,
  sessionId: 'sess-a1',
  scoredAt: '2026-05-17T08:00:00.000Z',
  items: RUBRIC_KEYS.map((key) => ({
    key,
    label: key,
    verdict: 'pass' as const,
    evidence: 'ok',
    pointer: null,
  })),
  overall: 'pass',
};

function evt(over: Partial<ToolUseEvent>): ToolUseEvent {
  return {
    at: '2026-05-17T06:00:00.000Z',
    kind: 'user-prompt',
    toolName: null,
    summary: 'a prompt',
    redactionApplied: [],
    uuid: 'u-0',
    ...over,
  };
}

function makeTimeline(over: Partial<SessionTimeline> = {}): SessionTimeline {
  return {
    schemaVersion: 1,
    transcriptPath: '/transcripts/alpha/sess-a1.jsonl',
    sessionId: 'sess-a1',
    projectCwd: '/repos/alpha',
    startedAt: '2026-05-17T06:00:00.000Z',
    lastEventAt: '2026-05-17T06:30:00.000Z',
    eventCount: 2,
    skippedLineCount: 0,
    events: [
      evt({ at: '2026-05-17T06:00:00.000Z', kind: 'user-prompt', summary: 'first prompt' }),
      evt({
        at: '2026-05-17T06:05:00.000Z',
        kind: 'tool-use',
        toolName: 'Bash',
        summary: 'run the build',
        uuid: 'u-1',
      }),
    ],
    ...over,
  };
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/sessions', name: 'sessions', component: { template: '<div>list</div>' } },
      {
        path: '/sessions/:project/:sessionId',
        name: 'session-detail',
        component: SessionDetailView,
      },
    ],
  });
}

/** Stub fetch for the detail endpoint. */
function withFetch(
  responder: () => { timeline: SessionTimeline; rubric: ProcessRubricScore; rating: null } | Response,
): () => void {
  const fetchMock = vi.fn(() => {
    const out = responder();
    if (out instanceof Response) return Promise.resolve(out);
    return Promise.resolve(
      new Response(JSON.stringify(out), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return () => vi.unstubAllGlobals();
}

async function mountDetail(router: Router): Promise<ReturnType<typeof mount>> {
  const w = mount(App, { global: { plugins: [router] } });
  await router.push({
    name: 'session-detail',
    params: { project: 'alpha', sessionId: 'sess-a1' },
  });
  await router.isReady();
  await flushPromises();
  return w;
}

describe('SessionDetailView', () => {
  it('renders a header with project, started-at and event count', async () => {
    const restore = withFetch(() => ({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }));
    const w = await mountDetail(makeRouter());
    const header = w.find('[data-testid="session-detail-header"]');
    expect(header.exists()).toBe(true);
    expect(header.text()).toContain('alpha');
    expect(header.text()).toContain('2 events');
    restore();
  });

  it('renders one timeline row per event with HH:MM:SS · kind · summary', async () => {
    const restore = withFetch(() => ({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }));
    const w = await mountDetail(makeRouter());
    // Expand the timeline (collapsed by default).
    await w.find('[data-testid="timeline-toggle"]').trigger('click');

    expect(w.findAll('[data-testid^="timeline-event-"]')).toHaveLength(2);
    const row0 = w.find('[data-testid="timeline-event-0"]');
    const row1 = w.find('[data-testid="timeline-event-1"]');
    expect(row0.text()).toContain('first prompt');
    expect(row0.text()).toContain('user-prompt');
    expect(row1.text()).toContain('tool-use');
    expect(row1.text()).toContain('run the build');
    restore();
  });

  it('truncates a long event summary in the timeline row', async () => {
    const longSummary = 'x'.repeat(400);
    const restore = withFetch(() => ({
      timeline: makeTimeline({
        eventCount: 1,
        events: [evt({ summary: longSummary })],
      }),
      rubric: RUBRIC,
      rating: null,
    }));
    const w = await mountDetail(makeRouter());
    await w.find('[data-testid="timeline-toggle"]').trigger('click');
    const row = w.find('[data-testid="timeline-event-0"]');
    expect(row.text()).toContain('…');
    expect(row.text().length).toBeLessThan(longSummary.length);
    restore();
  });

  it('the timeline is collapsed by default and expands on toggle', async () => {
    const restore = withFetch(() => ({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }));
    const w = await mountDetail(makeRouter());
    expect(w.findAll('[data-testid^="timeline-event-"]')).toHaveLength(0);
    await w.find('[data-testid="timeline-toggle"]').trigger('click');
    expect(w.findAll('[data-testid^="timeline-event-"]').length).toBeGreaterThan(0);
    restore();
  });

  it('shows the "in progress" badge when lastEventAt is within 60s of now', async () => {
    const nowIso = new Date().toISOString();
    const restore = withFetch(() => ({
      timeline: makeTimeline({ lastEventAt: nowIso }),
      rubric: RUBRIC,
      rating: null,
    }));
    const w = await mountDetail(makeRouter());
    expect(w.find('[data-testid="session-in-progress"]').exists()).toBe(true);
    restore();
  });

  it('hides the "in progress" badge for an old session', async () => {
    const restore = withFetch(() => ({
      timeline: makeTimeline({ lastEventAt: '2020-01-01T00:00:00.000Z' }),
      rubric: RUBRIC,
      rating: null,
    }));
    const w = await mountDetail(makeRouter());
    expect(w.find('[data-testid="session-in-progress"]').exists()).toBe(false);
    restore();
  });

  it('renders transcript content as TEXT — never via v-html', async () => {
    const restore = withFetch(() => ({
      timeline: makeTimeline({
        eventCount: 1,
        events: [evt({ summary: '<img src=x onerror=alert(1)>' })],
      }),
      rubric: RUBRIC,
      rating: null,
    }));
    const w = await mountDetail(makeRouter());
    await w.find('[data-testid="timeline-toggle"]').trigger('click');
    const row = w.find('[data-testid="timeline-event-0"]');
    // The malicious markup must appear as escaped text, not a live <img>.
    expect(row.text()).toContain('<img src=x onerror=alert(1)>');
    expect(row.find('img').exists()).toBe(false);
    restore();
  });

  it('shows a loading skeleton before the fetch resolves', async () => {
    let resolve: ((r: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () => new Promise<Response>((r) => { resolve = r; }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const router = makeRouter();
    const w = mount(App, { global: { plugins: [router] } });
    await router.push({
      name: 'session-detail',
      params: { project: 'alpha', sessionId: 'sess-a1' },
    });
    await router.isReady();
    await flushPromises();
    expect(w.find('[data-testid="session-detail-loading"]').exists()).toBe(true);

    resolve?.(
      new Response(JSON.stringify({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await flushPromises();
    expect(w.find('[data-testid="session-detail-loading"]').exists()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('renders an error state with the literal message and a Retry button', async () => {
    const restore = withFetch(() => new Response('boom', { status: 500 }));
    const w = await mountDetail(makeRouter());
    const err = w.find('[data-testid="session-detail-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('500');
    expect(w.find('[data-testid="session-detail-retry"]').exists()).toBe(true);
    restore();
  });

  it('Retry recovers from a transient error', async () => {
    let fail = true;
    const restore = withFetch(() => {
      if (fail) {
        fail = false;
        return new Response('boom', { status: 500 });
      }
      return { timeline: makeTimeline(), rubric: RUBRIC, rating: null };
    });
    const w = await mountDetail(makeRouter());
    expect(w.find('[data-testid="session-detail-error"]').exists()).toBe(true);

    await w.find('[data-testid="session-detail-retry"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="session-detail-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="session-detail-header"]').exists()).toBe(true);
    restore();
  });

  it('renders a dedicated 404 message when the transcript is not found', async () => {
    const restore = withFetch(() => new Response('not found', { status: 404 }));
    const w = await mountDetail(makeRouter());
    expect(w.find('[data-testid="session-detail-404"]').exists()).toBe(true);
    expect(w.text()).toContain("transcript was not found");
    // The generic error block is NOT shown for a 404.
    expect(w.find('[data-testid="session-detail-error"]').exists()).toBe(false);
    restore();
  });

  it('does NOT render the rating survey or rubric verdicts (WU v4-8 owns those)', async () => {
    const restore = withFetch(() => ({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }));
    const w = await mountDetail(makeRouter());
    expect(w.find('[data-testid="rating-survey"]').exists()).toBe(false);
    restore();
  });

  it('the back button navigates to the sessions list', async () => {
    const restore = withFetch(() => ({ timeline: makeTimeline(), rubric: RUBRIC, rating: null }));
    const router = makeRouter();
    const w = await mountDetail(router);
    await w.find('[data-testid="session-back-btn"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('sessions');
    restore();
  });
});
