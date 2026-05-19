<script setup lang="ts">
import { NButton, NDataTable, NSelect, NSkeleton } from 'naive-ui';
import { computed, h, ref, type VNode } from 'vue';
import { useRouter } from 'vue-router';

import CalibrationSummaryPanel from '../components/CalibrationSummaryPanel.vue';
import EmptyState from '../components/EmptyState.vue';
import { useSessions } from '../composables/useSessions.js';
import { formatUsd } from '../lib/cost-format.js';
import { durationBetween, sessionIdSuffix } from '../lib/session-format.js';

const router = useRouter();

// '' selects every project; the filter binds this to the API query.
const selectedProject = ref<string>('');
const { sessions, loading, error, reload } = useSessions(selectedProject);

interface Row {
  projectName: string;
  sessionId: string;
  startedLabel: string;
  durationLabel: string;
  eventCount: number;
  sidSuffix: string;
  rated: boolean;
  /** v5-9: the Claude-generated session title, or `null` when absent. */
  aiTitle: string | null;
  /** v5-9: the session's pre-formatted USD cost (`"n/a"` / `"$0.00"` / …). */
  costLabel: string;
}

const rows = computed<Row[]>(() =>
  sessions.value.map((s) => ({
    projectName: s.projectName,
    sessionId: s.sessionId,
    startedLabel: new Date(s.startedAt).toLocaleString(),
    durationLabel: durationBetween(s.startedAt, s.lastEventAt),
    eventCount: s.eventCount,
    sidSuffix: sessionIdSuffix(s.sessionId),
    rated: s.rated,
    // `aiTitle` is `.optional()` on the v5-6 schema — an absent field (a v4
    // summary) is normalized to `null` so the title line is simply omitted.
    aiTitle: s.aiTitle ?? null,
    // v5-9 (design §8.2): `costUsd` is `null` for an uncostable session and
    // `.optional()` on the v5-6 schema — an absent field renders "n/a".
    costLabel: formatUsd(s.costUsd ?? null),
  })),
);

// Project filter options: 'all' + every project that has a discovered
// session. Derived from the unfiltered list so the dropdown only ever
// offers projects the operator can actually drill into.
const projectOptions = computed(() => {
  const names = new Set(sessions.value.map((s) => s.projectName));
  return [
    { label: 'All projects', value: '' },
    ...[...names].sort().map((name) => ({ label: name, value: name })),
  ];
});

const isEmpty = computed(() => !loading.value && error.value === null && rows.value.length === 0);

function rowKey(row: Row): string {
  return `${row.projectName}/${row.sessionId}`;
}

function openSession(row: Row): void {
  void router.push({
    name: 'session-detail',
    params: { project: row.projectName, sessionId: row.sessionId },
  });
}

const columns = [
  {
    title: 'Project',
    key: 'projectName',
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `session-project-${rowKey(row)}` }, row.projectName),
  },
  {
    title: 'Started',
    key: 'startedLabel',
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `session-started-${rowKey(row)}` }, row.startedLabel),
  },
  {
    title: 'Duration',
    key: 'durationLabel',
    render: (row: Row): VNode =>
      h('span', { 'data-testid': `session-duration-${rowKey(row)}` }, row.durationLabel),
  },
  {
    title: 'Events',
    key: 'eventCount',
    render: (row: Row): VNode =>
      h(
        'span',
        { 'data-testid': `session-events-${rowKey(row)}` },
        row.eventCount.toString(),
      ),
  },
  {
    // v5-9 (design §8.2): a "Cost" column added after "Events". The cell
    // shows the pre-formatted USD figure — `"n/a"` for an uncostable
    // session, `"$0.00"` for a genuine zero, 4-decimal precision otherwise.
    title: 'Cost',
    key: 'costLabel',
    render: (row: Row): VNode =>
      h(
        'span',
        { class: 'cost', 'data-testid': `session-cost-${rowKey(row)}` },
        row.costLabel,
      ),
  },
  {
    // v5-9 (design §8.2): the Session cell shows `aiTitle` as a title line
    // ABOVE the `<sid[:8]>` suffix. The suffix is KEPT — it is the only
    // same-minute disambiguator (v4 §6.2). When `aiTitle` is null the title
    // line is omitted entirely (no blank line). All content is text —
    // never `v-html`.
    title: 'Session',
    key: 'sidSuffix',
    render: (row: Row): VNode => {
      const lines: VNode[] = [];
      if (row.aiTitle !== null) {
        lines.push(
          h(
            'span',
            {
              class: 'session-title',
              'data-testid': `session-title-${rowKey(row)}`,
            },
            row.aiTitle,
          ),
        );
      }
      lines.push(
        h(
          'span',
          { class: 'sid', 'data-testid': `session-sid-${rowKey(row)}` },
          row.sidSuffix,
        ),
      );
      return h('span', { class: 'session-cell' }, lines);
    },
  },
  {
    title: 'Rated',
    key: 'rated',
    render: (row: Row): VNode =>
      h(
        'span',
        {
          class: row.rated ? 'rated rated--yes' : 'rated rated--no',
          'data-testid': `session-rated-${rowKey(row)}`,
        },
        row.rated ? '● Rated' : '○ Unrated',
      ),
  },
];

function rowProps(row: Row): Record<string, unknown> {
  return {
    'data-testid': `session-row-${rowKey(row)}`,
    style: 'cursor: pointer;',
    onClick: () => openSession(row),
  };
}
</script>

<template>
  <main class="sessions-view" data-testid="sessions-view">
    <header>
      <h1>Sessions</h1>
      <div class="filter">
        <label for="session-project-filter">Project</label>
        <NSelect
          id="session-project-filter"
          v-model:value="selectedProject"
          data-testid="sessions-project-filter"
          :options="projectOptions"
          size="small"
          style="width: 220px"
        />
      </div>
    </header>

    <CalibrationSummaryPanel />

    <div v-if="loading" data-testid="sessions-loading" class="skeleton">
      <NSkeleton v-for="n in 4" :key="n" text :repeat="1" height="2.2rem" />
    </div>

    <div v-else-if="error" data-testid="sessions-error" class="error">
      <p>{{ error.message }}</p>
      <NButton data-testid="sessions-retry" size="small" @click="reload">Retry</NButton>
    </div>

    <EmptyState
      v-else-if="isEmpty"
      data-testid="sessions-empty"
      message="No sessions found — sessions appear once Claude Code has written a transcript for a configured project"
    />

    <NDataTable
      v-else
      data-testid="sessions-table"
      :columns="columns"
      :data="rows"
      :row-key="rowKey"
      :row-props="rowProps"
      striped
    />
  </main>
</template>

<style scoped>
.sessions-view {
  max-width: 1000px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
}

.filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.85;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.error {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}

.session-cell {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.session-title {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.sid {
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 0.8rem;
  opacity: 0.8;
}

.cost {
  font-variant-numeric: tabular-nums;
}

.rated--yes {
  color: #63e2b7;
}

.rated--no {
  opacity: 0.55;
}
</style>
