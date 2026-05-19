// Tests for the tokens→USD cost calculator (sessions-spike WU v5-1,
// design §5.2 / §5.3).
//
// Per design §5.1 these tests use a FIXED in-test pricing table — NOT the
// shipped `model-prices.json` — so editing real prices never breaks the
// calculator's arithmetic assertions. The shipped table has its own
// schema-validation test in `pricing.test.ts`.
//
// The fixed table below is chosen with round, easy-to-verify rates so each
// §5.2 term can be checked by hand:
//   - `fixed-claude` carries the full cache-write split (5m + 1h distinct).
//   - `fixed-claude-blended` omits the split keys but has a blended
//     `cacheWrite` — exercises the §5.2 `cacheWriteNm ?? cacheWrite` fallback.
//   - `fixed-claude-bare` omits every cache key — exercises the final
//     `?? input` fallback.
//   - `fixed-codex` carries `cacheRead` but no cache-write keys (Codex has no
//     cache-write split) — exercises the Codex `cached_input`/`reasoning`
//     terms.
//   - `fixed-codex-2026-05-01` is NOT a table key; it is a dated-suffix alias
//     of `fixed-codex` and must be normalized to it.

import type { PricingTable, TokenUsage } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import { CANONICAL_MODEL_ALIASES, costFor } from '../calculator.js';

/** A fixed in-test pricing table — per-1M-token USD rates (design §5.1). */
const FIXED_TABLE: PricingTable = {
  pricingAsOf: '2026-01-01',
  source: 'in-test fixed table — not the shipped model-prices.json',
  models: {
    'fixed-claude': {
      vendor: 'anthropic',
      input: 10,
      output: 40,
      cacheRead: 1,
      cacheWrite5m: 12,
      cacheWrite1h: 20,
    },
    'fixed-claude-blended': {
      vendor: 'anthropic',
      input: 10,
      output: 40,
      cacheRead: 1,
      cacheWrite: 15,
    },
    'fixed-claude-bare': {
      vendor: 'anthropic',
      input: 10,
      output: 40,
    },
    'fixed-codex': {
      vendor: 'openai',
      input: 5,
      output: 25,
      cacheRead: 2,
    },
    'fixed-gemini': {
      vendor: 'google',
      input: 3,
      output: 12,
    },
  },
};

/** Build a `TokenUsage` with every field defaulting to 0. */
function usage(partial: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
    ...partial,
  };
}

