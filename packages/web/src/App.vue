<script setup lang="ts">
import { NConfigProvider, NMessageProvider, darkTheme } from 'naive-ui';

import AppNav from './components/AppNav.vue';
</script>

<template>
  <NConfigProvider :theme="darkTheme">
    <NMessageProvider>
      <AppNav />
      <RouterView />
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: #18181c;
  color: rgba(255, 255, 255, 0.82);
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
}
</style>
