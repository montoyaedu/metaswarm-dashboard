// WU v4-8 — RatingSurvey: the per-KPI rating survey (design §6.3 write side).
// Covers: 9 rows in enum order, the ≥1-verdict save-gate, partial save,
// re-rate pre-population, the per-row + bulk anchoring toggles, save-failure
// retaining the operator's input, and agree/disagree shown after a save.

import type {
  OperatorVerdict,
  SessionRating,
} from '@metaswarm-dashboard/types/ratings';
import type {
  ProcessRubricScore,
  RubricKey,
} from '@metaswarm-dashboard/types/sessions';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import RatingSurvey from '../components/RatingSurvey.vue';
import type { PutRatingBody, RatingsApi } from '../lib/ratings-api.js';
import { RUBRIC_KEYS } from '../lib/rubric-labels.js';

/** `RUBRIC_KEYS[i]` with the index narrowed — all 9 indices are populated. */
function keyAt(i: number): RubricKey {
  const k = RUBRIC_KEYS[i];
  if (k === undefined) throw new Error(`no RubricKey at index ${i}`);
  return k;
}

function makeRubric(over: Partial<ProcessRubricScore> = {}): ProcessRubricScore {
  return {
    schemaVersion: 1,
    sessionId: 'sess-a1',
    scoredAt: '2026-05-17T08:00:00.000Z',
    items: RUBRIC_KEYS.map((key, i) => ({
      key,
      label: `Label ${key}`,
      // Alternate verdicts so agree/disagree has both outcomes.
      verdict: ['pass', 'watch', 'fail'][i % 3] as 'pass' | 'watch' | 'fail',
      evidence: `evidence for ${key}`,
      pointer: null,
    })),
    overall: 'watch',
    ...over,
  };
}

function makeRating(verdicts: OperatorVerdict[], overallNote?: string): SessionRating {
  return {
    schemaVersion: 1,
    sessionId: 'sess-a1',
    projectName: 'alpha',
    verdicts,
    overallNote,
    ratedAt: '2026-05-17T09:00:00.000Z',
    rubricAtRating: makeRubric(),
  };
}

/** A fake RatingsApi whose putRating resolves to a caller-provided rating;
 *  the read methods are never exercised by the survey. */
function fakeApi(
  putImpl: (project: string, sessionId: string, body: PutRatingBody) => Promise<SessionRating>,
): RatingsApi {
  const unused = (): Promise<never> =>
    Promise.reject(new Error('not used by RatingSurvey'));
  return {
    getSessions: unused,
    getSession: unused,
    getCalibration: unused,
    putRating: vi.fn(putImpl),
  };
}

function mountSurvey(opts: {
  rating?: SessionRating | null;
  api?: RatingsApi;
  rubric?: ProcessRubricScore;
}): ReturnType<typeof mount> {
  return mount(RatingSurvey, {
    props: {
      project: 'alpha',
      sessionId: 'sess-a1',
      rubric: opts.rubric ?? makeRubric(),
      rating: opts.rating ?? null,
      api: opts.api ?? fakeApi(() => Promise.resolve(makeRating([]))),
    },
  });
}

/** Pick a verdict on a row by clicking the matching radio input. */
async function pickVerdict(
  w: ReturnType<typeof mount>,
  rowIndex: number,
  verdict: string,
): Promise<void> {
  const radio = w.find(
    `[data-testid="survey-verdict-${rowIndex}-${verdict}"] input`,
  );
  await radio.setValue();
  await flushPromises();
}

describe('RatingSurvey — rendering', () => {
  it('renders exactly 9 KPI rows, one per RubricKey, in enum order', () => {
    const w = mountSurvey({});
    const rows = w.findAll('[data-testid^="survey-row-"]');
    expect(rows).toHaveLength(9);
    RUBRIC_KEYS.forEach((key, i) => {
      expect(w.find(`[data-testid="survey-row-${i}"]`).attributes('data-key')).toBe(key);
    });
  });

  it('shows the rubric label for each row', () => {
    const w = mountSurvey({});
    expect(w.find('[data-testid="survey-row-0"]').text()).toContain(
      `Label ${RUBRIC_KEYS[0]}`,
    );
  });

  it('starts with no verdict selected on any row', () => {
    const w = mountSurvey({});
    const checked = w.findAll('input[type="radio"]:checked');
    expect(checked).toHaveLength(0);
  });
});

describe('RatingSurvey — the save gate', () => {
  it('disables save until at least one verdict is selected', async () => {
    const w = mountSurvey({});
    const save = w.find('[data-testid="survey-save"]');
    expect(save.attributes('disabled')).toBeDefined();

    await pickVerdict(w, 0, 'pass');
    expect(w.find('[data-testid="survey-save"]').attributes('disabled')).toBeUndefined();
  });

  it('the save button label reports N of 9 rated', async () => {
    const w = mountSurvey({});
    expect(w.find('[data-testid="survey-save"]').text()).toContain('0 of 9');
    await pickVerdict(w, 0, 'pass');
    await pickVerdict(w, 1, 'fail');
    expect(w.find('[data-testid="survey-save"]').text()).toContain('2 of 9');
  });
});