describe('costFor — §5.2 individual terms', () => {
  it('prices input tokens at the model `input` rate', () => {
    const result = costFor(usage({ inputTokens: 1_000_000 }), 'fixed-claude', FIXED_TABLE);
    expect(result.costUsd).toBe(10);
    expect(result.priced).toBe(true);
    expect(result.vendor).toBe('anthropic');
    expect(result.model).toBe('fixed-claude');
  });

  it('prices output tokens at the model `output` rate', () => {
    const result = costFor(usage({ outputTokens: 1_000_000 }), 'fixed-claude', FIXED_TABLE);
    expect(result.costUsd).toBe(40);
  });

  it('prices reasoning tokens at the model `output` rate (Codex term)', () => {
    const result = costFor(usage({ reasoningTokens: 1_000_000 }), 'fixed-codex', FIXED_TABLE);
    expect(result.costUsd).toBe(25);
  });

  it('prices cache-read tokens at the model `cacheRead` rate', () => {
    const result = costFor(usage({ cacheReadTokens: 1_000_000 }), 'fixed-claude', FIXED_TABLE);
    expect(result.costUsd).toBe(1);
  });

  it('prices 5m cache-creation tokens at `cacheWrite5m`', () => {
    const result = costFor(
      usage({ cacheCreation5mTokens: 1_000_000 }),
      'fixed-claude',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(12);
  });

  it('prices 1h cache-creation tokens at `cacheWrite1h`', () => {
    const result = costFor(
      usage({ cacheCreation1hTokens: 1_000_000 }),
      'fixed-claude',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(20);
  });

  it('sums every term for a mixed-usage record', () => {
    // 1M input ×10 + 1M output ×40 + 1M cacheRead ×1
    //   + 1M 5m-write ×12 + 1M 1h-write ×20  = 83
    const result = costFor(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheCreation5mTokens: 1_000_000,
        cacheCreation1hTokens: 1_000_000,
      }),
      'fixed-claude',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(83);
  });

  it('scales sub-1M token counts proportionally', () => {
    // 250_000 input ×10 / 1e6 = 2.5
    const result = costFor(usage({ inputTokens: 250_000 }), 'fixed-claude', FIXED_TABLE);
    expect(result.costUsd).toBe(2.5);
  });
});

describe('costFor — §5.2 cache-write fallback chain', () => {
  it('falls back to the blended `cacheWrite` when a split key is absent', () => {
    // No cacheWrite5m/1h on `fixed-claude-blended`; cacheWrite is 15.
    const result = costFor(
      usage({ cacheCreation5mTokens: 1_000_000, cacheCreation1hTokens: 1_000_000 }),
      'fixed-claude-blended',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(30); // (1M + 1M) × 15 / 1e6
  });

  it('falls back to base `input` when neither split nor blended write exists', () => {
    // `fixed-claude-bare` has only input/output; cache writes price at input.
    const result = costFor(
      usage({ cacheCreation5mTokens: 1_000_000, cacheCreation1hTokens: 1_000_000 }),
      'fixed-claude-bare',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(20); // (1M + 1M) × 10 (input) / 1e6
  });

  it('falls back to base `input` for cache-read when `cacheRead` is absent', () => {
    const result = costFor(
      usage({ cacheReadTokens: 1_000_000 }),
      'fixed-claude-bare',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(10); // cacheRead priced at input (10)
  });
});

describe('costFor — Codex terms (§5.2)', () => {
  it('prices a Codex run: cached_input→cacheRead, reasoning→output', () => {
    // 1M input ×5 + 1M output ×25 + 1M cacheRead(cached_input) ×2
    //   + 1M reasoning ×25  = 57
    const result = costFor(
      usage({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        reasoningTokens: 1_000_000,
      }),
      'fixed-codex',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(57);
    expect(result.vendor).toBe('openai');
  });

  it('treats Codex zero cache-creation fields as a no-op', () => {
    // Codex usage always sets the two cache-creation fields to 0.
    const result = costFor(
      usage({ inputTokens: 1_000_000, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 }),
      'fixed-codex',
      FIXED_TABLE,
    );
    expect(result.costUsd).toBe(5);
  });
});

describe('costFor — §5.3 unknown models', () => {
  it('returns costUsd: null, priced: false for an id absent from the table', () => {
    const result = costFor(usage({ inputTokens: 1_000_000 }), 'no-such-model-9000', FIXED_TABLE);
    expect(result.costUsd).toBeNull();
    expect(result.priced).toBe(false);
  });

  it('never fabricates a 0 for an unknown model with real usage', () => {
    const result = costFor(
      usage({ inputTokens: 5_000_000, outputTokens: 5_000_000 }),
      'unknown-but-expensive',
      FIXED_TABLE,
    );
    expect(result.costUsd).not.toBe(0);
    expect(result.costUsd).toBeNull();
  });

  it('still echoes the requested model id and usage on an unknown result', () => {
    const u = usage({ inputTokens: 7 });
    const result = costFor(u, 'unknown-x', FIXED_TABLE);
    expect(result.model).toBe('unknown-x');
    expect(result.usage).toEqual(u);
  });

  it('derives the vendor from a recognizable id prefix even when unpriced', () => {
    expect(costFor(usage(), 'claude-opus-9-9', FIXED_TABLE).vendor).toBe('anthropic');
    expect(costFor(usage(), 'gpt-9-turbo', FIXED_TABLE).vendor).toBe('openai');
    expect(costFor(usage(), 'gemini-9-pro', FIXED_TABLE).vendor).toBe('google');
  });

  it('defaults an unrecognizable unpriced id to the anthropic vendor', () => {
    // Documented fallback: the dashboard's primary vendor is Anthropic;
    // an unknown id with no recognizable prefix is bucketed there.
    expect(costFor(usage(), 'mystery-model', FIXED_TABLE).vendor).toBe('anthropic');
  });
});

describe('costFor — dated-suffix alias normalization (§5.1)', () => {
  it('normalizes a documented dated-suffix alias to its canonical priced id', () => {
    // `fixed-codex-2026-05-01` is not a table key; it aliases `fixed-codex`.
    const result = costFor(
      usage({ inputTokens: 1_000_000 }),
      'fixed-codex-2026-05-01',
      FIXED_TABLE,
    );
    expect(result.priced).toBe(true);
    expect(result.costUsd).toBe(5); // priced at fixed-codex.input
    // The result reports the CANONICAL id, not the alias.
    expect(result.model).toBe('fixed-codex');
  });

  it('exposes the alias map so the normalization is documented and testable', () => {
    expect(CANONICAL_MODEL_ALIASES['fixed-codex-2026-05-01']).toBe('fixed-codex');
  });

  it('strips a bare trailing -YYYYMMDD date suffix to find a canonical id', () => {
    // A model id of the form `<canonical>-20260501` resolves to `<canonical>`.
    const result = costFor(
      usage({ inputTokens: 1_000_000 }),
      'fixed-claude-20260501',
      FIXED_TABLE,
    );
    expect(result.priced).toBe(true);
    expect(result.model).toBe('fixed-claude');
    expect(result.costUsd).toBe(10);
  });

  it('leaves an id that is already canonical untouched', () => {
    const result = costFor(usage({ inputTokens: 1_000_000 }), 'fixed-gemini', FIXED_TABLE);
    expect(result.model).toBe('fixed-gemini');
    expect(result.costUsd).toBe(3);
  });

  it('leaves a dated-suffix id unpriced when its stripped base is unknown', () => {
    // `unknown-base-20260501` strips to `unknown-base`, which is NOT a table
    // key — so the id stays as-is and renders unpriced (no spurious match).
    const result = costFor(
      usage({ inputTokens: 1_000_000 }),
      'unknown-base-20260501',
      FIXED_TABLE,
    );
    expect(result.priced).toBe(false);
    expect(result.costUsd).toBeNull();
    expect(result.model).toBe('unknown-base-20260501');
  });
});

describe('costFor — public surface', () => {
  it('is re-exported from the package index', () => {
    expect(sessions.costFor).toBe(costFor);
  });
});
