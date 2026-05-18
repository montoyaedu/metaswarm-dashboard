<script setup lang="ts">
// The collapsible event timeline for the session detail view. Collapsed by
// default; expands into a fixed-height scroll region listing each event as
// `HH:MM:SS · kind · summary`.
//
// SECURITY: every transcript-derived string (summary, toolName) is rendered
// via TEXT interpolation — never `v-html`. Transcript content may carry
// operator data, so it must never be parsed as HTML. See design §6.3 / §11.

import type { ToolUseEvent } from '@metaswarm-dashboard/types/sessions';
import { NButton } from 'naive-ui';
import { computed, ref } from 'vue';

import { truncateSummary } from '../lib/session-format.js';

const props = defineProps<{ events: ToolUseEvent[] }>();

const expanded = ref(false);

interface DisplayEvent {
  index: number;
  time: string;
  kind: string;
  /** `kind` or `kind/toolName` — the latter when a tool name is present. */
  kindLabel: string;
  summary: string;
}

/** `HH:MM:SS` slice of an ISO-8601 timestamp (the time portion). */
function clockTime(iso: string): string {
  const date = new Date(iso);
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const mm = date.getUTCMinutes().toString().padStart(2, '0');
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const displayEvents = computed<DisplayEvent[]>(() =>
  props.events.map((e, index) => ({
    index,
    time: clockTime(e.at),
    kind: e.kind,
    kindLabel: e.toolName === null ? e.kind : `${e.kind}/${e.toolName}`,
    summary: truncateSummary(e.summary, 120),
  })),
);

function toggle(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <section class="timeline" data-testid="session-timeline">
    <header class="timeline-header">
      <NButton
        data-testid="timeline-toggle"
        size="small"
        quaternary
        @click="toggle"
      >
        <span class="caret">{{ expanded ? '▾' : '▸' }}</span>
        Timeline ({{ events.length }} events)
      </NButton>
    </header>

    <ol v-if="expanded" class="timeline-scroll" data-testid="timeline-list">
      <li
        v-for="e in displayEvents"
        :key="e.index"
        class="timeline-row"
        :data-testid="`timeline-event-${e.index}`"
      >
        <span class="ev-time">{{ e.time }}</span>
        <span class="ev-sep">·</span>
        <span class="ev-kind">{{ e.kindLabel }}</span>
        <span class="ev-sep">·</span>
        <span class="ev-summary">{{ e.summary }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.timeline {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  overflow: hidden;
}

.timeline-header {
  padding: 0.25rem 0.5rem;
  background: rgba(255, 255, 255, 0.03);
}

.caret {
  margin-right: 0.4rem;
}

.timeline-scroll {
  list-style: none;
  margin: 0;
  padding: 0.5rem 0.75rem;
  max-height: 360px;
  overflow-y: auto;
}

.timeline-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.82rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.timeline-row:last-child {
  border-bottom: none;
}

.ev-time {
  font-family: ui-monospace, Menlo, Monaco, monospace;
  opacity: 0.6;
  flex-shrink: 0;
}

.ev-kind {
  color: #70c0e8;
  flex-shrink: 0;
}

.ev-sep {
  opacity: 0.3;
}

.ev-summary {
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
