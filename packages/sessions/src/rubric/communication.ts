// communication scorer (sessions-spike WU-4, design §7).
//
// Signal: did the agent communicate progress externally — a `bd close`,
// `bd update --notes`, or `mini yt comment`, AND an `.agents/` note write?
// Verdict: session <10 events -> na; both signals present -> pass; exactly
// one -> watch; neither -> fail.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { bashMatches, isAgentsPath, isToolUse } from './util.js';

const BD_CLOSE = /\bbd\s+close\b/;
const BD_NOTES = /\bbd\s+update\b.*--notes\b/;
const MINI_YT_COMMENT = /\bmini\s+yt\s+comment\b/;

const MIN_EVENTS = 10;

function isWriteOrEdit(e: ToolUseEvent): boolean {
  return isToolUse(e, 'Write') || isToolUse(e, 'Edit');
}

export function scoreCommunication(timeline: SessionTimeline): RubricItem {
  const events = timeline.events;

  if (events.length < MIN_EVENTS) {
    return {
      key: 'communication',
      label: 'External communication',
      verdict: 'na',
      evidence: `session has only ${events.length} events (<${MIN_EVENTS})`,
      pointer: null,
    };
  }

  const commCloseIndex = events.findIndex(
    (e) =>
      bashMatches(e, BD_CLOSE) || bashMatches(e, BD_NOTES) || bashMatches(e, MINI_YT_COMMENT),
  );
  const agentsWriteIndex = events.findIndex(
    (e) => isWriteOrEdit(e) && isAgentsPath(e.summary),
  );

  const hasComm = commCloseIndex !== -1;
  const hasAgents = agentsWriteIndex !== -1;

  if (hasComm && hasAgents) {
    return {
      key: 'communication',
      label: 'External communication',
      verdict: 'pass',
      evidence: 'closed/updated the bead and wrote an .agents/ note',
      pointer: { kind: 'index', value: commCloseIndex },
    };
  }
  if (hasComm || hasAgents) {
    return {
      key: 'communication',
      label: 'External communication',
      verdict: 'watch',
      evidence: hasComm
        ? 'bd close/update present but no .agents/ note written'
        : '.agents/ note written but no bd close/update',
      pointer: { kind: 'index', value: hasComm ? commCloseIndex : agentsWriteIndex },
    };
  }
  return {
    key: 'communication',
    label: 'External communication',
    verdict: 'fail',
    evidence: 'no bd close/update and no .agents/ note written',
    pointer: null,
  };
}
