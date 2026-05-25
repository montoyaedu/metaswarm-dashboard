<script setup lang="ts">
import { NCard, NSpace, NTag, NTimeline, NTimelineItem } from 'naive-ui';
import { computed } from 'vue';

import type { WuResult } from '../api/virtual-factory-client.js';

const props = defineProps<{ wuResults: WuResult[] }>();

const wuErrors = computed(() => {
  const m: Record<string, string[]> = {};
  for (const wu of props.wuResults) {
    if (wu.errors?.length) m[wu.id] = wu.errors;
  }
  return m;
});

const totalTokens = computed(() =>
  (props.wuResults || []).reduce(
    (s, wu) => s + (wu.phases || []).reduce((p, ph) => p + (ph.tokenTotal || 0), 0),
    0,
  ),
);
</script>

<template>
  <NCard v-if="wuResults.length" title="Work Unit Timeline" size="small">
    <template #header-extra>
      <span style="font-size: 11px; color: #888">{{ totalTokens }} tokens</span>
    </template>
    <NTimeline>
      <NTimelineItem
        v-for="wu in wuResults" :key="wu.id"
        :type="wu.committed ? 'success' : 'error'"
      >
        <template #header>{{ wu.id }}: {{ wu.committed ? 'Committed' : 'Failed' }}</template>
        <template #default>
          <div v-for="p in wu.phases || []" :key="p.phase" style="margin-bottom: 6px">
            <NSpace align="center" style="margin-bottom: 2px">
              <NTag size="tiny" type="info">{{ p.phase }}</NTag>
              <span style="font-size: 11px">{{ p.provider }} · {{ p.duration }}ms</span>
              <NTag v-if="p.tokenTotal" size="tiny" bordered>{{ p.inputTokens }}/{{ p.outputTokens }} tok</NTag>
            </NSpace>
            <span v-if="p.filesChanged?.length" style="font-size: 11px; color: #888; display: block; margin-left: 4px">
              files: {{ p.filesChanged.join(', ') }}
            </span>
            <NCard v-if="p.agentResponse" size="tiny" style="margin-top: 2px">
              <pre style="font-size: 11px; white-space: pre-wrap; margin: 0">{{ p.agentResponse }}</pre>
            </NCard>
          </div>
          <div v-if="wuErrors[wu.id]?.length" style="margin-top: 4px">
            <NTag v-for="e in wuErrors[wu.id]" :key="e" size="tiny" type="error">{{ e }}</NTag>
          </div>
        </template>
      </NTimelineItem>
    </NTimeline>
  </NCard>
</template>
