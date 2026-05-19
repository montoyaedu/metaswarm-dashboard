// Codex rollout reader (sessions-spike WU v5-3, design §4.2 / §4.4 / §9).
//
// Codex CLI writes one `rollout-<ts>-<uuid>.jsonl` per run under
// `~/.codex/sessions/<YYYY>/<MM>/<DD>/`. `discoverCodexRuns` does a HARDENED
// recursive descent of that tree and parses each rollout to a `DelegationRun`;
// `readCodexRollout` parses a single rollout file.
//
// READ-ONLY. The reader never writes, never creates, never follows a symlink
// out of the tree, and never deserializes Codex prompt/response text.
//
// §4.2 — per-rollout extraction:
//   - usage  = the LAST `event_msg`/`token_count` record whose `payload.info`
//              is NON-NULL → `info.total_token_usage`. A rollout with ZERO
//              such records yields `costUsd: null` (design §4.2 — NEVER `0`).
//   - model  = the LAST `turn_context` record's `payload.model`.
//   - cwd    = `session_meta.payload.cwd`, attributed via `resolveProjectForCwd`.
//   - vendor = always `openai`.
//
// §9 — recursive-walk hardening (the security core of v5-3). The walk of
// `<YYYY>/<MM>/<DD>/`:
//   - resolves the sessions root once and REFUSES it if it is a symlink;
//   - `lstat`s EVERY directory level and refuses (skips, does not follow) a
//     symlinked directory;
//   - re-asserts `realpath` containment under the resolved root at EACH level;
//   - applies a `^[A-Za-z0-9._-]+$` + `..`-reject sanitizer to EVERY path
//     segment, not just a leaf basename;
//   - bounds the walk at MAX_DEPTH 4 (the fixed `YYYY/MM/DD/file` shape) and a
//     max-files-visited cap;
//   - never reaches `~/.codex/archived_sessions/` — that tree is out of scope
//     (design §2) and is simply not a descendant of the sessions root.
//
// §9 — allow-list parse. Each rollout line is parsed with a Zod schema
// (`CodexRecord`) that picks ONLY the fields above; every other field —
// `response_item` content, `agent_message`, `git`, `base_instructions`,
// `rate_limits` — is structurally dropped at parse time and never read into
// memory. v4's per-line `MAX_LINE_BYTES` cap + malformed-line skipping are
// reused.

import {
  lstatSync as nodeLstatSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs';
import { join, sep } from 'node:path';

import type { Config } from '@metaswarm-dashboard/types/config';
import type { DelegationRun, TokenUsage } from '@metaswarm-dashboard/types/cost';
import { z } from 'zod';

import { resolveProjectForCwd } from './attribution.js';
import { costFor } from './calculator.js';
import { loadPricingTable } from './pricing.js';

/** A minimal `fs.Stats`-like shape — only the predicates the walk needs. */
interface StatsLike {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}

/**
 * Injectable filesystem hooks for the Codex reader. Defaults to `node:fs`.
 * Tests point the functions at a temp tree so every branch is reachable
 * without touching the real `~/.codex/sessions/`.
 */
export interface CodexReaderFsHooks {
  /** List the entries of a directory. */
  readdirSync: (dir: string) => string[];
  /** `lstat` a path — MUST NOT follow symlinks (symlink detection relies on it). */
  lstatSync: (path: string) => StatsLike;
  /** Resolve a path to its canonical location (follows symlinks). */
  realpathSync: (path: string) => string;
  /** Read a file as a raw Buffer (call WITHOUT an encoding argument). */
  readFileSync: (filePath: string) => Buffer;
}

const DEFAULT_FS: CodexReaderFsHooks = {
  readdirSync: (dir) => nodeReaddirSync(dir),
  lstatSync: (path) => nodeLstatSync(path),
  realpathSync: (path) => nodeRealpathSync(path),
  readFileSync: (filePath) => nodeReadFileSync(filePath),
};

/** Tunable bounds for the recursive walk (§9). */
export interface CodexWalkOptions {
  /** Hard cap on rollout files visited across the whole walk. */
  maxFilesVisited?: number;
}

/**
 * Max walk depth below the sessions root: `YYYY` (1) / `MM` (2) / `DD` (3) /
 * `rollout-*.jsonl` (4). The walk never descends past this (design §9).
 */
const MAX_DEPTH = 4;

/** Default files-visited cap — generous; the operator can lower it. */
const DEFAULT_MAX_FILES = 50_000;

/**
 * Per-path-segment allow-list (design §9). Every directory and file name in
 * the walk must match this; a segment outside the charset — or carrying a
 * `..` sequence — is refused.
 */
const SEGMENT_ALLOWED = /^[A-Za-z0-9._-]+$/;

/** Codex names every rollout `rollout-<ts>-<uuid>.jsonl`. */
const ROLLOUT_PREFIX = 'rollout-';
const JSONL_EXT = '.jsonl';

/** Per-line size cap: a line larger than this is skipped without decoding. */
const MAX_LINE_BYTES = 1024 * 1024;

/** Newline (`\n`) byte used to segment the raw Buffer. */
const NEWLINE_BYTE = 0x0a;

/** Carriage-return (`\r`) stripped from a CRLF line ending. */
const CARRIAGE_RETURN = '\r';

/** UTF-8 byte-order-mark, stripped from the first line only. */
const BOM = '﻿';

// ---------------------------------------------------------------------------
// Allow-list parse schemas (design §9 — Security blocker S2).
//
// `CodexRecord` is a discriminated union over the THREE record types the
// reader needs. Zod `.parse` of each line keeps ONLY these fields; everything
// else in the JSONL line is dropped and never reaches memory. A line that does
// not match any branch (`response_item`, `agent_message`, `task_*`, …) fails
// `safeParse` and is simply ignored — not an error.
// ---------------------------------------------------------------------------

/** Codex `total_token_usage` figures (design §4.2). */
const CodexTokenUsage = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
});

