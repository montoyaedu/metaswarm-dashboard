// Tests for the JSONL transcript parser (sessions-spike WU-3).
//
// Covers every Appendix B edge case (B1–B11) plus the raw-entry → event
// mapping for all seven `ToolUseEventKind`s and every `tool-use` summary
// branch, and a golden-master parity test against the synthetic fixture.
//
// B-case `.jsonl` inputs are written to `mkdtemp` temp dirs — NOT under
// `__tests__/fixtures/`, which is marker-guarded by the vitest setup file.

import { Buffer } from 'node:buffer';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SessionTimeline } from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseTranscript } from '../jsonl-reader.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

/** A scratch dir for byte-level B-case inputs, cleaned up after each test. */
let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'jsonl-reader-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Write `data` (string or Buffer) to a temp `.jsonl` and return its path. */
function tmpJsonl(name: string, data: string | Buffer): string {
  const p = join(scratch, name);
  writeFileSync(p, data);
  return p;
}

/** A minimal valid `assistant` entry with one text block. */
function assistantText(text: string, ts = '2026-05-17T10:00:00.000Z'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'uuid-1',
    timestamp: ts,
    sessionId: 'sess-1',
    cwd: '/repo',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

describe('parseTranscript — Appendix B edge cases', () => {
  it('B1: empty file → no events, startedAt/lastEventAt = file mtime', () => {
    const p = tmpJsonl('empty.jsonl', '');
    const mtime = statSync(p).mtime.toISOString();
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(0);
    expect(tl.events).toEqual([]);
    expect(tl.skippedLineCount).toBe(0);
    expect(tl.startedAt).toBe(mtime);
    expect(tl.lastEventAt).toBe(mtime);
  });

  it('B1: empty file + statSync throws → startedAt/lastEventAt = epoch', () => {
    const p = tmpJsonl('empty2.jsonl', '');
    const tl = parseTranscript(p, {
      readFileSync: (fp) => readFileSync(fp),
      statSync: () => {
        throw new Error('stat failed');
      },
    });
    expect(tl.eventCount).toBe(0);
    expect(tl.startedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(tl.lastEventAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('B2: single valid line → eventCount 1', () => {
    const p = tmpJsonl('one.jsonl', assistantText('hello') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(0);
    expect(tl.events[0]?.kind).toBe('assistant-text');
  });

  it('B3: single malformed line → eventCount 0, skippedLineCount 1', () => {
    const p = tmpJsonl('bad.jsonl', '{"bad":}\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(0);
    expect(tl.skippedLineCount).toBe(1);
  });

  it('B4: 3 valid + 2 malformed interleaved → 3 events, 2 skipped', () => {
    const lines = [
      assistantText('one'),
      '{"bad":}',
      assistantText('two'),
      'not json at all',
      assistantText('three'),
    ];
    const p = tmpJsonl('mixed.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(3);
    expect(tl.skippedLineCount).toBe(2);
  });

  it('B5: partial JSON at EOF (no trailing newline) → counted as skipped', () => {
    const p = tmpJsonl('partial.jsonl', assistantText('ok') + '\n{"part');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(1);
  });

  it('B6: CRLF line endings → parsed normally', () => {
    const body = assistantText('crlf-a') + '\r\n' + assistantText('crlf-b') + '\r\n';
    const p = tmpJsonl('crlf.jsonl', body);
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(2);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('B7: leading UTF-8 BOM → stripped, first line parsed', () => {
    const p = tmpJsonl('bom.jsonl', '﻿' + assistantText('with-bom') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.events[0]?.kind).toBe('assistant-text');
  });

  it('B8: line > 1 MiB → skipped + counted, no decode/parse', () => {
    // A >1 MiB line of valid JSON: even though it parses, the size cap fires
    // first, so it must be skipped without being decoded.
    const huge = 'x'.repeat(1024 * 1024 + 10);
    const bigLine = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: huge }] },
    });
    const p = tmpJsonl(
      'huge.jsonl',
      bigLine + '\n' + assistantText('after-huge') + '\n',
    );
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(1);
  });

  it('B9: non-UTF-8 byte in a line → skipped + counted', () => {
    // 0xFF is not valid UTF-8; the fatal decoder must throw and the line is
    // skipped. A following valid ASCII line still parses.
    const badLine = Buffer.from([0x7b, 0xff, 0x7d]); // { <0xFF> }
    const body = Buffer.concat([
      badLine,
      Buffer.from('\n' + assistantText('after-bad') + '\n', 'utf8'),
    ]);
    const p = tmpJsonl('nonutf8.jsonl', body);
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(1);
  });

  it('B10: __proto__ key → parsed, no prototype pollution', () => {
    const line = '{"type":"system","__proto__":{"polluted":true}}';
    const p = tmpJsonl('proto.jsonl', line + '\n');
    const tl = parseTranscript(p);
    // `system` type → 0 events, not skipped (it parsed fine).
    expect(tl.eventCount).toBe(0);
    expect(tl.skippedLineCount).toBe(0);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('B11: 10k-deep nested object → does not crash the process', () => {
    const depth = 10_000;
    const deep = '['.repeat(depth) + ']'.repeat(depth);
    const line = `{"type":"system","timestamp":"2026-05-17T10:00:00.000Z","payload":${deep}}`;
    const p = tmpJsonl('deep.jsonl', line + '\n' + assistantText('after-deep') + '\n');
    // The assertion is simply that this returns without throwing/overflowing.
    const tl = parseTranscript(p);
    // The deep line is `system` → 0 events; if JSON.parse rejected it, it is
    // skipped. Either way the process survives and the valid line parses.
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount + tl.eventCount).toBeGreaterThanOrEqual(1);
  });
});

describe('parseTranscript — blank-line handling', () => {
  it('ignores blank and whitespace-only lines (not skipped, not events)', () => {
    const body = [
      assistantText('a'),
      '',
      '   ',
      '\t',
      assistantText('b'),
    ].join('\n');
    const p = tmpJsonl('blanks.jsonl', body + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(2);
    expect(tl.skippedLineCount).toBe(0);
  });
});

describe('parseTranscript — well-formed non-object JSON lines', () => {
  it('a bare JSON scalar line → 0 events, not skipped', () => {
    // `42` is valid JSON but not a transcript entry: ignored, not counted.
    const p = tmpJsonl('scalar.jsonl', '42\n' + assistantText('after') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('a bare JSON array line → 0 events, not skipped', () => {
    const p = tmpJsonl('arr.jsonl', '[1,2,3]\n' + assistantText('after') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('a JSON null line → 0 events, not skipped', () => {
    const p = tmpJsonl('null.jsonl', 'null\n' + assistantText('after') + '\n');
    const tl = parseTranscript(p);
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(0);
  });
});

describe('parseTranscript — entry → event mapping', () => {
  function parseOne(entry: unknown) {
    const p = tmpJsonl('m.jsonl', JSON.stringify(entry) + '\n');
    return parseTranscript(p);
  }

  it('user string content without command marker → user-prompt', () => {
    const tl = parseOne({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'user', content: 'please add a parser' },
    });
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]?.kind).toBe('user-prompt');
    expect(tl.events[0]?.toolName).toBeNull();
    expect(tl.events[0]?.summary).toBe('please add a parser');
    expect(tl.events[0]?.uuid).toBe('u1');
  });

  it('user string content with <command-name> → user-command', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'user', content: '<command-name>/start-task</command-name>' },
    });
    expect(tl.events[0]?.kind).toBe('user-command');
    expect(tl.events[0]?.uuid).toBeNull();
  });

  it('user array content with text block → user-prompt', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'array prompt' }],
      },
    });
    expect(tl.events[0]?.kind).toBe('user-prompt');
    expect(tl.events[0]?.summary).toBe('array prompt');
  });

  it('user array text block with <command-name> → user-command', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<command-name>/prime</command-name>' }],
      },
    });
    expect(tl.events[0]?.kind).toBe('user-command');
  });

  it('user tool_result block → tool-result', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            content: [{ type: 'text', text: 'command succeeded' }],
          },
        ],
      },
    });
    expect(tl.events[0]?.kind).toBe('tool-result');
    expect(tl.events[0]?.toolName).toBeNull();
    expect(tl.events[0]?.summary).toBe('command succeeded');
  });

  it('user tool_result with is_error true → tool-error', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            is_error: true,
            content: [{ type: 'text', text: 'exit code 1' }],
          },
        ],
      },
    });
    expect(tl.events[0]?.kind).toBe('tool-error');
    expect(tl.events[0]?.summary).toBe('exit code 1');
  });

  it('user tool_result with string content → summary is the string', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: 'plain text result' }],
      },
    });
    expect(tl.events[0]?.kind).toBe('tool-result');
    expect(tl.events[0]?.summary).toBe('plain text result');
  });

  it('user array with an unknown block type → no event', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'image', source: {} }],
      },
    });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('assistant text block → assistant-text', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    });
    expect(tl.events[0]?.kind).toBe('assistant-text');
    expect(tl.events[0]?.summary).toBe('done');
  });

  it('assistant thinking block → assistant-thinking', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'let me consider this' }],
      },
    });
    expect(tl.events[0]?.kind).toBe('assistant-thinking');
    expect(tl.events[0]?.summary).toBe('let me consider this');
  });

  it('assistant unknown block type → no event', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'redacted_thinking' }] },
    });
    expect(tl.events).toHaveLength(0);
  });

  it('assistant string content → single assistant-text event', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: 'plain string response' },
    });
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0]?.kind).toBe('assistant-text');
    expect(tl.events[0]?.summary).toBe('plain string response');
  });

  it('user tool_result with non-string/non-array content → empty summary', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: { unexpected: 'shape' } }],
      },
    });
    expect(tl.events[0]?.kind).toBe('tool-result');
    expect(tl.events[0]?.summary).toBe('');
  });

  it('user tool_result with array content lacking text fields → empty summary', () => {
    const tl = parseOne({
      type: 'user',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', content: [{ type: 'image', source: {} }] },
        ],
      },
    });
    expect(tl.events[0]?.summary).toBe('');
  });

  it('message with a non-string/non-array content field → 0 events', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: 42 },
    });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('summary normalizes whitespace and truncates to 200 chars', () => {
    const messy = 'line one\n\tline\t two   \n  end' + ' x'.repeat(300);
    const tl = parseOne({
      type: 'assistant',
      timestamp: '2026-05-17T10:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: messy }] },
    });
    const summary = tl.events[0]?.summary ?? '';
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toContain('\n');
    expect(summary).not.toContain('\t');
    expect(summary.startsWith('line one line two end')).toBe(true);
  });

  it('unknown entry type (summary) → 0 events, not skipped', () => {
    const tl = parseOne({ type: 'summary', summary: 'recap' });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('entry with no type → 0 events, not skipped', () => {
    const tl = parseOne({ foo: 'bar' });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('user entry with no message → 0 events, not skipped', () => {
    const tl = parseOne({ type: 'user', timestamp: '2026-05-17T10:00:00.000Z' });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('user entry with missing timestamp → skipped (malformed event-bearing)', () => {
    const tl = parseOne({
      type: 'user',
      message: { role: 'user', content: 'no timestamp here' },
    });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(1);
  });

  it('assistant entry with non-string timestamp → skipped', () => {
    const tl = parseOne({
      type: 'assistant',
      timestamp: 12345,
      message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
    });
    expect(tl.events).toHaveLength(0);
    expect(tl.skippedLineCount).toBe(1);
  });
});

describe('parseTranscript — tool-use summary branches', () => {
  function toolUse(name: string, input: unknown, cwd = '/home/op/myrepo') {
    const p = tmpJsonl(
      'tu.jsonl',
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-17T10:00:00.000Z',
        cwd,
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name, input }],
        },
      }) + '\n',
    );
    return parseTranscript(p).events[0];
  }

  it('Bash → first 120 chars of command', () => {
    const cmd = 'echo ' + 'a'.repeat(300);
    const ev = toolUse('Bash', { command: cmd });
    expect(ev?.kind).toBe('tool-use');
    expect(ev?.toolName).toBe('Bash');
    expect(ev?.summary).toBe(cmd.slice(0, 120));
    expect(ev?.summary.length).toBe(120);
  });

  it('Bash with no command field → falls back to tool name', () => {
    const ev = toolUse('Bash', {});
    expect(ev?.summary).toBe('Bash');
  });

  it('Read → file_path with cwd prefix stripped', () => {
    const ev = toolUse('Read', { file_path: '/home/op/myrepo/src/index.ts' });
    expect(ev?.toolName).toBe('Read');
    expect(ev?.summary).toBe('src/index.ts');
  });

  it('Write → file_path unchanged when not under cwd', () => {
    const ev = toolUse('Write', { file_path: '/tmp/elsewhere.ts' });
    expect(ev?.summary).toBe('/tmp/elsewhere.ts');
  });

  it('Edit → file_path with cwd prefix stripped', () => {
    const ev = toolUse('Edit', { file_path: '/home/op/myrepo/src/a.ts' });
    expect(ev?.summary).toBe('src/a.ts');
  });

  it('Read with missing file_path → falls back to tool name', () => {
    const ev = toolUse('Read', {});
    expect(ev?.summary).toBe('Read');
  });

  it('Agent → "subagent_type: description[:80]"', () => {
    const ev = toolUse('Agent', {
      subagent_type: 'coder-agent',
      description: 'D'.repeat(200),
    });
    expect(ev?.summary).toBe('coder-agent: ' + 'D'.repeat(80));
  });

  it('Agent with missing fields → falls back to tool name', () => {
    const ev = toolUse('Agent', {});
    expect(ev?.summary).toBe('Agent');
  });

  it('generic tool with a scalar input → name + first scalar value', () => {
    const ev = toolUse('Grep', { pattern: 'TODO' });
    expect(ev?.toolName).toBe('Grep');
    expect(ev?.summary).toContain('Grep');
    expect(ev?.summary).toContain('TODO');
  });

  it('generic tool with empty input → just the tool name', () => {
    const ev = toolUse('Glob', {});
    expect(ev?.summary).toBe('Glob');
  });

  it('generic tool with only non-scalar input → just the tool name', () => {
    const ev = toolUse('Custom', { nested: { a: 1 } });
    expect(ev?.summary).toBe('Custom');
  });

  it('tool_use with undefined input → falls back to tool name', () => {
    const ev = toolUse('Bash', undefined);
    expect(ev?.summary).toBe('Bash');
  });

  it('Read with no cwd on the entry → file_path used verbatim', () => {
    const ev = toolUse('Read', { file_path: '/abs/path/file.ts' }, '');
    expect(ev?.toolName).toBe('Read');
    expect(ev?.summary).toBe('/abs/path/file.ts');
  });

  it('tool_use block with a non-string name → toolName falls back to "tool"', () => {
    const p = tmpJsonl(
      'noname.jsonl',
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-17T10:00:00.000Z',
        cwd: '/repo',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', input: { x: 1 } }],
        },
      }) + '\n',
    );
    const ev = parseTranscript(p).events[0];
    expect(ev?.kind).toBe('tool-use');
    expect(ev?.toolName).toBe('tool');
  });
});

