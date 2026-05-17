// Golden-master test for the rubric composer (sessions-spike WU-4).
//
// Parses the WU-3 synthetic transcript, scores it with a FIXED `now`, and
// asserts the result deep-equals the frozen golden
// `fixtures/synthetic-rubric.expected.json`. Also asserts the result
// satisfies the real `ProcessRubricScore` Zod schema.
//
// The golden was generated from this exact composer with the fixed `now`
// below and spot-checked against the fixture events before freezing.
// `synthetic-events.jsonl` / `synthetic-events.expected.json` are WU-3
// artifacts and are NOT modified here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProcessRubricScore } from '@metaswarm-dashboard/types/sessions';
import { describe, expect, it } from 'vitest';

import { parseTranscript } from '../../jsonl-reader.js';
import { scoreTimeline } from '../../rubric/index.js';

const FIXED_NOW = new Date('2026-05-17T00:00:00.000Z');

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const transcriptPath = join(fixturesDir, 'synthetic-events.jsonl');
const goldenPath = join(fixturesDir, 'synthetic-rubric.expected.json');

describe('rubric golden master', () => {
  it('scoreTimeline(parseTranscript(...)) deep-equals the frozen golden', () => {
    const timeline = parseTranscript(transcriptPath);
    const result = scoreTimeline(timeline, FIXED_NOW);
    const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'));
    expect(result).toEqual(golden);
  });

  it('the golden satisfies the ProcessRubricScore Zod schema', () => {
    const golden: unknown = JSON.parse(readFileSync(goldenPath, 'utf8'));
    expect(() => ProcessRubricScore.parse(golden)).not.toThrow();
  });

  it('the synthetic session scores overall watch with one na item', () => {
    // overall is `watch`: the synthetic fixture contains one genuine thrash
    // episode (two Edits of src/parser.ts 3s apart, no intervening read), so
    // the `thrashing` item is `watch`; cross-reference is the lone `na`.
    const result = scoreTimeline(parseTranscript(transcriptPath), FIXED_NOW);
    expect(result.overall).toBe('watch');
    expect(result.items.filter((i) => i.verdict === 'na')).toHaveLength(1);
  });
});
