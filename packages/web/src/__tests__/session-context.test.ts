// WU v5-8 — pure extraction helpers for the F1 survey-context panel
// (design §8.1). Tested directly so the branchy filter/group logic is
// covered without mounting RatingSurvey.

import type { ToolUseEvent } from '@metaswarm-dashboard/types/sessions';
import { describe, expect, it } from 'vitest';

import {
  actionSummary,
  sessionHeading,
  userPrompts,
} from '../lib/session-context.js';

/** Build a `ToolUseEvent` with sensible defaults; `over` narrows it. */
function evt(over: Partial<ToolUseEvent> = {}): ToolUseEvent {
  return {
    at: '2026-05-18T06:00:00.000Z',
    kind: 'user-prompt',
    toolName: null,
    summary: 'an event',
    redactionApplied: [],
    uuid: null,
    ...over,
  };
}

describe('sessionHeading', () => {
  it('returns the aiTitle when present', () => {
    expect(sessionHeading('Refactor the cost cache')).toBe('Refactor the cost cache');
  });

  it('returns "Untitled session" when aiTitle is null', () => {
    expect(sessionHeading(null)).toBe('Untitled session');
  });

  it('returns "Untitled session" when aiTitle is undefined', () => {
    expect(sessionHeading(undefined)).toBe('Untitled session');
  });

  it('returns "Untitled session" for an empty-string aiTitle', () => {
    expect(sessionHeading('')).toBe('Untitled session');
  });
});

describe('userPrompts', () => {
  it('returns only `user-prompt` events, in order', () => {
    const events = [
      evt({ kind: 'user-prompt', summary: 'first' }),
      evt({ kind: 'assistant-text', summary: 'reply' }),
      evt({ kind: 'user-prompt', summary: 'second' }),
    ];
    expect(userPrompts(events)).toEqual(['first', 'second']);
  });

  it('excludes `user-command` (slash-command) events', () => {
    const events = [
      evt({ kind: 'user-command', summary: '/start-task' }),
      evt({ kind: 'user-prompt', summary: 'a real prompt' }),
    ];
    expect(userPrompts(events)).toEqual(['a real prompt']);
  });

  it('returns an empty array when there are no user prompts', () => {
    const events = [
      evt({ kind: 'user-command', summary: '/prime' }),
      evt({ kind: 'tool-use', toolName: 'Read', summary: 'read a file' }),
    ];
    expect(userPrompts(events)).toEqual([]);
  });

  it('returns an empty array for an empty event list', () => {
    expect(userPrompts([])).toEqual([]);
  });
});

describe('actionSummary', () => {
  it('groups tool-use events by toolName, descending by count', () => {
    const events = [
      evt({ kind: 'tool-use', toolName: 'Read' }),
      evt({ kind: 'tool-use', toolName: 'Edit' }),
      evt({ kind: 'tool-use', toolName: 'Read' }),
      evt({ kind: 'tool-use', toolName: 'Bash' }),
      evt({ kind: 'tool-use', toolName: 'Read' }),
      evt({ kind: 'tool-use', toolName: 'Edit' }),
    ];
    expect(actionSummary(events)).toBe('Read ×3 · Edit ×2 · Bash ×1');
  });

  it('ignores non-tool-use events', () => {
    const events = [
      evt({ kind: 'user-prompt', summary: 'a prompt' }),
      evt({ kind: 'tool-use', toolName: 'Bash' }),
      evt({ kind: 'tool-result', toolName: 'Bash', summary: 'done' }),
      evt({ kind: 'assistant-thinking', summary: 'hmm' }),
    ];
    expect(actionSummary(events)).toBe('Bash ×1');
  });

  it('returns "no tool calls recorded" when there are zero tool-uses', () => {
    const events = [
      evt({ kind: 'user-prompt', summary: 'a prompt' }),
      evt({ kind: 'assistant-text', summary: 'a reply' }),
    ];
    expect(actionSummary(events)).toBe('no tool calls recorded');
  });

  it('returns "no tool calls recorded" for an empty event list', () => {
    expect(actionSummary([])).toBe('no tool calls recorded');
  });

  it('buckets a tool-use whose toolName is null under "(unknown)"', () => {
    // `ToolUseEvent.toolName` is `string | null` — a tool-use with a null
    // name is structurally possible; it is bucketed rather than dropped.
    const events = [
      evt({ kind: 'tool-use', toolName: null }),
      evt({ kind: 'tool-use', toolName: 'Read' }),
      evt({ kind: 'tool-use', toolName: null }),
    ];
    expect(actionSummary(events)).toBe('(unknown) ×2 · Read ×1');
  });

  it('breaks count ties by first-seen tool order (stable sort)', () => {
    const events = [
      evt({ kind: 'tool-use', toolName: 'Edit' }),
      evt({ kind: 'tool-use', toolName: 'Bash' }),
    ];
    // Both have count 1; Edit was seen first, so it sorts first.
    expect(actionSummary(events)).toBe('Edit ×1 · Bash ×1');
  });
});
