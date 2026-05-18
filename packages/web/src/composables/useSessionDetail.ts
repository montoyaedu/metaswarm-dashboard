// Composable: fetches /api/sessions/:project/:sessionId and exposes
// loading/error state. A `404` is surfaced separately via `notFound` so the
// view can render the dedicated "transcript was deleted" message instead of
// a generic error.

import { ref, watch, type Ref } from 'vue';

import {
  createRatingsApi,
  RatingsApiError,
  type RatingsApi,
  type SessionDetail,
} from '../lib/ratings-api.js';

export interface UseSessionDetailState {
  detail: Ref<SessionDetail | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  notFound: Ref<boolean>;
  reload: () => Promise<void>;
}

export function useSessionDetail(
  project: Ref<string>,
  sessionId: Ref<string>,
  api: RatingsApi = createRatingsApi(),
): UseSessionDetailState {
  const detail = ref<SessionDetail | null>(null);
  const loading = ref(false);
  const error = ref<Error | null>(null);
  const notFound = ref(false);

  async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    notFound.value = false;
    try {
      detail.value = await api.getSession(project.value, sessionId.value);
    } catch (err) {
      detail.value = null;
      if (err instanceof RatingsApiError && err.status === 404) {
        notFound.value = true;
      } else {
        error.value = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      loading.value = false;
    }
  }

  // Re-fetch when either route param changes.
  watch([project, sessionId], () => void reload(), { immediate: true });

  return { detail, loading, error, notFound, reload };
}
