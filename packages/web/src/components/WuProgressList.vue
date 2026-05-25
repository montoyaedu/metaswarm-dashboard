<script setup lang="ts">
import { NBadge, NCollapse, NCollapseItem, NDataTable, NList, NListItem, NSpace, NTag } from 'naive-ui';
import { computed, h } from 'vue';

import type { WorkUnitDetail, WuResult } from '../api/virtual-factory-client.js';

const props = defineProps<{
  workUnits: WorkUnitDetail[];
  wuResults: WuResult[];
  currentWuIndex: number;
  phase: string;
  completedOutput?: string;
}>();

// Mode 1: explicit workUnits → progress cards
interface WuRow {
  id: string;
  title: string;
  checkpoint: boolean;
  status: 'pending' | 'in-progress' | 'committed' | 'checkpoint';
  attempts: number;
}

const rows = computed<WuRow[]>(() => {
  const resultMap = new Map(props.wuResults.map((r) => [r.id, r]));
  return props.workUnits.map((wu, i) => {
    const wr = resultMap.get(wu.id);
    let status: WuRow['status'] = 'pending';
    if (wr?.committed) {
      status = 'committed';
    } else if (props.phase.startsWith('checkpoint') && props.currentWuIndex === i) {
      status = 'checkpoint';
    } else if (props.currentWuIndex === i) {
      status = 'in-progress';
    }
    return {
      id: wu.id,
      title: wu.title,
      checkpoint: wu.checkpoint,
      status,
      attempts: wr?.implementAttempts ?? 0,
    };
  });
});

const badgeType: Record<WuRow['status'], 'default' | 'info' | 'success' | 'warning'> = {
  pending: 'default',
  'in-progress': 'info',
  committed: 'success',
  checkpoint: 'warning',
};

// Mode 2: wuResults without workUnits → summary table
const summaryColumns = [
  { title: 'WU', key: 'id', width: 80 },
  { title: 'Committed', key: 'committed', width: 100, render: (row: WuResult): string => row.committed ? '✓' : '✗' },
  { title: 'Attempts', key: 'implementAttempts', width: 90 },
  { title: 'Review', key: 'reviewPassed', width: 80, render: (row: WuResult) => h(NTag, { type: row.reviewPassed ? 'success' : 'warning', size: 'tiny' }, { default: () => row.reviewPassed ? 'Pass' : (row.reviewPassed === false ? 'Fail' : '—') }) },
  { title: 'Errors', key: 'errors', render: (row: WuResult): string => row.errors?.length ? row.errors.join('; ') : '—' },
];

const showCards = computed(() => props.workUnits.length > 0);
</script>

<template>
  <div data-testid="wu-progress-list">
    <NList v-if="showCards">
      <NListItem v-for="row in rows" :key="row.id">
        <NSpace align="center">
          <NBadge :type="badgeType[row.status]" dot />
          <span>{{ row.title }}</span>
          <NTag v-if="row.checkpoint" size="tiny" type="warning">checkpoint</NTag>
          <NTag v-if="row.attempts > 1" size="tiny" type="error">
            {{ row.attempts }} attempts
          </NTag>
        </NSpace>
      </NListItem>
    </NList>

    <NDataTable
      v-else-if="wuResults.length > 0"
      :columns="summaryColumns"
      :data="wuResults"
      :row-key="(r: WuResult) => r.id"
      striped
      size="small"
    />

    <div v-else style="opacity: 0.5; padding: 0.5rem 0">No work units</div>

    <NCollapse v-if="completedOutput" style="margin-top: 12px">
      <NCollapseItem title="Pipeline Output" name="output">
        <pre style="white-space: pre-wrap; font-size: 0.8rem; max-height: 300px; overflow: auto; background: #1e1e1e; padding: 8px; border-radius: 4px">{{ completedOutput }}</pre>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>
