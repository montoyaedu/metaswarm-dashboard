// WU v5-8 — pure extraction helpers for the F1 survey-context panel
// (design §8.1). Extracted from `RatingSurvey.vue` so the branchy
// filter/group logic is unit-testable without mounting the component.
//
// SECURITY: these helpers only project transcript-derived strings — every
// returned string is rendered by the caller via TEXT interpolation, never
// `v-html`. They never parse or sanitize markup. See design §8.1 / §9.

import type { ToolUseEvent } from '@metaswarm-dashboard/types/sessions';

/** Bucket label for a `tool-use` event whose `toolName` is `null`. */
const UNKNOWN_TOOL = '(unknown)';

/**
 * The session heading for the context panel: the Claude-generated `aiTitle`,
 * or the literal `"Untitled session"` when it is `null`, `undefined`, or an
 * empty string (`aiTitle` is `string | null | undefined` — v5-6 made the Zod
 * field `.optional()`).
 */
export function sessionHeading(aiTitle: string | null | undefined): string {
  const trimmed = aiTitle?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : 'Untitled session';
}

/**
 * The user-prompt summaries, in transcript order. Only `kind === 'user-prompt'`
 * events qualify — `user-command` events are slash-commands and are excluded
 * (design §8.1).
 */
export function userPrompts(events: ToolUseEvent[]): string[] {
  return events.filter((e) => e.kind === 'user-prompt').map((e) => e.summary);
}

/**
 * A one-line tool-use action summary: counts grouped by `toolName`, ordered
 * descending by count (ties broken by first-seen order — `Map` insertion is
 * stable), rendered e.g. `"Read ×12 · Edit ×8 · Bash ×5"`. A `tool-use` with
 * a `null` `toolName` is bucketed under `"(unknown)"`. When the session has
 * zero tool-use events, the literal `"no tool calls recorded"` is returned.
 */
export function actionSummary(events: ToolUseEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'tool-use') continue;
    const name = e.toolName ?? UNKNOWN_TOOL;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return 'no tool calls recorded';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} ×${count}`)
    .join(' · ');
}
