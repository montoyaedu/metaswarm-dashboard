<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AgentTable from '../components/AgentTable.vue';
import EmptyState from '../components/EmptyState.vue';
import ThroughputSparkline from '../components/ThroughputSparkline.vue';
import { useProjectDetail } from '../composables/useProjectDetail.js';

const route = useRoute();
const router = useRouter();

const projectName = computed(() => {
  const v = route.params.name;
  /* v8 ignore start — vue-router 4 only passes string for single :name; the
     array/non-string guards are defensive against future route shape changes. */
  if (Array.isArray(v)) return v[0] ?? '';
  return typeof v === 'string' ? v : '';
  /* v8 ignore stop */
});

const { detail, loading, error } = useProjectDetail(projectName);

const lastActivityLabel = computed(() => {
  const at = detail.value?.lastActivityAt;
  if (at === null || at === undefined) return 'Never';
  return new Date(at).toLocaleString();
});

const hasData = computed(() => detail.value !== null && detail.value.agents.length > 0);

function goBack(): void {
  void router.push({ name: 'projects-index' });
}
</script>

<template>
  <main class="project-detail" data-testid="project-detail">
    <header>
      <button class="back-btn" data-testid="back-btn" @click="goBack">← Projects</button>
      <h1>{{ projectName }}</h1>
      <p class="meta">Last activity: <span data-testid="detail-last-activity">{{ lastActivityLabel }}</span></p>
    </header>

    <div v-if="loading" data-testid="loading">Loading…</div>
    <div v-else-if="error" data-testid="error">{{ error.message }}</div>

    <template v-else-if="detail">
      <section class="agents-section">
        <h2>Per-agent breakdown</h2>
        <AgentTable v-if="hasData" :agents="detail.agents" />
        <EmptyState v-else message="No agent activity yet — run `metaswarm-dashboard collect`" />
      </section>

      <section class="throughput-section">
        <h2>Throughput (14 days)</h2>
        <ThroughputSparkline :points="detail.throughput" />
      </section>

      <section class="recent-section">
        <h2>Recent work units</h2>
        <!-- v8 ignore start — recentWorkUnits is always empty in the MVP per
             API contract (server returns []); the v-for branch ships for
             forward-compat with the follow-up issue that surfaces work unit
             rows. -->
        <ul v-if="detail.recentWorkUnits.length > 0" class="recent-list">
          <li v-for="wu in detail.recentWorkUnits" :key="wu.id">
            <span class="status">{{ wu.status }}</span>
            <span class="title">{{ wu.title }}</span>
            <span v-if="wu.agent" class="agent">{{ wu.agent }}</span>
          </li>
        </ul>
        <!-- v8 ignore stop -->
        <EmptyState
          v-else
          message="Recent work units are not exposed in the MVP — see follow-up issue."
        />
      </section>
    </template>
  </main>
</template>

<style scoped>
.project-detail {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header {
  margin-bottom: 1.5rem;
}

.back-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: inherit;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

h1 {
  margin: 0.75rem 0 0.25rem 0;
  font-size: 1.5rem;
}

.meta {
  margin: 0;
  opacity: 0.7;
  font-size: 0.85rem;
}

section {
  margin-top: 2rem;
}

section h2 {
  font-size: 1rem;
  margin: 0 0 0.75rem 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.recent-list li {
  display: grid;
  grid-template-columns: 100px 1fr 120px;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
}
</style>
