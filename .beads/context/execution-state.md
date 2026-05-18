# Execution State — sessions-spike v4

## Current Position
- Phase: **executing v4** (metaswarm orchestrated, 4-phase loop per WU).
- **At the v4-6 HUMAN CHECKPOINT** — awaiting operator go-ahead before v4-7.
- Branch: `sessions-spike` (NOT pushed — design anti-goal §12.7; operator pushes).
- Plan: `.beads/plans/active-plan.md` + `docs/plan-sessions-v4.md`.

## v4 work units
| WU | bead | status |
|----|------|--------|
| v4-1 rating schemas | b5z | ✅ COMMITTED |
| v4-2 shared lifts (config + transcriptsDir) | fhb | ✅ COMMITTED |
| v4-3 rubric advisory + fixes | 2tf | ✅ COMMITTED |
| v4-4 transcript-discovery | xyl | ✅ COMMITTED |
| v4-5 server read API | f27 | ✅ COMMITTED |
| v4-6 server write API | na3 | ✅ COMMITTED — HUMAN CHECKPOINT |
| v4-7 SPA list/detail/nav | qxk | next (← v4-5) |
| v4-8 SPA rating survey + calibration | 26a | blocked ← v4-6,7 |
| v4-9 integration + docs + follow-ups | vka | blocked ← v4-1..8 |

## Notes
- 764 tests; `npm run test:coverage` gate green (lines 100%).
- v4-6 (write API) reviewed: re-derives rubric server-side; method-guard
  exact-match allow-list; §8.1 CSRF trio (json-only / same-origin
  fail-closed / 64KB cap / no CORS); writes only into the datalake.

## Recovery
`bd prime`; read this file + `project-context.md` + `docs/plan-sessions-v4.md`;
`git log sessions-spike`.
