// Coverage gap closure: composables' "non-Error rejection" branch
// (catch-all `err instanceof Error ? err : new Error(String(err))`).

import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { ApiClient } from '../api/client.js';
import { useAgents } from '../composables/useAgents.js';
import { useProjectDetail } from '../composables/useProjectDetail.js';
import { useProjects } from '../composables/useProjects.js';

async function flushAll(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function rejectingClient(thrown: unknown): ApiClient {
  // The whole point of these tests is to feed non-Error rejections into the
  // composables to exercise their `instanceof Error` branch.
  const reject = (): Promise<never> =>
    Promise.resolve().then(() => {
      throw thrown;
    });
  return { getProjects: reject, getProject: reject, getAgents: reject };
}

describe('Composables — non-Error rejection branch', () => {
  it('useProjects: string rejection becomes a new Error', async () => {
    const state = useProjects(rejectingClient('plain string failure'));
    await flushAll();
    expect(state.error.value).toBeInstanceOf(Error);
    expect(state.error.value?.message).toBe('plain string failure');
  });

  it('useProjectDetail: number rejection becomes a new Error', async () => {
    const state = useProjectDetail(ref('alpha'), rejectingClient(42));
    await flushAll();
    expect(state.error.value).toBeInstanceOf(Error);
    expect(state.error.value?.message).toBe('42');
  });

  it('useAgents: object rejection becomes a new Error', async () => {
    const state = useAgents(rejectingClient({ weird: 'object' }));
    await flushAll();
    expect(state.error.value).toBeInstanceOf(Error);
    expect(state.error.value?.message).toContain('object');
  });
});
