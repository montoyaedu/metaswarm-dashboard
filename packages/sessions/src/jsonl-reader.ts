// JSONL transcript parser (sessions-spike WU-3, design §5.1).
//
// `parseTranscript(filePath, fs?)` reads a Claude Code JSONL transcript and
// produces a `SessionTimeline`. The function is PURE apart from the injected
// filesystem hooks: `fs` defaults to `node:fs` but tests pass a stub so the
// parser can be exercised without touching disk.
//
// The parser builds plain typed objects — it does NOT call Zod at runtime.
// Validation of the result against `SessionTimeline` is a caller/test concern;
// keeping the hot path Zod-free avoids paying schema cost per transcript.
//
// Robustness (design Appendix B): the file is read as a Buffer and split on
// the raw `\n` byte so a >1 MiB line can be skipped WITHOUT being decoded
// (B8 — must not OOM) and a non-UTF-8 line is caught by a fatal decoder
// (B9). Malformed JSON lines are skipped and counted, never thrown (B3–B5).

import { readFileSync as nodeReadFileSync, statSync as nodeStatSync } from 'node:fs';
import { basename } from 'node:path';

import type { TokenUsage } from '@metaswarm-dashboard/types/cost';
import type {
  SessionTimeline,
  ToolUseEvent,
  ToolUseEventKind,
} from '@metaswarm-dashboard/types/sessions';

/** Injectable filesystem hooks. Defaults to `node:fs`. */
export interface JsonlReaderFsHooks {
  /** Read a file as a raw Buffer (call WITHOUT an encoding argument). */
  readFileSync: (filePath: string) => Buffer;
  /** Stat a file — used only for the empty-file mtime fallback. */
  statSync: (filePath: string) => { mtime: Date };
}

const DEFAULT_FS: JsonlReaderFsHooks = {
  readFileSync: (filePath) => nodeReadFileSync(filePath),
  statSync: (filePath) => nodeStatSync(filePath),
};

/** Per-line size cap: lines larger than this are skipped without decoding. */
const MAX_LINE_BYTES = 1024 * 1024;

/** Newline (`\n`) byte used to segment the raw Buffer. */
const NEWLINE_BYTE = 0x0a;

/** Carriage-return (`\r`) byte stripped from CRLF line endings. */
const CARRIAGE_RETURN = '\r';

/** UTF-8 byte-order-mark, stripped from the first line only. */
const BOM = '﻿';

/** Substring Claude Code uses to wrap slash-commands in user content. */
const COMMAND_MARKER = '<command-name>';

/** Maximum length of a `summary` field (single-line, design §6.1). */
const SUMMARY_MAX = 200;

/** Epoch ISO string used when an empty file's mtime is unavailable (B1). */
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/** A parsed JSONL entry — read leniently; only known fields are used. */
interface RawEntry {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  message?: unknown;
  /** `true` on a subagent (sidechain) record; absent / `false` on the main
   *  thread. Read by the v5-2 cost carrier (`parseTranscriptUsage`). */
  isSidechain?: unknown;
  /** The Claude-generated title — present only on an `ai-title` record
   *  (`{ type:'ai-title', aiTitle, sessionId }`). Read by v5-6 (design §3). */
  aiTitle?: unknown;
}

/** A content block inside `message.content`. */
interface RawBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
}

/**
 * Parse a Claude Code JSONL transcript into a `SessionTimeline`.
 *
 * @param filePath - Path to the `.jsonl` transcript.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 */
