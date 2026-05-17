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
    events,
  };
}

/**
 * Map one raw entry to 0+ `ToolUseEvent`s, or the sentinel `'malformed'`
 * when an event-bearing entry is missing its required string `timestamp`.
 */
function mapEntry(entry: RawEntry): ToolUseEvent[] | 'malformed' {
  const { type } = entry;
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
