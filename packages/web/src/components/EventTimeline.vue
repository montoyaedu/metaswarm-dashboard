<script setup lang="ts">
import { NTag, NTimeline, NTimelineItem } from 'naive-ui';
import { computed } from 'vue';

import type { TaskEvent } from '../api/virtual-factory-client.js';

const props = defineProps<{
  events: TaskEvent[];
}>();

const items = computed(() =>
  props.events.map((evt) => ({
    ts: new Date(evt.ts).toLocaleString(),
    type: evt.type,
    phase: evt.phase,
    verdict: evt.verdict,
    message: evt.message,
    wuId: evt.wuId,
  })),
);

function itemType(_type: string): 'info' | 'success' | 'warning' | 'error' | 'default' {
  if (_type.includes('complete') || _type.includes('commit')) return 'success';
  if (_type.includes('fail') || _type.includes('error')) return 'error';
  if (_type.includes('checkpoint') || _type.includes('pause')) return 'warning';
  if (_type.startsWith('phase.')) return 'info';
  return 'default';
}
</script>

<template>
  <NTimeline data-testid="event-timeline">
    <NTimelineItem
      v-for="item in items"
      :key="item.ts + item.type"
      :type="itemType(item.type)"
    >
      <div style="font-size: 0.8rem; opacity: 0.6">{{ item.ts }}</div>
      <div>
        <NTag size="tiny" :type="itemType(item.type)">{{ item.type }}</NTag>
        <span v-if="item.phase" style="margin-left: 4px; font-size: 0.85rem">
          {{ item.phase }}
        </span>
      </div>
      <div v-if="item.message" style="font-size: 0.85rem; opacity: 0.8; margin-top: 2px">
        {{ item.message }}
      </div>
    </NTimelineItem>
  </NTimeline>
</template>
