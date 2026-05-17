// error-handling scorer (sessions-spike WU-4, design §5 — v4 rewrite).
//
// v3's rule scored a `tool-error` as "handled" only when events[i+1..i+2]
// was a Read/Grep tool-use or an `assistant-text` — a diagnostic `Bash`
// (`git status`, `ls`) was scored as unhandled, so competent sessions that
// investigated via the shell wrongly failed (WU-4.5 calibration finding).
//
// v4 single complementary definition (design §5): for each `tool-error` at
// stream index `i`, the **errored call** is the nearest preceding `tool-use`
// event (index < i). The error is **unhandled** iff EITHER
//   - `events[i+1]` exists and is a `tool-use` whose `(toolName, summary)`
//     equals the errored call's `(toolName, summary)` — a blind identical
//     retry; OR
//   - no event follows `i` — the session ended on the error.
// The error is **handled** in every other case. `handled ≡ NOT unhandled`,
// complementary by construction: every error is classified exactly once.
//
// The comparison uses only the `ToolUseEvent` `(toolName, summary)` fields —
// the parser retains nothing else, so there are no raw call bytes to diff.
// LIMITATION: `summary` is truncated to ≤200 chars (design §6 / the
// `ToolUseEvent` schema). Two genuinely distinct calls whose first 200 chars
// coincide compare as equal and a real retry-vs-not distinction is lost.
// Accepted: the rubric is an advisory hint, not an oracle (design §5).
//
// Verdict on handled/total ratio: `≥0.8`→pass · `0.5 ≤ r < 0.8`→watch ·
// `<0.5`→fail · 0 `tool-error`s→na.

import type { RubricItem, SessionTimeline, ToolUseEvent } from '@metaswarm-dashboard/types/sessions';

const HANDLED_PASS_RATIO = 0.8;
const HANDLED_WATCH_RATIO = 0.5;

/** The nearest preceding `tool-use` event before stream index `i`, or
 *  `undefined` when no `tool-use` precedes the error (e.g. the error is the
 *  first event). */
function erroredCall(
  events: SessionTimeline['events'],
  i: number,
): ToolUseEvent | undefined {
  for (let j = i - 1; j >= 0; j -= 1) {
    const e = events[j];
    if (e !== undefined && e.kind === 'tool-use') return e;
  }
  return undefined;
}

/** True iff the `tool-error` at `events[i]` is "unhandled": the next event is
 *  a blind identical retry of the errored call, or the session ended on the
 *  error. Handled is the exact complement. */
function isUnhandled(events: SessionTimeline['events'], i: number): boolean {
  const next = events[i + 1];
  // Session ended on the error — no corrective response possible.
  if (next === undefined) return true;
  // A blind identical retry: the next event repeats the errored call.
  if (next.kind !== 'tool-use') return false;
  const errored = erroredCall(events, i);
  if (errored === undefined) return false;
  return next.toolName === errored.toolName && next.summary === errored.summary;
}

export function scoreErrorHandling(timeline: SessionTimeline): RubricItem {
  const events = timeline.events;
  const errorIndices: number[] = [];
  events.forEach((e, i) => {
    if (e.kind === 'tool-error') errorIndices.push(i);
  });

  if (errorIndices.length === 0) {
    return {
      key: 'error-handling',
      label: 'Error handling',
      verdict: 'na',
      evidence: 'no tool errors in session',
      pointer: null,
    };
  }

  const unhandled = errorIndices.filter((i) => isUnhandled(events, i));
  const handledCount = errorIndices.length - unhandled.length;
  const ratio = handledCount / errorIndices.length;
  const verdict =
    ratio >= HANDLED_PASS_RATIO ? 'pass' : ratio >= HANDLED_WATCH_RATIO ? 'watch' : 'fail';

  // `pass` carries no pointer. On `watch`/`fail` the ratio is < 0.8, so at
  // least one error is unhandled — `firstUnhandled` is then a number.
  const firstUnhandled = unhandled[0];
  const pointer: RubricItem['pointer'] =
    verdict === 'pass' || firstUnhandled === undefined
      ? null
      : { kind: 'index', value: firstUnhandled };

  return {
    key: 'error-handling',
    label: 'Error handling',
    verdict,
    evidence: `${handledCount}/${errorIndices.length} tool errors got a corrective response`,
    pointer,
  };
}
