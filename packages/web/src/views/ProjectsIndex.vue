<script setup lang="ts">
import { computed } from 'vue';

import EmptyState from '../components/EmptyState.vue';
import ProjectCard from '../components/ProjectCard.vue';
import { useProjects } from '../composables/useProjects.js';

const { projects, loading, error } = useProjects();

const visibleProjects = computed(() => projects.value);
const allEmpty = computed(
  () => !loading.value && projects.value.length > 0 && projects.value.every((p) => !p.hasMetrics),
);
const noProjects = computed(() => !loading.value && projects.value.length === 0);
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

    <div v-else class="grid">
      <ProjectCard v-for="p in visibleProjects" :key="p.name" :project="p" />
    </div>
  </main>
</template>

<style scoped>
.projects-index {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

header h1 {
  margin: 0 0 1.5rem 0;
  font-size: 1.5rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}
</style>
