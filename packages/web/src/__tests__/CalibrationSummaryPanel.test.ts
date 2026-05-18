// WU v4-8 — CalibrationSummaryPanel: the per-KPI agreement panel on /sessions
// (design §6.4). Covers: agreement bar + N + naOrUnsure per KPI; the N<5
// greyed "not enough ratings" floor; the N≥5 + agreementRatio<0.6 "consider
// retiring" flag; the empty / loading / error states.

import type { CalibrationSummary, KpiAgreement } from '@metaswarm-dashboard/types/ratings';
import type { RubricKey } from '@metaswarm-dashboard/types/sessions';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import CalibrationSummaryPanel from '../components/CalibrationSummaryPanel.vue';
import type { RatingsApi } from '../lib/ratings-api.js';
import { RatingsApiError } from '../lib/ratings-api.js';
import { RUBRIC_KEYS } from '../lib/rubric-labels.js';

/** `RUBRIC_KEYS[i]` with the index narrowed — all 9 indices are populated. */
function keyAt(i: number): RubricKey {
  const k = RUBRIC_KEYS[i];
  if (k === undefined) throw new Error(`no RubricKey at index ${i}`);
  return k;
}

function kpi(over: Partial<KpiAgreement> & Pick<KpiAgreement, 'key'>): KpiAgreement {
  return {
    agree: 0,
    disagree: 0,
    naOrUnsure: 0,
    total: 0,
    agreementRatio: null,
    ...over,
  };
}

function makeSummary(perKpi: KpiAgreement[], ratedSessionCount = 5): CalibrationSummary {
  return {
    schemaVersion: 1,
    generatedAt: '2026-05-17T12:00:00.000Z',
    ratedSessionCount,
    perKpi,
  };
}

/** All-zero summary — the no-ratings empty state. */
const EMPTY_SUMMARY = makeSummary(
  RUBRIC_KEYS.map((key) => kpi({ key })),
  0,
);

/** A fake RatingsApi exposing only getCalibration; the others are unused. */
function fakeApi(getCalibration: () => Promise<CalibrationSummary>): RatingsApi {
  const unused = (): Promise<never> =>
    Promise.reject(new Error('not used by CalibrationSummaryPanel'));
  return {
    getSessions: unused,
    getSession: unused,
    getCalibration: vi.fn(getCalibration),
    putRating: unused,
  };
}

async function mountPanel(api: RatingsApi): Promise<ReturnType<typeof mount>> {
  const w = mount(CalibrationSummaryPanel, { props: { api } });
  await flushPromises();
  return w;
}

describe('CalibrationSummaryPanel — loading', () => {
  it('shows a loading state before the fetch resolves', async () => {
    let resolve: ((s: CalibrationSummary) => void) | undefined;
    const api = fakeApi(() => new Promise((r) => { resolve = r; }));
    const w = mount(CalibrationSummaryPanel, { props: { api } });
    expect(w.find('[data-testid="calibration-loading"]').exists()).toBe(true);
    resolve?.(EMPTY_SUMMARY);
    await flushPromises();
    expect(w.find('[data-testid="calibration-loading"]').exists()).toBe(false);
  });
});

describe('CalibrationSummaryPanel — empty state', () => {
  it('shows "Rate sessions to start calibrating" when there are no ratings', async () => {
    const w = await mountPanel(fakeApi(() => Promise.resolve(EMPTY_SUMMARY)));
    const empty = w.find('[data-testid="calibration-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Rate sessions to start calibrating');
  });
});

