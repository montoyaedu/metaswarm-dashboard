// Pure sorter callbacks shared by AgentTable + AgentsView. Extracted so
// they can be unit-tested directly (NDataTable invokes them only on
// header clicks, which is awkward to drive in jsdom).

export function bySortKey<T, K extends keyof T>(key: K) {
  return (a: T, b: T): number => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv));
  };
}

/** Format a duration in seconds as `s` / `m` / `h` shorthand. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
