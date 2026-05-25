<script setup lang="ts">
import { NCard, NList, NListItem, NSpace, NTag } from 'naive-ui';
import { computed } from 'vue';

import type { TaskEvent } from '../api/virtual-factory-client.js';

const props = defineProps<{ events: TaskEvent[] }>();

const commits = computed(() => props.events.filter((e) => e.type === 'wu.commit'));
</script>

<template>
  <NCard v-if="commits.length" title="Commits" size="small">
    <NList>
      <NListItem v-for="c in commits" :key="c.commitHash ?? c.wu ?? ''">
        <NSpace align="center">
          <code style="font-size: 11px">{{ c.commitHash?.slice(0, 7) }}</code>
          <span style="font-size: 12px">{{ c.message }}</span>
          <NTag size="tiny">{{ c.wu }}</NTag>
        </NSpace>
        <div style="font-size: 11px; color: #888; margin-top: 2px">
          files: {{ c.filesChanged?.join(', ') }}
        </div>
      </NListItem>
    </NList>
  </NCard>
</template>
