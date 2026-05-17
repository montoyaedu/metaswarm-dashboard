// Shared detection helpers for the process-rubric scorers (sessions-spike
// WU-4, design §7). Pure functions over a parsed `SessionTimeline`.
//
// Path predicates operate on the cwd-relative path strings that WU-3's
// parser places in a Read/Write/Edit event's `summary`. Bash predicates
// operate on the shell command in a Bash event's `summary` (first 120
// chars). See design §5.1 and the WU-4 brief.

import type { SessionTimeline, ToolUseEvent } from '@metaswarm-dashboard/types/sessions';

/** Tool names that mutate files on disk. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit']);

/** Basenames that count as project-convention documents. */
const CONVENTION_BASENAMES: ReadonlySet<string> = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  '.coverage-thresholds.json',
]);

/** True iff `e` is a `tool-use` event invoking the named tool. */
export function isToolUse(e: ToolUseEvent, name: string): boolean {
  return e.kind === 'tool-use' && e.toolName === name;
}

/** All `Write`/`Edit` tool-use events in declaration order. */
export function writeEvents(timeline: SessionTimeline): ToolUseEvent[] {
  return timeline.events.filter(
    (e) => e.kind === 'tool-use' && e.toolName !== null && WRITE_TOOLS.has(e.toolName),
  );
}

/** Index in `events` of the first `Write`/`Edit` tool-use, or `events.length`
 *  when the session writes no files at all. */
export function firstWriteIndex(timeline: SessionTimeline): number {
  const idx = timeline.events.findIndex(
    (e) => e.kind === 'tool-use' && e.toolName !== null && WRITE_TOOLS.has(e.toolName),
  );
  return idx === -1 ? timeline.events.length : idx;
}

/** Returns the path's `/`-delimited segments (also splits a leading-segment
 *  path with no slashes into a single-element list). */
function segments(p: string): string[] {
  return p.split('/');
}

/** The final path segment (basename) — everything after the last `/`.
 *  `lastIndexOf` returns -1 with no slash, and `slice(0)` then yields `p`. */
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** True iff the path contains a `src/` directory segment. */
export function isSrcCode(p: string): boolean {
  return segments(p).includes('src');
}

/** True iff the path is a test file: under a `__tests__/` segment, or whose
 *  basename matches `*.test.*` / `*.spec.*`. */
export function isTestFile(p: string): boolean {
  if (segments(p).includes('__tests__')) return true;
  return /\.(test|spec)\.[A-Za-z]+$/.test(basename(p));
}

/** True iff the path contains a `.agents/` directory segment. */
export function isAgentsPath(p: string): boolean {
  return segments(p).includes('.agents');
}

/** True iff the path is a project-convention document — a known convention
 *  basename, or anything under `.agents/`. */
export function isConventionDoc(p: string): boolean {
  return CONVENTION_BASENAMES.has(basename(p)) || isAgentsPath(p);
}

/** True iff `e` is a `Bash` tool-use whose command summary matches `re`. */
export function bashMatches(e: ToolUseEvent, re: RegExp): boolean {
  return isToolUse(e, 'Bash') && re.test(e.summary);
}

/** The `packages/<name>` prefix of a path, or `null` when the path is not
 *  under a named package directory. */
export function packagePrefix(p: string): string | null {
  const segs = segments(p);
  const i = segs.indexOf('packages');
  if (i === -1) return null;
  const name = segs[i + 1];
  if (name === undefined || name === '') return null;
  return `packages/${name}`;
}
