import { createRouter, createWebHistory, type Router } from 'vue-router';

import AgentsView from './views/AgentsView.vue';
import ProjectDetail from './views/ProjectDetail.vue';
import ProjectsIndex from './views/ProjectsIndex.vue';
import SessionDetailView from './views/SessionDetailView.vue';
import SessionsView from './views/SessionsView.vue';
import VirtualFactoryTaskDetail from './views/VirtualFactoryTaskDetail.vue';
import VirtualFactoryView from './views/VirtualFactoryView.vue';

export function createAppRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'projects-index', component: ProjectsIndex },
      { path: '/projects/:name', name: 'project-detail', component: ProjectDetail, props: true },
      { path: '/agents', name: 'agents', component: AgentsView },
      { path: '/sessions', name: 'sessions', component: SessionsView },
      {
        path: '/sessions/:project/:sessionId',
        name: 'session-detail',
        component: SessionDetailView,
      },
      { path: '/virtual-factory', name: 'virtual-factory', component: VirtualFactoryView },
      {
        path: '/virtual-factory/tasks/:id',
        name: 'virtual-factory-task-detail',
        component: VirtualFactoryTaskDetail,
      },
    ],
  });
}