export function parseTranscript(
  filePath: string,
  fs: JsonlReaderFsHooks = DEFAULT_FS,
): SessionTimeline {
  const buffer = fs.readFileSync(filePath);

  const events: ToolUseEvent[] = [];
  let skippedLineCount = 0;
  let sessionId: string | null = null;
  let projectCwd: string | null = null;
  // v5-6 (design §3 / §6): the value of the LAST `ai-title` record seen, or
  // `null` when the transcript carries no `ai-title` record (~85% of files).
  let aiTitle: string | null = null;

  // `ignoreBOM: true` so a leading BOM is NOT silently consumed by the
  // decoder — the parser strips it explicitly (B7) on the first line only,
  // which keeps the behaviour deterministic and not reliant on the WHATWG
  // decoder's default BOM handling. `fatal: true` makes invalid UTF-8 throw
  // (B9) instead of producing replacement characters.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  let lineStart = 0;
  let lineIndex = 0;
  // Iterate <= buffer.length so the final segment (which has no trailing
  // newline) is processed exactly once (handles B5's partial line at EOF).
  for (let i = 0; i <= buffer.length; i++) {
    if (i < buffer.length && buffer[i] !== NEWLINE_BYTE) {
      continue;
    }
    const segment = buffer.subarray(lineStart, i);
    const isFirstLine = lineIndex === 0;
    lineStart = i + 1;
    lineIndex++;

    // B8: a >1 MiB line is skipped without being decoded or parsed.
    if (segment.length > MAX_LINE_BYTES) {
      skippedLineCount++;
      continue;
    }

    // B9: a fatal decoder throws on invalid UTF-8 → skip + count.
    let text: string;
    try {
      text = decoder.decode(segment);
    } catch {
      skippedLineCount++;
      continue;
    }

    // B6: strip a trailing `\r` (CRLF). B7: strip a leading BOM on line 1.
    if (text.endsWith(CARRIAGE_RETURN)) {
      text = text.slice(0, -1);
    }
    if (isFirstLine && text.startsWith(BOM)) {
      text = text.slice(BOM.length);
    }

    // Blank / whitespace-only lines (incl. the trailing newline's empty
    // segment) are ignored: not an event, not counted as skipped.
    if (text.trim() === '') {
      continue;
    }

    // B3–B5: a malformed JSON line is skipped and counted, never thrown.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      skippedLineCount++;
      continue;
    }

    if (parsed === null || typeof parsed !== 'object') {
      // A bare scalar / array is a well-formed JSON value but not an entry.
      continue;
    }
    const entry = parsed as RawEntry;

    // Capture session metadata from the first entry that carries it.
    if (sessionId === null && typeof entry.sessionId === 'string' && entry.sessionId !== '') {
      sessionId = entry.sessionId;
    }
    if (projectCwd === null && typeof entry.cwd === 'string') {
      projectCwd = entry.cwd;
    }

    // v5-6: the LAST `ai-title` record's value wins. A record with no usable
    // title (`readAiTitle` → null) does NOT clear a title already captured.
    const recordTitle = readAiTitle(entry);
    if (recordTitle !== null) {
      aiTitle = recordTitle;
    }

    const mapped = mapEntry(entry);
    if (mapped === 'malformed') {
      skippedLineCount++;
      continue;
    }
    for (const event of mapped) {
      events.push(event);
    }
  }

  const fallbackTimestamp = (): string => {
    try {
      return fs.statSync(filePath).mtime.toISOString();
    } catch {
      // B1: mtime unavailable → epoch.
      return EPOCH_ISO;
    }
  };

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const startedAt = firstEvent ? firstEvent.at : fallbackTimestamp();
  const lastEventAt = lastEvent ? lastEvent.at : fallbackTimestamp();

  return {
    schemaVersion: 1,
    transcriptPath: filePath,
    sessionId: sessionId ?? basename(filePath).replace(/\.jsonl$/, ''),
    projectCwd: projectCwd ?? '',
    startedAt,
    lastEventAt,
    eventCount: events.length,
    skippedLineCount,
    // v5-6 (design §3 / §6): always a concrete `string | null` — the last
    // `ai-title` record's value, or `null` when the transcript has none.
    aiTitle,
    events,
  };
}

/**
 * Read an entry's `ai-title` value: the trimmed `aiTitle` string when the
 * entry is an `ai-title` record carrying a non-empty string, else `null`.
 * `parseTranscript` keeps the value of the LAST such record (design §3 / §6).
 */
function readAiTitle(entry: RawEntry): string | null {
  if (entry.type !== 'ai-title') {
    return null;
  }
  // The real record shape is `{ type:'ai-title', aiTitle, sessionId }`. A
  // non-string / missing / empty `aiTitle` carries no title — treat as none.
  if (typeof entry.aiTitle !== 'string') {
    return null;
  }
  const title = entry.aiTitle.trim();
  return title === '' ? null : title;
}

