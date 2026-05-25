<script setup lang="ts">
import {
  NButton,
  NButtonGroup,
  NCard,
  NDataTable,
  useMessage,
} from 'naive-ui';
import { h, ref, type VNode } from 'vue';
import { RouterLink } from 'vue-router';

import TaskActionsCell from '../components/TaskActionsCell.vue';
import TaskCreateModal from '../components/TaskCreateModal.vue';
import TaskStatusBadge from '../components/TaskStatusBadge.vue';
import { useVfTasks } from '../composables/useVirtualFactory.js';

const statusFilter = ref<string | undefined>(undefined);
const showCreateModal = ref(false);

const { tasks, loading, error, reload } = useVfTasks(statusFilter);
const message = useMessage();

const columns = [
  {
    title: 'ID',
    key: 'id',
    render: (row: { id: string }): VNode =>
      h(
        RouterLink,
        { to: `/virtual-factory/tasks/${encodeURIComponent(row.id)}` },
        { default: () => row.id.slice(0, 8) },
      ),
  },
  {
    title: 'Status',
    key: 'status',
    render: (row: { status: string }): VNode => h(TaskStatusBadge, { status: row.status }),
  },
  {
    title: 'Phase',
    key: 'phase',
  },
  {
    title: 'WU',
    key: 'currentWuIndex',
    render: (row: { currentWuIndex: number; workUnits?: unknown[] }): string =>
      `${row.currentWuIndex + 1}/${row.workUnits?.length ?? '?'}`,
  },
  {
    title: 'Attempt',
    key: 'attempt',
  },
  {
    title: '',
    key: 'actions',
    width: 120,
    render: (row: { id: string; status: string; goal?: string }): VNode =>
      h(TaskActionsCell, {
        taskId: row.id,
        status: row.status,
        taskGoal: row.goal,
        onCancelled: () => {
          message.success('Task cancelled');
          void reload();
        },
        onDeleted: () => {
          message.success('Task deleted');
          void reload();
        },
      }),
  },
];

const rowKey = (row: { id: string }): string => row.id;

function setFilter(status: string | undefined): void {
  statusFilter.value = status;
}

function onCreated(_id: string): void {
  void reload();
}
</script>

<template>
  <main class="virtual-factory" data-testid="virtual-factory-view">
    <header style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem">
      <h1 style="margin: 0">Virtual Software Factory</h1>
      <NButton type="primary" @click="showCreateModal = true">+ New Task</NButton>
    </header>

    <NSpace vertical>
      <NCard size="small">
        <NButtonGroup size="small">
          <NButton
            :type="statusFilter === undefined ? 'primary' : 'default'"
            @click="setFilter(undefined)"
          >
            All
          </NButton>
          <NButton
            :type="statusFilter === 'running' ? 'primary' : 'default'"
            @click="setFilter('running')"
          >
            Running
          </NButton>
          <NButton
            :type="statusFilter === 'paused' ? 'primary' : 'default'"
            @click="setFilter('paused')"
          >
            Paused
          </NButton>
          <NButton
            :type="statusFilter === 'completed' ? 'primary' : 'default'"
            @click="setFilter('completed')"
          >
            Completed
          </NButton>
          <NButton
            :type="statusFilter === 'failed' ? 'primary' : 'default'"
            @click="setFilter('failed')"
          >
            Failed
          </NButton>
        </NButtonGroup>

        <div v-if="loading" style="margin-top: 12px">Loading…</div>
        <div v-else-if="error" style="margin-top: 12px; color: #e88080">
          {{ error.message }}
        </div>

        <NDataTable
          v-else
          :columns="columns"
          :data="tasks"
          :row-key="rowKey"
          striped
          style="margin-top: 12px"
        />
      </NCard>
    </NSpace>

    <TaskCreateModal
      :show="showCreateModal"
      @update:show="showCreateModal = $event"
      @created="onCreated"
    />
  </main>
</template>

<style scoped>
.virtual-factory {
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>
