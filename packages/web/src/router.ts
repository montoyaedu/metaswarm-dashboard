import { createRouter, createWebHistory, type Router } from 'vue-router';

import AgentsView from './views/AgentsView.vue';
import ProjectDetail from './views/ProjectDetail.vue';
import ProjectsIndex from './views/ProjectsIndex.vue';

export function createAppRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: ProjectsIndex },
      { path: '/projects/:name', name: 'project-detail', component: ProjectDetail, props: true },
      { path: '/agents', name: 'agents', component: AgentsView },
    ],
  });
}
