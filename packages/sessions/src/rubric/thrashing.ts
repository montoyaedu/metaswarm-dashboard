// thrashing scorer (sessions-spike WU-4, design §7).
//
// Signal: a thrash "episode" is a pair of CONSECUTIVE `Edit` tool-use events
// — consecutive within the Edit subsequence, i.e. `eB` is the next `Edit`
// after `eA` regardless of how many `tool-result` / `assistant-text` /
// `thinking` / other-tool events sit between them — that ALL hold:
//   - `eA` and `eB` target the SAME file path (their `summary`);
//   - they are less than 5000 ms apart;
//   - there is NO `Read` tool-use of that SAME path anywhere between them in
//     the full event stream (a same-file Read means the agent investigated,
//     so it is not thrashing).
// This is the correct reading of design §7's "edit-retry-edit loop on the
// same file without diagnostic reads in between": in a real transcript every
// `tool-use` is immediately followed by its `tool-result`, so two `Edit`s are
// never LITERALLY adjacent in `events` — episode detection must therefore
// look at consecutive Edits within the Edit subsequence, not at literal
// `events[i]`/`events[i+1]` pairs. Interleaved tool-results, text, thinking,
// other tools, and other-file Reads do NOT break an episode.
//
// Verdict: 0 episodes -> pass; 1-3 -> watch; >=4 -> fail. No `na` branch.
//
// FOLLOW-UP: design §7's signal also names "consecutive Bash calls differing
// only in trivial flags" as a thrashing variant. That heuristic is NOT
// implemented in this spike — it needs a robust shell-arg diff and risks
// false positives. WU-7 should open a follow-up bead to add it.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { isToolUse } from './util.js';

const THRASH_GAP_MS = 5000;

/** An `Edit` tool-use event tagged with its index in the full event stream. */
interface IndexedEdit {
  event: ToolUseEvent;
  index: number;
}

/** Adjacent `(prev, curr)` pairs within the `Edit` subsequence — `curr` is
 *  the next `Edit` after `prev`, however many non-Edit events sit between
 *  them. Built with a `prev` accumulator so both members are statically
 *  non-undefined (no indexed-access guard needed). */
function adjacentEditPairs(
  events: readonly ToolUseEvent[],
): Array<{ prev: IndexedEdit; curr: IndexedEdit }> {
  const pairs: Array<{ prev: IndexedEdit; curr: IndexedEdit }> = [];
  let prev: IndexedEdit | null = null;
  events.forEach((event, index) => {
    if (!isToolUse(event, 'Edit')) return;
    const curr: IndexedEdit = { event, index };
    if (prev !== null) pairs.push({ prev, curr });
    prev = curr;
  });
  return pairs;
}

/** True iff a `Read` tool-use of `path` appears in `events` strictly between
 *  the stream indices `(fromIndex, toIndex)`. A same-file Read means the
 *  agent investigated, which breaks an otherwise-thrashing Edit pair. */
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

export function scoreThrashing(timeline: SessionTimeline): RubricItem {
  let episodes = 0;
  let firstEpisode: { path: string; secondIndex: number } | undefined;

  for (const { prev, curr } of adjacentEditPairs(timeline.events)) {
    if (prev.event.summary !== curr.event.summary) continue;
    const gap = Date.parse(curr.event.at) - Date.parse(prev.event.at);
    if (gap >= THRASH_GAP_MS) continue;
    if (
      hasInterveningReadOfPath(timeline.events, prev.index, curr.index, curr.event.summary)
    ) {
      continue;
    }
    episodes += 1;
    firstEpisode ??= { path: curr.event.summary, secondIndex: curr.index };
  }

  const verdict = episodes === 0 ? 'pass' : episodes <= 3 ? 'watch' : 'fail';
  const evidence =
    firstEpisode === undefined
      ? '0 thrash episodes'
      : `${episodes} thrash episode${episodes === 1 ? '' : 's'} ` +
        `(consecutive Edit on ${firstEpisode.path} <5s, no intervening read)`;
  return {
    key: 'thrashing',
    label: 'No thrashing',
    verdict,
    evidence,
    pointer:
      firstEpisode === undefined ? null : { kind: 'index', value: firstEpisode.secondIndex },
  };
}
