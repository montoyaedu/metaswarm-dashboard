// Pure formatting helpers for the Sessions list + detail views. Extracted so
// the branchy duration/truncation logic is unit-testable without mounting a
// component. All inputs are UTC ISO-8601 strings from `@metaswarm-dashboard/types`.

/**
 * Human-readable span between two ISO-8601 timestamps as `s` / `m` / `h`
 * shorthand. A negative span (a clock-skewed `lastEventAt` before
 * `startedAt`) is clamped to `0s`.
 */
export function durationBetween(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const seconds = ms <= 0 ? 0 : ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** First ~8 chars of a session id — disambiguates same-minute sessions. */
export function sessionIdSuffix(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * Single-line, length-capped projection of a (possibly multi-line) summary
 * for a timeline row. Newlines collapse to spaces; an over-length string is
 * cut to `max` chars with a trailing ellipsis.
 */
export function truncateSummary(summary: string, max: number): string {
  const oneLine = summary.replace(/\s*\n\s*/g, ' ');
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/** True when `lastEventAt` is within the 60s window ending at `now`. */
export function isInProgress(lastEventIso: string, now: Date): boolean {
  const delta = now.getTime() - new Date(lastEventIso).getTime();
  return delta >= 0 && delta <= 60_000;
}