describe('RatingSurvey — partial save', () => {
  it('PUTs only the selected rows; unselected rows are omitted from verdicts[]', async () => {
    let captured: PutRatingBody | undefined;
    const api = fakeApi((_p, _s, body) => {
      captured = body;
      return Promise.resolve(makeRating(body.verdicts, body.overallNote));
    });
    const w = mountSurvey({ api });

    await pickVerdict(w, 0, 'pass');
    await pickVerdict(w, 4, 'watch');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();

    expect(captured?.verdicts).toHaveLength(2);
    const keys = captured?.verdicts.map((v) => v.key).sort();
    expect(keys).toEqual([RUBRIC_KEYS[0], RUBRIC_KEYS[4]].sort());
  });

  it('emits a "saved" event with the persisted rating after a successful save', async () => {
    const persisted = makeRating([
      { key: keyAt(0), verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
    ]);
    const api = fakeApi(() => Promise.resolve(persisted));
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();

    expect(w.emitted('saved')).toBeTruthy();
    expect(w.emitted('saved')?.[0]?.[0]).toEqual(persisted);
  });

  it('includes the overall note in the PUT body when entered', async () => {
    let captured: PutRatingBody | undefined;
    const api = fakeApi((_p, _s, body) => {
      captured = body;
      return Promise.resolve(makeRating(body.verdicts, body.overallNote));
    });
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass');
    await w.find('[data-testid="survey-overall-note"] textarea').setValue('went well overall');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    expect(captured?.overallNote).toBe('went well overall');
  });

  it('includes a per-row note in the matching verdict when entered', async () => {
    let captured: PutRatingBody | undefined;
    const api = fakeApi((_p, _s, body) => {
      captured = body;
      return Promise.resolve(makeRating(body.verdicts, body.overallNote));
    });
    const w = mountSurvey({ api });
    await pickVerdict(w, 2, 'fail');
    await w.find('[data-testid="survey-note-toggle-2"]').trigger('click');
    await w.find('[data-testid="survey-note-2"] textarea').setValue('flaky here');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    expect(captured?.verdicts[0]?.note).toBe('flaky here');
  });
});

describe('RatingSurvey — re-rate pre-population', () => {
  it('pre-populates rows from an existing rating', () => {
    const rating = makeRating(
      [
        { key: keyAt(1), verdict: 'fail', scoredAt: '2026-05-17T09:00:00.000Z' },
        { key: keyAt(3), verdict: 'na', scoredAt: '2026-05-17T09:00:00.000Z' },
      ],
      'prior overall note',
    );
    const w = mountSurvey({ rating });

    expect(
      (w.find('[data-testid="survey-verdict-1-fail"] input').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (w.find('[data-testid="survey-verdict-3-na"] input').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (w.find('[data-testid="survey-overall-note"] textarea').element as HTMLTextAreaElement)
        .value,
    ).toBe('prior overall note');
    expect(w.find('[data-testid="survey-save"]').text()).toContain('2 of 9');
  });

  it('a re-rate re-PUTs (upsert) with the edited verdicts', async () => {
    let captured: PutRatingBody | undefined;
    const rating = makeRating([
      { key: keyAt(0), verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
    ]);
    const api = fakeApi((_p, _s, body) => {
      captured = body;
      return Promise.resolve(makeRating(body.verdicts));
    });
    const w = mountSurvey({ rating, api });

    // Change row 0 from pass → fail, then save.
    await pickVerdict(w, 0, 'fail');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();

    expect(captured?.verdicts[0]?.verdict).toBe('fail');
  });
});

describe('RatingSurvey — anchoring toggles', () => {
  it('rubric suggestions are hidden by default (anti-anchoring)', () => {
    const w = mountSurvey({});
    expect(w.find('[data-testid="survey-suggestion-0"]').exists()).toBe(false);
  });

  it('the per-row toggle reveals that row\'s rubric suggestion + evidence', async () => {
    const w = mountSurvey({});
    await w.find('[data-testid="survey-suggestion-toggle-0"]').trigger('click');
    const sug = w.find('[data-testid="survey-suggestion-0"]');
    expect(sug.exists()).toBe(true);
    expect(sug.text()).toContain(`evidence for ${RUBRIC_KEYS[0]}`);
  });

  it('the "show all suggestions" bulk toggle reveals every row\'s suggestion', async () => {
    const w = mountSurvey({});
    expect(w.findAll('.suggestion')).toHaveLength(0);
    await w.find('[data-testid="survey-show-all"]').trigger('click');
    expect(w.findAll('.suggestion')).toHaveLength(9);
    // Each row's suggestion panel exists by its precise testid.
    for (let i = 0; i < 9; i += 1) {
      expect(w.find(`[data-testid="survey-suggestion-${i}"]`).exists()).toBe(true);
    }
  });

  it('the bulk toggle hides all suggestions when they are already shown', async () => {
    const w = mountSurvey({});
    await w.find('[data-testid="survey-show-all"]').trigger('click');
    expect(w.findAll('.suggestion')).toHaveLength(9);
    await w.find('[data-testid="survey-show-all"]').trigger('click');
    expect(w.findAll('.suggestion')).toHaveLength(0);
  });

  it('renders rubric evidence as TEXT — never via v-html', async () => {
    const rubric = makeRubric({
      items: makeRubric().items.map((it, i) =>
        i === 0 ? { ...it, evidence: '<img src=x onerror=alert(1)>' } : it,
      ),
    });
    const w = mountSurvey({ rubric });
    await w.find('[data-testid="survey-suggestion-toggle-0"]').trigger('click');
    const sug = w.find('[data-testid="survey-suggestion-0"]');
    expect(sug.text()).toContain('<img src=x onerror=alert(1)>');
    expect(sug.find('img').exists()).toBe(false);
  });
});

describe('RatingSurvey — save failure', () => {
  it('shows an inline error banner and RETAINS the entered verdicts on failure', async () => {
    const api = fakeApi(() => Promise.reject(new Error('network down')));
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass');
    await pickVerdict(w, 1, 'fail');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="survey-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="survey-error"]').text()).toContain('network down');
    // The operator's verdicts are NOT discarded.
    expect(
      (w.find('[data-testid="survey-verdict-0-pass"] input').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (w.find('[data-testid="survey-verdict-1-fail"] input').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(w.find('[data-testid="survey-save"]').text()).toContain('2 of 9');
  });

  it('wraps a non-Error rejection into an Error for the banner', async () => {
    // A rejection that is NOT an `Error` instance must still surface as a
    // message — the catch in `save()` coerces it via `String(err)`. Mirrors
    // the `rejectingClient` pattern in composable-error-coverage.test.ts.
    const thrown: unknown = 'plain string failure';
    const api = fakeApi(() =>
      Promise.resolve().then((): SessionRating => {
        throw thrown;
      }),
    );
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="survey-error"]').text()).toContain(
      'plain string failure',
    );
  });

  it('Retry re-submits and succeeds after a transient failure', async () => {
    let fail = true;
    const api = fakeApi((_p, _s, body) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('transient'));
      }
      return Promise.resolve(makeRating(body.verdicts));
    });
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="survey-error"]').exists()).toBe(true);

    await w.find('[data-testid="survey-retry"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="survey-error"]').exists()).toBe(false);
    expect(w.emitted('saved')).toBeTruthy();
  });
});

