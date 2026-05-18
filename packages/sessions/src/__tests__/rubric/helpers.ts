// Terse in-code builders for SessionTimeline / ToolUseEvent fixtures used by
// the rubric scorer unit tests (sessions-spike WU-4). Not a `.test.ts` file,
// so vitest's `include` glob does not pick it up as a suite.

import type {
  SessionTimeline,
  ToolUseEvent,
  ToolUseEventKind,
} from '@metaswarm-dashboard/types/sessions';

/** Monotonic ISO-8601 timestamp generator, 1 s apart by default. */
function makeClock(startMs = Date.parse('2026-05-17T10:00:00.000Z')): () => string {
  let cursor = startMs;
  return () => {
    const iso = new Date(cursor).toISOString();
    cursor += 1000;
    return iso;
  };
}

/** Build a single event. `at` may be overridden for thrashing-gap tests. */
export function ev(
  kind: ToolUseEventKind,
  opts: { toolName?: string; summary?: string; at?: string; uuid?: string } = {},
): ToolUseEvent {
  return {
    at: opts.at ?? '2026-05-17T10:00:00.000Z',
    kind,
    toolName: opts.toolName ?? null,
    summary: opts.summary ?? '',
    redactionApplied: [],
    uuid: opts.uuid ?? null,
  };
}

/** A `tool-use` event for the given tool with `summary` as its rendered arg. */
export function tool(toolName: string, summary: string, at?: string): ToolUseEvent {
  return ev('tool-use', { toolName, summary, ...(at === undefined ? {} : { at }) });
}

/** Wrap a list of events into a SessionTimeline with sane defaults. Each
 *  event with no explicit `at` gets a fresh monotonic timestamp so ordering
 *  is realistic; events that supply their own `at` keep it. */
export function timeline(
  events: ToolUseEvent[],
  overrides: Partial<SessionTimeline> = {},
): SessionTimeline {
  const clock = makeClock();
  const stamped = events.map((e) =>
    e.at === '2026-05-17T10:00:00.000Z' ? { ...e, at: clock() } : e,
  );
  const first = stamped[0]?.at ?? '2026-05-17T10:00:00.000Z';
  const last = stamped[stamped.length - 1]?.at ?? first;
  return {
    schemaVersion: 1,
    transcriptPath: '/tmp/synthetic.jsonl',
    sessionId: 'sess-test',
    projectCwd: '/repo',
    startedAt: first,
    lastEventAt: last,
    eventCount: stamped.length,
    skippedLineCount: 0,
    events: stamped,
    ...overrides,
  };
}
