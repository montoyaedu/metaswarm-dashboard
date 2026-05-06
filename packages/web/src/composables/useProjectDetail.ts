import type { GetProjectByNameResponse } from '@metaswarm-dashboard/types/api';
import { ref, watch, type Ref } from 'vue';

import { type ApiClient, createApiClient } from '../api/client.js';

export interface UseProjectDetailState {
  detail: Ref<GetProjectByNameResponse | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useProjectDetail(
  name: Ref<string>,
  client: ApiClient = createApiClient(),
): UseProjectDetailState {
  const detail = ref<GetProjectByNameResponse | null>(null);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      detail.value = await client.getProject(name.value);
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      detail.value = null;
    } finally {
      loading.value = false;
    }
  }

  // Re-fetch when the project name changes (e.g., navigating between projects).
  watch(name, () => void reload(), { immediate: true });

  return { detail, loading, error, reload };
}
