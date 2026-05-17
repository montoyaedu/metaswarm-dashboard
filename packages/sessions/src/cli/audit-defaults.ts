/**
 * Default for the `sessions audit --persist` flag.
 *
 * WU-6's `cli/audit.ts` MUST wire its commander `--persist` option default
 * from this constant — do NOT inline `false` there. Do NOT flip this to
 * `true`: a persisted snapshot may contain operator secrets (design §11.1,
 * anti-goal §12.11). WU-1 lands a test asserting this stays `false`.
 */
export const AUDIT_PERSIST_DEFAULT = false;