/** `session_meta` — only `cwd` is read. */
const SessionMetaRecord = z.object({
  type: z.literal('session_meta'),
  timestamp: z.string().optional(),
  payload: z.object({ cwd: z.string() }),
});

/** `turn_context` — only `model` is read. */
const TurnContextRecord = z.object({
  type: z.literal('turn_context'),
  timestamp: z.string().optional(),
  payload: z.object({ model: z.string() }),
});

/**
 * `event_msg`/`token_count` — `info` is nullable (design §4.2: an early
 * `token_count` carries `info: null`). When non-null, only
 * `total_token_usage` is read.
 */
const TokenCountRecord = z.object({
  type: z.literal('event_msg'),
  timestamp: z.string().optional(),
  payload: z.object({
    type: z.literal('token_count'),
    info: z
      .object({ total_token_usage: CodexTokenUsage })
      .nullable(),
  }),
});

/** A parsed Codex record — one of the three the reader cares about. */
type CodexRecord =
  | z.infer<typeof SessionMetaRecord>
  | z.infer<typeof TurnContextRecord>
  | z.infer<typeof TokenCountRecord>;

/** Try each branch in turn; return the first match, or `null`. */
function parseCodexRecord(value: unknown): CodexRecord | null {
  const meta = SessionMetaRecord.safeParse(value);
  if (meta.success) return meta.data;
  const turn = TurnContextRecord.safeParse(value);
  if (turn.success) return turn.data;
  const tc = TokenCountRecord.safeParse(value);
  if (tc.success) return tc.data;
  return null;
}

/**
 * What a rollout file yields after its lines are read: the last seen values
 * for each interesting record type. `usage` is `null` until a non-null-`info`
 * `token_count` is seen (design §4.2).
 */
interface RolloutScan {
  cwd: string | null;
  model: string | null;
  /** The last non-null-`info` token usage, or `null` if none was seen. */
  usage: TokenUsage | null;
  /** The last record `timestamp` seen — used as the run `at`. */
  lastTimestamp: string | null;
}

/**
 * Read one Codex rollout file and produce a `DelegationRun`.
 *
 * @param filePath - Absolute path to a `rollout-*.jsonl` file.
 * @param config - The loaded dashboard config; the rollout's `cwd` is
 *   attributed to a configured project via `resolveProjectForCwd`.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @returns A `DelegationRun`, or `null` when the file cannot be read or
 *   carries no `turn_context` model (nothing to cost). A rollout with a model
 *   but ZERO non-null-`info` `token_count` records yields a `DelegationRun`
 *   with `costUsd: null` (design §4.2 — never `0`).
 */
