# Execution State — sessions-spike v4

## Current Position
- Phase: **executing v4** — plan approved (design gate 5/5, plan gate 3/3),
  operator chose metaswarm orchestrated execution (4-phase loop per WU).
- Active work unit: **v4-1** (`metaswarm-dashboard-b5z`) — rating schemas.
- Current phase: IMPLEMENT.
- Branch: `sessions-spike` (NOT pushed — design anti-goal §12.7; operator pushes).
- Plan: `.beads/plans/active-plan.md` + canonical `docs/plan-sessions-v4.md`.

## v4 work units (beads)
| WU | bead | status |
|----|------|--------|
| v4-1 rating schemas | b5z | IN-PROGRESS (IMPLEMENT) |
| v4-2 shared lifts | fhb | ready |
| v4-3 rubric advisory + fixes | 2tf | ready |
| v4-4 transcript-discovery | xyl | blocked ← v4-2 |
| v4-5 server read API | f27 | blocked ← v4-1,3,4 |
| v4-6 server write API [HUMAN CHECKPOINT] | na3 | blocked ← v4-1,5 |
| v4-7 SPA list/detail/nav | qxk | blocked ← v4-5 |
| v4-8 SPA rating survey + calibration | 26a | blocked ← v4-6,7 |
| v4-9 integration + docs + follow-ups | vka | blocked ← v4-1..8 |

Execution order: v4-1 → v4-2 → v4-3 → v4-4 → v4-5 → v4-6 (checkpoint) → v4-7 → v4-8 → v4-9.

## Done (foundation)
WU-1..WU-5 (v3) committed; coverage debt `0nt` closed; WU-4.5 calibration
(`0ga`) closed — §15.3 kill resolved by the v4 re-scope; v3 WU-6/7/8
(`vcr`/`pkl`/`9qo`) closed as superseded by v4.

## Recovery
`bd prime`; read this file + `project-context.md` + `docs/plan-sessions-v4.md`
+ `docs/design-sessions-spike-v4.md`; `git log sessions-spike`.
