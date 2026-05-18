// setup-discipline scorer (sessions-spike WU-4, design §7).
//
// Signal: count of `Read` tool-use events targeting a project-convention
// document (AGENTS.md / CLAUDE.md / .agents/** / .coverage-thresholds.json)
// occurring BEFORE the first Write/Edit.
// Verdict: >=3 -> pass; 1-2 -> watch; 0 -> fail. No `na` branch — design §7
// explicitly states this criterion is always scored.

import type { RubricItem, SessionTimeline } from '@metaswarm-dashboard/types/sessions';

import { firstWriteIndex, isConventionDoc, isToolUse } from './util.js';

export function scoreSetupDiscipline(timeline: SessionTimeline): RubricItem {
  const cutoff = firstWriteIndex(timeline);
  // Only events before the first Write/Edit count.
  const reads: number[] = [];
  timeline.events.slice(0, cutoff).forEach((e, i) => {
    if (isToolUse(e, 'Read') && isConventionDoc(e.summary)) reads.push(i);
  });
  const count = reads.length;
  const verdict = count >= 3 ? 'pass' : count >= 1 ? 'watch' : 'fail';
  const decisive = count >= 3 ? reads[2] : count >= 1 ? reads[0] : undefined;
  return {
    key: 'setup-discipline',
    label: 'Setup discipline',
    verdict,
    evidence:
      count === 0
        ? 'no convention docs read before first write'
        : `${count} convention doc${count === 1 ? '' : 's'} read before first write`,
    pointer: decisive === undefined ? null : { kind: 'index', value: decisive },
  };
}
