<script setup lang="ts">
import type { ThroughputPoint } from '@metaswarm-dashboard/types/api';
import { computed } from 'vue';

const props = defineProps<{ points: ThroughputPoint[]; width?: number; height?: number }>();

const W = computed(() => props.width ?? 280);
const H = computed(() => props.height ?? 60);
const PAD = 4;

const max = computed(() => {
  if (props.points.length === 0) return 0;
  return Math.max(...props.points.map((p) => p.closed));
});

const polyline = computed(() => {
  const n = props.points.length;
  if (n === 0 || max.value === 0) return '';
  const innerW = W.value - PAD * 2;
  const innerH = H.value - PAD * 2;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  return props.points
    .map((p, i) => {
      const x = PAD + i * stepX;
      const y = PAD + innerH - (p.closed / max.value) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
});
</script>

<template>
  <div class="sparkline-wrapper" data-testid="throughput-sparkline">
    <svg :width="W" :height="H" viewBox="0 0 280 60" preserveAspectRatio="none" aria-label="14-day throughput sparkline">
      <polyline
        v-if="polyline.length > 0"
        :points="polyline"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <text
        v-else
        x="140"
        y="34"
        text-anchor="middle"
        font-size="11"
        fill="currentColor"
        opacity="0.5"
      >
        no data
      </text>
    </svg>
    <div class="legend">
      <span data-testid="sparkline-points-count">{{ points.length }} days</span>
      <span data-testid="sparkline-peak">peak: {{ max }}</span>
    </div>
  </div>
</template>

<style scoped>
.sparkline-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.legend {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  opacity: 0.6;
}
</style>
