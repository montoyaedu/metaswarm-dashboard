// Gemini ledger reader (sessions-spike WU v5-4, design §4.3 / §9).
//
// metaswarm's external-tools adapter (`log_session` in
// `skills/external-tools/adapters/_common.sh`) appends ONE JSONL envelope per
// Codex/Gemini delegation run to a single append-only file —
// `~/.claude/sessions/external-tools.jsonl`. This file is the ONLY capture
// point for Gemini token usage: the Gemini CLI persists nothing to disk, so
// usage exists only on the adapter's `--output-format json` stdout at
// invocation time (design §4.3).
//
// `discoverGeminiRuns` reads that ledger and yields one `DelegationRun` per
// `tool === "gemini"` entry. `tool === "codex"` entries are IGNORED — Codex
// is read directly from `~/.codex/sessions/` by the v5-3 rollout reader.
//
// READ-ONLY. The reader never writes, never creates, and never deserializes
// the ledger's secret-bearing `command` / `raw_log` fields.
//
// §4.3 — per-entry extraction:
//   - usage  = `cost.input_tokens` / `cost.output_tokens`; the other
//              `TokenUsage` fields are 0 (the ledger carries no cache /
//              reasoning split).
//   - model  = the entry's `model`.
//   - at     = the entry's `timestamp` (added by `log_session`).
//   - vendor = always `google` (only gemini entries are mapped).
//   - costUsd= v5-1's `costFor` against `loadPricingTable()`; an UNPRICED
//              model yields `costUsd: null` (design §5.3 — never a
//              fabricated 0).
//
// §4.3 — failed runs are STILL costed. A non-zero `exit_code` / a set
// `error_type` still consumed billed tokens, so the reader does NOT filter
// on exit status — it does not even deserialize those fields.
//
// §4.4 — attribution. The ledger record carries no `cwd`. Per-project
// attribution is not reliably determinable from the ledger alone — the only
// path-ish field, `git_sha`, is a commit hash, not a working directory, and
// `command` (which might name a path) is deliberately NOT parsed (§9). So
// every gemini run is bucketed `projectName: null` (the `unattributed`
// bucket). The reader does NOT parse `command` and does NOT shell out to git.
//
// §9 — allow-list parse (Security blocker S2). Each line is parsed with a Zod
// schema that `.pick()`s ONLY `schema_version`, `tool`, `model`, `cost`,
// `timestamp`, `git_sha`. The secret-bearing `command` and `raw_log` are
// structurally dropped at parse time — never read into a parsed object,
// never reachable by a later code change.
//
// §4.3 — `schema_version`. The reader targets the version `emit_json`
// currently writes (`"1"`). An entry with an unrecognized `schema_version`
// is skipped (the record shape may have changed in a way the allow-list no
// longer matches) — mirroring v4's `skippedLineCount` discipline.
//
// §9 — caps. The reader reuses v4's per-line `MAX_LINE_BYTES` cap and
// malformed-line skipping, AND adds a TOTAL-FILE-SIZE cap: the ledger is a
// single append-only file that could grow unbounded, so a file larger than
// the cap is refused outright rather than read entirely into memory.

import {
  readFileSync as nodeReadFileSync,
  statSync as nodeStatSync,
} from 'node:fs';

import type { DelegationRun, TokenUsage } from '@metaswarm-dashboard/types/cost';
import { z } from 'zod';

import { costFor } from './calculator.js';
import { loadPricingTable } from './pricing.js';

/** A minimal `fs.Stats`-like shape — only the `size` the cap check needs. */
interface StatsLike {
  size: number;
}

/**
 * Injectable filesystem hooks for the ledger reader. Defaults to `node:fs`.
 * Tests point these at a temp file (or an in-memory fake) so every branch is
 * reachable without touching the real `~/.claude/sessions/`.
 */
export interface LedgerReaderFsHooks {
  /** `stat` a path — used for the total-file-size cap before any read. */
  statSync: (path: string) => StatsLike;
  /** Read a file as a raw Buffer (call WITHOUT an encoding argument). */
  readFileSync: (path: string) => Buffer;
}

