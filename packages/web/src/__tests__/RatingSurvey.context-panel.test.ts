// WU v5-8 — RatingSurvey F1 survey-context panel (design §8.1). Covers: the
// bordered panel above the 9 KPI rows; the `aiTitle` heading (and the
// "Untitled session" fallback); the first user prompt with the inline
// "show all N prompts" expander; the tool-use action summary (incl. the
// zero-tools literal); the no-prompts omission; XSS-safe text interpolation;
// and the inline-expand invariant — the panel expander never reorders /
// pushes the KPI rows.

import type {
  ProcessRubricScore,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import RatingSurvey from '../components/RatingSurvey.vue';
import type { RatingsApi } from '../lib/ratings-api.js';
import { RUBRIC_KEYS } from '../lib/rubric-labels.js';

function makeRubric(): ProcessRubricScore {
  return {
    schemaVersion: 1,
    sessionId: 'sess-a1',
    scoredAt: '2026-05-18T08:00:00.000Z',
    items: RUBRIC_KEYS.map((key) => ({
      key,
      label: `Label ${key}`,
      verdict: 'pass' as const,
      evidence: `evidence for ${key}`,
      pointer: null,
    })),
    overall: 'pass',
  };
}

/** A `RatingsApi` whose methods are never exercised by these render tests. */
function inertApi(): RatingsApi {
  const unused = (): Promise<never> =>
    Promise.reject(new Error('not used by the context-panel tests'));
  return {
    getSessions: unused,
    getSession: unused,
    getCalibration: unused,
    putRating: unused,
  };
}

function evt(over: Partial<ToolUseEvent> = {}): ToolUseEvent {
  return {
    at: '2026-05-18T06:00:00.000Z',
    kind: 'user-prompt',
    toolName: null,
    summary: 'an event',
    redactionApplied: [],
    uuid: null,
    ...over,
  };
}

function makeTimeline(over: Partial<SessionTimeline> = {}): SessionTimeline {
  return {
    schemaVersion: 1,
    transcriptPath: '/transcripts/alpha/sess-a1.jsonl',
    sessionId: 'sess-a1',
    projectCwd: '/repos/alpha',
    startedAt: '2026-05-18T06:00:00.000Z',
    lastEventAt: '2026-05-18T06:30:00.000Z',
    eventCount: 0,
    skippedLineCount: 0,
    events: [],
    aiTitle: null,
    ...over,
  };
}

function mountSurvey(opts: {
  timeline?: SessionTimeline;
  rubric?: ProcessRubricScore;
}): ReturnType<typeof mount> {
  return mount(RatingSurvey, {
    props: {
      project: 'alpha',
      sessionId: 'sess-a1',
      rubric: opts.rubric ?? makeRubric(),
      rating: null,
      timeline: opts.timeline ?? makeTimeline(),
      api: inertApi(),
    },
  });
}

describe('RatingSurvey context panel — heading', () => {
  it('renders the panel above the first KPI row', () => {
    const w = mountSurvey({ timeline: makeTimeline({ aiTitle: 'My session' }) });
    const panel = w.find('[data-testid="survey-context-panel"]');
    expect(panel.exists()).toBe(true);
    // The panel's DOM position precedes the first KPI row.
    const html = w.html();
    expect(html.indexOf('survey-context-panel')).toBeLessThan(
      html.indexOf('survey-row-0'),
    );
  });

  it('shows the aiTitle as the panel heading', () => {
    const w = mountSurvey({
      timeline: makeTimeline({ aiTitle: 'Refactor the cost cache' }),
    });
    expect(w.find('[data-testid="survey-context-heading"]').text()).toBe(
      'Refactor the cost cache',
    );
  });

  it('falls back to "Untitled session" when aiTitle is null', () => {
    const w = mountSurvey({ timeline: makeTimeline({ aiTitle: null }) });
    expect(w.find('[data-testid="survey-context-heading"]').text()).toBe(
      'Untitled session',
    );
  });

  it('falls back to "Untitled session" when aiTitle is absent (undefined)', () => {
    // v5-6 made `aiTitle` Zod `.optional()` — the field can be undefined.
    const t = makeTimeline();
    delete (t as { aiTitle?: string | null }).aiTitle;
    const w = mountSurvey({ timeline: t });
    expect(w.find('[data-testid="survey-context-heading"]').text()).toBe(
      'Untitled session',
    );
  });
});

describe('RatingSurvey context panel — prompts', () => {
  it('shows the first user prompt', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-prompt', summary: 'do the first thing' }),
          evt({ kind: 'user-prompt', summary: 'then the second' }),
        ],
      }),
    });
    const prompts = w.find('[data-testid="survey-context-prompts"]');
    expect(prompts.exists()).toBe(true);
    expect(prompts.text()).toContain('do the first thing');
  });

  it('hides the later prompts until the expander is clicked', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-prompt', summary: 'first prompt' }),
          evt({ kind: 'user-prompt', summary: 'second prompt' }),
          evt({ kind: 'user-prompt', summary: 'third prompt' }),
        ],
      }),
    });
    expect(w.find('[data-testid="survey-context-prompts"]').text()).not.toContain(
      'second prompt',
    );
    expect(w.find('[data-testid="survey-context-prompts-more"]').exists()).toBe(false);
  });

  it('the "show all N prompts" expander reveals the remaining prompts inline', async () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-prompt', summary: 'first prompt' }),
          evt({ kind: 'user-prompt', summary: 'second prompt' }),
          evt({ kind: 'user-prompt', summary: 'third prompt' }),
        ],
      }),
    });
    const toggle = w.find('[data-testid="survey-context-prompts-toggle"]');
    expect(toggle.exists()).toBe(true);
    // The control names the total prompt count.
    expect(toggle.text()).toContain('3');

    await toggle.trigger('click');
    const more = w.find('[data-testid="survey-context-prompts-more"]');
    expect(more.exists()).toBe(true);
    expect(more.text()).toContain('second prompt');
    expect(more.text()).toContain('third prompt');
  });

  it('does not show the expander when there is only one prompt', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [evt({ kind: 'user-prompt', summary: 'the only prompt' })],
      }),
    });
    expect(w.find('[data-testid="survey-context-prompts"]').exists()).toBe(true);
    expect(w.find('[data-testid="survey-context-prompts-toggle"]').exists()).toBe(false);
  });

  it('omits the prompts block entirely when there are zero user prompts', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-command', summary: '/start-task' }),
          evt({ kind: 'tool-use', toolName: 'Read', summary: 'read a file' }),
        ],
      }),
    });
    expect(w.find('[data-testid="survey-context-prompts"]').exists()).toBe(false);
  });

  it('excludes user-command (slash-command) events from the prompts', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-command', summary: '/prime' }),
          evt({ kind: 'user-prompt', summary: 'a genuine prompt' }),
        ],
      }),
    });
    const prompts = w.find('[data-testid="survey-context-prompts"]');
    expect(prompts.text()).toContain('a genuine prompt');
    expect(prompts.text()).not.toContain('/prime');
  });
});