/**
 * Map one raw entry to 0+ `ToolUseEvent`s, or the sentinel `'malformed'`
 * when an event-bearing entry is missing its required string `timestamp`.
 */
function mapEntry(entry: RawEntry): ToolUseEvent[] | 'malformed' {
  const { type } = entry;
  if (type === 'ai-title') {
    // v5-6 (design §3): an `ai-title` record carries the Claude-generated
    // session title, not a timeline event. It contributes 0 `ToolUseEvent`s;
    // its title value is captured separately by `parseTranscript` via
    // `readAiTitle`. It is NOT counted as a skipped line.
    return [];
  }
  if (type !== 'user' && type !== 'assistant') {
    // `summary`, `system`, missing `message`, etc. → 0 events, NOT skipped.
    return [];
  }

  // An event-bearing entry MUST carry a string timestamp.
  if (typeof entry.timestamp !== 'string') {
    return 'malformed';
  }
  const at = entry.timestamp;
  const uuid = typeof entry.uuid === 'string' ? entry.uuid : null;

  const content = readMessageContent(entry.message);
  if (content === undefined) {
    // `user`/`assistant` entry with no usable message → 0 events.
    return [];
  }

  if (type === 'user') {
    return mapUserContent(content, at, uuid);
  }
  const cwd = typeof entry.cwd === 'string' ? entry.cwd : '';
  return mapAssistantContent(content, at, uuid, cwd);
}

/** Return `message.content` (string or block array), or undefined if absent. */
function readMessageContent(message: unknown): string | RawBlock[] | undefined {
  if (message === null || typeof message !== 'object') {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content as RawBlock[];
  }
  return undefined;
}

/** Map a `user` entry's content to events. */
function mapUserContent(
  content: string | RawBlock[],
  at: string,
  uuid: string | null,
): ToolUseEvent[] {
  if (typeof content === 'string') {
    return [makeEvent(promptKind(content), null, content, at, uuid)];
  }

  const events: ToolUseEvent[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      events.push(makeEvent(promptKind(block.text), null, block.text, at, uuid));
    } else if (block.type === 'tool_result') {
      const kind: ToolUseEventKind = block.is_error === true ? 'tool-error' : 'tool-result';
      events.push(makeEvent(kind, null, blockContentText(block.content), at, uuid));
    }
    // Any other block type → no event.
  }
  return events;
}

/** Map an `assistant` entry's content to events. */
function mapAssistantContent(
  content: string | RawBlock[],
  at: string,
  uuid: string | null,
  cwd: string,
): ToolUseEvent[] {
  if (typeof content === 'string') {
    // Assistant string content is not described in the transcript schema;
    // treat it as plain assistant text for resilience.
    return [makeEvent('assistant-text', null, content, at, uuid)];
  }

  const events: ToolUseEvent[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      events.push(makeEvent('assistant-text', null, block.text, at, uuid));
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      events.push(makeEvent('assistant-thinking', null, block.thinking, at, uuid));
    } else if (block.type === 'tool_use') {
      const name = typeof block.name === 'string' ? block.name : 'tool';
      events.push(makeEvent('tool-use', name, toolUseSummary(name, block.input, cwd), at, uuid));
    }
    // Any other block type → no event.
  }
  return events;
}

/** A user/assistant text block is a slash-command if it carries the marker. */
function promptKind(text: string): ToolUseEventKind {
  return text.includes(COMMAND_MARKER) ? 'user-command' : 'user-prompt';
}

/**
 * Extract the displayable text from a `tool_result` block's `content`, which
 * may be a plain string or an array of `{ type:'text', text }` blocks.
 */
function blockContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content as RawBlock[]) {
      if (part && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
    return parts.join(' ');
  }
  return '';
}

/**
 * Build the raw summary string for a `tool-use` event, branching on the tool
 * name (design WU-3 bead). Every `input.*` access is guarded — `input` may be
 * undefined or a field may be missing — and falls back to the tool name.
 * Never deep-stringifies arbitrary structure (B11 safety).
 *
 * @param cwd - The entry's `cwd`, used to strip the repo prefix from
 *   `Read`/`Write`/`Edit` file paths so the summary is repo-relative.
 */
