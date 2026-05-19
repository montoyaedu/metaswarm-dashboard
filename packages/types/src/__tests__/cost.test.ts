// Coverage for the AI-cost Zod schemas added in sessions-spike WU v5-1.
// These are pure schema declarations; importing and round-tripping them here
// exercises every line. Cases mirror design §5 / §6 and plan §v5-1.

import { describe, expect, it } from 'vitest';

import {
  DelegationRun,
  ModelPricing,
  PricingTable,
  ProjectCostSummary,
  SessionCost,
  TokenUsage,
  VendorCost,
  VendorCostRollup,
  VendorId,
} from '../cost.js';

// --- shared valid fixtures -------------------------------------------------

const validUsage = {
  inputTokens: 1_000,
  outputTokens: 500,
  cacheReadTokens: 9_000,
  cacheCreation5mTokens: 200,
  cacheCreation1hTokens: 100,
  reasoningTokens: 0,
};

const validModelPricing = {
  vendor: 'anthropic' as const,
  input: 15,
  output: 75,
  cacheRead: 1.5,
  cacheWrite5m: 18.75,
  cacheWrite1h: 30,
};

/** A minimal model entry — no cache keys (e.g. a plain Gemini model). */
const minimalModelPricing = {
  vendor: 'google' as const,
  input: 1.25,
  output: 5,
};

const validPricingTable = {
  pricingAsOf: '2026-05-18',
  source: 'vendor public pricing pages — see model-prices.source.md',
  models: {
    'claude-opus-4-7': validModelPricing,
    'gemini-3-pro': minimalModelPricing,
  },
};

const validVendorCost = {
  vendor: 'anthropic' as const,
  model: 'claude-opus-4-7',
  usage: validUsage,
  costUsd: 0.123_45,
  priced: true,
};

/** An unpriced model — `costUsd: null`, `priced: false` (design §5.3). */
const unpricedVendorCost = {
  vendor: 'openai' as const,
  model: 'gpt-unknown-model',
  usage: validUsage,
  costUsd: null,
  priced: false,
};

const validSessionCost = {
  sessionId: 'session-1',
  vendor: 'anthropic' as const,
  byModel: [validVendorCost, unpricedVendorCost],
  totalCostUsd: 0.123_45,
  hasUnpriced: true,
};

const validDelegationRun = {
  vendor: 'openai' as const,
  model: 'gpt-5.5',
  projectName: 'metaswarm-dashboard',
  at: '2026-05-18T10:00:00.000Z',
  usage: validUsage,
  costUsd: 0.05,
};

const validRollup = { costUsd: 1.5, runCount: 3, hasUnpriced: false };

const validProjectCostSummary = {
  projectName: 'metaswarm-dashboard',
  byVendor: {
    anthropic: validRollup,
    openai: { costUsd: 0, runCount: 0, hasUnpriced: false },
    google: validRollup,
  },
  totalCostUsd: 3,
  hasUnpriced: false,
  pricingAsOf: '2026-05-18',
};

// --- valid round-trips -----------------------------------------------------

describe('valid round-trips', () => {
  it('TokenUsage parses and round-trips', () => {
    const result = TokenUsage.safeParse(validUsage);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validUsage);
  });

  it('ModelPricing parses a full entry and a minimal (no-cache) entry', () => {
    expect(ModelPricing.safeParse(validModelPricing).success).toBe(true);
    const minimal = ModelPricing.safeParse(minimalModelPricing);
    expect(minimal.success).toBe(true);
    if (minimal.success) expect(minimal.data).toEqual(minimalModelPricing);
  });

  it('PricingTable parses and round-trips', () => {
    const result = PricingTable.safeParse(validPricingTable);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validPricingTable);
  });

  it('VendorCost parses a priced and an unpriced (null cost) entry', () => {
    expect(VendorCost.safeParse(validVendorCost).success).toBe(true);
    const unpriced = VendorCost.safeParse(unpricedVendorCost);
    expect(unpriced.success).toBe(true);
    if (unpriced.success) {
      expect(unpriced.data.costUsd).toBeNull();
      expect(unpriced.data.priced).toBe(false);
    }
  });

  it('SessionCost parses and round-trips', () => {
    const result = SessionCost.safeParse(validSessionCost);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validSessionCost);
  });

  it('DelegationRun parses and round-trips', () => {
    const result = DelegationRun.safeParse(validDelegationRun);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validDelegationRun);
  });

  it('VendorCostRollup parses and round-trips', () => {
    const result = VendorCostRollup.safeParse(validRollup);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validRollup);
  });

  it('ProjectCostSummary parses and round-trips', () => {
    const result = ProjectCostSummary.safeParse(validProjectCostSummary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validProjectCostSummary);
  });
});

