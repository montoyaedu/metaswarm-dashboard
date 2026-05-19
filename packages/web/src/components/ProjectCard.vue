<script setup lang="ts">
import { NBadge, NCard, NPopover, NTag } from 'naive-ui';
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import type { ProjectSummaryWithCost } from '../api/client.js';
import { buildCollectionAdvice } from '../lib/collection-help.js';
import { formatUsd } from '../lib/cost-format.js';

const props = defineProps<{ project: ProjectSummaryWithCost }>();
const router = useRouter();

// v5-10 (design §8.2): the per-card total AI cost. The v5-7 server attaches
// `totalCostUsd` + `hasUnpriced` to every `/api/projects` row; a v4-shaped
// row leaves `totalCostUsd` `undefined` and the metric is omitted.
//
// `hasUnpriced` means the priced sum is a LOWER BOUND — design §8.2 mandates
// `"$X + unpriced"` (never a bare number, never "n/a", since a project's
// total is always a real priced sum — `0` is meaningful, not "no data").
const aiCostLabel = computed<string | null>(() => {
  const total = props.project.totalCostUsd;
  if (total === undefined) return null;
  const base = formatUsd(total);
  return props.project.hasUnpriced === true ? `${base} + unpriced` : base;
});

const lastActivityLabel = computed(() => {
  if (props.project.lastActivityAt === null) return 'Never';
  const d = new Date(props.project.lastActivityAt);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
});

const prsLabel = computed(() =>
  props.project.prsMergedLast7d === null
    ? '—'
    : /* v8 ignore next — non-null branch unreachable in MVP (plan §2.6 hard-codes null);
         retained so the SPA is forward-compatible when a follow-up issue picks a data source. */
      props.project.prsMergedLast7d.toString(),
);

const advice = computed(() =>
  buildCollectionAdvice(props.project.collectionStatus, props.project.collectionWarnings),
);

const statusBadge = computed(() => {
  // git-only projects get a distinct neutral badge (not a warning) to
  // signal "we know this exists but it isn't metaswarm-managed yet".
  // Unreachable: `statusBadge` is read only inside the `v-else` of
  // `v-if="isGitOnly"`, so this computed never runs for a git-only
  // project. Kept as a defensive guard mirroring the template gate.
  /* v8 ignore start */
  if (props.project.category === 'git-only') {
    return { type: 'info' as const, label: 'not yet managed' };
  }
  /* v8 ignore stop */
  switch (props.project.collectionStatus) {
    case 'failed':
      return { type: 'error' as const, label: 'failed' };
    case 'degraded':
      return { type: 'warning' as const, label: 'degraded' };
    case 'ok':
    default:
      return null;
  }
});

const isGitOnly = computed(() => props.project.category === 'git-only');

function navigate(): void {
  void router.push({ name: 'project-detail', params: { name: props.project.name } });
}

function stopProp(e: Event): void {
  e.stopPropagation();
}
</script>

<template>
  <div
    class="project-card"
    role="link"
    tabindex="0"
    :data-testid="`project-card-${project.name}`"
    @click="navigate"
    @keydown.enter="navigate"
    @keydown.space="navigate"
  >
    <NCard hoverable>
      <template #header>
        <div class="header">
          <span class="title">{{ project.name }}</span>
          <!-- git-only badge: simple tag (no popover); the placeholder card already speaks for itself. -->
          <NTag
            v-if="isGitOnly"
            type="info"
            size="small"
            round
            :data-testid="`status-badge-${project.name}`"
          >
            ⊘ not yet managed
          </NTag>
          <!-- metaswarm-managed projects with degraded/failed: tag + popover with advice. -->
          <NPopover
            v-else-if="statusBadge !== null"
            trigger="click"
            placement="bottom-end"
            :width="380"
          >
            <template #trigger>
              <NTag
                :type="statusBadge.type"
                size="small"
                round
                clickable
                :data-testid="`status-badge-${project.name}`"
                @click="stopProp"
              >
                ⚠ {{ statusBadge.label }}
              </NTag>
            </template>
            <div class="advice" data-testid="collection-advice">
              <p class="summary">{{ advice.summary }}</p>
              <div
                v-for="(w, i) in advice.warnings"
                :key="i"
                class="warning-block"
              >
                <div class="warning-label">{{ w.help.label }}</div>
                <pre class="warning-msg">{{ w.message }}</pre>
                <div class="hint">
                  <strong>Fix now:</strong>
                  <span>{{ w.help.fixNow }}</span>
                </div>
                <div class="hint">
                  <strong>Prevent next time:</strong>
                  <span>{{ w.help.preventNextTime }}</span>
                </div>
              </div>
            </div>
          </NPopover>
        </div>
      </template>
      <div class="metrics">
        <div class="metric">
          <span class="label">Active tasks</span>
          <span class="value" data-testid="metric-active">{{ project.activeTasks }}</span>
        </div>
        <div class="metric">
          <span class="label">Blocked</span>
          <span class="value" data-testid="metric-blocked">{{ project.blockedTasks }}</span>
        </div>
        <div class="metric">
          <span class="label">PRs merged 7d</span>
          <span class="value" data-testid="metric-prs">{{ prsLabel }}</span>
        </div>
        <div class="metric">
          <span class="label">Last activity</span>
          <span class="value" data-testid="metric-last-activity">{{ lastActivityLabel }}</span>
        </div>
        <!-- v5-10 (design §8.2): the project's total AI cost. Spans the full
             row so the "$X + unpriced" lower-bound label is never clipped. -->
        <div v-if="aiCostLabel !== null" class="metric ai-cost">
          <span class="label">AI cost</span>
          <span class="value" :data-testid="`metric-ai-cost-${project.name}`">
            {{ aiCostLabel }}
          </span>
        </div>
      </div>
    </NCard>
    <NBadge v-if="false" /> <!-- kept for tree-shaking import retention check -->
  </div>
</template>

<style scoped>
.project-card {
  cursor: pointer;
  margin-bottom: 1rem;
  outline: none;
}

.project-card:focus-visible {
  box-shadow: 0 0 0 2px var(--n-color-target);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.title {
  font-weight: 500;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.metric {
  display: flex;
  flex-direction: column;
}

/* The AI-cost metric spans both grid columns so "$X + unpriced" fits. */
.metric.ai-cost {
  grid-column: 1 / -1;
}

.label {
  font-size: 0.75rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.value {
  font-size: 1.25rem;
  font-weight: 600;
}

.advice {
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 60vh;
  overflow-y: auto;
}

.advice .summary {
  margin: 0;
  font-weight: 600;
}

.warning-block {
  border-left: 2px solid var(--n-border-color);
  padding-left: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.warning-label {
  font-weight: 600;
  font-size: 0.85rem;
}

.warning-msg {
  margin: 0;
  padding: 0.4rem;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  font-size: 0.7rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.hint strong {
  display: block;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
  margin-bottom: 0.15rem;
}
</style>
