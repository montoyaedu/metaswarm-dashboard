// workflow-touchpoints scorer (sessions-spike WU-4, design §7).
//
// Signal: how many distinct project-workflow tool categories the session
// touched — (a) any `bd …` Bash; (b) any `mini yt` Bash; (c) any `.agents/`
// Write/Edit; (d) any Read of `.coverage-thresholds.json`.
// Verdict: >=3 distinct -> pass; 1-2 -> watch; 0 -> fail. No `na` branch.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { bashMatches, isAgentsPath, isToolUse } from './util.js';

const BD = /\bbd\s+/;
const MINI_YT = /\bmini\s+yt\b/;

function isWriteOrEdit(e: ToolUseEvent): boolean {
  return isToolUse(e, 'Write') || isToolUse(e, 'Edit');
}

/** True iff the path's basename is `.coverage-thresholds.json`. */
function isCoverageThresholds(p: string): boolean {
  return p.slice(p.lastIndexOf('/') + 1) === '.coverage-thresholds.json';
}

export function scoreWorkflowTouchpoints(timeline: SessionTimeline): RubricItem {
  const events = timeline.events;
  const present = {
    bd: events.some((e) => bashMatches(e, BD)),
    miniYt: events.some((e) => bashMatches(e, MINI_YT)),
    agentsWrite: events.some((e) => isWriteOrEdit(e) && isAgentsPath(e.summary)),
    coverageRead: events.some(
      (e) => isToolUse(e, 'Read') && isCoverageThresholds(e.summary),
    ),
  };

  const labels: string[] = [];
  if (present.bd) labels.push('bd');
  if (present.miniYt) labels.push('mini yt');
  if (present.agentsWrite) labels.push('.agents/');
  if (present.coverageRead) labels.push('.coverage-thresholds.json');

  const count = labels.length;
  const verdict = count >= 3 ? 'pass' : count >= 1 ? 'watch' : 'fail';
  return {
    key: 'workflow-touchpoints',
    label: 'Workflow touchpoints',
    verdict,
    evidence:
      count === 0
        ? 'no workflow tooling used'
        : `${labels.join(' + ')} (${count} distinct)`,
    pointer: null,
  };
}
