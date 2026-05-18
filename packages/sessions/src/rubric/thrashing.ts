// thrashing scorer (sessions-spike WU-4, design §5 — v4 rewrite).
//
// v3's rule counted every adjacent same-file `<5s` `Edit` *pair* as an
// "episode" and fired `watch` at a single pair — so normal "edit section A
// then edit section B of the same file" tripped it (WU-4.5 calibration
// finding: thrashing fired on competent sessions).
//
// v4 rule (design §5): a **thrash run** is a maximal run of **≥3** `Edit`
// tool-use events that ALL target the SAME file path, where
//   - each `Edit` is `< 5000 ms` after the previous `Edit` of the run; AND
//   - there is NO `Read` tool-use of that SAME path between two consecutive
//     edits of the run.
// "Consecutive" is within the `Edit` subsequence: in a real transcript every
// `tool-use` is followed by its `tool-result`, so two `Edit`s are never
// LITERALLY adjacent in `events` — interleaved tool-results / text /
// thinking / other tools / other-file Reads do NOT break a run.
//
// A same-file `Read`, or a ≥5s gap, between two consecutive edits breaks the
// run there; the run is split and a new run may start at the next edit. A
// run of length ≥3 (after splitting) counts as one thrash run.
//
// Verdict on the run count: `0`→pass · `1`→watch · `≥2`→fail. No `na`.
//
// FOLLOW-UP: design §7's signal also names "consecutive Bash calls differing
// only in trivial flags" as a thrashing variant. That heuristic is NOT
// implemented in this spike — it needs a robust shell-arg diff and risks
// false positives.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { isToolUse } from './util.js';

const THRASH_GAP_MS = 5000;
const THRASH_RUN_MIN_EDITS = 3;

/** An `Edit` tool-use event tagged with its index in the full event stream. */
interface IndexedEdit {
  event: ToolUseEvent;
  index: number;
}

/** A detected thrash run — for evidence/pointer reporting. The `pointerIndex`
 *  is the stream index of the run's SECOND edit (the first point where the
 *  run becomes visible). */
interface ThrashRun {
  path: string;
  pointerIndex: number;
}

/** All `Edit` tool-use events tagged with their stream index, in order. */
function indexedEdits(events: readonly ToolUseEvent[]): IndexedEdit[] {
  const edits: IndexedEdit[] = [];
  events.forEach((event, index) => {
    if (isToolUse(event, 'Edit')) edits.push({ event, index });
  });
  return edits;
}

/** True iff a `Read` tool-use of `path` appears in `events` strictly between
 *  the stream indices `(fromIndex, toIndex)`. A same-file Read means the
 *  agent investigated, which breaks an otherwise-thrashing run. */
function hasInterveningReadOfPath(
  events: readonly ToolUseEvent[],
  fromIndex: number,
  toIndex: number,
  path: string,
): boolean {
  return events
    .slice(fromIndex + 1, toIndex)
    .some((event) => isToolUse(event, 'Read') && event.summary === path);
}

/** True iff `curr` continues the run anchored on `prev`: same file path,
 *  `< THRASH_GAP_MS` apart, and no intervening same-file `Read`. */
function continuesRun(
  events: readonly ToolUseEvent[],
  prev: IndexedEdit,
  curr: IndexedEdit,
): boolean {
  if (prev.event.summary !== curr.event.summary) return false;
  const gap = Date.parse(curr.event.at) - Date.parse(prev.event.at);
  if (gap >= THRASH_GAP_MS) return false;
  return !hasInterveningReadOfPath(events, prev.index, curr.index, curr.event.summary);
}

export function scoreThrashing(timeline: SessionTimeline): RubricItem {
  const edits = indexedEdits(timeline.events);
  const runs: ThrashRun[] = [];

  // Walk the Edit subsequence with a `prev` accumulator, growing a maximal
  // same-file run. `runLength` counts the edits of the run in progress. The
  // run becomes a thrash run the moment `runLength` reaches the ≥3-edit bar
  // — and at that exact iteration `prev` is the run's SECOND edit (non-null,
  // because reaching length 3 means we are inside the `continuesRun`
  // branch). The whole run shares one file path (`continuesRun` requires
  // equal `summary`), so `prev.event.summary` is the run's path and
  // `prev.index` its second-edit pointer. Each run contributes at most one
  // `ThrashRun`, recorded only on the 2→3 transition; further growth of an
  // already-counted run changes nothing.
  let prev: IndexedEdit | null = null;
  let runLength = 0;

  for (const curr of edits) {
    if (prev !== null && continuesRun(timeline.events, prev, curr)) {
      // `curr` extends the current run.
      runLength += 1;
      // The 2→3 transition: the run just crossed the thrash bar. `prev` is
      // the run's second edit — its path and index describe the run.
      if (runLength === THRASH_RUN_MIN_EDITS) {
        runs.push({ path: prev.event.summary, pointerIndex: prev.index });
      }
    } else {
      // `curr` starts a fresh run of length 1.
      runLength = 1;
    }
    prev = curr;
  }

  const runCount = runs.length;
  const verdict = runCount === 0 ? 'pass' : runCount === 1 ? 'watch' : 'fail';
  const firstRun = runs[0];
  const evidence =
    firstRun === undefined
      ? '0 thrash runs'
      : `${runCount} thrash run${runCount === 1 ? '' : 's'} ` +
        `(≥3 Edits on ${firstRun.path} <5s apart, no intervening read)`;

  return {
    key: 'thrashing',
    label: 'No thrashing',
    verdict,
    evidence,
    pointer:
      firstRun === undefined ? null : { kind: 'index', value: firstRun.pointerIndex },
  };
}