describe('CalibrationSummaryPanel — error state', () => {
  it('shows an error message and a Retry button on a failed fetch', async () => {
    const api = fakeApi(() => Promise.reject(new RatingsApiError('GET /api/calibration → 503', 503)));
    const w = await mountPanel(api);
    const err = w.find('[data-testid="calibration-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('503');
    expect(w.find('[data-testid="calibration-retry"]').exists()).toBe(true);
  });

  it('wraps a non-Error rejection into an Error for the banner', async () => {
    // The catch in `load()` coerces a non-Error rejection via `String(err)`.
    const thrown: unknown = 'odd failure';
    const api = fakeApi(() =>
      Promise.resolve().then((): CalibrationSummary => {
        throw thrown;
      }),
    );
    const w = await mountPanel(api);
    expect(w.find('[data-testid="calibration-error"]').text()).toContain(
      'odd failure',
    );
  });

  it('Retry recovers from a transient error', async () => {
    let fail = true;
    const api = fakeApi(() => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error('transient'));
      }
      return Promise.resolve(makeSummary(RUBRIC_KEYS.map((key) => kpi({ key, total: 6, agree: 5, disagree: 1, agreementRatio: 5 / 6 }))));
    });
    const w = await mountPanel(api);
    expect(w.find('[data-testid="calibration-error"]').exists()).toBe(true);
    await w.find('[data-testid="calibration-retry"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="calibration-error"]').exists()).toBe(false);
    expect(w.findAll('[data-testid^="calibration-kpi-"]').length).toBeGreaterThan(0);
  });
});

describe('CalibrationSummaryPanel — per-KPI rendering', () => {
  it('renders one row per RubricKey', async () => {
    const summary = makeSummary(
      RUBRIC_KEYS.map((key) => kpi({ key, total: 6, agree: 4, disagree: 2, agreementRatio: 4 / 6 })),
    );
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    expect(w.findAll('[data-testid^="calibration-kpi-"]')).toHaveLength(9);
  });

  it('shows the agreement %, N, and naOrUnsure count for a healthy KPI', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 8, disagree: 2, naOrUnsure: 1, total: 11, agreementRatio: 0.8 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    const row = w.find('[data-testid="calibration-kpi-0"]');
    expect(row.text()).toContain('80%');
    // N = agree + disagree + naOrUnsure = 11.
    expect(row.find('[data-testid="calibration-n-0"]').text()).toContain('11');
    expect(row.find('[data-testid="calibration-naunsure-0"]').text()).toContain('1');
  });

  it('renders an agreement bar whose width reflects the ratio', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 6, disagree: 0, naOrUnsure: 0, total: 6, agreementRatio: 1 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    const bar = w.find('[data-testid="calibration-bar-0"]');
    expect(bar.exists()).toBe(true);
    expect(bar.attributes('style')).toContain('100%');
  });
});

describe('CalibrationSummaryPanel — the small-N floor', () => {
  it('greys out a KPI with N < 5 and shows "not enough ratings yet"', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 2, disagree: 1, naOrUnsure: 0, total: 3, agreementRatio: 2 / 3 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    const row = w.find('[data-testid="calibration-kpi-0"]');
    expect(row.classes()).toContain('kpi--insufficient');
    expect(row.text().toLowerCase()).toContain('not enough ratings');
  });

  it('does NOT grey out a KPI with N ≥ 5', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 4, disagree: 1, naOrUnsure: 0, total: 5, agreementRatio: 0.8 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    const row = w.find('[data-testid="calibration-kpi-0"]');
    expect(row.classes()).not.toContain('kpi--insufficient');
  });
});

describe('CalibrationSummaryPanel — the retire flag', () => {
  it('flags "consider retiring" for a KPI with N ≥ 5 and ratio < 0.6', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 2, disagree: 4, naOrUnsure: 0, total: 6, agreementRatio: 2 / 6 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    const row = w.find('[data-testid="calibration-kpi-0"]');
    expect(row.find('[data-testid="calibration-retire-0"]').exists()).toBe(true);
    expect(row.text().toLowerCase()).toContain('consider retiring');
  });

  it('does NOT flag a KPI with N ≥ 5 and ratio ≥ 0.6', async () => {
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 4, disagree: 2, naOrUnsure: 0, total: 6, agreementRatio: 4 / 6 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    expect(w.find('[data-testid="calibration-retire-0"]').exists()).toBe(false);
  });

  it('does NOT flag a small-N KPI even if its ratio is below the floor', async () => {
    // N < 5 → insufficient; the retire flag must not fire on noise.
    const summary = makeSummary([
      kpi({ key: keyAt(0), agree: 1, disagree: 3, naOrUnsure: 0, total: 4, agreementRatio: 0.25 }),
      ...RUBRIC_KEYS.slice(1).map((key) => kpi({ key })),
    ]);
    const w = await mountPanel(fakeApi(() => Promise.resolve(summary)));
    expect(w.find('[data-testid="calibration-retire-0"]').exists()).toBe(false);
  });
});
