<script setup lang="ts">
import { NButton, NCard, NInput, NSpace, NTag } from 'naive-ui';
import { ref } from 'vue';

import { useVfApproveCheckpoint } from '../composables/useVirtualFactory.js';

const props = defineProps<{
  taskId: string;
  wuId: string;
  reason: string;
  prompt: string;
}>();

const emit = defineEmits<{
  resolved: [];
}>();

const comment = ref('');
const { approving, error, approve } = useVfApproveCheckpoint();

async function handleApprove(): Promise<void> {
  const ok = await approve(props.taskId, 'approve', comment.value || undefined);
  if (ok) emit('resolved');
}

async function handleReject(): Promise<void> {
  const ok = await approve(props.taskId, 'reject', comment.value || undefined);
  if (ok) emit('resolved');
}
</script>

<template>
  <NCard title="Checkpoint Pending" size="small" data-testid="checkpoint-panel">
    <div style="margin-bottom: 8px">
      <NTag size="small" type="warning">{{ wuId }}</NTag>
    </div>
    <div style="margin-bottom: 8px; font-size: 0.85rem; opacity: 0.8">{{ reason }}</div>
    <div
      v-if="prompt"
      style="margin-bottom: 12px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; font-size: 0.85rem; white-space: pre-wrap"
    >
      {{ prompt }}
    </div>
    <NInput
      v-model:value="comment"
      placeholder="Optional comment..."
      size="small"
      style="margin-bottom: 8px"
    />
    <div v-if="error" style="color: #e88080; font-size: 0.85rem; margin-bottom: 8px">
      {{ error.message }}
    </div>
    <NSpace>
      <NButton size="small" type="success" :loading="approving" @click="handleApprove">
        Approve
      </NButton>
      <NButton size="small" type="error" :loading="approving" @click="handleReject">
        Reject
      </NButton>
    </NSpace>
  </NCard>
</template>
