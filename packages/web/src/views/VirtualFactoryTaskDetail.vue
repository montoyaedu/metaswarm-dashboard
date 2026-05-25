<script setup lang="ts">
import { NCollapse, NCollapseItem, NButton, NCard, NPopconfirm, NSpace, NSpin, NTag, useMessage } from 'naive-ui';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import CheckpointPanel from '../components/CheckpointPanel.vue';
import CommitLog from '../components/CommitLog.vue';
import EventTimeline from '../components/EventTimeline.vue';
import ReviewDecisionTree from '../components/ReviewDecisionTree.vue';
import TaskStatusBadge from '../components/TaskStatusBadge.vue';
import WuPhaseTimeline from '../components/WuPhaseTimeline.vue';
import WuProgressList from '../components/WuProgressList.vue';
import { useVfCancelTask, useVfDeleteTask, useVfTaskDetail } from '../composables/useVirtualFactory.js';

const route = useRoute();
const router = useRouter();
const message = useMessage();

const taskId = computed(() => (route.params['id'] as string) || '');

const { task, loading, error, reload } = useVfTaskDetail(taskId);
const { cancelling, cancel: cancelTask } = useVfCancelTask();
const { deleting, deleteTask } = useVfDeleteTask();

const completedOutput = computed(() => {
  if (!task.value) return undefined;
  const ev = task.value.events.find((e) => e.type === 'task.completed' || e.type === 'task.failed');
  return ev?.message || undefined;
});

const polling = ref(false);

function startPolling(): void {
  polling.value = true;
  const interval = setInterval(() => {
    if (!polling.value) {
      clearInterval(interval);
      return;
    }
    void reload();
    if (task.value && ['completed', 'failed', 'cancelled'].includes(task.value.status)) {
      polling.value = false;
      clearInterval(interval);
    }
  }, 3000);
}

function stopPolling(): void {
  polling.value = false;
}

async function handleCancel(): Promise<void> {
  if (!window.confirm(`Cancel task ${taskId.value.slice(0, 8)}? This cannot be undone.`)) return;
  const ok = await cancelTask(taskId.value);
  if (ok) void reload();
}

async function handleDelete(): Promise<void> {
  const ok = await deleteTask(taskId.value);
  if (ok) {
    message.success('Task deleted');
    void router.push('/virtual-factory');
  } else {
    message.error('Failed to delete task');
  }
}

function onCheckpointResolved(): void {
  void reload();
}

function goBack(): void {
  void router.push('/virtual-factory');
}
</script>

<template>
  <main class="task-detail" data-testid="virtual-factory-task-detail">
    <header style="display: flex; align-items: center; gap: 12px; margin-bottom: 1rem">
      <NButton size="small" quaternary @click="goBack">← Back</NButton>
      <h1 style="margin: 0; font-size: 1.3rem" v-if="task">
        Task {{ task.id.slice(0, 8) }}
      </h1>
      <div v-if="task" style="display: flex; gap: 6px; align-items: center">
        <TaskStatusBadge :status="task.status" />
        <NTag size="small">{{ task.phase }}</NTag>
        <span style="font-size: 0.8rem; opacity: 0.6">attempt {{ task.attempt }}</span>
      </div>
      <div style="margin-left: auto; display: flex; gap: 8px; align-items: center">
        <NButton
          v-if="task && task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'failed'"
          size="small"
          type="error"
          quaternary
          :loading="cancelling"
          @click="handleCancel"
        >
          Cancel Task
        </NButton>
        <NPopconfirm
          :show-icon="false"
          positive-text="Delete permanently"
          negative-text="Keep"
          @positive-click="handleDelete"
        >
          <template #trigger>
            <NButton size="small" type="error" secondary :loading="deleting">
              Delete Task
            </NButton>
          </template>
          This permanently removes the task and all its events. Continue?
        </NPopconfirm>
      </div>
    </header>

    <div v-if="loading" style="display: flex; justify-content: center; padding: 3rem">
      <NSpin />
    </div>

    <div v-else-if="error" style="color: #e88080; padding: 2rem">
      {{ error.message }}
    </div>

    <template v-else-if="task">
      <NSpace vertical size="large">
        <CheckpointPanel
          v-if="task.checkpoint"
          :task-id="task.id"
          :wu-id="task.checkpoint.wuId"
          :reason="task.checkpoint.reason"
          :prompt="task.checkpoint.prompt"
          @resolved="onCheckpointResolved"
        />

        <ReviewDecisionTree :events="task.events" />

        <NCard title="Work Units" size="small">
          <WuProgressList
            :work-units="task.workUnits"
            :wu-results="task.wuResults"
            :current-wu-index="task.currentWuIndex"
            :phase="task.phase"
            :completed-output="completedOutput"
          />
        </NCard>

        <WuPhaseTimeline :wu-results="task.wuResults" />

        <NCard v-if="completedOutput" title="Pipeline Output" size="small">
          <NCollapse>
            <NCollapseItem title="Show full output" name="output">
              <pre style="white-space: pre-wrap; font-size: 0.8rem; max-height: 400px; overflow: auto; background: #1e1e1e; padding: 8px; border-radius: 4px">{{ completedOutput }}</pre>
            </NCollapseItem>
          </NCollapse>
        </NCard>

        <NCard title="Events" size="small">
          <div style="margin-bottom: 8px">
            <NButton
              v-if="task.status === 'running' || task.status === 'paused'"
              size="tiny"
              :type="polling ? 'warning' : 'primary'"
              @click="polling ? stopPolling() : startPolling()"
            >
              {{ polling ? 'Stop Polling' : 'Poll (3s)' }}
            </NButton>
          </div>
          <EventTimeline :events="task.events" />
        </NCard>

        <CommitLog :events="task.events" />
      </NSpace>
    </template>
  </main>
</template>

<style scoped>
.task-detail {
  max-width: 860px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>
