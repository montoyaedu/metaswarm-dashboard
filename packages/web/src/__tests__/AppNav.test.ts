// WU v4-7 — top-level navigation. App.vue is coverage-excluded (a glue-only
// entry point), so the nav is exercised here by mounting the AppNav component
// directly with a real router and asserting link presence + active highlight.

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import AppNav from '../components/AppNav.vue';

const stub = (label: string) => ({ template: `<div>${label}</div>` });

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: stub('projects') },
      { path: '/agents', name: 'agents', component: stub('agents') },
      { path: '/sessions', name: 'sessions', component: stub('sessions') },
      {
        path: '/sessions/:project/:sessionId',
        name: 'session-detail',
        component: stub('session-detail'),
      },
    ],
  });
}

async function mountNav(router: Router): Promise<ReturnType<typeof mount>> {
  const w = mount(AppNav, { global: { plugins: [router] } });
  await router.isReady();
  await flushPromises();
  return w;
}

describe('AppNav', () => {
  it('renders Projects, Agents and Sessions links', async () => {
    const router = makeRouter();
    await router.push('/');
    const w = await mountNav(router);
    const text = w.text();
    expect(text).toContain('Projects');
    expect(text).toContain('Agents');
    expect(text).toContain('Sessions');
  });

  it('highlights Sessions as active when on /sessions', async () => {
    const router = makeRouter();
    await router.push('/sessions');
    const w = await mountNav(router);
    const vm = w.vm as unknown as { activeKey: string };
    expect(vm.activeKey).toBe('sessions');
  });

  it('keeps Sessions active when on a session detail route', async () => {
    const router = makeRouter();
    await router.push({
      name: 'session-detail',
      params: { project: 'alpha', sessionId: 'sess-a1' },
    });
    const w = await mountNav(router);
    const vm = w.vm as unknown as { activeKey: string };
    expect(vm.activeKey).toBe('sessions');
  });

  it('highlights Projects as active when on the index route', async () => {
    const router = makeRouter();
    await router.push('/');
    const w = await mountNav(router);
    const vm = w.vm as unknown as { activeKey: string };
    expect(vm.activeKey).toBe('projects-index');
  });

  it('navigates when a nav item is selected', async () => {
    const router = makeRouter();
    await router.push('/');
    const w = await mountNav(router);
    const vm = w.vm as unknown as { onSelect: (key: string) => void };
    vm.onSelect('sessions');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('sessions');
  });
});
