// Sessions-observability schemas for the spike (design §6). Additive to
// `@metaswarm-dashboard/types` — a brand-new file; no existing schema in
// api.ts / snapshots.ts / paths.ts is modified.

import { z } from 'zod';

export const ToolUseEventKind = z.enum([
  'user-prompt',
  'user-command',
  'assistant-text',
  'assistant-thinking',
  'tool-use',
  'tool-result',
  'tool-error',
]);
export type ToolUseEventKind = z.infer<typeof ToolUseEventKind>;

export const ToolUseEvent = z.object({
  /** UTC ISO-8601 timestamp from the JSONL entry. */
  at: z.string().datetime({ offset: false }),
  kind: ToolUseEventKind,
  /** For `tool-use`: the tool name (Read/Write/Edit/Bash/Agent/...). */
  toolName: z.string().nullable(),
  /** Short summary for the timeline view (≤200 chars, single-line).
   *  MAY CONTAIN OPERATOR SECRETS. See design §11. */
  summary: z.string(),
  /** Which redactors fired before truncation. Empty in this spike. */
  redactionApplied: z.array(z.string()).default([]),
  /** Original JSONL entry's UUID, for cross-reference / debugging. */
  uuid: z.string().nullable(),
});
export type ToolUseEvent = z.infer<typeof ToolUseEvent>;

export const SessionTimeline = z.object({
  schemaVersion: z.literal(1),
  transcriptPath: z.string(),
  sessionId: z.string(),
  projectCwd: z.string(),
  startedAt: z.string().datetime({ offset: false }),
  lastEventAt: z.string().datetime({ offset: false }),
  eventCount: z.number().int().nonnegative(),
  /** Count of JSONL lines skipped because they failed to parse, exceeded
   *  the 1 MiB line cap, or contained non-UTF-8 bytes. */
  skippedLineCount: z.number().int().nonnegative().default(0),
  events: z.array(ToolUseEvent),
});
export type SessionTimeline = z.infer<typeof SessionTimeline>;

export const RubricVerdict = z.enum(['pass', 'watch', 'fail', 'na']);
export type RubricVerdict = z.infer<typeof RubricVerdict>;

export const RubricKey = z.enum([
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
]);
export type RubricKey = z.infer<typeof RubricKey>;

/** Discriminated union — replaces v1's ambiguous `pointer: string | null`. */
export const RubricPointer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uuid'), value: z.string() }),
  z.object({ kind: z.literal('index'), value: z.number().int().nonnegative() }),
]);
export type RubricPointer = z.infer<typeof RubricPointer>;

export const RubricItem = z.object({
  key: RubricKey,
  label: z.string(),
  verdict: RubricVerdict,
  /** One short sentence describing the evidence (≤200 chars).
   *  MAY CONTAIN OPERATOR SECRETS. See design §11. */
  evidence: z.string().max(200),
  pointer: RubricPointer.nullable(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const ProcessRubricScore = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  scoredAt: z.string().datetime({ offset: false }),
  /** Exactly one entry per RubricKey, in the enum's declaration order.
   *  Length is mutated to N ∈ [6, 9] by WU-4.5 if criteria are dropped. */
  items: z.array(RubricItem).length(9),
  /** `fail` if any item is fail; else `watch` if any is watch; else `pass`.
   *  `na` items are excluded; all-`na` → `na`. */
  overall: RubricVerdict,
});
export type ProcessRubricScore = z.infer<typeof ProcessRubricScore>;

/**
 * A list-row projection of a discovered session, surfaced by
 * `GET /api/sessions` (design §7). It carries no rubric verdict — the list
 * view shows only identity + activity + a `rated` flag (design §6.2). The
 * full timeline + rubric are fetched on demand by the detail endpoint.
 */
export const SessionSummary = z.object({
  /** The `config.yaml` project name the session's transcript belongs to. */
  projectName: z.string().min(1),
  /** The `.jsonl` basename (extension removed) — the route's `:sessionId`. */
  sessionId: z.string().min(1),
  startedAt: z.string().datetime({ offset: false }),
  lastEventAt: z.string().datetime({ offset: false }),
  eventCount: z.number().int().nonnegative(),
  /** True iff a persisted `SessionRating` exists for this session. */
  rated: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionSnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  generatedAt: z.string().datetime({ offset: false }),
  /** False in this spike. Future secret-pattern redactor flips this to
   *  true; downstream sharers must check it. */
  persistedWithSanitization: z.boolean(),
  timeline: SessionTimeline,
  rubric: ProcessRubricScore,
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;
