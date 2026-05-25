import { ref, type Ref } from 'vue';

import {
  createVirtualFactoryClient,
  type CheckpointSummary,
  type TaskDetail,
  type TaskSummary,
  type VirtualFactoryApiClient,
  type WorkUnitInput,
} from '../api/virtual-factory-client.js';

export interface UseVfTasksState {
  tasks: Ref<TaskSummary[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useVfTasks(
  status?: Ref<string | undefined>,
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfTasksState {
  const tasks = ref<TaskSummary[]>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      tasks.value = await client.listTasks(status?.value);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  void reload();

  return { tasks, loading, error, reload };
}

export interface UseVfTaskDetailState {
  task: Ref<TaskDetail | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useVfTaskDetail(
  id: Ref<string>,
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfTaskDetailState {
  const task = ref<TaskDetail | null>(null);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      task.value = await client.getTask(id.value);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  void reload();

  return { task, loading, error, reload };
}

export interface UseVfCheckpointsState {
  checkpoints: Ref<CheckpointSummary[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useVfCheckpoints(
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfCheckpointsState {
  const checkpoints = ref<CheckpointSummary[]>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      checkpoints.value = await client.listCheckpoints();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  void reload();

  return { checkpoints, loading, error, reload };
}

export interface UseVfCreateTaskState {
  creating: Ref<boolean>;
  error: Ref<Error | null>;
  create: (
    goal: string,
    workUnits?: WorkUnitInput[],
    tags?: string[],
  ) => Promise<{ id: string } | null>;
}

export function useVfCreateTask(
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfCreateTaskState {
  const creating = ref(false);
  const error = ref<Error | null>(null);

  async function create(
    goal: string,
    workUnits?: WorkUnitInput[],
    tags?: string[],
  ): Promise<{ id: string } | null> {
    creating.value = true;
    error.value = null;
    try {
      return await client.createTask(goal, workUnits, tags);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      return null;
    } finally {
      creating.value = false;
    }
  }

  return { creating, error, create };
}

export interface UseVfCancelTaskState {
  cancelling: Ref<boolean>;
  error: Ref<Error | null>;
  cancel: (id: string) => Promise<boolean>;
}

export function useVfCancelTask(
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfCancelTaskState {
  const cancelling = ref(false);
  const error = ref<Error | null>(null);

  async function cancel(id: string): Promise<boolean> {
    cancelling.value = true;
    error.value = null;
    try {
      await client.cancelTask(id);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    } finally {
      cancelling.value = false;
    }
  }

  return { cancelling, error, cancel };
}

export interface UseVfDeleteTaskState {
  deleting: Ref<boolean>;
  error: Ref<Error | null>;
  deleteTask: (id: string) => Promise<boolean>;
}

export function useVfDeleteTask(
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfDeleteTaskState {
  const deleting = ref(false);
  const error = ref<Error | null>(null);

  async function deleteTask(id: string): Promise<boolean> {
    deleting.value = true;
    error.value = null;
    try {
      await client.deleteTask(id);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    } finally {
      deleting.value = false;
    }
  }

  return { deleting, error, deleteTask };
}

export interface UseVfApproveCheckpointState {
  approving: Ref<boolean>;
  error: Ref<Error | null>;
  approve: (
    taskId: string,
    action: 'approve' | 'reject',
    comment?: string,
  ) => Promise<boolean>;
}

export function useVfApproveCheckpoint(
  client: VirtualFactoryApiClient = createVirtualFactoryClient(),
): UseVfApproveCheckpointState {
  const approving = ref(false);
  const error = ref<Error | null>(null);

  async function approve(
    taskId: string,
    action: 'approve' | 'reject',
    comment?: string,
  ): Promise<boolean> {
    approving.value = true;
    error.value = null;
    try {
      await client.approveCheckpoint(taskId, action, comment);
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      return false;
    } finally {
      approving.value = false;
    }
  }

  return { approving, error, approve };
}
