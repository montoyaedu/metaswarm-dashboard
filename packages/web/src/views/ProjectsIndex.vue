<script setup lang="ts">
import { computed } from 'vue';

import EmptyState from '../components/EmptyState.vue';
import ProjectCard from '../components/ProjectCard.vue';
import { useProjects } from '../composables/useProjects.js';
import { groupByParent } from '../lib/group-by-parent.js';

const { projects, loading, error } = useProjects();

const groups = computed(() => groupByParent(projects.value));

// v5-10 (design §8.2): the `pricingAsOf` caveat is rendered ONCE per view —
// a single footnote under the card grid, not repeated on every card. The
// v5-7 server stamps the same `pricingAsOf` on every row; a v4-shaped
// payload omits it entirely, in which case the footnote is suppressed.
const pricingAsOf = computed<string | null>(() => {
  for (const p of projects.value) {
    if (p.pricingAsOf !== undefined) return p.pricingAsOf;
  }
  return null;
});

const allEmpty = computed(
  () =>
    !loading.value &&
    projects.value.length > 0 &&
    projects.value.every((p) => !p.hasMetrics && p.category !== 'git-only'),
);
const noProjects = computed(() => !loading.value && projects.value.length === 0);

function statusSummary(g: ReturnType<typeof groupByParent>[number]): string {
  const parts: string[] = [];
  if (g.counts.metaswarm > 0) parts.push(`${g.counts.metaswarm} metaswarm`);
  if (g.counts.gitOnly > 0) parts.push(`${g.counts.gitOnly} git-only`);
  if (g.counts.degraded > 0) parts.push(`${g.counts.degraded} degraded`);
  if (g.counts.failed > 0) parts.push(`${g.counts.failed} failed`);
  return parts.join(' · ');
}
</script>

<template>
  <main class="projects-index" data-testid="projects-index">
    <header>
      <h1>Projects</h1>
    </header>

    <div v-if="loading" data-testid="loading">Loading…</div>
    <div v-else-if="error" data-testid="error">{{ error.message }}</div>

    <EmptyState
      v-else-if="noProjects"
      message="No projects configured yet — run `metaswarm-dashboard config init` and edit config.yaml"
      data-testid="empty-no-projects"
    />

    <EmptyState
      v-else-if="allEmpty"
      message="No metrics yet — run `metaswarm-dashboard collect`"
      data-testid="empty-no-metrics"
    />

    <div v-else class="groups">
      <section
        v-for="g in groups"
        :key="g.parentPath"
        class="parent-group"
        :data-testid="`group-${g.parentPath || 'root'}`"
      >
        <header class="group-header">
          <h2 class="group-label">{{ g.label }}</h2>
          <span class="group-path">{{ g.parentPath || '(no parent)' }}</span>
          <span class="group-summary" :data-testid="`group-summary-${g.parentPath || 'root'}`">
            {{ g.counts.total }} total · {{ statusSummary(g) }}
          </span>
        </header>
        <div class="grid">
          <ProjectCard v-for="p in g.projects" :key="p.name" :project="p" />
        </div>
      </section>

      <!-- v5-10 (design §8.2): one pricing-staleness footnote for the view. -->
      <p
        v-if="pricingAsOf !== null"
        class="pricing-asof"
        data-testid="projects-pricing-asof"
      >
        AI prices as of {{ pricingAsOf }}
      </p>
    </div>
  </main>
</template>

<style scoped>
.projects-index {
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header h1 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.parent-group .group-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin: 0 0 0.75rem 0;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.group-label {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.group-path {
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 0.75rem;
  opacity: 0.5;
}

.group-summary {
  margin-left: auto;
  font-size: 0.75rem;
  opacity: 0.7;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

.pricing-asof {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.55;
}
</style>
