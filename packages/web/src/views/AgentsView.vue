<script setup lang="ts">
import { NDataTable } from 'naive-ui';
import { computed, h, type VNode } from 'vue';

import EmptyState from '../components/EmptyState.vue';
import { useAgents } from '../composables/useAgents.js';

const { agents, loading, error } = useAgents();

interface Row {
  agent: string;
  totalTasksCompleted: number;
  weightedSuccessRate: number;
  weightedSuccessRateLabel: string;
  avgDurationSeconds: number;
  avgDurationLabel: string;
  projectsLabel: string;
}

const rows = computed<Row[]>(() =>
  agents.value.map((a) => ({
    agent: a.agent,
    totalTasksCompleted: a.totalTasksCompleted,
    weightedSuccessRate: a.weightedSuccessRate,
    weightedSuccessRateLabel: `${(a.weightedSuccessRate * 100).toFixed(0)}%`,
    avgDurationSeconds: a.avgDurationSeconds,
    avgDurationLabel: formatDuration(a.avgDurationSeconds),
    projectsLabel: a.projects
      .map((p) => `${p.name} (${p.tasksCompleted})`)
      .join(', '),
  })),
);

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const columns = [
  {
    title: 'Agent',
    key: 'agent',
    sorter: 'default' as const,
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `agg-agent-${row.agent}` }, row.agent),
  },
  {
    title: 'Total tasks',
    key: 'totalTasksCompleted',
    sorter: (a: Row, b: Row): number => a.totalTasksCompleted - b.totalTasksCompleted,
    render: (row: Row): VNode =>
      h(
        'span',
        { 'data-testid': `agg-tasks-${row.agent}` },
        row.totalTasksCompleted.toString(),
      ),
  },
  {
    title: 'Success rate',
    key: 'weightedSuccessRate',
    sorter: (a: Row, b: Row): number => a.weightedSuccessRate - b.weightedSuccessRate,
    render: (row: Row): VNode =>
      h(
        'span',
        { 'data-testid': `agg-rate-${row.agent}` },
        row.weightedSuccessRateLabel,
      ),
  },
  {
    title: 'Avg duration',
    key: 'avgDurationSeconds',
    sorter: (a: Row, b: Row): number => a.avgDurationSeconds - b.avgDurationSeconds,
    render: (row: Row): VNode =>
      h(
        'span',
        { 'data-testid': `agg-duration-${row.agent}` },
        row.avgDurationLabel,
      ),
  },
  {
    title: 'Projects',
    key: 'projectsLabel',
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `agg-projects-${row.agent}` }, row.projectsLabel),
  },
];
</script>

<template>
  <main class="agents-view" data-testid="agents-view">
    <header>
      <h1>Agents (cross-project)</h1>
    </header>

    <div v-if="loading" data-testid="loading">Loading…</div>
    <div v-else-if="error" data-testid="error">{{ error.message }}</div>

    <NDataTable
      v-else-if="agents.length > 0"
      data-testid="agents-aggregate-table"
      :columns="columns"
      :data="rows"
      :row-key="(row: Row) => row.agent"
      striped
    />

    <EmptyState
      v-else
      message="No agent activity across configured projects yet — run `metaswarm-dashboard collect --all`"
    />
  </main>
</template>

<style scoped>
.agents-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

h1 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
}
</style>
