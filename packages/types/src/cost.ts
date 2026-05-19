// AI-cost schemas for sessions-spike v5 (design §6, §5).
//
// Additive to `@metaswarm-dashboard/types` — a brand-new file; no v4 schema
// in api.ts / sessions.ts / snapshots.ts / paths.ts is modified.
//
// `TokenUsage` reconciliation (design §6 vs §5.2): design §6 sketched a
// single `cacheCreationTokens` field. The §5.2 cost formula — the
// authoritative computation spec — prices the Anthropic 5-minute and
// 1-hour cache-creation writes at SEPARATE table rates. A single combined
// field cannot represent that split, so `TokenUsage` here carries the two
// fields `cacheCreation5mTokens` / `cacheCreation1hTokens` instead. Codex
// usage (which has no cache-write split) sets both to 0. This follows §5.2,
// which the design itself names as authoritative for the computation.

import { z } from 'zod';

/** A non-negative integer token count. */
const tokenCount = z.number().int().nonnegative();

/** A non-negative per-1M-token USD rate. */
const usdRate = z.number().nonnegative();

/**
 * Per-record token usage, normalized across vendors.
 *
 * - `inputTokens` / `outputTokens` — the base prompt / completion counts.
 * - `cacheReadTokens` — Anthropic `cache_read_input_tokens`, or Codex
 *   `cached_input_tokens` (both billed at the model's `cacheRead` rate).
 * - `cacheCreation5mTokens` / `cacheCreation1hTokens` — the Anthropic
 *   `cache_creation.ephemeral_5m/1h_input_tokens` split. Codex sets both 0.
 * - `reasoningTokens` — Codex `reasoning_output_tokens` (billed at `output`).
 *   0 for Anthropic.
 */
export const TokenUsage = z.object({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
  cacheCreation5mTokens: tokenCount,
  cacheCreation1hTokens: tokenCount,
  reasoningTokens: tokenCount,
});
export type TokenUsage = z.infer<typeof TokenUsage>;

/** The three AI vendors the dashboard surfaces cost for. */
export const VendorId = z.enum(['anthropic', 'openai', 'google']);
export type VendorId = z.infer<typeof VendorId>;

/**
 * One model's pricing — per-1M-token USD rates (design §5.1).
 *
 * `cacheWrite5m` / `cacheWrite1h` are the Anthropic cache-creation split.
 * `cacheWrite` is an optional blended fallback used when a split key is
 * absent (design §5.2 fallback chain). A model with no cache pricing at all
 * (e.g. a plain Gemini model) omits every cache key; the §5.2 formula then
 * falls back to the base `input` rate.
 */
export const ModelPricing = z.object({
  vendor: VendorId,
  input: usdRate,
  output: usdRate,
  cacheRead: usdRate.optional(),
  cacheWrite: usdRate.optional(),
  cacheWrite5m: usdRate.optional(),
  cacheWrite1h: usdRate.optional(),
});
export type ModelPricing = z.infer<typeof ModelPricing>;

/**
 * The pinned, version-controlled model→price table (design §5.1). Validated
 * at load time; `pricingAsOf` is surfaced in the UI so stale prices show.
 */
export const PricingTable = z.object({
  /** ISO `YYYY-MM-DD` the rates were pinned. */
  pricingAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Human-readable note + a pointer to the cited price sources. */
  source: z.string().min(1),
  /** Model id → its pricing. An id absent here renders unpriced (§5.3). */
  models: z.record(z.string(), ModelPricing),
});
export type PricingTable = z.infer<typeof PricingTable>;

/**
 * The cost of one model's usage within a vendor context (design §6).
 *
 * `costUsd` is `null` (with `priced: false`) when the model id is absent
 * from the pricing table — the UI shows "n/a", never a fabricated `0`
 * (design §5.3).
 */
export const VendorCost = z.object({
  vendor: VendorId,
  /** The CANONICAL priced model id (a dated-suffix alias is normalized). */
  model: z.string(),
  usage: TokenUsage,
  costUsd: z.number().nullable(),
  priced: z.boolean(),
});
export type VendorCost = z.infer<typeof VendorCost>;

/**
 * A Claude session's own cost (design §6). `totalCostUsd` is the sum of the
 * priced contributions; `hasUnpriced` is true iff at least one model in the
 * session was unpriced — meaning `totalCostUsd` is a lower bound.
 */
export const SessionCost = z.object({
  sessionId: z.string(),
  vendor: z.literal('anthropic'),
  byModel: z.array(VendorCost),
  totalCostUsd: z.number(),
  hasUnpriced: z.boolean(),
});
export type SessionCost = z.infer<typeof SessionCost>;

/**
 * One Codex or Gemini delegation run (design §6). `projectName` is the
 * cwd-attributed config project, or `null` for the `unattributed` bucket.
 * `costUsd` is `null` when the run's model is unpriced or its token usage
 * could not be recovered (design §4.2 `info`-null case).
 */
export const DelegationRun = z.object({
  vendor: VendorId,
  model: z.string(),
  projectName: z.string().nullable(),
  /** UTC ISO-8601 timestamp of the run. */
  at: z.string().datetime({ offset: false }),
  usage: TokenUsage,
  costUsd: z.number().nullable(),
});
export type DelegationRun = z.infer<typeof DelegationRun>;

/** Per-vendor cost roll-up within a project (design §6). */
export const VendorCostRollup = z.object({
  costUsd: z.number(),
  runCount: z.number().int().nonnegative(),
  hasUnpriced: z.boolean(),
});
export type VendorCostRollup = z.infer<typeof VendorCostRollup>;

/**
 * Per-project AI cost across all three vendors (design §6). `byVendor`
 * always has an entry for every `VendorId` — a vendor with no runs is shown
 * as `costUsd: 0, runCount: 0` rather than omitted. `totalCostUsd` is the
 * priced-sum; `hasUnpriced` flags a lower-bound total.
 */
export const ProjectCostSummary = z.object({
  /** The config-project name, or `'unattributed'` for the catch-all bucket. */
  projectName: z.string(),
  byVendor: z.object({
    anthropic: VendorCostRollup,
    openai: VendorCostRollup,
    google: VendorCostRollup,
  }),
  totalCostUsd: z.number(),
  hasUnpriced: z.boolean(),
  /** Echoed from the pricing table so the UI can show "prices as of …". */
  pricingAsOf: z.string(),
});
export type ProjectCostSummary = z.infer<typeof ProjectCostSummary>;
