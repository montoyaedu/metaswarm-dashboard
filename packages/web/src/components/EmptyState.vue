<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div class="empty-state" data-testid="empty-state">
    <p>{{ message }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  padding: 2rem;
  text-align: center;
  opacity: 0.7;
  font-style: italic;
}
</style>
