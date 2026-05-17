# Execution State — sessions-spike

## Current Position
- Phase: **design v4 APPROVED by the design-review gate (5/5, 3 rounds, 2026-05-17).**
- Next: write the v4 implementation plan (decompose §9 WU-A..G into detailed
  work units) → plan-review gate → operator picks execution method → build.
- Branch: `sessions-spike` (NOT pushed — design anti-goal §12.7; operator pushes).

## Done
| Item | Status |
|------|--------|
| WU-1..WU-5 (v3) | COMPLETE — committed (skeleton, schemas, parser, 9 rubric scorers, snapshot writer) |
| Coverage debt `metaswarm-dashboard-0nt` | CLOSED — `npm run test:coverage` exits 0 |
| WU-4.5 calibration `metaswarm-dashboard-0ga` | CLOSED — §15.3 kill; superseded by design v4 |
| Design v4 (`docs/design-sessions-spike-v4.md`) | APPROVED 5/5 by the design-review gate |

## Next — v4 implementation (design v4 §9, work-unit shape)
- A: rubric → advisory + the 2 bug-fixes (error-handling, thrashing)
- B: rating schemas in `@metaswarm-dashboard/types`
- C: shared lifts (config loader + `transcriptsDir`) + session discovery + server read API
- D: server write API + `method-guard.ts` re-scope
- E: SPA Sessions list + detail/timeline + nav bar
- F: SPA rating survey + calibration summary + eslint write-guard re-scope
- G: integration test + docs + follow-up beads + the 2-week usage-check bead

## Open follow-ups / housekeeping for the planning step
- Stale v3 beads to close-as-superseded when the v4 plan is written:
  `metaswarm-dashboard-vcr` (v3 WU-6), `-pkl` (v3 WU-7), `-9qo` (v3 WU-8).
- Non-blocking gate suggestions to fold into the plan: method-guard exact-match
  shape + test; WU-E no-`v-html` on transcript content; row-click nav;
  min-1-verdict to save; the config.ts barrel decision; the error-handling
  summary-truncation edge-case test fixture.

## Recovery
`bd prime`; read this file + `project-context.md` + `docs/design-sessions-spike-v4.md`;
`git log sessions-spike`.
