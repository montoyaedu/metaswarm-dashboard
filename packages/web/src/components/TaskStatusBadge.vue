<script setup lang="ts">
import { NTag } from 'naive-ui';
import { computed } from 'vue';

const props = defineProps<{
  status: string;
}>();

const type = computed<'info' | 'warning' | 'success' | 'error' | 'default'>(() => {
  switch (props.status) {
    case 'running':
      return 'info';
    case 'paused':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'default';
    default:
      return 'default';
  }
});
</script>

<template>
  <NTag :type="type" size="small" data-testid="task-status-badge">
    {{ status }}
  </NTag>
</template>
