<script setup lang="ts">
// Session detail — renders a header, the event timeline, and (WU v4-8) the
// per-session rating survey below the timeline (design §6.3).
//
// SECURITY: all transcript-derived content flows through child components
// that interpolate it as TEXT — `v-html` is never used here. See §6.3 / §11.

import type { SessionRating } from '@metaswarm-dashboard/types/ratings';
import { NButton, NSkeleton } from 'naive-ui';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import RatingSurvey from '../components/RatingSurvey.vue';
import SessionEventTimeline from '../components/SessionEventTimeline.vue';
import { useSessionDetail } from '../composables/useSessionDetail.js';
import { isInProgress } from '../lib/session-format.js';

const route = useRoute();
const router = useRouter();

/** Coerce a route param (which is `string | string[]`) to a single string. */
function paramStr(value: string | string[] | undefined): string {
  /* v8 ignore start — vue-router 4 passes a string for these single params;
     the array/undefined arms are defensive against future route changes. */
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
  /* v8 ignore stop */
}

const project = computed(() => paramStr(route.params.project));
const sessionId = computed(() => paramStr(route.params.sessionId));

const { detail, loading, error, notFound, reload } = useSessionDetail(project, sessionId);

const startedLabel = computed(() => {
  const at = detail.value?.timeline.startedAt;
  return at === undefined ? '' : new Date(at).toLocaleString();
});

const inProgress = computed(() => {
  const at = detail.value?.timeline.lastEventAt;
  return at !== undefined && isInProgress(at, new Date());
});

function goBack(): void {
  void router.push({ name: 'sessions' });
}

/** Reflect a freshly-saved rating in local state so a re-rate pre-populates.
 *  The survey only renders inside the `v-else-if="detail"` block, so
 *  `detail.value` is always non-null when this `@saved` handler fires. */
function onRatingSaved(rating: SessionRating): void {
  /* v8 ignore next — `detail` is non-null whenever the survey is mounted. */
  if (detail.value !== null) detail.value.rating = rating;
}
</script>

<template>
  <main class="session-detail-view" data-testid="session-detail-view">
    <button class="back-btn" data-testid="session-back-btn" @click="goBack">
      ◀ Sessions
    </button>

    <div v-if="loading" data-testid="session-detail-loading" class="skeleton">
      <NSkeleton text height="1.6rem" :width="'60%'" />
      <NSkeleton text :repeat="3" />
    </div>

    <div v-else-if="notFound" data-testid="session-detail-404" class="notice">
      <p>This session's transcript was not found — it may have been deleted.</p>
    </div>

    <div v-else-if="error" data-testid="session-detail-error" class="error">
      <p>{{ error.message }}</p>
      <NButton data-testid="session-detail-retry" size="small" @click="reload">
        Retry
      </NButton>
    </div>

    <template v-else-if="detail">
      <header class="detail-header" data-testid="session-detail-header">
        <h1>{{ project }}</h1>
        <p class="meta">
          <span>{{ startedLabel }}</span>
          <span class="dot">·</span>
          <span>{{ detail.timeline.eventCount }} events</span>
          <span
            v-if="inProgress"
            class="badge"
            data-testid="session-in-progress"
          >
            ● in progress
          </span>
        </p>
      </header>

      <SessionEventTimeline :events="detail.timeline.events" />

      <RatingSurvey
        :project="project"
        :session-id="sessionId"
        :rubric="detail.rubric"
        :rating="detail.rating"
        :timeline="detail.timeline"
        @saved="onRatingSaved"
      />
    </template>
  </main>
</template>

<style scoped>
.session-detail-view {
  max-width: 960px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.back-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: inherit;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.detail-header {
  margin: 1rem 0 1.5rem 0;
}

.detail-header h1 {
  margin: 0 0 0.25rem 0;
  font-size: 1.5rem;
}

.meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  opacity: 0.8;
}

.dot {
  opacity: 0.4;
}

.badge {
  color: #63e2b7;
  font-size: 0.78rem;
  font-weight: 600;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}

.error,
.notice {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: flex-start;
}
</style>
