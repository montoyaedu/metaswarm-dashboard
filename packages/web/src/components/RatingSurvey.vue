<script setup lang="ts">
// The per-session rating survey — the WRITE side of the session detail view
// (design §6.3). One row per `RubricKey` (9, in enum order): a verdict picker
// (pass/watch/fail/na/unsure), a per-row anti-anchoring "show rubric
// suggestion" toggle (hidden by default), and an on-demand per-row note. A
// header "show all suggestions" bulk toggle and an overall note complete it.
//
// SECURITY: rubric `evidence` is transcript-derived and MAY carry operator
// secrets — it is rendered via TEXT interpolation, never `v-html`. See §6.3.
//
// SAVE: the button is disabled until ≥1 verdict is selected; an unselected
// row is omitted from `verdicts[]` (partial ratings are valid). On failure the
// operator's entered verdicts are RETAINED in component state (never
// discarded) — Retry re-submits. On success each rated row shows agree/
// disagree vs the PERSISTED `rubricAtRating`.

import type { OperatorVerdict, SessionRating } from '@metaswarm-dashboard/types/ratings';
import type { ProcessRubricScore } from '@metaswarm-dashboard/types/sessions';
import { NButton, NInput, NRadio, NRadioGroup } from 'naive-ui';
import { computed, reactive, ref } from 'vue';

import { createRatingsApi, type RatingsApi } from '../lib/ratings-api.js';

/** The five operator verdicts (a superset of the rubric's four). */
type Verdict = OperatorVerdict['verdict'];
const VERDICTS: readonly Verdict[] = ['pass', 'watch', 'fail', 'na', 'unsure'];

const props = defineProps<{
  project: string;
  sessionId: string;
  rubric: ProcessRubricScore;
  rating: SessionRating | null;
  /** Injectable for tests; defaults to the real fetch-backed client. */
  api?: RatingsApi;
}>();

const emit = defineEmits<{ saved: [rating: SessionRating] }>();

const api = computed<RatingsApi>(() => props.api ?? createRatingsApi());

/** Per-row mutable survey state — `rows[i]` pairs with `rubric.items[i]`. */
interface RowState {
  key: ProcessRubricScore['items'][number]['key'];
  verdict: Verdict | null;
  note: string;
  showSuggestion: boolean;
  showNote: boolean;
}

const rows = reactive<RowState[]>(
  props.rubric.items.map((item) => {
    const prior = props.rating?.verdicts.find((v) => v.key === item.key);
    return {
      key: item.key,
      verdict: prior?.verdict ?? null,
      note: prior?.note ?? '',
      showSuggestion: false,
      showNote: prior?.note !== undefined && prior.note.length > 0,
    };
  }),
);

/**
 * The 9 survey rows zipped with their rubric item — one stable array the
 * template iterates without index access. Each `state` is the SAME reactive
 * proxy held in `rows`, so `v-model` on it stays two-way bound.
 */
const displayRows = computed(() =>
  props.rubric.items.map((item, i) => ({ index: i, item, state: rows[i] as RowState })),
);

const overallNote = ref(props.rating?.overallNote ?? '');

const saving = ref(false);
const saveError = ref<Error | null>(null);
/** The rating persisted by the most recent successful save (drives agree/disagree). */
const persisted = ref<SessionRating | null>(null);

const ratedCount = computed(() => rows.filter((r) => r.verdict !== null).length);
const canSave = computed(() => ratedCount.value >= 1 && !saving.value);

function toggleShowAll(): void {
  // If any row is hidden, reveal all; otherwise hide all.
  const reveal = rows.some((r) => !r.showSuggestion);
  for (const r of rows) r.showSuggestion = reveal;
}

/** Build the PUT body from the currently-selected rows. */
function buildVerdicts(): OperatorVerdict[] {
  const scoredAt = new Date().toISOString();
  const out: OperatorVerdict[] = [];
  for (const row of rows) {
    if (row.verdict === null) continue;
    const verdict: OperatorVerdict = { key: row.key, verdict: row.verdict, scoredAt };
    if (row.note.trim().length > 0) verdict.note = row.note.trim();
    out.push(verdict);
  }
  return out;
}

async function save(): Promise<void> {
  saving.value = true;
  saveError.value = null;
  const body = {
    verdicts: buildVerdicts(),
    ...(overallNote.value.trim().length > 0
      ? { overallNote: overallNote.value.trim() }
      : {}),
  };
  try {
    const result = await api.value.putRating(props.project, props.sessionId, body);
    persisted.value = result;
    emit('saved', result);
  } catch (err) {
    // The operator's entered verdicts stay in `rows` — never discarded.
    saveError.value = err instanceof Error ? err : new Error(String(err));
  } finally {
    saving.value = false;
  }
}

/**
 * Agree/disagree for a KPI, derived from the PERSISTED rating. Returns null
 * when there is no save yet, the KPI was not rated, or the operator answered
 * `na`/`unsure` (those verdicts are excluded from agreement — design §4).
 */
