// Pricing-table loader (sessions-spike WU v5-1, design §5.1).
//
// The pinned model→price table lives in `model-prices.json` and is brought
// in via a STATIC JSON `import`. `tsconfig.base.json` enables
// `resolveJsonModule`; `tsc` keeps the `import` in the emitted JS and copies
// `model-prices.json` alongside `pricing.js` into `dist/cost/` — the table
// is a build-output sibling asset (design §5.1) and must stay next to this
// module when the package is built or packaged.
//
// The imported object is Zod-validated against `PricingTable` at module load
// (design §5.1: the table is always validated). `loadPricingTable()` returns
// a deeply-frozen copy so a consumer cannot mutate the shared table; the
// validation runs once and the frozen result is memoized.

import { createHash } from 'node:crypto';

import { PricingTable } from '@metaswarm-dashboard/types/cost';

import rawPricing from './model-prices.json' with { type: 'json' };

/**
 * The validated, deeply-frozen pricing table. Validation runs exactly once
 * at module load; an invalid shipped `model-prices.json` fails fast here
 * (and is caught by `pricing.test.ts` before it ever ships).
 */
const VALIDATED_TABLE: PricingTable = deepFreeze(PricingTable.parse(rawPricing));

/**
 * A content hash of the pricing table — used as the §5.4 aggregate-cache
 * key. A content hash (not the file's mtime) is correct: a `git checkout`
 * rewrites mtime without changing content, and vice versa.
 */
const TABLE_HASH: string = createHash('sha256')
  .update(JSON.stringify(VALIDATED_TABLE))
  .digest('hex');

/**
 * The pinned, Zod-validated model→price table (design §5.1). The returned
 * object is deeply frozen — callers may read it freely but cannot mutate the
 * shared table.
 */
export function loadPricingTable(): PricingTable {
  return VALIDATED_TABLE;
}

/**
 * A stable SHA-256 content hash of the pricing table. The §5.4 per-project
 * aggregate cache keys on this so a price-table edit invalidates cost
 * aggregates while a no-op `git checkout` (mtime-only change) does not.
 */
export function pricingTableHash(): string {
  return TABLE_HASH;
}

/** Recursively `Object.freeze` an object and every nested object/array. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
