// Composable: fetches /api/projects and exposes loading/error state.

import type { GetProjectsResponse } from '@metaswarm-dashboard/types/api';
import { ref, type Ref } from 'vue';


import { type ApiClient, createApiClient } from '../api/client.js';

export interface UseProjectsState {
  projects: Ref<GetProjectsResponse>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useProjects(client: ApiClient = createApiClient()): UseProjectsState {
  const projects = ref<GetProjectsResponse>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      projects.value = await client.getProjects();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  void reload();

  return { projects, loading, error, reload };
}
