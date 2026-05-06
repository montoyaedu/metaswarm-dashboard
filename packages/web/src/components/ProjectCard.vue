<script setup lang="ts">
import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { NCard } from 'naive-ui';
import { computed } from 'vue';
import { useRouter } from 'vue-router';


const props = defineProps<{ project: ProjectSummary }>();
const router = useRouter();

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

function navigate(): void {
  void router.push({ name: 'project-detail', params: { name: props.project.name } });
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
    <NCard hoverable :title="project.name">
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
      </div>
    </NCard>
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

.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.metric {
  display: flex;
  flex-direction: column;
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
</style>
