<script setup lang="ts">
import type { VendorCostRollup, VendorId } from '@metaswarm-dashboard/types/cost';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AgentTable from '../components/AgentTable.vue';
import EmptyState from '../components/EmptyState.vue';
import ThroughputSparkline from '../components/ThroughputSparkline.vue';
import { useProjectDetail } from '../composables/useProjectDetail.js';
import { formatUsd } from '../lib/cost-format.js';

const route = useRoute();
const router = useRouter();

const projectName = computed(() => {
  const v = route.params.name;
  /* v8 ignore start — vue-router 4 only passes string for single :name; the
     array/non-string guards are defensive against future route shape changes. */
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
  /* v8 ignore stop */
});

const { detail, loading, error } = useProjectDetail(projectName);

const lastActivityLabel = computed(() => {
  const at = detail.value?.lastActivityAt;
  if (at === null || at === undefined) return 'Never';
  return new Date(at).toLocaleString();
});

const hasData = computed(() => detail.value !== null && detail.value.agents.length > 0);

// v5-10 (design §8.2): the fifth section — "AI cost". The v5-7 server
// attaches `cost: ProjectCostSummary` + `pricingAsOf` to the detail; a
// v4-shaped response leaves `cost` `undefined` and the section is omitted.
const cost = computed(() => detail.value?.cost ?? null);
const pricingAsOf = computed<string | null>(() => detail.value?.pricingAsOf ?? null);

/** A display row for one vendor in the AI-cost section. */
interface VendorCostRow {
  vendor: VendorId;
  /** Operator-facing vendor name. */
  label: string;
  /** `"3 runs"` / `"0 runs"` / `"1 run"`. */
  runCountLabel: string;
  /** The vendor's USD figure — see `vendorCostLabel` for the branch logic. */
  costLabel: string;
}

/** The three vendors, in a fixed display order (design §8.2 — all shown). */
const VENDOR_LABELS: ReadonlyArray<readonly [VendorId, string]> = [
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['google', 'Google'],
];

/**
 * Render a vendor roll-up's USD figure (design §8.2):
 *
 * - no runs                      → `"$0.00"` (the roll-up's priced 0);
 * - all runs unpriced (cost 0,
 *   `hasUnpriced`)                → `"n/a"` — the figure cannot be computed;
 * - partly priced (`hasUnpriced`,
 *   cost > 0)                     → `"$X + unpriced"` — a lower bound;
 * - fully priced                  → `"$X"`.
 */
function vendorCostLabel(rollup: VendorCostRollup): string {
  if (rollup.hasUnpriced && rollup.costUsd === 0 && rollup.runCount > 0) {
    return 'n/a';
  }
  const base = formatUsd(rollup.costUsd);
  return rollup.hasUnpriced ? `${base} + unpriced` : base;
}

const vendorCostRows = computed<VendorCostRow[]>(() => {
  const c = cost.value;
  if (c === null) return [];
  return VENDOR_LABELS.map(([vendor, label]) => {
    const rollup = c.byVendor[vendor];
    return {
      vendor,
      label,
      runCountLabel: `${rollup.runCount} ${rollup.runCount === 1 ? 'run' : 'runs'}`,
      costLabel: vendorCostLabel(rollup),
    };
  });
});

/** The project's total — `"$X + unpriced"` when the total is a lower bound. */
const projectTotalLabel = computed<string>(() => {
  const c = cost.value;
  if (c === null) return '';
  const base = formatUsd(c.totalCostUsd);
  return c.hasUnpriced ? `${base} + unpriced` : base;
});

function goBack(): void {
  void router.push({ name: 'projects-index' });
}
</script>

<template>
  <main class="project-detail" data-testid="project-detail">
    <header>
      <button class="back-btn" data-testid="back-btn" @click="goBack">← Projects</button>
      <h1>{{ projectName }}</h1>
      <p class="meta">Last activity: <span data-testid="detail-last-activity">{{ lastActivityLabel }}</span></p>
    </header>

    <div v-if="loading" data-testid="loading">Loading…</div>
    <div v-else-if="error" data-testid="error">{{ error.message }}</div>

    <template v-else-if="detail">
      <section class="agents-section">
        <h2>Per-agent breakdown</h2>
        <AgentTable v-if="hasData" :agents="detail.agents" />
        <EmptyState v-else message="No agent activity yet — run `metaswarm-dashboard collect`" />
      </section>

      <section class="throughput-section">
        <h2>Throughput (14 days)</h2>
        <ThroughputSparkline :points="detail.throughput" />
      </section>

      <section class="recent-section">
        <h2>Recent work units</h2>
        <!-- v8 ignore start — recentWorkUnits is always empty in the MVP per
             API contract (server returns []); the v-for branch ships for
             forward-compat with the follow-up issue that surfaces work unit
             rows. -->
        <ul v-if="detail.recentWorkUnits.length > 0" class="recent-list">
          <li v-for="wu in detail.recentWorkUnits" :key="wu.id">
            <span class="status">{{ wu.status }}</span>
            <span class="title">{{ wu.title }}</span>
            <span v-if="wu.agent" class="agent">{{ wu.agent }}</span>
          </li>
        </ul>
        <!-- v8 ignore stop -->
        <EmptyState
          v-else
          message="Recent work units are not exposed in the MVP — see follow-up issue."
        />
      </section>

      <!-- v5-10 (design §8.2): the fifth section — per-vendor AI cost. All
           three vendors are listed even with no runs, so the operator sees
           every vendor was considered. Omitted entirely for a v4-shaped
           detail that carries no cost. -->
      <section
        v-if="cost !== null"
        class="cost-section"
        data-testid="project-cost-section"
      >
        <h2>AI cost</h2>
        <table class="cost-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th class="num">Runs</th>
              <th class="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in vendorCostRows"
              :key="row.vendor"
              :data-testid="`cost-vendor-${row.vendor}`"
            >
              <td class="vendor">{{ row.label }}</td>
              <td class="num">{{ row.runCountLabel }}</td>
              <td class="num">{{ row.costLabel }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="total-label">Project total</td>
              <td class="num total" data-testid="cost-project-total">
                {{ projectTotalLabel }}
              </td>
            </tr>
          </tfoot>
        </table>
        <p
          v-if="pricingAsOf !== null"
          class="pricing-asof"
          data-testid="cost-pricing-asof"
        >
          AI prices as of {{ pricingAsOf }}
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.project-detail {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header {
  margin-bottom: 1.5rem;
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

h1 {
  margin: 0.75rem 0 0.25rem 0;
  font-size: 1.5rem;
}

.meta {
  margin: 0;
  opacity: 0.7;
  font-size: 0.85rem;
}

section {
  margin-top: 2rem;
}

section h2 {
  font-size: 1rem;
  margin: 0 0 0.75rem 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-list li {
  display: grid;
  grid-template-columns: 100px 1fr 120px;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
}

/* v5-10: the per-vendor AI-cost table. */
.cost-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.cost-table th,
.cost-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  text-align: left;
}

.cost-table th {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
  font-weight: 600;
}

.cost-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cost-table .vendor {
  font-weight: 500;
}

.cost-table .total-label {
  font-weight: 600;
}

.cost-table .total {
  font-weight: 600;
}

.cost-table tfoot td {
  border-bottom: none;
}

.pricing-asof {
  margin: 0.6rem 0 0 0;
  font-size: 0.75rem;
  opacity: 0.55;
}
</style>
