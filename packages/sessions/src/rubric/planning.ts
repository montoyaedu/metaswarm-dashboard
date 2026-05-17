// planning scorer (sessions-spike WU-4, design §7).
//
// Signal: was a beads issue created/claimed before source code was first
// written?
// Verdict: a `bd create` / `bd update --claim` before the first src write
// -> pass; otherwise an `.agents/` write before the first src write ->
// watch; src write with no prior bd/agents activity -> fail.
//
// EDGE (documented per the WU-4 brief): design §7 has no `na` branch here.
// When a session writes no source files at all, there is nothing to plan
// for — we return `pass` with the explicit evidence "no source files
// written" rather than inventing an `na` branch the schema/aggregate do not
// expect for this criterion.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { bashMatches, isAgentsPath, isSrcCode, isToolUse } from './util.js';

const BD_CREATE = /\bbd\s+create\b/;
const BD_CLAIM = /\bbd\s+update\b.*--claim\b/;

function isWriteOrEdit(e: ToolUseEvent): boolean {
  return isToolUse(e, 'Write') || isToolUse(e, 'Edit');
}

export function scorePlanning(timeline: SessionTimeline): RubricItem {
  const events = timeline.events;
  const firstSrcWrite = events.findIndex(
    (e) => isWriteOrEdit(e) && isSrcCode(e.summary),
  );

  if (firstSrcWrite === -1) {
    return {
      key: 'planning',
      label: 'Planning vs cowboy',
      verdict: 'pass',
      evidence: 'no source files written',
      pointer: null,
    };
  }

  // Examine only the events that precede the first src write.
  const preamble = events.slice(0, firstSrcWrite);
  const bdIndex = preamble.findIndex(
    (e) => bashMatches(e, BD_CREATE) || bashMatches(e, BD_CLAIM),
  );
  const agentsIndex = preamble.findIndex(
    (e) => isWriteOrEdit(e) && isAgentsPath(e.summary),
  );

  if (bdIndex !== -1) {
    return {
      key: 'planning',
      label: 'Planning vs cowboy',
      verdict: 'pass',
      evidence: 'bd issue created/claimed before first src write',
      pointer: { kind: 'index', value: bdIndex },
    };
  }
  if (agentsIndex !== -1) {
    return {
      key: 'planning',
      label: 'Planning vs cowboy',
      verdict: 'watch',
      evidence: 'only .agents/ note written before first src write, no bd issue',
      pointer: { kind: 'index', value: agentsIndex },
    };
  }
  return {
    key: 'planning',
    label: 'Planning vs cowboy',
    verdict: 'fail',
    evidence: 'src code written with no prior bd or .agents activity',
    pointer: { kind: 'index', value: firstSrcWrite },
  };
}