const DEFAULT_FS: LedgerReaderFsHooks = {
  statSync: (path) => nodeStatSync(path),
  readFileSync: (path) => nodeReadFileSync(path),
};

/** Tunable bounds for the ledger read (§9). */
export interface LedgerReaderOptions {
  /**
   * Hard cap on the total ledger file size in bytes. A file larger than this
   * is refused outright (→ empty result) rather than read into memory.
   */
  maxFileBytes?: number;
}

/**
 * The `schema_version` value `emit_json` currently writes (`SCHEMA_VERSION`
 * in `_common.sh`). An entry with any other version is skipped (§4.3).
 */
const SUPPORTED_SCHEMA_VERSION = '1';

/** The ledger `tool` value this reader maps; any other value is ignored. */
const GEMINI_TOOL = 'gemini';

/** Per-line size cap: a line larger than this is skipped without decoding. */
const MAX_LINE_BYTES = 1024 * 1024;

/**
 * Default total-file-size cap (§9). 64 MiB is far above any plausible real
 * ledger (one envelope is ~400 bytes) yet bounds a pathological file. The
 * operator can lower it via `LedgerReaderOptions.maxFileBytes`.
 */
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Newline (`\n`) byte used to segment the raw Buffer. */
const NEWLINE_BYTE = 0x0a;

/** Carriage-return (`\r`) stripped from a CRLF line ending. */
const CARRIAGE_RETURN = '\r';

/** UTF-8 byte-order-mark, stripped from the first line only. */
const BOM = '﻿';

// ---------------------------------------------------------------------------
// Allow-list parse schema (design §9 — Security blocker S2).
//
// `LedgerRecord` picks ONLY the six allow-listed fields. The secret-bearing
// `command` and `raw_log`, plus `attempt`, `exit_code`, `branch`,
// `files_changed`, `diff_stats`, `duration_seconds`, `error_type`, are NOT
// declared here — Zod's default object parse strips unknown keys, so they
// are never carried into a parsed object and never reachable by later code.
// ---------------------------------------------------------------------------

/** The ledger `cost` object — the two token figures `emit_json` writes. */
const LedgerCost = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
});

/**
 * One ledger envelope, allow-list-parsed. Only the six fields the reader
 * needs are declared; every other field (`command`, `raw_log`, …) is dropped
 * by Zod's strip-unknown-keys default.
 */
const LedgerRecord = z.object({
  schema_version: z.string(),
  tool: z.string(),
  model: z.string(),
  cost: LedgerCost,
  timestamp: z.string(),
  git_sha: z.string(),
});

type LedgerRecord = z.infer<typeof LedgerRecord>;

/**
 * Read metaswarm's external-tools ledger and yield one `DelegationRun` per
 * `tool === "gemini"` entry (design §4.3).
 *
 * @param ledgerPath - Absolute path to `external-tools.jsonl` (or the
 *   `METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER` override). An ABSENT file
 *   yields `[]` — never a throw (design §4.3 empty-state).
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @param options - Optional read bounds (the total-file-size cap).
 * @returns Every `tool === "gemini"` entry as a `DelegationRun`, sorted by
 *   `at` then `model` for a deterministic result. `tool === "codex"` entries,
 *   entries with an unrecognized `schema_version`, malformed lines, and
 *   over-cap lines are all silently skipped — discovery never throws.
 */
export function discoverGeminiRuns(
  ledgerPath: string,
  fs: LedgerReaderFsHooks = DEFAULT_FS,
  options: LedgerReaderOptions = {},
): DelegationRun[] {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  // §9: total-file-size cap. `stat` first — an absent file throws here and
  // yields the empty state; an oversized file is refused before any read.
  let stats: StatsLike;
  try {
    stats = fs.statSync(ledgerPath);
  } catch {
    // Absent / unstattable ledger → empty state (design §4.3).
    return [];
  }
  if (stats.size > maxFileBytes) {
    // A ledger past the cap is refused outright — never read into memory.
    return [];
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(ledgerPath);
  } catch {
    // Unreadable (deleted between stat and read, permission error) → empty.
    return [];
  }

  const runs: DelegationRun[] = [];
  const table = loadPricingTable();
  for (const record of scanLedgerBuffer(buffer)) {
    runs.push(recordToRun(record, table));
  }

  // Deterministic order so callers (and tests) see a stable result.
  runs.sort((a, b) =>
    a.at === b.at ? a.model.localeCompare(b.model) : a.at.localeCompare(b.at),
  );
  return runs;
}