describe('RatingSurvey context panel — action summary', () => {
  it('renders the tool-use counts descending by count', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'tool-use', toolName: 'Read' }),
          evt({ kind: 'tool-use', toolName: 'Edit' }),
          evt({ kind: 'tool-use', toolName: 'Read' }),
          evt({ kind: 'tool-use', toolName: 'Read' }),
          evt({ kind: 'tool-use', toolName: 'Edit' }),
          evt({ kind: 'tool-use', toolName: 'Bash' }),
        ],
      }),
    });
    expect(w.find('[data-testid="survey-context-actions"]').text()).toContain(
      'Read ×3 · Edit ×2 · Bash ×1',
    );
  });

  it('renders "no tool calls recorded" when there are zero tool-uses', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [evt({ kind: 'user-prompt', summary: 'a prompt' })],
      }),
    });
    expect(w.find('[data-testid="survey-context-actions"]').text()).toContain(
      'no tool calls recorded',
    );
  });
});

describe('RatingSurvey context panel — XSS safety', () => {
  it('renders the aiTitle as TEXT — never via v-html', () => {
    const w = mountSurvey({
      timeline: makeTimeline({ aiTitle: '<img src=x onerror=alert(1)>' }),
    });
    const heading = w.find('[data-testid="survey-context-heading"]');
    expect(heading.text()).toContain('<img src=x onerror=alert(1)>');
    expect(heading.find('img').exists()).toBe(false);
  });

  it('renders a user prompt as TEXT — never via v-html', () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-prompt', summary: '<script>alert(1)</script>' }),
        ],
      }),
    });
    const prompts = w.find('[data-testid="survey-context-prompts"]');
    expect(prompts.text()).toContain('<script>alert(1)</script>');
    expect(prompts.find('script').exists()).toBe(false);
  });

  it('truncates a very long prompt summary', () => {
    const longPrompt = 'x'.repeat(800);
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [evt({ kind: 'user-prompt', summary: longPrompt })],
      }),
    });
    const prompts = w.find('[data-testid="survey-context-prompts"]');
    expect(prompts.text()).toContain('…');
    expect(prompts.text().length).toBeLessThan(longPrompt.length);
  });
});

describe('RatingSurvey context panel — inline-expand invariant', () => {
  it('keeps the 9 KPI rows after the panel before and after the expander toggles', async () => {
    const w = mountSurvey({
      timeline: makeTimeline({
        events: [
          evt({ kind: 'user-prompt', summary: 'first prompt' }),
          evt({ kind: 'user-prompt', summary: 'second prompt' }),
        ],
      }),
    });
    // The 9 KPI rows live in their own <ol>, a sibling AFTER the panel.
    const rowsBefore = w.findAll('[data-testid^="survey-row-"]');
    expect(rowsBefore).toHaveLength(9);
    const firstRowIdBefore = w.find('[data-testid="survey-row-0"]').attributes('data-key');

    await w.find('[data-testid="survey-context-prompts-toggle"]').trigger('click');

    // Expanding the panel adds rows INSIDE the panel — the KPI <ol> is
    // untouched: still 9 rows, still the same first row, still after the panel.
    const rowsAfter = w.findAll('[data-testid^="survey-row-"]');
    expect(rowsAfter).toHaveLength(9);
    expect(w.find('[data-testid="survey-row-0"]').attributes('data-key')).toBe(
      firstRowIdBefore,
    );
    const html = w.html();
    expect(html.indexOf('survey-context-panel')).toBeLessThan(
      html.indexOf('survey-row-0'),
    );
    // The expanded prompts live inside the panel, before the KPI rows.
    expect(html.indexOf('survey-context-prompts-more')).toBeLessThan(
      html.indexOf('survey-row-0'),
    );
  });

  it('renders the panel even when the timeline has no events', () => {
    const w = mountSurvey({ timeline: makeTimeline({ events: [] }) });
    expect(w.find('[data-testid="survey-context-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="survey-context-prompts"]').exists()).toBe(false);
    expect(w.find('[data-testid="survey-context-actions"]').text()).toContain(
      'no tool calls recorded',
    );
  });
});
