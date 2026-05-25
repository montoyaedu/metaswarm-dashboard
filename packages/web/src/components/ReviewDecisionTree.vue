<script setup lang="ts">
import { NCard, NSpace, NTag } from 'naive-ui';
import { computed } from 'vue';

import type { TaskEvent } from '../api/virtual-factory-client.js';

const props = defineProps<{ events: TaskEvent[] }>();

const reviewers = computed(() =>
  props.events.filter((e) => e.type === 'plan.reviewer'),
);

const totalTokens = computed(() =>
  reviewers.value.reduce((s, r) => s + (r.inputTokens || 0) + (r.outputTokens || 0), 0),
);
</script>

<template>
  <NCard v-if="reviewers.length" title="Plan Review" size="small">
    <template #header-extra>
      <span style="font-size: 11px; color: #888">{{ totalTokens }} tokens totali</span>
    </template>
    <NSpace vertical>
      <NCard
        v-for="r in reviewers" :key="r.reviewer ?? r.wuId ?? ''"
        size="tiny" segmented
        :style="r.approved ? 'border-left: 3px solid #18a058' : 'border-left: 3px solid #d03050'"
      >
        <NSpace align="center">
          <strong>{{ r.reviewer }}</strong>
          <NTag :type="r.approved ? 'success' : 'error'" size="small">
            {{ r.approved ? 'Approved' : 'Findings' }}
          </NTag>
          <span style="font-size: 11px; color: #888">{{ r.provider }} · {{ r.duration }}ms</span>
          <NTag size="tiny" bordered>{{ r.inputTokens || '?' }}/{{ r.outputTokens || '?' }} tok</NTag>
        </NSpace>
        <ul v-if="r.findings?.length" style="margin: 4px 0 0; font-size: 12px">
          <li v-for="f in r.findings" :key="f">{{ f }}</li>
        </ul>
        <NCard v-if="r.agentResponse" size="tiny" style="margin-top: 4px">
          <pre style="font-size: 11px; white-space: pre-wrap; margin: 0">{{ r.agentResponse }}</pre>
        </NCard>
      </NCard>
    </NSpace>
  </NCard>
</template>
