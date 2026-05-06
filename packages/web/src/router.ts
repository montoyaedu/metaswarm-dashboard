import { defineComponent } from 'vue';
import { createRouter, createWebHistory, type Router } from 'vue-router';

import ProjectsIndex from './views/ProjectsIndex.vue';

/**
 * Stub components for routes whose real views ship in WU-6. The minimal
 * stubs here let WU-5 ship a working back-nav cycle (per WU-5.3
 * closes-round-4-Comp-1).
 */
const ProjectDetailStub = defineComponent({
  name: 'ProjectDetailStub',
  template:
    '<main data-testid="project-detail-stub">Project detail (placeholder — wired in WU-6)</main>',
});

const AgentsStub = defineComponent({
  name: 'AgentsStub',
  template: '<main data-testid="agents-stub">Agents (placeholder — wired in WU-6)</main>',
});

export function createAppRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: ProjectsIndex },
      { path: '/projects/:name', name: 'project-detail', component: ProjectDetailStub, props: true },
      { path: '/agents', name: 'agents', component: AgentsStub },
    ],
  });
}
