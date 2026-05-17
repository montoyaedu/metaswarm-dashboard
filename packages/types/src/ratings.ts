// Operator-rating schemas for the v4 calibration UI. Additive to
// `@metaswarm-dashboard/types` — a brand-new file; no existing schema in
// sessions.ts / api.ts / snapshots.ts is modified. See design §4.

import { z } from 'zod';

import { ProcessRubricScore, RubricKey } from './sessions.js';

export const OperatorVerdict = z.object({
  /** Which rubric criterion this verdict is for. */
  key: RubricKey,
  /** The operator's judgement. `unsure` = "I looked and can't tell". */
  verdict: z.enum(['pass', 'watch', 'fail', 'na', 'unsure']),
  /** Optional short free-text note (≤500 chars). MAY contain operator secrets. */
  note: z.string().max(500).optional(),
  scoredAt: z.string().datetime({ offset: false }),
});
export type OperatorVerdict = z.infer<typeof OperatorVerdict>;

export const SessionRating = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  projectName: z.string().min(1),
  /** 0..9 verdicts (partial ratings allowed); no duplicate `key`. */
  verdicts: z
    .array(OperatorVerdict)
    .max(9)
    .refine((vs) => new Set(vs.map((v) => v.key)).size === vs.length, {
      message: 'duplicate RubricKey in verdicts',
    }),
  /** Optional overall note (≤2000 chars). MAY contain operator secrets. */
  overallNote: z.string().max(2000).optional(),
  ratedAt: z.string().datetime({ offset: false }),
  /** The rubric suggestion frozen at rating time — the server re-derives and
   *  embeds this so rubric-vs-operator agreement is computed honestly. */
  rubricAtRating: ProcessRubricScore,
});
export type SessionRating = z.infer<typeof SessionRating>;

export const KpiAgreement = z.object({
  key: RubricKey,
  /** rubric suggestion == operator verdict, counting only pass/watch/fail. */
  agree: z.number().int().nonnegative(),
  disagree: z.number().int().nonnegative(),
  /** verdicts where the operator answered `na` or `unsure` — excluded from
   *  agree/disagree, counted here separately (design §4). */
  naOrUnsure: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** agree / (agree+disagree); null when there is no agree/disagree data. */
  agreementRatio: z.number().min(0).max(1).nullable(),
});
export type KpiAgreement = z.infer<typeof KpiAgreement>;

export const CalibrationSummary = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: false }),
  ratedSessionCount: z.number().int().nonnegative(),
  /** One entry per RubricKey. */
  perKpi: z.array(KpiAgreement),
});
export type CalibrationSummary = z.infer<typeof CalibrationSummary>;
