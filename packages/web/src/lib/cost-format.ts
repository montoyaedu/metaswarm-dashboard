// Pure formatting helpers for the v5-9 F2 cost widgets (design §8.2).
// Extracted from the views so the branchy null / precision logic is
// unit-testable without mounting a component.

/**
 * Render a session/model cost as a USD string.
 *
 * - `null` → `"n/a"` — an unpriced model or a session with no costable
 *   records. Design §5.3 / §8.2: a `null` cost is NEVER shown as a
 *   fabricated `$0.00`, because `0` is a meaningful, distinct value.
 * - a number (including `0`) → `"$X.XXXX"` at **4-decimal precision**, so
 *   sub-cent sessions are distinguishable (design §8.2). `0` → `"$0.00"`.
 */
export function formatUsd(costUsd: number | null): string {
  if (costUsd === null) return 'n/a';
  if (costUsd === 0) return '$0.00';
  return `$${costUsd.toFixed(4)}`;
}

/** Render an integer token count with thousands grouping. */
export function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString('en-US');
}