function agreement(key: RowState['key']): 'agree' | 'disagree' | null {
  const saved = persisted.value;
  if (saved === null) return null;
  const operator = saved.verdicts.find((v) => v.key === key);
  if (operator === undefined) return null;
  if (operator.verdict === 'na' || operator.verdict === 'unsure') return null;
  const rubricItem = saved.rubricAtRating.items.find((it) => it.key === key);
  /* v8 ignore next — rubricAtRating always carries all 9 keys (schema .length(9)). */
  if (rubricItem === undefined) return null;
  return operator.verdict === rubricItem.verdict ? 'agree' : 'disagree';
}
</script>

<template>
  <section class="rating-survey" data-testid="rating-survey">
    <header class="survey-header">
      <h2>Rate this session — how do you think it went?</h2>
      <NButton
        data-testid="survey-show-all"
        size="small"
        quaternary
        @click="toggleShowAll"
      >
        show all suggestions
      </NButton>
    </header>

    <ol class="survey-rows">
      <li
        v-for="row in displayRows"
        :key="row.item.key"
        class="survey-row"
        :data-testid="`survey-row-${row.index}`"
        :data-key="row.item.key"
      >
        <div class="row-main">
          <span class="kpi-label">{{ row.item.label }}</span>

          <NRadioGroup v-model:value="row.state.verdict" size="small" class="verdicts">
            <NRadio
              v-for="v in VERDICTS"
              :key="v"
              :value="v"
              :data-testid="`survey-verdict-${row.index}-${v}`"
            >
              {{ v }}
            </NRadio>
          </NRadioGroup>

          <NButton
            :data-testid="`survey-note-toggle-${row.index}`"
            size="tiny"
            text
            @click="row.state.showNote = !row.state.showNote"
          >
            +note
          </NButton>

          <NButton
            :data-testid="`survey-suggestion-toggle-${row.index}`"
            size="tiny"
            text
            @click="row.state.showSuggestion = !row.state.showSuggestion"
          >
            {{ row.state.showSuggestion ? 'hide' : 'show' }} rubric suggestion
          </NButton>

          <span
            v-if="agreement(row.item.key) !== null"
            class="agreement"
            :class="`agreement--${agreement(row.item.key)}`"
            :data-testid="`survey-agreement-${row.index}`"
          >
            {{ agreement(row.item.key) === 'agree' ? '✓ agree' : '✗ disagree' }}
          </span>
        </div>

        <div
          v-if="row.state.showSuggestion"
          class="suggestion"
          :data-testid="`survey-suggestion-${row.index}`"
        >
          <span class="sug-verdict">rubric suggests: {{ row.item.verdict }}</span>
          <span class="sug-evidence">{{ row.item.evidence }}</span>
        </div>

        <NInput
          v-if="row.state.showNote"
          v-model:value="row.state.note"
          :data-testid="`survey-note-${row.index}`"
          type="textarea"
          size="small"
          placeholder="note for this KPI"
          :autosize="{ minRows: 1, maxRows: 3 }"
        />
      </li>
    </ol>

    <label class="overall">
      <span>overall note</span>
      <NInput
        v-model:value="overallNote"
        data-testid="survey-overall-note"
        type="textarea"
        size="small"
        placeholder="anything notable about the session as a whole"
        :autosize="{ minRows: 1, maxRows: 4 }"
      />
    </label>

    <div
      v-if="saveError"
      class="save-error"
      data-testid="survey-error"
    >
      <p>Could not save the rating: {{ saveError.message }}</p>
      <NButton
        data-testid="survey-retry"
        size="small"
        :loading="saving"
        @click="save"
      >
        Retry
      </NButton>
    </div>

    <div class="survey-actions">
      <NButton
        data-testid="survey-save"
        type="primary"
        :disabled="!canSave"
        :loading="saving"
        @click="save"
      >
        save rating ({{ ratedCount }} of 9 rated)
      </NButton>
    </div>
  </section>
</template>

<style scoped>
.rating-survey {
  margin-top: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 1rem;
}

.survey-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.survey-header h2 {
  margin: 0;
  font-size: 1.05rem;
}

.survey-rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.survey-row {
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.survey-row:last-child {
  border-bottom: none;
}

.row-main {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.kpi-label {
  min-width: 12rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.suggestion {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.82rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
}

.sug-verdict {
  color: #70c0e8;
  font-weight: 600;
}

.sug-evidence {
  opacity: 0.85;
}

.agreement {
  font-size: 0.8rem;
  font-weight: 600;
}

.agreement--agree {
  color: #63e2b7;
}

.agreement--disagree {
  color: #e88080;
}

.overall {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 1rem;
  font-size: 0.85rem;
}

.save-error {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
  color: #e88080;
  font-size: 0.85rem;
}

.survey-actions {
  margin-top: 1rem;
  display: flex;
  justify-content: flex-end;
}
</style>
