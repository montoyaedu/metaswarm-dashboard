// Tests for the shipped pricing table (sessions-spike WU v5-1, design §5.1).
//
// Per design §5.1, the cost-calculator's own unit tests use a FIXED in-test
// pricing table (see `calculator.test.ts`) — editing real prices must never
// break calculator tests. THIS file is the separate guard that the *shipped*
// `model-prices.json` is structurally valid: it validates the resource that
// `pricing.ts` imports against the `PricingTable` Zod schema and pins the
// content-hash / `loadPricingTable` contract.

import { PricingTable } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import { loadPricingTable, pricingTableHash } from '../pricing.js';

describe('shipped model-prices.json', () => {
  it('validates against the PricingTable schema', () => {
    const result = PricingTable.safeParse(loadPricingTable());
    expect(result.success).toBe(true);
  });

  it('carries a pricingAsOf date and a source string', () => {
    const table = loadPricingTable();
    expect(table.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(table.source.length).toBeGreaterThan(0);
  });

  it('prices the observed Claude 4.x family', () => {
    const { models } = loadPricingTable();
    // The Opus id in use plus the wider Claude 4.x family the design names.
    expect(models['claude-opus-4-7']).toBeDefined();
    const hasSonnet = Object.keys(models).some((id) => id.includes('sonnet-4'));
    const hasHaiku = Object.keys(models).some((id) => id.includes('haiku-4'));
    expect(hasSonnet).toBe(true);
    expect(hasHaiku).toBe(true);
  });

  it('prices the Codex model and the Gemini model', () => {
    const { models } = loadPricingTable();
    const hasCodex = Object.keys(models).some((id) => id.startsWith('gpt-5'));
    const hasGemini = Object.keys(models).some((id) => id.startsWith('gemini-'));
    expect(hasCodex).toBe(true);
    expect(hasGemini).toBe(true);
  });

  it('gives every Claude model a cache-write split', () => {
    const { models } = loadPricingTable();
    for (const [id, pricing] of Object.entries(models)) {
      if (!id.startsWith('claude-')) continue;
      expect(pricing.cacheWrite5m).toBeDefined();
      expect(pricing.cacheWrite1h).toBeDefined();
      expect(pricing.cacheRead).toBeDefined();
    }
  });

  it('returns a stable, non-empty content hash', () => {
    const a = pricingTableHash();
    const b = pricingTableHash();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('loadPricingTable returns a frozen copy that cannot mutate the source', () => {
    const first = loadPricingTable();
    expect(() => {
      // Mutating the returned table must not corrupt subsequent loads.
      (first.models as Record<string, unknown>)['__injected__'] = {};
    }).toThrow();
    expect(loadPricingTable().models['__injected__']).toBeUndefined();
  });

  it('is re-exported from the package public surface', () => {
    expect(sessions.loadPricingTable).toBe(loadPricingTable);
    expect(sessions.pricingTableHash).toBe(pricingTableHash);
  });
});
