<script setup lang="ts">
import type { AgentBreakdown } from '@metaswarm-dashboard/types/api';
import { NDataTable } from 'naive-ui';
import { h, computed, type VNode } from 'vue';

const props = defineProps<{ agents: AgentBreakdown[] }>();

interface Row {
  agent: string;
  tasksCompleted: number;
  successRate: number;
  successRateLabel: string;
  avgDurationSeconds: number;
  avgDurationLabel: string;
}

const rows = computed<Row[]>(() =>
  props.agents.map((a) => ({
    agent: a.agent,
    tasksCompleted: a.tasksCompleted,
    successRate: a.successRate,
    successRateLabel: `${(a.successRate * 100).toFixed(0)}%`,
    avgDurationSeconds: a.avgDurationSeconds,
    avgDurationLabel: formatDuration(a.avgDurationSeconds),
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
      h('span', { 'data-testid': `cell-agent-${row.agent}` }, row.agent),
  },
  {
    title: 'Tasks completed',
    key: 'tasksCompleted',
    sorter: (a: Row, b: Row): number => a.tasksCompleted - b.tasksCompleted,
    render: (row: Row): VNode =>
      h(
        'span',
        { 'data-testid': `cell-tasks-${row.agent}` },
        row.tasksCompleted.toString(),
      ),
  },
  {
    title: 'Success rate',
    key: 'successRate',
    sorter: (a: Row, b: Row): number => a.successRate - b.successRate,
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `cell-rate-${row.agent}` }, row.successRateLabel),
  },
  {
    title: 'Avg duration',
    key: 'avgDurationSeconds',
    sorter: (a: Row, b: Row): number => a.avgDurationSeconds - b.avgDurationSeconds,
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `cell-duration-${row.agent}` }, row.avgDurationLabel),
  },
];
</script>

<template>
  <NDataTable
    data-testid="agent-table"
    :columns="columns"
    :data="rows"
    :row-key="(row: Row) => row.agent"
    striped
  />
</template>