describe('RatingSurvey — agree/disagree after save', () => {
  it('shows agree/disagree per rated row vs the persisted rubricAtRating', async () => {
    // Persisted rubric: row 0 = pass, row 1 = watch (from makeRubric alternation).
    const persistedRubric = makeRubric();
    const api = fakeApi((_p, _s, body) =>
      Promise.resolve({
        ...makeRating(body.verdicts, body.overallNote),
        rubricAtRating: persistedRubric,
      }),
    );
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'pass'); // matches rubric row 0 = pass → agree
    await pickVerdict(w, 1, 'fail'); // rubric row 1 = watch → disagree
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="survey-agreement-0"]').text().toLowerCase()).toContain('agree');
    expect(w.find('[data-testid="survey-agreement-1"]').text().toLowerCase()).toContain(
      'disagree',
    );
  });

  it('does not show agree/disagree for an `na` verdict', async () => {
    const api = fakeApi((_p, _s, body) => Promise.resolve(makeRating(body.verdicts)));
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'na');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    // The row was rated `na` — excluded from agree/disagree.
    expect(w.find('[data-testid="survey-agreement-0"]').exists()).toBe(false);
  });

  it('does not show agree/disagree for an `unsure` verdict', async () => {
    const api = fakeApi((_p, _s, body) => Promise.resolve(makeRating(body.verdicts)));
    const w = mountSurvey({ api });
    await pickVerdict(w, 0, 'unsure');
    await w.find('[data-testid="survey-save"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="survey-agreement-0"]').exists()).toBe(false);
  });

  it('does not show agreement before a save', async () => {
    const w = mountSurvey({});
    await pickVerdict(w, 0, 'pass');
    expect(w.find('[data-testid="survey-agreement-0"]').exists()).toBe(false);
  });
});
