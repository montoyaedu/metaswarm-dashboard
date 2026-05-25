<script setup lang="ts">
import { NButton, NPopconfirm } from 'naive-ui';

import { useVfCancelTask, useVfDeleteTask } from '../composables/useVirtualFactory.js';

const props = defineProps<{
  taskId: string;
  status: string;
  taskGoal?: string;
}>();

const emit = defineEmits<{
  cancelled: [];
  deleted: [];
}>();

const { cancelling, cancel } = useVfCancelTask();
const { deleting, deleteTask } = useVfDeleteTask();

async function handleCancel(): Promise<void> {
  const ok = await cancel(props.taskId);
  if (ok) emit('cancelled');
}

async function handleDelete(): Promise<void> {
  const ok = await deleteTask(props.taskId);
  if (ok) emit('deleted');
}
</script>

<template>
  <div style="display: flex; gap: 4px; align-items: center">
    <NButton
      v-if="status !== 'completed' && status !== 'cancelled' && status !== 'failed'"
      size="tiny"
      type="error"
      quaternary
      :loading="cancelling"
      @click="handleCancel"
    >
      Cancel
    </NButton>
    <NPopconfirm
      :show-icon="false"
      positive-text="Delete permanently"
      negative-text="Keep"
      @positive-click="handleDelete"
    >
      <template #trigger>
        <NButton size="tiny" tertiary circle type="error" :loading="deleting">
          ✕
        </NButton>
      </template>
      Delete task{{ taskGoal ? ` "${taskGoal.slice(0, 40)}..."` : '' }}? This permanently removes the task and all its events.
    </NPopconfirm>
  </div>
</template>
