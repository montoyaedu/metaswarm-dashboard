// Tests for `computeSessionCost` and the Claude usage/model carrier
// (sessions-spike WU v5-2, design §4.1 / §5.2).
//
// Per design §4 the fixture is a REDACTED REAL Claude Code transcript — not
// hand-authored JSON. `claude-multi-model.transcript.jsonl` is built from
// real `assistant` records (their `message.usage` / `message.model` shapes
// kept EXACTLY as the vendor wrote them; only secret-bearing `content` /
// `cwd` / ids redacted). It carries:
//   - 2 main-thread `claude-opus-4-7` records (1h cache split, priced),
//   - 2 main-thread `claude-sonnet-4-6` records (1h split, UNPRICED — that
//     id is deliberately absent from the shipped pricing table),
//   - 1 `isSidechain: true` subagent `claude-opus-4-7` record (5m split).
// `claude-no-assistant.transcript.jsonl` is a redacted real transcript with
// only `summary` / `user` records — zero assistant records.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VendorCost } from '@metaswarm-dashboard/types/cost';
import { describe, expect, it } from 'vitest';

import * as sessions from '../../index.js';
import {
  type AssistantUsageRecord,
  parseTranscriptUsage,
} from '../../jsonl-reader.js';
import { computeSessionCost } from '../session-cost.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MULTI_MODEL = join(FIXTURES, 'claude-multi-model.transcript.jsonl');
const NO_ASSISTANT = join(FIXTURES, 'claude-no-assistant.transcript.jsonl');

/** Find the single `VendorCost` for a model in a `SessionCost.byModel`. */
function modelCost(byModel: readonly VendorCost[], model: string): VendorCost {
  const found = byModel.filter((m) => m.model === model);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('parseTranscriptUsage — Claude usage/model carrier (§4.1)', () => {
  it('captures one record per assistant entry, main thread and subagent', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    // 5 assistant records: 2 opus main + 2 sonnet main + 1 opus subagent.
    expect(records).toHaveLength(5);
  });

  it('captures `message.model` per assistant record', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    const models = records.map((r) => r.model).sort();
    expect(models).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-7',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6',
    ]);
  });

  it('captures `isSidechain` so subagent records can be counted', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    expect(records.filter((r) => r.isSidechain)).toHaveLength(1);
    expect(records.filter((r) => !r.isSidechain)).toHaveLength(4);
  });

  it('preserves the 1h / 5m cache-creation split distinctly', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    // The subagent record is the one carrying the 5m split.
    const subagent = records.find((r) => r.isSidechain);
    expect(subagent).toBeDefined();
    expect(subagent!.usage.cacheCreation5mTokens).toBe(11940);
    expect(subagent!.usage.cacheCreation1hTokens).toBe(0);
    // Every main-thread record here carries a 1h split, never a 5m one.
    for (const main of records.filter((r) => !r.isSidechain)) {
      expect(main.usage.cacheCreation5mTokens).toBe(0);
      expect(main.usage.cacheCreation1hTokens).toBeGreaterThan(0);
    }
  });

  it('uses the top-level usage figures, not usage.iterations[]', () => {
    // Each fixture record carries an `iterations[]` array whose entries
    // duplicate the top-level figures. Summing iterations would double-count.
    // The opus tally below matches the TOP-LEVEL figures only.
    const records = parseTranscriptUsage(MULTI_MODEL);
    const opus = records.filter((r) => r.model === 'claude-opus-4-7');
    const inputSum = opus.reduce((s, r) => s + r.usage.inputTokens, 0);
    const outputSum = opus.reduce((s, r) => s + r.usage.outputTokens, 0);
    expect(inputSum).toBe(6);
    expect(outputSum).toBe(12444);
  });

  it('returns an empty array for a transcript with zero assistant records', () => {
    expect(parseTranscriptUsage(NO_ASSISTANT)).toEqual([]);
  });

  it('reads through an injected fs hook (no disk access)', () => {
    let called = '';
    const records = parseTranscriptUsage('/virtual/x.jsonl', {
      readFileSync: (p) => {
        called = p;
        return Buffer.from(
          '{"type":"assistant","isSidechain":false,"message":' +
            '{"model":"claude-opus-4-7","usage":{"input_tokens":10,' +
            '"output_tokens":20,"cache_read_input_tokens":5,' +
            '"cache_creation":{"ephemeral_5m_input_tokens":1,' +
            '"ephemeral_1h_input_tokens":2}}}}\n',
        );
      },
      statSync: () => ({ mtime: new Date(0) }),
    });
    expect(called).toBe('/virtual/x.jsonl');
    expect(records).toEqual<AssistantUsageRecord[]>([
      {
        model: 'claude-opus-4-7',
        isSidechain: false,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 5,
          cacheCreation5mTokens: 1,
          cacheCreation1hTokens: 2,
          reasoningTokens: 0,
        },
      },
    ]);
  });
});

