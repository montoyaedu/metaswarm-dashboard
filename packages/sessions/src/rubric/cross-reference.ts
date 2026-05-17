// cross-reference scorer (sessions-spike WU-4, design §7).
//
// Signal: when the work touches multiple packages, did the agent read at
// least one documenting file outside `src/` (a doc/contract/config)?
// Verdict: not multi-package -> na; multi-package + >=1 cross-ref read ->
// pass; multi-package + 0 -> watch. No `fail` branch (design §7).

import type { RubricItem, SessionTimeline } from '@metaswarm-dashboard/types/sessions';

import { isSrcCode, isToolUse, packagePrefix, writeEvents } from './util.js';

export function scoreCrossReference(timeline: SessionTimeline): RubricItem {
  const writePackages = new Set<string>();
  for (const w of writeEvents(timeline)) {
    const prefix = packagePrefix(w.summary);
    if (prefix !== null) writePackages.add(prefix);
  }

  if (writePackages.size < 2) {
    return {
      key: 'cross-reference',
      label: 'Cross-ref to context',
      verdict: 'na',
      evidence: 'single-package work',
      pointer: null,
    };
  }

  // A cross-ref read is a Read of a file that is NOT source code — a doc,
  // a contract, or a config file.
  const crossRefIndex = timeline.events.findIndex(
    (e) => isToolUse(e, 'Read') && !isSrcCode(e.summary),
  );

  if (crossRefIndex !== -1) {
    return {
      key: 'cross-reference',
      label: 'Cross-ref to context',
      verdict: 'pass',
      evidence: `multi-package work (${writePackages.size} packages) with a cross-ref doc read`,
      pointer: { kind: 'index', value: crossRefIndex },
    };
  }

  return {
    key: 'cross-reference',
    label: 'Cross-ref to context',
    verdict: 'watch',
    evidence: `multi-package work (${writePackages.size} packages) with no cross-ref doc read`,
    pointer: null,
  };
}
