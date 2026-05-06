// SPA entry. Mounts Vue + naive-ui + vue-router.

import { createApp } from 'vue';

import App from './App.vue';
import { createAppRouter } from './router.js';

export { WEB_PACKAGE_VERSION } from './version.js';

const app = createApp(App);
app.use(createAppRouter());
app.mount('#app');
