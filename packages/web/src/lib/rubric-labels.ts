// Human-readable labels for each `RubricKey`, in the enum's declaration order
// (design §6.3 / §6.4). The detail endpoint's `rubric.items` already carries a
// `label` per KPI, but the calibration summary's `perKpi[]` carries only the
// `key` — this map gives the calibration panel a consistent display label.
// These are static UI strings (no transcript content), so they live in the
// SPA rather than crossing a package boundary.

import type { RubricKey } from '@metaswarm-dashboard/types/sessions';

/** The 9 `RubricKey`s in enum-declaration order — the survey/panel row order. */
export const RUBRIC_KEYS: readonly RubricKey[] = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
];

const RUBRIC_LABELS: Record<RubricKey, string> = {
  'setup-discipline': 'Setup discipline',
  planning: 'Planning vs cowboy',
  tdd: 'TDD discipline',
  'error-handling': 'Error handling',
  thrashing: 'No thrashing',
  'cross-reference': 'Cross-ref to context',
  communication: 'External communication',
  'prompt-coherence': 'Coherence with prompt',
  'workflow-touchpoints': 'Workflow touchpoints',
};

/** The display label for a `RubricKey`. */
export function rubricLabel(key: RubricKey): string {
  return RUBRIC_LABELS[key];
}
