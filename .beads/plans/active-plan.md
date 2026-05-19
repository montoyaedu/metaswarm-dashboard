# Active Plan — Sessions Observability v5

<!-- approved: 2026-05-18 -->
<!-- gate-iterations: design-review 2 rounds (5/5 APPROVED), plan-review 2 rounds (3/3 PASS) -->
<!-- user-approved: true — operator approved + chose orchestrated execution 2026-05-18 -->
<!-- execution-method: metaswarm orchestrated execution (4-phase loop per WU) -->
<!-- status: approved — execution blocked on the PR #6 (sessions-spike v4) merge -->

Canonical plan: `docs/plan-sessions-v5.md`. Design:
`docs/design-sessions-spike-v5.md` (design-review gate APPROVED 5/5).
Branch: `sessions-v5` (off `sessions-spike`; rebases onto `main` once PR #6
merges). Epic: `metaswarm-dashboard-r9e`.

Two features: F1 rating-survey context (ai-title + prompts + action
summary); F2 AI cost per vendor in every view (Claude from transcripts,
Codex from `~/.codex/sessions`, Gemini from the metaswarm ledger).

## Work units (10) — each via the orchestrated 4-phase loop

| WU | Title | Deps |
|----|-------|------|
| v5-1 | cost foundation: types + pricing + calculator + cwd resolver | — |
| v5-2 | Claude usage/model parse + `computeSessionCost` | v5-1 |
| v5-3 | Codex rollout reader + hardened recursive walk | v5-1 |
| v5-4 | Gemini ledger reader + empty-state | v5-1 |
| v5-5 | per-project per-vendor aggregation + cache | v5-2,3,4 |
| v5-6 | `ai-title` parse + session schema extensions | v5-2 |
| v5-7 | server API + namespace join **[HUMAN CHECKPOINT]** | v5-5,6 |
| v5-8 | F1 SPA survey-context panel | v5-6,7 |
| v5-9 | F2 SPA cost widgets — Sessions list + detail | v5-7,8 |
| v5-10 | F2 SPA cost widgets — repo views + e2e + docs | v5-1..9 |

## Execution order
v5-1 → v5-2 → v5-3 → v5-4 → v5-5 → v5-6 → v5-7 (**human checkpoint**) →
v5-8 → v5-9 → v5-10.

## State
- Gates: design-review 5/5 (2 rounds), plan-review 3/3 (2 rounds).
- Execution method: metaswarm orchestrated (operator-chosen 2026-05-18).
- Execution NOT started — blocked solely on the PR #6 merge (design §2).
  Kickoff after merge: rebase `sessions-v5` onto `main`, create the per-WU
  beads, run v5-1 through the 4-phase loop.
- Live state during execution: `.beads/context/execution-state.md`.

## Recovery
`bd prime`; read this file + `docs/plan-sessions-v5.md` +
`docs/design-sessions-spike-v5.md`; `git log main..sessions-v5`.
