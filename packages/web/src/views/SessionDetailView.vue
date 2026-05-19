<script setup lang="ts">
// Session detail — renders a header, the event timeline, and (WU v4-8) the
// per-session rating survey below the timeline (design §6.3).
//
// SECURITY: all transcript-derived content flows through child components
// that interpolate it as TEXT — `v-html` is never used here. See §6.3 / §11.

import type { SessionRating } from '@metaswarm-dashboard/types/ratings';
import { NButton, NSkeleton, NTooltip } from 'naive-ui';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import RatingSurvey from '../components/RatingSurvey.vue';
import SessionEventTimeline from '../components/SessionEventTimeline.vue';
import { useSessionDetail } from '../composables/useSessionDetail.js';
import { formatTokenCount, formatUsd } from '../lib/cost-format.js';
import { isInProgress } from '../lib/session-format.js';

const route = useRoute();
const router = useRouter();

/** Coerce a route param (which is `string | string[]`) to a single string. */
function paramStr(value: string | string[] | undefined): string {
  /* v8 ignore start — vue-router 4 passes a string for these single params;
     the array/undefined arms are defensive against future route changes. */
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
  /* v8 ignore stop */
}

const project = computed(() => paramStr(route.params.project));
const sessionId = computed(() => paramStr(route.params.sessionId));

const { detail, loading, error, notFound, reload } = useSessionDetail(project, sessionId);

const startedLabel = computed(() => {
  const at = detail.value?.timeline.startedAt;
  return at === undefined ? '' : new Date(at).toLocaleString();
});

const inProgress = computed(() => {
  const at = detail.value?.timeline.lastEventAt;
  return at !== undefined && isInProgress(at, new Date());
});

// v5-9 (design §8.2): the per-model cost panel. The v5-7 server attaches
// `cost: SessionCost` + `pricingAsOf` to the detail response; a v4-shaped
// response (no cost) leaves both `undefined` and the panel is omitted.
const cost = computed(() => detail.value?.cost ?? null);
const pricingAsOf = computed(() => detail.value?.pricingAsOf ?? null);

interface CostRow {
  model: string;
  inputLabel: string;
  outputLabel: string;
  /** cacheRead + 5m + 1h cache-creation tokens, design §5.2 terms. */
  cacheLabel: string;
  costLabel: string;
  /** True for an unpriced model — the row shows "n/a" + a tooltip (§5.3). */
  unpriced: boolean;
}

/** The unpriced-model tooltip text (design §8.2). */
function unpricedTooltip(model: string): string {
  return `Model ${model} is not in the pricing table — cost cannot be computed.`;
}

const costRows = computed<CostRow[]>(() => {
  const c = cost.value;
  if (c === null) return [];
  return c.byModel.map((m) => ({
    model: m.model,
    inputLabel: formatTokenCount(m.usage.inputTokens),
    outputLabel: formatTokenCount(m.usage.outputTokens),
    cacheLabel: formatTokenCount(
      m.usage.cacheReadTokens +
        m.usage.cacheCreation5mTokens +
        m.usage.cacheCreation1hTokens,
    ),
    costLabel: formatUsd(m.costUsd),
    unpriced: !m.priced,
  }));
});

const totalCostLabel = computed(() =>
  cost.value === null ? '' : formatUsd(cost.value.totalCostUsd),
);

function goBack(): void {
  void router.push({ name: 'sessions' });
}

/** Reflect a freshly-saved rating in local state so a re-rate pre-populates.
 *  The survey only renders inside the `v-else-if="detail"` block, so
 *  `detail.value` is always non-null when this `@saved` handler fires. */
function onRatingSaved(rating: SessionRating): void {
  /* v8 ignore next — `detail` is non-null whenever the survey is mounted. */
  if (detail.value !== null) detail.value.rating = rating;
}
</script>

