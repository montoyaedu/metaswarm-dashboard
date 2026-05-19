// Tokens→USD cost calculator (sessions-spike WU v5-1, design §5.2 / §5.3).
//
// `costFor(usage, model, table)` prices one model's `TokenUsage` against the
// pinned pricing table and returns a `VendorCost`. An id absent from the
// table — after the documented alias normalization — yields
// `costUsd: null, priced: false` (design §5.3): the UI then shows "n/a",
// never a fabricated `0` (which would be indistinguishable from a genuinely
// free run).
//
// Model-id matching is EXACT (design §11.4 — no fuzzy matching) after a
// documented normalization of dated-suffix aliases (see
// `CANONICAL_MODEL_ALIASES` and `normalizeModelId`).

import type {
  ModelPricing,
  PricingTable,
  TokenUsage,
  VendorCost,
  VendorId,
} from '@metaswarm-dashboard/types/cost';

/**
 * Explicit dated-suffix → canonical-id aliases (design §5.1). A vendor may
 * expose a dated model id whose canonical priced id is not derivable by
 * simply stripping a trailing date (e.g. a re-spin with a non-numeric
 * suffix). Add such an id here. Ids that DO strip cleanly via a trailing
 * `-YYYYMMDD` are handled by `normalizeModelId` without an entry here.
 */
export const CANONICAL_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  // Codex has shipped dated rollout ids; map them to the priced base id.
  'gpt-5.3-codex-2026-05-01': 'gpt-5.3-codex',
  // Fixture-only alias exercised by calculator.test.ts.
  'fixed-codex-2026-05-01': 'fixed-codex',
});

/** A bare trailing `-YYYYMMDD` date suffix (e.g. `claude-x-20260501`). */
const DATED_SUFFIX = /-\d{8}$/;

/** Divisor: pricing-table rates are quoted per 1,000,000 tokens. */
const PER_MILLION = 1_000_000;

/**
 * Normalize a model id to its canonical priced id (design §5.1).
 *
 * Two documented normalizations, applied in order:
 *   1. an explicit `CANONICAL_MODEL_ALIASES` entry, if present;
 *   2. otherwise, stripping a bare trailing `-YYYYMMDD` date suffix —
 *      `<canonical>-20260501` → `<canonical>` — but only when the stripped
 *      id is itself a key in the supplied table.
 *
 * If neither applies, the id is returned unchanged (it is either already
 * canonical or genuinely unknown).
 */
function normalizeModelId(model: string, table: PricingTable): string {
  const explicit = CANONICAL_MODEL_ALIASES[model];
  if (explicit !== undefined) {
    return explicit;
  }
  if (DATED_SUFFIX.test(model)) {
    const stripped = model.replace(DATED_SUFFIX, '');
    if (Object.prototype.hasOwnProperty.call(table.models, stripped)) {
      return stripped;
    }
  }
  return model;
}

/**
 * Best-effort vendor for a model id, used when the id is UNPRICED (so its
 * vendor cannot come from the table). Derived from a recognizable id prefix;
 * an id with no recognizable prefix falls back to `anthropic` — the
 * dashboard's primary vendor — which is a documented, deliberate default
 * (design §5.3: an unpriced result is still a well-formed `VendorCost`).
 */
function vendorForUnpricedId(model: string): VendorId {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  // `claude-*` and every unrecognized id default to anthropic.
  return 'anthropic';
}

/**
 * Price one model's `TokenUsage` (design §5.2 / §5.3).
 *
 * @param usage - The normalized per-record token usage.
 * @param model - The raw model id (a dated-suffix alias is normalized).
 * @param table - The pricing table to price against.
 * @returns A `VendorCost`. `priced: false` / `costUsd: null` when the model
 *   id is absent from the table — never a fabricated `0`.
 */
export function costFor(
  usage: TokenUsage,
  model: string,
  table: PricingTable,
): VendorCost {
  const canonicalId = normalizeModelId(model, table);
  const pricing: ModelPricing | undefined = table.models[canonicalId];

  if (pricing === undefined) {
    // §5.3: unknown model → null, never 0. Echo the requested id back.
    return {
      vendor: vendorForUnpricedId(canonicalId),
      model: canonicalId,
      usage,
      costUsd: null,
      priced: false,
    };
  }

  const costUsd = computeCost(usage, pricing);
  return {
    vendor: pricing.vendor,
    model: canonicalId,
    usage,
    costUsd,
    priced: true,
  };
}

/**
 * The §5.2 USD formula for a priced model. Each term names the source field
 * it reads and the rate it is priced at:
 *
 *   input_tokens                × input
 * + output_tokens               × output
 * + reasoning_tokens            × output                       (Codex)
 * + cache_read_tokens           × (cacheRead    ?? input)
 * + ephemeral_5m_cache_creation × (cacheWrite5m ?? cacheWrite ?? input)
 * + ephemeral_1h_cache_creation × (cacheWrite1h ?? cacheWrite ?? input)
 *
 * divided by 1,000,000 (rates are per-1M-token). The `?? cacheWrite ?? input`
 * fallback chain is the §5.2 conservative degradation: a model entry that
 * omits the 5m/1h split falls back to a blended `cacheWrite`, then to the
 * base `input` rate.
 */
function computeCost(usage: TokenUsage, pricing: ModelPricing): number {
  const cacheReadRate = pricing.cacheRead ?? pricing.input;
  const write5mRate = pricing.cacheWrite5m ?? pricing.cacheWrite ?? pricing.input;
  const write1hRate = pricing.cacheWrite1h ?? pricing.cacheWrite ?? pricing.input;

  const total =
    usage.inputTokens * pricing.input +
    usage.outputTokens * pricing.output +
    usage.reasoningTokens * pricing.output +
    usage.cacheReadTokens * cacheReadRate +
    usage.cacheCreation5mTokens * write5mRate +
    usage.cacheCreation1hTokens * write1hRate;

  return total / PER_MILLION;
}
