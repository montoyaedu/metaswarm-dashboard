<script setup lang="ts">
import { NCard, NList, NListItem, NSpace, NTag } from 'naive-ui';
import { computed } from 'vue';

import type { TaskEvent } from '../api/virtual-factory-client.js';

const props = defineProps<{ events: TaskEvent[] }>();

const commits = computed(() => props.events.filter((e) => e.type === 'wu.commit'));
const totalInsertions = computed(() => commits.value.reduce((s, c) => s + (c.insertions || 0), 0));
const totalDeletions = computed(() => commits.value.reduce((s, c) => s + (c.deletions || 0), 0));

function fmtTime(ts?: string): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <NCard v-if="commits.length" title="Commits" size="small">
    <template #header-extra>
      <span style="font-size: 11px; color: #888">{{ totalInsertions }}++ {{ totalDeletions }}--</span>
    </template>
    <NList>
      <NListItem v-for="c in commits" :key="c.commitHash ?? c.wu ?? ''">
        <NSpace align="center">
          <code style="font-size: 11px">{{ c.commitHash?.slice(0, 7) }}</code>
          <span style="font-size: 12px">{{ c.message }}</span>
          <NTag size="tiny">{{ c.wu }}</NTag>
          <span style="font-size: 10px; color: #888">
            {{ c.author || '?' }} · {{ fmtTime(c.ts) }}
          </span>
        </NSpace>
        <NSpace style="margin-top: 2px; font-size: 11px; color: #888">
          <span v-if="c.insertions" style="color: #18a058">+{{ c.insertions }}</span>
          <span v-if="c.deletions" style="color: #d03050">-{{ c.deletions }}</span>
          <span>files: {{ c.filesChanged?.join(', ') }}</span>
        </NSpace>
      </NListItem>
    </NList>
  </NCard>
</template>