export function readCodexRollout(
  filePath: string,
  config: Config,
  fs: CodexReaderFsHooks = DEFAULT_FS,
): DelegationRun | null {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    // Unreadable (deleted, permission error) → no run, never a throw.
    return null;
  }

  const scan = scanRolloutBuffer(buffer);

  // No `turn_context` model → nothing to price against; not a Codex run we
  // can represent. Skip it rather than guessing a model.
  if (scan.model === null) {
    return null;
  }

  const usage: TokenUsage = scan.usage ?? zeroUsage();
  const projectName =
    scan.cwd === null ? null : resolveProjectForCwd(scan.cwd, config);

  let costUsd: number | null;
  if (scan.usage === null) {
    // §4.2: zero non-null-`info` token_count records → usage unrecoverable.
    // The run is real but uncosted — `null`, explicitly NOT `0`.
    costUsd = null;
  } else {
    costUsd = costFor(usage, scan.model, loadPricingTable()).costUsd;
  }

  return {
    vendor: 'openai',
    model: scan.model,
    projectName,
    at: normalizeTimestamp(scan.lastTimestamp),
    usage,
    costUsd,
  };
}

/**
 * Discover and parse every Codex rollout under a `<YYYY>/<MM>/<DD>/` sessions
 * tree (design §4.2 / §9).
 *
 * @param sessionsDir - The Codex sessions root (`~/.codex/sessions` or the
 *   `METASWARM_DASHBOARD_CODEX_SESSIONS_DIR` override). A non-existent or
 *   symlinked root yields `[]`.
 * @param config - The loaded dashboard config (for cwd attribution).
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @param options - Optional walk bounds (the files-visited cap).
 * @returns Every parseable rollout as a `DelegationRun`, sorted by `at` then
 *   `model` for a deterministic result. The §9 hardening means a symlinked
 *   directory level, an over-deep path, or a disallowed path segment are all
 *   silently skipped — discovery never throws.
 */
export function discoverCodexRuns(
  sessionsDir: string,
  config: Config,
  fs: CodexReaderFsHooks = DEFAULT_FS,
  options: CodexWalkOptions = {},
): DelegationRun[] {
  const maxFiles = options.maxFilesVisited ?? DEFAULT_MAX_FILES;

  // Resolve the sessions root once. A non-existent root → nothing to walk.
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync(sessionsDir);
  } catch {
    return [];
  }

  // §9: refuse a symlinked walk-root. The operator-set env path must be a
  // real directory, not a symlink into one.
  let rootStats: StatsLike;
  try {
    rootStats = fs.lstatSync(sessionsDir);
  } catch {
    return [];
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    return [];
  }

  const runs: DelegationRun[] = [];
  const visited = { count: 0 };
  walkDir(resolvedRoot, 1, resolvedRoot, config, fs, maxFiles, visited, runs);

  // Deterministic order so callers (and tests) see a stable result.
  runs.sort((a, b) =>
    a.at === b.at ? a.model.localeCompare(b.model) : a.at.localeCompare(b.at),
  );
  return runs;
}

/**
 * Recursively walk one directory level (design §9). `depth` is 1 at the
 * `YYYY` level; the walk descends to `MAX_DEPTH` (the `rollout-*.jsonl` leaf).
 *
 * Every entry is `lstat`ed: a symlinked directory is refused (not followed); a
 * symlinked file is refused. Each entry name must pass the per-segment
 * sanitizer. A directory's canonical path is re-asserted to be within the
 * resolved root before descending. The files-visited cap stops the walk early.
 */
