// WU-3.17 — committed sample snapshot must always parse via the live
// DailySnapshot schema. Schema drift fails this test.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DailySnapshot } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';


const SAMPLE_PATH = resolve(import.meta.dirname, '../../../../docs/samples/daily-snapshot.example.json');

describe('docs/samples/daily-snapshot.example.json', () => {
  it('parses against the live DailySnapshot Zod schema', () => {
    const raw = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
    const result = DailySnapshot.safeParse(raw);
    if (!result.success) {
      throw new Error(
        `Sample JSON does not match DailySnapshot schema:\n${result.error.toString()}`,
      );
    }
    expect(result.data.prsMergedLast7d).toBeNull();
    expect(result.data.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