describe('parseTranscript — SessionTimeline assembly', () => {
  it('derives sessionId/projectCwd from the first entry that has them', () => {
    const lines = [
      JSON.stringify({ type: 'summary', summary: 'no ids here' }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-05-17T10:00:00.000Z',
        sessionId: 'real-session',
        cwd: '/the/cwd',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
      }),
    ];
    const p = tmpJsonl('ids.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.sessionId).toBe('real-session');
    expect(tl.projectCwd).toBe('/the/cwd');
  });

  it('falls back to file basename for sessionId and "" for projectCwd', () => {
    const p = tmpJsonl(
      'abc-123.jsonl',
      JSON.stringify({ type: 'summary', summary: 'x' }) + '\n',
    );
    const tl = parseTranscript(p);
    expect(tl.sessionId).toBe('abc-123');
    expect(tl.projectCwd).toBe('');
  });

  it('startedAt/lastEventAt come from first/last event timestamps', () => {
    const lines = [
      assistantText('first', '2026-05-17T09:00:00.000Z'),
      assistantText('mid', '2026-05-17T09:30:00.000Z'),
      assistantText('last', '2026-05-17T10:00:00.000Z'),
    ];
    const p = tmpJsonl('span.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.startedAt).toBe('2026-05-17T09:00:00.000Z');
    expect(tl.lastEventAt).toBe('2026-05-17T10:00:00.000Z');
  });

  it('schemaVersion is 1 and transcriptPath echoes the input path', () => {
    const p = tmpJsonl('echo.jsonl', assistantText('x') + '\n');
    const tl = parseTranscript(p);
    expect(tl.schemaVersion).toBe(1);
    expect(tl.transcriptPath).toBe(p);
  });
});

describe('parseTranscript — ai-title parse (v5-6, design §3 / §6)', () => {
  /** An `ai-title` JSONL record — the exact real-transcript shape:
   *  `{ type, aiTitle, sessionId }`, no timestamp. */
  function aiTitleRecord(title: string): string {
    return JSON.stringify({
      type: 'ai-title',
      aiTitle: title,
      sessionId: 'sess-1',
    });
  }

  it('populates aiTitle from a transcript carrying an ai-title record', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      aiTitleRecord('Implement the ai-title parser'),
    ];
    const p = tmpJsonl('one-title.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBe('Implement the ai-title parser');
  });

  it('aiTitle is null when the transcript has no ai-title record (~85% case)', () => {
    const p = tmpJsonl('no-title.jsonl', assistantText('hello') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBeNull();
  });

  it('uses the LAST ai-title record when several are present', () => {
    const lines = [
      aiTitleRecord('First draft title'),
      assistantText('work', '2026-05-19T10:00:00.000Z'),
      aiTitleRecord('Second revised title'),
      assistantText('more work', '2026-05-19T10:01:00.000Z'),
      aiTitleRecord('Final title'),
    ];
    const p = tmpJsonl('many-titles.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBe('Final title');
  });

  it('the ai-title record contributes no ToolUseEvent and is not counted as skipped', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      aiTitleRecord('A title'),
    ];
    const p = tmpJsonl('title-no-event.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    // One assistant text event; the ai-title record adds nothing.
    expect(tl.eventCount).toBe(1);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('an ai-title record with a non-string aiTitle is ignored (stays null)', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      JSON.stringify({ type: 'ai-title', aiTitle: 123, sessionId: 'sess-1' }),
    ];
    const p = tmpJsonl('bad-title.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBeNull();
    expect(tl.skippedLineCount).toBe(0);
  });

  it('an ai-title record missing aiTitle entirely leaves aiTitle null', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      JSON.stringify({ type: 'ai-title', sessionId: 'sess-1' }),
    ];
    const p = tmpJsonl('absent-field.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBeNull();
  });

  it('an ai-title record with a whitespace-only aiTitle leaves aiTitle null', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      JSON.stringify({ type: 'ai-title', aiTitle: '   \t  ', sessionId: 'sess-1' }),
    ];
    const p = tmpJsonl('blank-title.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBeNull();
    expect(tl.skippedLineCount).toBe(0);
  });

  it('an ai-title record with surrounding whitespace yields the trimmed title', () => {
    const lines = [
      assistantText('hello', '2026-05-19T10:00:00.000Z'),
      JSON.stringify({
        type: 'ai-title',
        aiTitle: '  Trim me  ',
        sessionId: 'sess-1',
      }),
    ];
    const p = tmpJsonl('padded-title.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBe('Trim me');
  });

  it('a valid ai-title after a malformed one still wins (last valid value)', () => {
    const lines = [
      JSON.stringify({ type: 'ai-title', aiTitle: null, sessionId: 'sess-1' }),
      aiTitleRecord('The good title'),
    ];
    const p = tmpJsonl('mixed-titles.jsonl', lines.join('\n') + '\n');
    const tl = parseTranscript(p);
    expect(tl.aiTitle).toBe('The good title');
  });

  it('reads the synthetic ai-title-present fixture: last value wins', () => {
    const tl = parseTranscript(join(fixturesDir, 'ai-title-present.jsonl'));
    // The fixture carries three ai-title records; the LAST value is taken.
    expect(tl.aiTitle).toBe('Implement the ai-title parser branch in jsonl-reader');
    // The ai-title / last-prompt / permission-mode / system records produce
    // no events — only the user prompt + two assistant blocks do.
    expect(tl.eventCount).toBe(3);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('reads the synthetic ai-title-absent fixture: aiTitle is null', () => {
    const tl = parseTranscript(join(fixturesDir, 'ai-title-absent.jsonl'));
    expect(tl.aiTitle).toBeNull();
    // user prompt + one assistant block; the other record types are inert.
    expect(tl.eventCount).toBe(2);
    expect(tl.skippedLineCount).toBe(0);
  });

  it('the parsed ai-title fixture timeline passes the Zod SessionTimeline schema', () => {
    const present = parseTranscript(join(fixturesDir, 'ai-title-present.jsonl'));
    const absent = parseTranscript(join(fixturesDir, 'ai-title-absent.jsonl'));
    expect(SessionTimeline.safeParse(present).success).toBe(true);
    expect(SessionTimeline.safeParse(absent).success).toBe(true);
  });
});

describe('parseTranscript — golden-master parity', () => {
  it('synthetic fixture deep-equals the frozen expected timeline', () => {
    const fixturePath = join(fixturesDir, 'synthetic-events.jsonl');
    const expected = JSON.parse(
      readFileSync(join(fixturesDir, 'synthetic-events.expected.json'), 'utf8'),
    ) as unknown;
    const tl = parseTranscript(fixturePath);
    // The expected golden master stores transcriptPath as a bare filename so
    // it is machine-independent; compare against a path-normalized copy.
    const normalized = { ...tl, transcriptPath: 'synthetic-events.jsonl' };
    expect(normalized).toEqual(expected);
  });

  it('parsed synthetic timeline passes the real Zod SessionTimeline schema', () => {
    const fixturePath = join(fixturesDir, 'synthetic-events.jsonl');
    const tl = parseTranscript(fixturePath);
    const result = SessionTimeline.safeParse(tl);
    expect(result.success).toBe(true);
  });
});
