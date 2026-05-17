// Process-rubric composer (sessions-spike WU-4, design §7 & §7.2).
//
// `scoreTimeline` runs the 9 pure scorers over a parsed SessionTimeline and
// assembles a `ProcessRubricScore`. Items appear in `RubricKey` declaration
// order. The `now` parameter is injectable so tests get a deterministic
// `scoredAt`.
//
// No Zod validation at runtime — scorers build typed plain objects and the
// composer assembles them. `rubric-golden.test.ts` asserts schema parity.

import type {
  ProcessRubricScore,
  RubricItem,
  RubricVerdict,
  SessionTimeline,
} from '@metaswarm-dashboard/types/sessions';

import { scoreCommunication } from './communication.js';
import { scoreCrossReference } from './cross-reference.js';
import { scoreErrorHandling } from './error-handling.js';
import { scorePlanning } from './planning.js';
import { scorePromptCoherence } from './prompt-coherence.js';
import { scoreSetupDiscipline } from './setup-discipline.js';
import { scoreTdd } from './tdd.js';
import { scoreThrashing } from './thrashing.js';
import { scoreWorkflowTouchpoints } from './workflow-touchpoints.js';

/** The 9 scorers, in `RubricKey` enum declaration order. */
const SCORERS: ReadonlyArray<(timeline: SessionTimeline) => RubricItem> = [
  scoreSetupDiscipline,
  scorePlanning,
  scoreTdd,
  scoreErrorHandling,
  scoreThrashing,
  scoreCrossReference,
  scoreCommunication,
  scorePromptCoherence,
  scoreWorkflowTouchpoints,
];

/** Aggregate per design §7.2: `fail` if any verdict is fail; else `watch`
 *  if any is watch; else `pass` if any is pass; else (all `na`) `na`.
 *
 *  v4 (design §5): this feeds `ProcessRubricScore.overall`, which is
 *  **INFORMATIONAL ONLY — not a gate**. The rubric is an advisory
 *  suggestion; the operator's per-KPI ratings are the ground truth. WU-4.5's
 *  calibration found a fixed rule set cannot be the oracle, so `overall` is
 *  computed and displayed but never blocks or decides anything. */
export function aggregateVerdict(verdicts: readonly RubricVerdict[]): RubricVerdict {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('watch')) return 'watch';
  if (verdicts.includes('pass')) return 'pass';
  return 'na';
}

export function scoreTimeline(
  timeline: SessionTimeline,
  now: Date = new Date(),
): ProcessRubricScore {
  const items = SCORERS.map((score) => score(timeline));
  return {
    schemaVersion: 1,
    sessionId: timeline.sessionId,
    scoredAt: now.toISOString(),
    items,
    // `overall` is INFORMATIONAL ONLY — not a gate (design §5). It is
    // computed and surfaced as a hint; it never blocks or decides anything.
    overall: aggregateVerdict(items.map((i) => i.verdict)),
  };
}
