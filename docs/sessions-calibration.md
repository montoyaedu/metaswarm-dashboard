# Sessions Rubric — Calibration (WU-4.5)

> Status: **calibration run complete — outcome is a §15.3 concern** (see "Verdict").
> Date: 2026-05-17. Design ref: `design-sessions-spike.md` §7, §9.4, §15.1, §15.3.

## Methodology and its limitation (read this first)

Design §9.4 calibration validates the 9 rubric scorers against **operator**
ground-truth verdicts on 2 real sessions. The operator delegated this run to
the executing agent ("fallo tu … valuta il risultato anche tu", 2026-05-17).

**Limitation, stated honestly:** the ground-truth verdicts below are
*agent-judged*, not operator-judged. To keep the comparison meaningful the
agent (a) read each session's full parsed event timeline and wrote down an
independent per-criterion verdict reasoned from the events, then (b) ran the
rubric and compared. But agent-judged ground truth is structurally weaker
than the design intended. The real validation is the **operator-judged
recurring calibration on ≥5 sessions** that WU-7 opens as a follow-up. This
run should be read as a *strong smoke-test*, not a definitive calibration.

A wider smoke survey was also run: the rubric was scored against **7 real
sessions** across metaswarm-dashboard, the metaswarm framework, and three
sibling production repos. **All 7 scored `overall: fail`.** A KPI that
returns the same verdict for every session has no discriminating power —
this is the headline finding and it does not depend on the agent-vs-operator
judgment question.

## Calibration sessions

- **Session A** — a `metaswarm-dashboard` session: `/metaswarm:setup` followed
  by `/start-task` on the MVP issue. Heavy metaswarm-process use (skills,
  Architect agent, plan-review gate). Ends mid-stream during planning; writes
  no source code. 136 events.
- **Session C** — a bug-fix session on a sibling production repo that does
  **not** run the full metaswarm process (no beads, no `.agents/`). The agent
  diagnosed a defect via ~11 targeted reads/greps, made one source edit, ran a
  clean build, and committed. A competent, complete session. 107 events.

(Session content is proprietary; only abstracted descriptions and the
per-criterion verdict labels are recorded here, per §9.4.)

## Per-criterion result

Verdicts: agent = independent judgment from the events; rubric = `scoreTimeline`.
`§9.4`: 2-of-2 agree → keep; 1-of-2 → keep only if the lone disagreement is a
legitimate corner case (not a systematic flaw); 0-of-2 → drop.

| Criterion | A: agent / rubric | C: agent / rubric | Agree | §9.4 (honest) |
|---|---|---|---|---|
| setup-discipline | watch / watch ✓ | watch / fail ✗ | 1/2 | keep — corner case (C has no convention docs) |
| planning | pass / pass ✓ | watch / fail ✗ | 1/2 | keep — corner case (C is a non-beads repo) |
| tdd | na / na ✓ | na / fail ✗ | 1/2 | keep — corner case (C's repo has no test suite at all) |
| error-handling | na / na ✓ | pass / fail ✗ | 1/2 | **DROP — systematic**: scorer ignores diagnostic `Bash` |
| thrashing | pass / watch ✗ | pass / pass ✓ | 1/2 | **DROP — systematic**: over-fires on normal multi-edit |
| cross-reference | na / na ✓ | na / na ✓ | 2/2 | keep — but inert (na on both) |
| communication | na / fail ✗ | watch / fail ✗ | 0/2 | **DROP** |
| prompt-coherence | na / na ✓ | na / na ✓ | 2/2 | keep — but inert (na on both) |
| workflow-touchpoints | pass / watch ✗ | na / fail ✗ | 0/2 | **DROP** |

## Systematic problems found (not corner cases)

1. **`overall` never discriminates.** All 7 smoke-survey sessions → `fail`.
   The aggregate (`any fail → fail`) lets one harsh criterion sink every
   verdict, and the harsh criteria fire on almost everything.
2. **`error-handling` is partly blind.** It counts a corrective `Read`/`Grep`
   or an `assistant-text` as "handling" an error, but **not** a diagnostic
   `Bash` (`git status`, `pwd`, `ls`, grep-via-bash) — which is the most
   common way an agent investigates a failure. Session C handled all 3 of
   its errors well (retry, `git status` diagnosis, fix) yet scored `fail`.
   It is also blind to non-zero-exit errors that surface as `tool-result`
   text rather than `is_error:true`.
3. **`thrashing` over-fires.** "Two consecutive same-file Edits <5s apart"
   flags an agent editing section A then section B of one file — normal,
   deliberate work — as thrashing. It cannot tell a retry-loop from fast
   competent editing.
4. **`communication` / `workflow-touchpoints` assume the metaswarm process.**
   They require `bd close`/`bd update`/`.agents/` writes / `.coverage-
   thresholds.json` reads. The operator's real sessions — even competent
   ones — frequently run on repos that do not use beads/`.agents`, so these
   criteria `fail` correct, well-executed sessions. They measure "is this a
   beads project" more than "did this session go well".
5. **`cross-reference` and `prompt-coherence` were inert** — `na` on both
   calibration sessions and `na`-heavy across the survey. They "passed" only
   by never firing. This is the exact defect that retired `scope-drift` in
   v2 (design §7.1).

## Verdict — §9.4 / §15.1 / §15.3

Applying §9.4 in its **spirit** (1-of-2 keeps only for a *legitimate corner
case, not a systematic flaw*): criteria that genuinely survive =
`setup-discipline`, `planning`, `tdd`, `cross-reference`, `prompt-coherence`
— **5**. `error-handling` and `thrashing` fail on systematic flaws;
`communication` and `workflow-touchpoints` fail 0-of-2.

**5 < 6 → this trips the §15.1 calibration bar and is a §15.3 "calibration
kill": "operator decides; default is pause and reassess — do not ship a
degraded rubric silently."**

A purely mechanical §9.4 reading (1-of-2 always keeps) would give "7 keep" —
but that would be exactly the "ship a degraded rubric silently" outcome §15.3
forbids, given finding #1 (the rubric does not discriminate).

## Decision (pending — §15.3 routes this to the operator)

WU-4.5 stays **open** until the operator records a §15.3 decision. Options
put to the operator (with the executor's recommendation):

- **A — Rework the rubric, then re-calibrate (recommended).** Pause WU-6.
  Fix the systematic scorer flaws (#2, #3), revisit the aggregate (#1) and
  the beads-centric criteria (#4), retire or rebuild the inert criteria (#5),
  record each change as a `bd decision` per §12.9, then re-run calibration.
- **B — Ship a reduced rubric now.** Drop the 4 failing criteria, ship the
  5 survivors + CLI (WU-6) as-is. Honest but low-utility — two survivors are
  inert; `overall` still skews `fail`.
- **C — Pause the spike** per the §15.3 default and reassess scope later.

This file will be updated with the recorded decision once made.