/** Build an fs hook that serves `content` as the transcript's raw bytes. */
function fsFor(content: string) {
  return {
    readFileSync: () => Buffer.from(content),
    statSync: () => ({ mtime: new Date(0) }),
  };
}

describe('parseTranscriptUsage — robustness (shares parseTranscript hardening)', () => {
  const ASSISTANT_OK =
    '{"type":"assistant","message":{"model":"claude-opus-4-7",' +
    '"usage":{"input_tokens":1,"output_tokens":2}}}';

  it('skips a malformed JSON line and keeps parsing the rest', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor(`{not json\n${ASSISTANT_OK}\n`),
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.model).toBe('claude-opus-4-7');
  });

  it('skips a well-formed JSON line that is not an object', () => {
    const records = parseTranscriptUsage('/v.jsonl', fsFor(`42\n${ASSISTANT_OK}\n`));
    expect(records).toHaveLength(1);
  });

  it('skips an assistant record whose message is not an object', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor(`{"type":"assistant","message":null}\n${ASSISTANT_OK}\n`),
    );
    expect(records).toHaveLength(1);
  });

  it('skips an assistant record with no string model', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor('{"type":"assistant","message":{"usage":{"input_tokens":1}}}\n'),
    );
    expect(records).toEqual([]);
  });

  it('skips an assistant record with no usable usage object', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor('{"type":"assistant","message":{"model":"claude-opus-4-7","usage":null}}\n'),
    );
    expect(records).toEqual([]);
  });

  it('skips a >1 MiB line without decoding it', () => {
    const huge = `{"x":"${'a'.repeat(1024 * 1024 + 10)}"}`;
    const records = parseTranscriptUsage('/v.jsonl', fsFor(`${huge}\n${ASSISTANT_OK}\n`));
    expect(records).toHaveLength(1);
  });

  it('skips a line with invalid UTF-8 bytes', () => {
    const fs = {
      // 0xFF is never valid in UTF-8 → the fatal decoder throws → skip.
      readFileSync: () => Buffer.concat([Buffer.from([0xff]), Buffer.from(`\n${ASSISTANT_OK}\n`)]),
      statSync: () => ({ mtime: new Date(0) }),
    };
    const records = parseTranscriptUsage('/v.jsonl', fs);
    expect(records).toHaveLength(1);
  });

  it('ignores a leading BOM and CRLF line endings', () => {
    const records = parseTranscriptUsage('/v.jsonl', fsFor(`﻿${ASSISTANT_OK}\r\n`));
    expect(records).toHaveLength(1);
  });

  it('coerces a non-numeric / negative usage figure to 0', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor(
        '{"type":"assistant","message":{"model":"claude-opus-4-7",' +
          '"usage":{"input_tokens":"oops","output_tokens":-5}}}\n',
      ),
    );
    expect(records[0]!.usage.inputTokens).toBe(0);
    expect(records[0]!.usage.outputTokens).toBe(0);
  });

  it('ignores a non-assistant record type', () => {
    const records = parseTranscriptUsage(
      '/v.jsonl',
      fsFor(`{"type":"user","message":{"content":"hi"}}\n${ASSISTANT_OK}\n`),
    );
    expect(records).toHaveLength(1);
  });
});