/**
 * Scan the ledger's raw Buffer line by line, yielding each allow-list-parsed
 * `LedgerRecord` that is a SUPPORTED-version `gemini` entry.
 *
 * Robustness mirrors v4's `jsonl-reader` and v5-3's `codex-reader`: the file
 * is split on the raw `\n` byte so a >1 MiB line is skipped WITHOUT being
 * decoded; a non-UTF-8 line is caught by a fatal decoder; a malformed JSON
 * line is skipped. A well-formed line that is not a gemini entry — a codex
 * entry, or an entry with an unrecognized `schema_version` — is dropped here.
 */
function* scanLedgerBuffer(buffer: Buffer): Generator<LedgerRecord> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let lineStart = 0;
  let lineIndex = 0;
  // Iterate <= length so the final newline-less segment is processed once.
  for (let i = 0; i <= buffer.length; i++) {
    if (i < buffer.length && buffer[i] !== NEWLINE_BYTE) {
      continue;
    }
    const segment = buffer.subarray(lineStart, i);
    const isFirstLine = lineIndex === 0;
    lineStart = i + 1;
    lineIndex++;

    // §9: a >1 MiB line is skipped without being decoded or parsed.
    if (segment.length > MAX_LINE_BYTES) {
      continue;
    }

    let text: string;
    try {
      text = decoder.decode(segment);
    } catch {
      // A fatal decoder throws on invalid UTF-8 → skip the line.
      continue;
    }
    if (text.endsWith(CARRIAGE_RETURN)) {
      text = text.slice(0, -1);
    }
    if (isFirstLine && text.startsWith(BOM)) {
      text = text.slice(BOM.length);
    }
    if (text.trim() === '') {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A malformed JSON line is skipped, never thrown.
      continue;
    }

    // §9: allow-list parse — keeps ONLY the six picked fields. A line missing
    // a required field (e.g. no `cost`) fails `safeParse` and is dropped.
    const result = LedgerRecord.safeParse(parsed);
    if (!result.success) {
      continue;
    }
    const record = result.data;

    // §4.3: an entry written by an unrecognized ledger schema is skipped.
    if (record.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      continue;
    }
    // Only gemini entries become runs; codex entries are read elsewhere.
    if (record.tool !== GEMINI_TOOL) {
      continue;
    }

    yield record;
  }
}

/**
 * Map one allow-list-parsed gemini `LedgerRecord` to a `DelegationRun`
 * (design §4.3 / §4.4). An unpriced model yields `costUsd: null` (§5.3).
 */
function recordToRun(
  record: LedgerRecord,
  table: ReturnType<typeof loadPricingTable>,
): DelegationRun {
  const usage: TokenUsage = {
    inputTokens: intOr0(record.cost.input_tokens),
    outputTokens: intOr0(record.cost.output_tokens),
    // The ledger carries no cache / reasoning split — those fields are 0.
    cacheReadTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    reasoningTokens: 0,
  };

  // §5.3: an unpriced model → `costUsd: null` (never a fabricated 0).
  const costUsd = costFor(usage, record.model, table).costUsd;

  return {
    // §4.3: only gemini entries reach here — vendor is always `google`.
    vendor: 'google',
    model: record.model,
    // §4.4: the ledger carries no cwd → always the `unattributed` bucket.
    projectName: null,
    at: normalizeTimestamp(record.timestamp),
    usage,
    costUsd,
  };
}

/** A coerced non-negative integer; any non-finite / negative value → 0. */
function intOr0(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Normalize the ledger `timestamp` to a `DelegationRun.at`. The schema
 * requires a UTC ISO-8601 string with no offset; `log_session` writes
 * exactly that (`now | todate`). A missing or non-conforming timestamp falls
 * back to the Unix epoch so the run is still representable.
 */
function normalizeTimestamp(raw: string): string {
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}
