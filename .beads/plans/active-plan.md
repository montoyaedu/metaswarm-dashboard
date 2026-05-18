# Active Plan — Sessions Observability v4
<!-- approved: 2026-05-17 -->
<!-- gate-iterations: design-review 3 rounds (5/5 APPROVED), plan-review 3 rounds (3/3 PASS) -->
<!-- user-approved: true -->
<!-- execution-method: metaswarm orchestrated execution (4-phase loop per WU) -->
<!-- status: in-progress -->

Canonical plan: `docs/plan-sessions-v4.md`. Design: `docs/design-sessions-spike-v4.md`.
Branch: `sessions-spike`. (Supersedes the stale Step-1 MVP plan previously in this file —
the MVP shipped; its record is in git history.)

## Work units (9) — each via the orchestrated 4-phase loop (IMPLEMENT → VALIDATE → ADVERSARIAL REVIEW → COMMIT)

| WU | Title | Deps |
|----|-------|------|
| v4-1 | rating schemas in `@metaswarm-dashboard/types` | — |
| v4-2 | shared lifts: config loader + `transcriptsDir` → `types` | — |
| v4-3 | rubric → advisory + error-handling & thrashing fixes | — |
| v4-4 | `transcript-discovery.ts` + `packages/sessions` public surface | v4-2 |
| v4-5 | server read API — 3 GET endpoints + mtime cache | v4-1, v4-3, v4-4 |
| v4-6 | server write API — `PUT rating` + method-guard re-scope **[HUMAN CHECKPOINT]** | v4-1, v4-5 |
| v4-7 | SPA nav bar + Sessions list + detail/timeline | v4-5 |
| v4-8 | SPA rating survey + calibration summary | v4-6, v4-7 |
| v4-9 | integration test + docs + follow-up beads | v4-1..v4-8 |

## Execution order
v4-1 → v4-2 → v4-3 → v4-4 → v4-5 → v4-6 (**human checkpoint after commit**) → v4-7 → v4-8 → v4-9.
(v4-1/2/3 are independent and could parallelize; executed sequentially here.)

## State
Live state: `.beads/context/execution-state.md`. Per-WU DoD / file scope / test specs: `docs/plan-sessions-v4.md`.