<template>
  <main class="session-detail-view" data-testid="session-detail-view">
    <button class="back-btn" data-testid="session-back-btn" @click="goBack">
      ◀ Sessions
    </button>

    <div v-if="loading" data-testid="session-detail-loading" class="skeleton">
      <NSkeleton text height="1.6rem" :width="'60%'" />
      <NSkeleton text :repeat="3" />
    </div>

    <div v-else-if="notFound" data-testid="session-detail-404" class="notice">
      <p>This session's transcript was not found — it may have been deleted.</p>
    </div>

    <div v-else-if="error" data-testid="session-detail-error" class="error">
      <p>{{ error.message }}</p>
      <NButton data-testid="session-detail-retry" size="small" @click="reload">
        Retry
      </NButton>
    </div>

    <template v-else-if="detail">
      <header class="detail-header" data-testid="session-detail-header">
        <h1>{{ project }}</h1>
        <p class="meta">
          <span>{{ startedLabel }}</span>
          <span class="dot">·</span>
          <span>{{ detail.timeline.eventCount }} events</span>
          <span
            v-if="inProgress"
            class="badge"
            data-testid="session-in-progress"
          >
            ● in progress
          </span>
        </p>
      </header>

      <SessionEventTimeline :events="detail.timeline.events" />

      <section
        v-if="cost"
        class="cost-panel"
        data-testid="session-cost-panel"
      >
        <h2>AI cost</h2>
        <p v-if="costRows.length === 0" class="cost-empty">
          No costable model usage recorded for this session.
        </p>
        <table v-else class="cost-table">
          <thead>
            <tr>
              <th>Model</th>
              <th class="num">Input</th>
              <th class="num">Output</th>
              <th class="num">Cache</th>
              <th class="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in costRows"
              :key="row.model"
              :data-testid="`cost-model-${row.model}`"
            >
              <td class="model">{{ row.model }}</td>
              <td class="num">{{ row.inputLabel }}</td>
              <td class="num">{{ row.outputLabel }}</td>
              <td class="num">{{ row.cacheLabel }}</td>
              <td class="num">
                <NTooltip v-if="row.unpriced" trigger="hover" :delay="0">
                  <template #trigger>
                    <span
                      class="unpriced"
                      :data-testid="`cost-unpriced-tip-${row.model}`"
                      :title="unpricedTooltip(row.model)"
                    >
                      {{ row.costLabel }}
                    </span>
                  </template>
                  {{ unpricedTooltip(row.model) }}
                </NTooltip>
                <span v-else>{{ row.costLabel }}</span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" class="total-label">Session total</td>
              <td class="num total" data-testid="cost-total">
                {{ totalCostLabel }}
              </td>
            </tr>
          </tfoot>
        </table>
        <p
          v-if="pricingAsOf"
          class="cost-pricing-asof"
          data-testid="cost-pricing-asof"
        >
          AI prices as of {{ pricingAsOf }}
        </p>
      </section>

      <RatingSurvey
        :project="project"
        :session-id="sessionId"
        :rubric="detail.rubric"
        :rating="detail.rating"
        :timeline="detail.timeline"
        @saved="onRatingSaved"
      />
    </template>
  </main>
</template>

<style scoped>
.session-detail-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.back-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: inherit;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.detail-header {
  margin: 1rem 0 1.5rem 0;
}

.detail-header h1 {
  margin: 0 0 0.25rem 0;
  font-size: 1.5rem;
}

.meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.8;
}

.dot {
  opacity: 0.4;
}

.badge {
  color: #63e2b7;
  font-size: 0.78rem;
  font-weight: 600;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}

.error,
.notice {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}

.cost-panel {
  margin: 1.5rem 0;
}

.cost-panel h2 {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.cost-empty {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
}

.cost-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.cost-table th,
.cost-table td {
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-align: left;
}

.cost-table th {
  font-weight: 600;
  opacity: 0.65;
}

.cost-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cost-table .model {
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.cost-table .unpriced {
  opacity: 0.7;
  cursor: help;
}

.cost-table .total-label {
  text-align: right;
  opacity: 0.65;
}

.cost-table .total {
  font-weight: 600;
}

.cost-pricing-asof {
  margin: 0.4rem 0 0 0;
  font-size: 0.72rem;
  opacity: 0.5;
}
</style>