function toolUseSummary(name: string, input: unknown, cwd: string): string {
  const obj: Record<string, unknown> =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  if (name === 'Bash') {
    return typeof obj.command === 'string' ? obj.command.slice(0, 120) : name;
  }

  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    if (typeof obj.file_path !== 'string') {
      return name;
    }
    const prefix = cwd === '' ? '' : `${cwd}/`;
    return prefix !== '' && obj.file_path.startsWith(prefix)
      ? obj.file_path.slice(prefix.length)
      : obj.file_path;
  }

  if (name === 'Agent') {
    if (typeof obj.subagent_type === 'string' && typeof obj.description === 'string') {
      return `${obj.subagent_type}: ${obj.description.slice(0, 80)}`;
    }
    return name;
  }

  // Generic tool: render the name plus a compact one-line rendering of the
  // first scalar input value. Falls back to just the name when `input` is
  // empty or has no scalar fields.
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      return `${name} ${value}`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `${name} ${String(value)}`;
    }
  }
  return name;
}

/**
 * Build a `ToolUseEvent`. `rawSummary` is normalized — every run of
 * whitespace/control chars collapses to a single space, then it is trimmed
 * and sliced to `SUMMARY_MAX` chars. Tool-use-specific shaping (the Bash
 * 120-char cap, `Read`/`Write`/`Edit` cwd-prefix stripping, the `Agent`
 * label) is already applied by `toolUseSummary` before this point.
 */
function makeEvent(
  kind: ToolUseEventKind,
  toolName: string | null,
  rawSummary: string,
  at: string,
  uuid: string | null,
): ToolUseEvent {
  return {
    at,
    kind,
    toolName,
    summary: normalizeSummary(rawSummary),
    redactionApplied: [],
    uuid,
  };
}

/**
 * Matches any run of whitespace or C0/C1 control characters. `\s` covers the
 * common whitespace; the explicit \u0000-\u001F and \u007F-\u009F ranges
 * additionally collapse non-whitespace control bytes so the summary is
 * strictly single-line and printable.
 */
const WHITESPACE_OR_CONTROL_RUN = /[\s\u0000-\u001F\u007F-\u009F]+/g;

/** Collapse whitespace/control runs to a single space, trim, slice to 200. */
function normalizeSummary(raw: string): string {
  return raw.replace(WHITESPACE_OR_CONTROL_RUN, ' ').trim().slice(0, SUMMARY_MAX);
}

// ---------------------------------------------------------------------------
// v5-2 — Claude token-usage / model carrier (design §4.1 / §5.2).
//
// CARRIER DECISION (DoD: "additive only — the carrier must not alter existing
// event shapes"). v5-2 surfaces per-`assistant`-record `message.usage` +
// `message.model` via a SEPARATE exported function — `parseTranscriptUsage` —
// that returns a NEW, non-event `AssistantUsageRecord[]`. `parseTranscript`,
// `SessionTimeline` and `ToolUseEvent` are left BYTE-FOR-BYTE unchanged: a v4
// timeline consumer still type-checks and behaves identically.
//
// Why a second function and not a field on `ToolUseEvent` / `SessionTimeline`:
//   - Token usage is a per-RECORD figure (one `assistant` JSONL entry), while
//     a `ToolUseEvent` is a per-BLOCK projection — one assistant record fans
//     out to several events. Hanging usage off an event would force an
//     arbitrary "which event owns the record's usage" choice and risk
//     double-counting when `computeSessionCost` sums.
//   - `parseTranscript` is deliberately Zod-free on its hot path; an additive
//     sibling keeps that property and keeps the v4 timeline schema frozen.
// `computeSessionCost` (cost/session-cost.ts) consumes the `AssistantUsageRecord[]`.
// ---------------------------------------------------------------------------

/**
 * One `assistant` JSONL record's token usage + model — the v5-2 cost carrier.
 * Produced by `parseTranscriptUsage`; consumed by `computeSessionCost`. This
 * is NOT a `ToolUseEvent` and never enters a `SessionTimeline`.
 */
export interface AssistantUsageRecord {
  /** The raw `message.model` id (a dated-suffix alias is normalized later). */
  model: string;
  /** `true` for a subagent (sidechain) record; cost counts both (design §4.1). */
  isSidechain: boolean;
  /** The record's normalized `TokenUsage` (top-level figures — design §4.1). */
  usage: TokenUsage;
}

