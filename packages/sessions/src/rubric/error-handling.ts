// error-handling scorer (sessions-spike WU-4, design §7).
//
// Signal: tool errors followed by a corrective response — either a
// Read/Grep within <=2 events, or an assistant-text in the very next event.
// Verdict: handledRatio >=0.8 -> pass; 0.5 <= ratio < 0.8 -> watch;
// ratio < 0.5 -> fail; zero errors -> na.

import type { RubricItem, SessionTimeline } from '@metaswarm-dashboard/types/sessions';

import { isToolUse } from './util.js';

/** True iff the event at `events[i]` (a tool-error) is "handled" — followed
 *  by a corrective Read/Grep within events[i+1]/events[i+2], OR an
 *  assistant-text directly at events[i+1]. */
function isHandled(events: SessionTimeline['events'], i: number): boolean {
  const next = events[i + 1];
  if (next !== undefined && next.kind === 'assistant-text') return true;
  for (const j of [i + 1, i + 2]) {
    const e = events[j];
    if (e !== undefined && (isToolUse(e, 'Read') || isToolUse(e, 'Grep'))) return true;
  }
  return false;
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

  const unhandled = errorIndices.filter((i) => !isHandled(events, i));
  const handledCount = errorIndices.length - unhandled.length;
  const ratio = handledCount / errorIndices.length;
  const verdict = ratio >= 0.8 ? 'pass' : ratio >= 0.5 ? 'watch' : 'fail';

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