function walkDir(
  dir: string,
  depth: number,
  resolvedRoot: string,
  config: Config,
  fs: CodexReaderFsHooks,
  maxFiles: number,
  visited: { count: number },
  runs: DelegationRun[],
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (visited.count >= maxFiles) {
      return;
    }
    // §9: every path segment must pass the allow-list and carry no `..`.
    if (!SEGMENT_ALLOWED.test(entry) || entry.includes('..')) {
      continue;
    }

    const childPath = join(dir, entry);

    // §9: `lstat` (NOT `stat`) — a symlink is detected and refused here.
    let stats: StatsLike;
    try {
      stats = fs.lstatSync(childPath);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink()) {
      // A symlinked directory or file is refused, never followed.
      continue;
    }

    if (stats.isDirectory()) {
      // §9: do not descend past max depth (the fixed YYYY/MM/DD shape).
      if (depth >= MAX_DEPTH) {
        continue;
      }
      // §9: re-assert canonical containment under the resolved root at EACH
      // level — catches a symlinked ancestor `lstat` on the leaf cannot see.
      let resolvedChild: string;
      try {
        resolvedChild = fs.realpathSync(childPath);
      } catch {
        continue;
      }
      if (!isWithin(resolvedChild, resolvedRoot)) {
        continue;
      }
      walkDir(
        childPath,
        depth + 1,
        resolvedRoot,
        config,
        fs,
        maxFiles,
        visited,
        runs,
      );
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }
    // Only `rollout-*.jsonl` files are rollouts.
    if (!entry.startsWith(ROLLOUT_PREFIX) || !entry.endsWith(JSONL_EXT)) {
      continue;
    }
    // §9: a rollout file appears only at the leaf (`YYYY/MM/DD/file`).
    if (depth !== MAX_DEPTH) {
      continue;
    }

    visited.count++;
    const run = readCodexRollout(childPath, config, fs);
    if (run !== null) {
      runs.push(run);
    }
  }
}

/**
 * Scan a rollout file's raw Buffer line by line, returning the last seen value
 * for each interesting record type (design §4.2).
 *
 * Robustness mirrors v4's `jsonl-reader`: the file is split on the raw `\n`
 * byte so a >1 MiB line is skipped WITHOUT being decoded; a non-UTF-8 line is
 * caught by a fatal decoder; a malformed JSON line is skipped. A line that
 * decodes and parses but is not one of the three known record types is simply
 * ignored — the allow-list parse drops it.
 */
function scanRolloutBuffer(buffer: Buffer): RolloutScan {
  const scan: RolloutScan = {
    cwd: null,
    model: null,
    usage: null,
    lastTimestamp: null,
  };

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

    // A >1 MiB line is skipped without being decoded or parsed.
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

    const record = parseCodexRecord(parsed);
    if (record === null) {
      // A well-formed line that is not one of the three known record types
      // (a `response_item`, `agent_message`, …) — dropped by the allow-list.
      continue;
    }
    applyRecord(scan, record);
  }

  return scan;
}

/** Fold one parsed record into the running scan (last-value-wins, §4.2). */
function applyRecord(scan: RolloutScan, record: CodexRecord): void {
  if (record.timestamp !== undefined) {
    scan.lastTimestamp = record.timestamp;
  }
  if (record.type === 'session_meta') {
    scan.cwd = record.payload.cwd;
    return;
  }
  if (record.type === 'turn_context') {
    // §4.2: the LAST turn_context model is representative.
    scan.model = record.payload.model;
    return;
  }
  // event_msg / token_count.
  const info = record.payload.info;
  if (info !== null) {
    // §4.2: the LAST non-null-`info` token_count is the run's usage. An
    // `info: null` record is skipped — it never clears a prior usage.
    scan.usage = toTokenUsage(info.total_token_usage);
  }
}

/**
 * Map Codex `total_token_usage` to the normalized `TokenUsage` (design §4.2):
 *   `cached_input_tokens`    → `cacheReadTokens`
 *   `reasoning_output_tokens`→ `reasoningTokens`
 *   the two `cacheCreation*` fields → 0 (Codex has no cache-write split).
 * Each figure is coerced to a non-negative integer.
 */
function toTokenUsage(u: z.infer<typeof CodexTokenUsage>): TokenUsage {
  return {
    inputTokens: intOr0(u.input_tokens),
    outputTokens: intOr0(u.output_tokens),
    cacheReadTokens: intOr0(u.cached_input_tokens),
    reasoningTokens: intOr0(u.reasoning_output_tokens),
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
  };
}

/** A fresh, all-zero `TokenUsage` (used when usage is unrecoverable). */
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

/** A coerced non-negative integer; any non-finite / negative value → 0. */
function intOr0(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * Normalize a rollout's last record `timestamp` to a `DelegationRun.at`. The
 * schema requires a UTC ISO-8601 string with no offset; a missing or
 * non-conforming timestamp falls back to the Unix epoch so the run is still
 * representable.
 */
function normalizeTimestamp(raw: string | null): string {
  if (raw !== null) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return new Date(0).toISOString();
}

/**
 * True if `target` is `root` itself or a descendant of it. The comparison is
 * at a path-separator boundary so `/a/bc` is NOT treated as inside `/a/b`.
 */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}