/** A coerced non-negative integer; any non-number / negative becomes 0. */
function intOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

/**
 * Normalize one raw `assistant` `message.usage` object to a `TokenUsage`
 * (design §4.1 / §5.2). The TOP-LEVEL `input_tokens` / `output_tokens` /
 * `cache_read_input_tokens` figures are used — these are already cumulative
 * for the record; the `usage.iterations[]` array is deliberately NOT summed.
 * The `cache_creation.ephemeral_5m/1h_input_tokens` split is preserved as the
 * two distinct fields the §5.2 formula prices separately. A Claude record has
 * no reasoning tokens, so `reasoningTokens` is always 0 here.
 *
 * `usage` is guaranteed a non-null object by the caller (`parseTranscriptUsage`
 * skips a record before this point if `message.usage` is null / not an object),
 * so this function only has to guard the nested `cache_creation` field.
 */
function normalizeUsage(u: Record<string, unknown>): TokenUsage {
  const cacheCreation: Record<string, unknown> =
    u.cache_creation !== null && typeof u.cache_creation === 'object'
      ? (u.cache_creation as Record<string, unknown>)
      : {};
  return {
    inputTokens: intOr0(u.input_tokens),
    outputTokens: intOr0(u.output_tokens),
    cacheReadTokens: intOr0(u.cache_read_input_tokens),
    cacheCreation5mTokens: intOr0(cacheCreation.ephemeral_5m_input_tokens),
    cacheCreation1hTokens: intOr0(cacheCreation.ephemeral_1h_input_tokens),
    reasoningTokens: 0,
  };
}

/**
 * Extract per-`assistant`-record token usage + model from a Claude Code JSONL
 * transcript — the v5-2 cost carrier (design §4.1).
 *
 * This is ADDITIVE to `parseTranscript`: it shares the same robust raw-Buffer
 * line splitting (the >1 MiB cap, the fatal UTF-8 decoder, malformed-line
 * skipping) but produces `AssistantUsageRecord[]` instead of a timeline. An
 * `assistant` record with no usable `message.usage` is skipped. Both main-
 * thread and `isSidechain` subagent records are captured (design §4.1).
 *
 * @param filePath - Path to the `.jsonl` transcript (or subagent) file.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @returns One `AssistantUsageRecord` per assistant record carrying usage,
 *   in file order. A transcript with zero assistant records yields `[]`.
 */
export function parseTranscriptUsage(
  filePath: string,
  fs: JsonlReaderFsHooks = DEFAULT_FS,
): AssistantUsageRecord[] {
  const buffer = fs.readFileSync(filePath);
  const records: AssistantUsageRecord[] = [];

  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let lineStart = 0;
  let lineIndex = 0;
  for (let i = 0; i <= buffer.length; i++) {
    if (i < buffer.length && buffer[i] !== NEWLINE_BYTE) {
      continue;
    }
    const segment = buffer.subarray(lineStart, i);
    const isFirstLine = lineIndex === 0;
    lineStart = i + 1;
    lineIndex++;

    // B8: a >1 MiB line is skipped without being decoded.
    if (segment.length > MAX_LINE_BYTES) {
      continue;
    }

    // B9: a fatal decoder throws on invalid UTF-8 → skip.
    let text: string;
    try {
      text = decoder.decode(segment);
    } catch {
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

    // B3–B5: a malformed JSON line is skipped, never thrown.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object') {
      continue;
    }
    const entry = parsed as RawEntry;
    if (entry.type !== 'assistant') {
      continue;
    }

    const message = entry.message;
    if (message === null || typeof message !== 'object') {
      continue;
    }
    const model = (message as { model?: unknown }).model;
    const usage = (message as { usage?: unknown }).usage;
    // An assistant record with no string model or no usable usage object
    // carries no cost signal — skip it.
    if (typeof model !== 'string' || usage === null || typeof usage !== 'object') {
      continue;
    }

    records.push({
      model,
      isSidechain: entry.isSidechain === true,
      usage: normalizeUsage(usage as Record<string, unknown>),
    });
  }

  return records;
}
