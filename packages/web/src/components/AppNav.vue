<script setup lang="ts">
// Top-level horizontal nav bar (design §6.1). Lives in its own component so
// it is coverage-tested directly — App.vue, which mounts it, is excluded
// from coverage as a glue-only entry point.

import { NMenu } from 'naive-ui';
import { computed, h, type VNode } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

interface NavItem {
  label: string;
  /** Doubles as the menu key AND the target route name. */
  key: string;
  path: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Projects', key: 'projects-index', path: '/' },
  { label: 'Agents', key: 'agents', path: '/agents' },
  { label: 'Sessions', key: 'sessions', path: '/sessions' },
  { label: 'Virtual Factory', key: 'virtual-factory', path: '/virtual-factory' },
];

const route = useRoute();
const router = useRouter();

/**
 * The active menu key. A session-detail route (`/sessions/:p/:id`) keeps the
 * "Sessions" item highlighted by matching on the route-name prefix.
 */
const activeKey = computed<string>(() => {
  const name = typeof route.name === 'string' ? route.name : '';
  // A session-detail route keeps the "Sessions" item lit.
  return name === 'session-detail' ? 'sessions' : name;
});

const menuOptions = computed(() =>
  NAV_ITEMS.map((item) => ({
    label: (): VNode =>
      h(RouterLink, { to: item.path, 'data-testid': `nav-${item.key}` }, () => item.label),
    key: item.key,
  })),
);

// NMenu fires this on item click. The embedded RouterLink already navigates
// on a real click; this also routes for keyboard activation and is the
// programmatic entry point exercised by the unit test. Each menu key IS a
// route name, so the key routes directly.
function onSelect(key: string): void {
  void router.push({ name: key });
}
</script>

<template>
  <nav class="app-nav" data-testid="app-nav">
    <NMenu
      mode="horizontal"
      :value="activeKey"
      :options="menuOptions"
      @update:value="onSelect"
    />
  </nav>
</template>

<style scoped>
.app-nav {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 1rem;
}
</style>
