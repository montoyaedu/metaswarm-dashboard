# Sessions feature — deferred follow-ups

Deferred (not dropped) work from the sessions-spike v4 effort. Each item is a
candidate for a follow-up bead. Sources: design `docs/design-sessions-spike-v4.md`
§12 (v3 → v4 carryover), §2 (out-of-scope), §10 (post-merge usage check), plus
items that surfaced during v4 execution. The orchestrator opens beads from this
list.

## Deferred features

### v3 CLI verbs — `audit` / `timeline` / `tail`

The v3 design carried three CLI verbs that v4's web-view re-scope superseded.
They are **deferred, not killed** (design §12):

- **`audit`** — a one-shot CLI rubric scoring of a session. Superseded by the
  `/sessions` detail view's advisory rubric, but a scriptable CLI form may
  still be wanted.
- **`timeline`** — a CLI dump of a session's event timeline. Superseded by the
  `/sessions` detail+timeline view.
- **`tail`** — live-follow a running session. **Explicitly parked, not killed**
  (design §12): UC-2's live use case was deferred, but the verb remains a
  legitimate future addition if a real need appears.

### Cross-session aggregation / rubric-score-over-time

A view that aggregates rubric scores or operator ratings *across* sessions —
e.g. a per-KPI score trend over time, or "which repo had the most off-process
sessions last week". Out of scope for v4 (design §2 lists cross-session
aggregation as deferred); the v4 calibration summary is the only cross-session
roll-up shipped.

### Secret-pattern redactor for `summary` content

Transcript `summary` text is surfaced verbatim in the timeline view. A
secret-pattern redactor (API keys, tokens, credentials) over that content was
deferred (design §12). Until it lands, the timeline shows transcript text
as-is — acceptable for a single-operator localhost tool, but a hardening gap.

## Post-merge obligations

### 2-week usage check — M1 / M2 / M3 + kill switch (design §10)

A **tracked obligation**, not optional: a bead with a 2-week post-merge
deadline carrying design §10's success criterion verbatim —

- **M1 (rating habit):** the operator records a `SessionRating` for **≥5
  sessions** across **≥2 repos** in the 2-week window.
- **M2 (behavioural impact):** **≥2 distinct behavioural changes** (stopped a
  session, re-ran a WU, opened a corrective bead, adjusted scope) traceable to
  a Sessions-view review, each recorded in a bead or `.agents/notes.md`.
- **M3 (the loop closes):** the operator reviews the calibration summary at
  least once **and** ≥1 systematically-disagreeing criterion (`N ≥ 5`, below
  the 60% floor) is retired — or, if none qualifies, records "rubric reviewed,
  all criteria retained".
- **Kill switch:** if **M1** is missed (≈zero ratings in 2 weeks) the
  continuous-calibration model has failed — the rubric is decorative. Cancel
  the follow-up beads; the dashboard keeps only the logbook + timeline viewer
  (which delivers value with zero ratings). If M2 or M3 is missed → follow-ups
  deferred, reassess.

### Recurring calibration once ≥5 sessions are rated

After the 2-week usage window, calibration review should recur periodically —
the calibration summary becomes meaningful only once **≥5 sessions** are rated
(design §6.4 / §10 enforce the sample-size floor; small-N agreement is noise).
A recurring "review calibration" reminder/bead, gated on the rated-session
count crossing 5, is the natural follow-up.

## Hardening surfaced during v4 execution

### `dataDir`-inside-git is warn-only

The write path runs an advisory `warnIfDataDirInGit` check and logs a warning
if the datalake sits inside a git repo, but **still proceeds with the write**.
A future hardening could **refuse** the write outright (or require an explicit
opt-in) rather than only warning — the warn-only posture means a misconfigured
datalake can silently land rating files inside a tracked repo.

### Re-introduce `scope-drift` detection

A `scope-drift` rubric criterion (does a session's edits stay within the active
bead's declared file scope?) was left out of v4 because `bd show --json` does
not yet expose the active bead's file-scope field. Once BEADS surfaces that
field, `scope-drift` can be re-introduced as a 10th rubric KPI.
