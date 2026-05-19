// Per-session Claude cost (sessions-spike WU v5-2, design §4.1 / §5.2 / §6).
//
// `computeSessionCost(sessionId, records)` takes the v5-2 carrier output —
// the `AssistantUsageRecord[]` produced by `parseTranscriptUsage` — sums the
// `TokenUsage` per model across ALL assistant records (main thread AND
// `isSidechain` subagent records, design §4.1), prices each model's summed
// usage with v5-1's `costFor` against the pinned `loadPricingTable()`, and
// returns a `SessionCost`.
//
// `totalCostUsd` is the sum of the PRICED contributions only (a number,
// possibly 0). `hasUnpriced` is `true` iff at least one model in the session
// was absent from the pricing table — meaning `totalCostUsd` is a lower
// bound, never a fabricated full figure (design §5.3 / §6).

import type {
  SessionCost,
  TokenUsage,
  VendorCost,
} from '@metaswarm-dashboard/types/cost';

import type { AssistantUsageRecord } from '../jsonl-reader.js';

import { costFor } from './calculator.js';
import { loadPricingTable } from './pricing.js';

/** A fresh, all-zero `TokenUsage` accumulator. */
function zeroUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
  };
}

/** Add `b`'s every token field into `a` (mutating and returning `a`). */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  a.inputTokens += b.inputTokens;
  a.outputTokens += b.outputTokens;
  a.cacheReadTokens += b.cacheReadTokens;
  a.cacheCreation5mTokens += b.cacheCreation5mTokens;
  a.cacheCreation1hTokens += b.cacheCreation1hTokens;
  a.reasoningTokens += b.reasoningTokens;
  return a;
}

/**
 * Compute one Claude session's cost from its assistant usage records.
 *
 * @param sessionId - The session's id (echoed onto the `SessionCost`).
 * @param records - The session's `AssistantUsageRecord[]` — from
 *   `parseTranscriptUsage`, including any `isSidechain` subagent records
 *   (design §4.1). Order is significant only for `byModel`'s first-seen
 *   ordering; the per-model tally is order-independent.
 * @returns A `SessionCost`. A session with zero assistant records yields
 *   `{ byModel: [], totalCostUsd: 0, hasUnpriced: false }`.
 */
export function computeSessionCost(
  sessionId: string,
  records: readonly AssistantUsageRecord[],
): SessionCost {
  // Sum usage per model. `Map` preserves first-seen insertion order, so
  // `byModel` follows the order each model first appeared in the transcript.
  const perModel = new Map<string, TokenUsage>();
  for (const record of records) {
    let acc = perModel.get(record.model);
    if (acc === undefined) {
      acc = zeroUsage();
      perModel.set(record.model, acc);
    }
    addUsage(acc, record.usage);
  }

  const table = loadPricingTable();
  const byModel: VendorCost[] = [];
  let totalCostUsd = 0;
  let hasUnpriced = false;

  for (const [model, usage] of perModel) {
    const cost = costFor(usage, model, table);
    byModel.push(cost);
    if (cost.priced && cost.costUsd !== null) {
      // §5.3 / §6: only priced contributions enter the total.
      totalCostUsd += cost.costUsd;
    } else {
      hasUnpriced = true;
    }
  }

  return {
    sessionId,
    vendor: 'anthropic',
    byModel,
    totalCostUsd,
    hasUnpriced,
  };
}
