import type { GetAgentsResponse } from '@metaswarm-dashboard/types/api';
import { ref, type Ref } from 'vue';

import { type ApiClient, createApiClient } from '../api/client.js';

export interface UseAgentsState {
  agents: Ref<GetAgentsResponse>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

export function useAgents(client: ApiClient = createApiClient()): UseAgentsState {
  const agents = ref<GetAgentsResponse>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      agents.value = await client.getAgents();
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
    } finally {
      loading.value = false;
    }
  }

  void reload();

  return { agents, loading, error, reload };
}