// --- VendorId enum ---------------------------------------------------------

describe('VendorId', () => {
  it.each(['anthropic', 'openai', 'google'])('accepts %s', (member) => {
    expect(VendorId.safeParse(member).success).toBe(true);
  });

  it('rejects an unknown vendor', () => {
    expect(VendorId.safeParse('mistral').success).toBe(false);
  });
});

// --- token-count / rate constraints ----------------------------------------

describe('non-negative integer / rate constraints', () => {
  it('TokenUsage rejects a negative token count', () => {
    const result = TokenUsage.safeParse({ ...validUsage, inputTokens: -1 });
    expect(result.success).toBe(false);
  });

  it('TokenUsage rejects a non-integer token count', () => {
    const result = TokenUsage.safeParse({ ...validUsage, outputTokens: 1.5 });
    expect(result.success).toBe(false);
  });

  it('ModelPricing rejects a negative rate', () => {
    const result = ModelPricing.safeParse({ ...validModelPricing, input: -1 });
    expect(result.success).toBe(false);
  });

  it('VendorCostRollup rejects a negative runCount', () => {
    const result = VendorCostRollup.safeParse({ ...validRollup, runCount: -1 });
    expect(result.success).toBe(false);
  });
});

// --- PricingTable.pricingAsOf format ---------------------------------------

describe('PricingTable.pricingAsOf', () => {
  it('rejects a non-ISO date', () => {
    const result = PricingTable.safeParse({
      ...validPricingTable,
      pricingAsOf: '18-05-2026',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty source', () => {
    const result = PricingTable.safeParse({ ...validPricingTable, source: '' });
    expect(result.success).toBe(false);
  });
});

// --- discriminating-field constraints --------------------------------------

describe('schema-shape constraints', () => {
  it('SessionCost rejects a non-anthropic vendor (literal)', () => {
    const result = SessionCost.safeParse({
      ...validSessionCost,
      vendor: 'openai',
    });
    expect(result.success).toBe(false);
  });

  it('DelegationRun accepts a null projectName (unattributed)', () => {
    const result = DelegationRun.safeParse({
      ...validDelegationRun,
      projectName: null,
    });
    expect(result.success).toBe(true);
  });

  it('DelegationRun accepts a null costUsd (info-null / unpriced run)', () => {
    const result = DelegationRun.safeParse({
      ...validDelegationRun,
      costUsd: null,
    });
    expect(result.success).toBe(true);
  });

  it('DelegationRun rejects an offset timestamp', () => {
    const result = DelegationRun.safeParse({
      ...validDelegationRun,
      at: '2026-05-18T10:00:00.000+02:00',
    });
    expect(result.success).toBe(false);
  });

  it('ProjectCostSummary rejects a byVendor missing a vendor', () => {
    const result = ProjectCostSummary.safeParse({
      ...validProjectCostSummary,
      byVendor: {
        anthropic: validRollup,
        openai: { costUsd: 0, runCount: 0, hasUnpriced: false },
      },
    });
    expect(result.success).toBe(false);
  });
});
