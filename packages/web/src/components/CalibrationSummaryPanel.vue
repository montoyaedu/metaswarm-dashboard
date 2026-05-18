<script setup lang="ts">
// The calibration summary panel — shown on /sessions (design §6.4). Per
// `RubricKey`: a rubric-vs-operator agreement bar (`agree / (agree+disagree)`
// as a %), the sample count `N` (= agree + disagree + naOrUnsure), and the
// `naOrUnsure` count.
//
// Two thresholds (design §6.4):
//  - small-N floor: a KPI with N < 5 is greyed/disabled ("not enough ratings
//    yet") — agreement on a handful of ratings is noise.
//  - retire flag: a KPI with N ≥ 5 AND agreementRatio < 0.6 is flagged
//    "consider retiring" — the rubric systematically disagrees with the
//    operator there.
//
// Empty (no ratings at all) → "Rate sessions to start calibrating." Loading
// and error states mirror the other Sessions views.

import type { CalibrationSummary, KpiAgreement } from '@metaswarm-dashboard/types/ratings';
import { NButton, NSkeleton } from 'naive-ui';
import { computed, onMounted, ref } from 'vue';

import { createRatingsApi, type RatingsApi } from '../lib/ratings-api.js';
import { rubricLabel } from '../lib/rubric-labels.js';

/** N < this is too few ratings to draw a conclusion (design §6.4). */
const MIN_SAMPLE = 5;
/** Agreement below this (with N ≥ MIN_SAMPLE) flags the KPI for retirement. */
const RETIRE_FLOOR = 0.6;

const props = defineProps<{
  /** Injectable for tests; defaults to the real fetch-backed client. */
  api?: RatingsApi;
}>();
const api = computed<RatingsApi>(() => props.api ?? createRatingsApi());

const summary = ref<CalibrationSummary | null>(null);
const loading = ref(true);
const error = ref<Error | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await api.value.getCalibration();
  } catch (err) {
    summary.value = null;
    error.value = err instanceof Error ? err : new Error(String(err));
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

/** The sample size for a KPI — design §6.4 defines N as the verdict count. */
function sampleN(k: KpiAgreement): number {
  return k.agree + k.disagree + k.naOrUnsure;
}

/** A KPI projected for display: derived flags + the agreement percentage. */
interface KpiView {
  key: KpiAgreement['key'];
  label: string;
  n: number;
  naOrUnsure: number;
  /** agreement % (0..100), or null when there is no agree/disagree data. */
  percent: number | null;
  insufficient: boolean;
  retire: boolean;
}

const kpis = computed<KpiView[]>(() => {
  const s = summary.value;
  /* v8 ignore next — `kpis` is only read once `summary` is non-null. */
  if (s === null) return [];
  return s.perKpi.map((k) => {
    const n = sampleN(k);
    const insufficient = n < MIN_SAMPLE;
    const percent = k.agreementRatio === null ? null : Math.round(k.agreementRatio * 100);
    return {
      key: k.key,
      label: rubricLabel(k.key),
      n,
      naOrUnsure: k.naOrUnsure,
      percent,
      insufficient,
      retire:
        !insufficient &&
        k.agreementRatio !== null &&
        k.agreementRatio < RETIRE_FLOOR,
    };
  });
});

/** True when no session has been rated at all — the empty state. */
const isEmpty = computed(
  () => summary.value !== null && summary.value.ratedSessionCount === 0,
);
</script>

<template>
  <section class="calibration-panel" data-testid="calibration-panel">
    <h2>Rubric calibration</h2>

    <div v-if="loading" data-testid="calibration-loading" class="skeleton">
      <NSkeleton v-for="n in 3" :key="n" text height="1.6rem" />
    </div>

    <div v-else-if="error" data-testid="calibration-error" class="error">
      <p>Could not load calibration: {{ error.message }}</p>
      <NButton data-testid="calibration-retry" size="small" @click="load">
        Retry
      </NButton>
    </div>

    <p v-else-if="isEmpty" data-testid="calibration-empty" class="empty">
      Rate sessions to start calibrating.
    </p>

    <ul v-else class="kpi-list">
      <li
        v-for="(k, i) in kpis"
        :key="k.key"
        class="kpi"
        :class="{ 'kpi--insufficient': k.insufficient }"
        :data-testid="`calibration-kpi-${i}`"
      >
        <div class="kpi-head">
          <span class="kpi-label">{{ k.label }}</span>
          <span
            v-if="k.retire"
            class="retire"
            :data-testid="`calibration-retire-${i}`"
          >
            ⚠ consider retiring
          </span>
        </div>

        <div class="bar-track">
          <div
            class="bar-fill"
            :data-testid="`calibration-bar-${i}`"
            :style="{ width: `${k.percent ?? 0}%` }"
          />
        </div>

        <div class="kpi-stats">
          <span class="pct">{{ k.percent === null ? '—' : `${k.percent}%` }} agreement</span>
          <span class="dot">·</span>
          <span :data-testid="`calibration-n-${i}`">N = {{ k.n }}</span>
          <span class="dot">·</span>
          <span :data-testid="`calibration-naunsure-${i}`">
            {{ k.naOrUnsure }} na/unsure
          </span>
        </div>

        <p v-if="k.insufficient" class="insufficient-note">
          not enough ratings yet
        </p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.calibration-panel {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.calibration-panel h2 {
  margin: 0 0 0.75rem 0;
  font-size: 1.05rem;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.error {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
  color: #e88080;
  font-size: 0.85rem;
}

.empty {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.kpi-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
}

.kpi {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 5px;
  padding: 0.6rem;
}

.kpi--insufficient {
  opacity: 0.45;
}

.kpi-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.kpi-label {
  font-weight: 600;
  font-size: 0.88rem;
}

.retire {
  color: #f0a020;
  font-size: 0.74rem;
  font-weight: 600;
}

.bar-track {
  margin: 0.4rem 0 0.3rem 0;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: #63e2b7;
}

.kpi-stats {
  display: flex;
  gap: 0.35rem;
  font-size: 0.78rem;
  opacity: 0.8;
  flex-wrap: wrap;
}

.dot {
  opacity: 0.4;
}

.insufficient-note {
  margin: 0.3rem 0 0 0;
  font-size: 0.76rem;
  font-style: italic;
}
</style>