describe('computeSessionCost — per-model SessionCost (§5.2 / §6)', () => {
  it('tallies usage per model over main + subagent records', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    const cost = computeSessionCost('session-a', records);

    expect(cost.sessionId).toBe('session-a');
    expect(cost.vendor).toBe('anthropic');
    // One VendorCost per distinct model.
    expect(cost.byModel.map((m) => m.model).sort()).toEqual([
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]);

    // Opus tally = main(2) + subagent(1) records summed.
    const opus = modelCost(cost.byModel, 'claude-opus-4-7');
    expect(opus.usage).toEqual({
      inputTokens: 6,
      outputTokens: 12444,
      cacheReadTokens: 19866,
      cacheCreation5mTokens: 11940,
      cacheCreation1hTokens: 42112,
      reasoningTokens: 0,
    });

    const sonnet = modelCost(cost.byModel, 'claude-sonnet-4-6');
    expect(sonnet.usage).toEqual({
      inputTokens: 6,
      outputTokens: 278,
      cacheReadTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 70420,
      reasoningTokens: 0,
    });
  });

  it('prices the priced model and sums it into totalCostUsd', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    const cost = computeSessionCost('session-a', records);

    const opus = modelCost(cost.byModel, 'claude-opus-4-7');
    // claude-opus-4-7: input 15, output 75, cacheRead 1.5,
    //   cacheWrite5m 18.75, cacheWrite1h 30 (shipped table).
    // 6×15 + 12444×75 + 19866×1.5 + 11940×18.75 + 42112×30 = 2 450 424
    // / 1e6 = 2.450424
    expect(opus.priced).toBe(true);
    expect(opus.costUsd).toBeCloseTo(2.450424, 9);
  });

  it('marks an unpriced model and excludes it from totalCostUsd', () => {
    const records = parseTranscriptUsage(MULTI_MODEL);
    const cost = computeSessionCost('session-a', records);

    // claude-sonnet-4-6 is deliberately absent from the shipped table.
    const sonnet = modelCost(cost.byModel, 'claude-sonnet-4-6');
    expect(sonnet.priced).toBe(false);
    expect(sonnet.costUsd).toBeNull();

    // hasUnpriced flips true; the total is the priced (opus) contribution
    // only — a lower bound, never inflated by a fabricated sonnet 0.
    expect(cost.hasUnpriced).toBe(true);
    expect(cost.totalCostUsd).toBeCloseTo(2.450424, 9);
  });

  it('returns totalCostUsd 0 / byModel [] for zero assistant records', () => {
    const cost = computeSessionCost('empty-session', parseTranscriptUsage(NO_ASSISTANT));
    expect(cost).toEqual({
      sessionId: 'empty-session',
      vendor: 'anthropic',
      byModel: [],
      totalCostUsd: 0,
      hasUnpriced: false,
    });
  });

  it('reports hasUnpriced false when every model in the session is priced', () => {
    const opusOnly: AssistantUsageRecord[] = parseTranscriptUsage(MULTI_MODEL).filter(
      (r) => r.model === 'claude-opus-4-7',
    );
    const cost = computeSessionCost('opus-only', opusOnly);
    expect(cost.hasUnpriced).toBe(false);
    expect(cost.byModel).toHaveLength(1);
    expect(cost.totalCostUsd).toBeCloseTo(2.450424, 9);
  });

  it('preserves first-seen model order in byModel', () => {
    // The fixture's first assistant record is opus, sonnet appears later.
    const cost = computeSessionCost('session-a', parseTranscriptUsage(MULTI_MODEL));
    expect(cost.byModel.map((m) => m.model)).toEqual([
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]);
  });
});

describe('v5-2 public surface', () => {
  it('re-exports computeSessionCost and parseTranscriptUsage from the index', () => {
    expect(sessions.computeSessionCost).toBe(computeSessionCost);
    expect(sessions.parseTranscriptUsage).toBe(parseTranscriptUsage);
  });

  it('produces a SessionCost that round-trips through the Zod schema', async () => {
    const { SessionCost } = await import('@metaswarm-dashboard/types/cost');
    const cost = computeSessionCost('round-trip', parseTranscriptUsage(MULTI_MODEL));
    expect(() => SessionCost.parse(cost)).not.toThrow();
  });
});
