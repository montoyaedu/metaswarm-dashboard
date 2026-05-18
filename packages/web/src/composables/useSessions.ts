// Composable: fetches /api/sessions (with an optional project filter) and
// exposes loading/error state. Mirrors `useProjects` / `useProjectDetail`.

import type { SessionSummary } from '@metaswarm-dashboard/types/sessions';
import { ref, watch, type Ref } from 'vue';

import { createRatingsApi, type RatingsApi } from '../lib/ratings-api.js';

export interface UseSessionsState {
  sessions: Ref<SessionSummary[]>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  reload: () => Promise<void>;
}

/**
 * `project` is a reactive filter: `''` (or `'all'`) means no `?project`
 * query; any other value re-fetches the filtered list. Re-fetches whenever
 * the filter changes.
 */
export function useSessions(
  project: Ref<string>,
  api: RatingsApi = createRatingsApi(),
): UseSessionsState {
  const sessions = ref<SessionSummary[]>([]);
  const loading = ref(false);
  const error = ref<Error | null>(null);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    const filter = project.value;
    try {
      sessions.value = await api.getSessions(
        filter === '' || filter === 'all' ? undefined : filter,
      );
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      sessions.value = [];
    } finally {
      loading.value = false;
    }
  }

  watch(project, () => void reload(), { immediate: true });

  return { sessions, loading, error, reload };
}
