# Design — Sessions Observability, v4 (Calibration-UI re-scope)

> Status: **draft — heading to the design-review gate.**
> Supersedes the *scope* decisions of `design-sessions-spike.md` v3. v3's
> WU-1..WU-5 (built, committed on branch `sessions-spike`) stand and are the
> foundation of v4. Author: executor, on operator direction (2026-05-17).

## 0. Why v4

v3's WU-4.5 calibration ran on 2026-05-17 (`docs/sessions-calibration.md`).
Outcome: the automatic rubric **scored `overall: fail` on all 7 real
sessions surveyed** — no discriminating power — and 4 of 9 criteria failed
the §9.4 agreement bar. Per design §15.3 this is a calibration kill.

Root cause is not a bug to patch away: **judging whether a coding session
followed good process is inherently subjective.** A fixed rule set cannot be
the oracle. The operator's response (the right one): make the human judgment
a first-class product feature instead of a one-off gate.

## 1. The model shift

| | v3 (failed) | v4 |
|---|---|---|
| Rubric role | the verdict | an **advisory suggestion** |
| Ground truth | a one-off 2-session calibration | the **operator's ratings**, collected continuously through the dashboard |
| Calibration | WU-4.5, done once | a **continuous feature** — agreement (rubric vs operator) accrues with use |
| Surface | CLI only; no web view | a **"Sessions" view** in the dashboard SPA |

The rubric still runs and still produces a per-KPI suggestion + evidence —
but it is never trusted blind. The operator reviews a session, records their
own per-KPI verdict, and the dashboard tracks how often the rubric agreed.
Criteria that systematically disagree are surfaced and dropped. The product
is useful from day one (a session logbook + structured self-review) even
while the rubric is still mediocre.

## 2. Architecture

### 2.1 No new language, no new server
The write API is an **extension of the existing `packages/server` (Fastify
5)**. Go was floated and explicitly delegated to the executor; evaluated and
rejected — the monorepo is uniformly TypeScript with shared Zod types
(`@metaswarm-dashboard/types`) and one vitest/coverage/eslint apparatus; a
second language fragments all of that for a handful of endpoints. Recorded in
`STACK.md` (Excluded table) and `.beads/knowledge/decisions.jsonl`.

### 2.2 Read-write — scoped strictly to the datalake
The dashboard's own data directory (`METASWARM_DASHBOARD_DATA_DIR`, the
"datalake") becomes **read-write**. Observed host repos remain **strictly
read-only** — the zero-footprint-on-host-repos invariant is unchanged.
Transcripts under `~/.claude/projects/` are read-only inputs (parsed, never
written). The only new write surface is operator ratings + snapshots, into
the datalake, via the lifted atomic writer (`@metaswarm-dashboard/types/
fs-utils` `atomicWriteJson`, already path-sanitized + realpath-contained in
WU-5).

### 2.3 Data flow
```
~/.claude/projects/<cwd>/<sid>.jsonl   (read-only)
        │  parseTranscript (WU-3)
        ▼
   SessionTimeline ──► scoreTimeline (WU-4) ──► ProcessRubricScore  [suggestion]
        │                                              │
        └──────────────► Fastify server ◄──────────────┘
                          │  GET  /api/sessions...     (read)
                          │  PUT  .../rating           (write → datalake)
                          ▼
                       Vue SPA "Sessions" view  ──►  operator rates
                          │
                          ▼  PUT
                  <dataDir>/projects/<name>/sessions/<day>/<sid>.rating.json
```

### 2.4 The SPA write-guard
v3's MVP enforced a read-only SPA via an eslint `no-restricted-syntax` rule
banning `POST`/`PUT`/`DELETE` literals in `packages/web/src`. v4 **re-scopes**
(does not delete) this guard: the SPA may issue writes, but only to the
dashboard's own API. The rating module is the sanctioned write path; the
guard is narrowed to still catch stray write-method literals elsewhere. The
exact mechanism is a WU decision; the intent — "the SPA never drives a write
to a host repo" — is preserved.

## 3. Data — new schemas (additive to `@metaswarm-dashboard/types`)

A new file `packages/types/src/ratings.ts`, re-exported; no existing schema
touched.

- **`OperatorVerdict`** — per (session, KPI): `key: RubricKey`,
  `verdict: z.enum(['pass','watch','fail','na','unsure'])` (note the new
  `unsure`), `note: z.string().max(500).optional()`, `ratedAt` ISO-8601.
- **`SessionRating`** — `schemaVersion: 1`, `sessionId`, `projectName`,
  `verdicts: OperatorVerdict[]` (0..N — the operator may rate a subset),
  `overallNote: z.string().max(2000).optional()`, `ratedAt`,
  `rubricAtRating: ProcessRubricScore` (the suggestion frozen at rating
  time, so agreement is computed against what the operator actually saw).
- **`CalibrationSummary`** — derived, not stored: per `RubricKey`,
  `{ agree, disagree, total }` counts plus the agreement ratio, aggregated
  across all `SessionRating`s.

## 4. Rubric — demoted to advisory, plus the 2 calibration bug-fixes

The rubric stays as the suggestion engine. Changes:
1. **`error-handling`** — also count a diagnostic `Bash` (`git status`,
   `pwd`, `ls`, grep-via-bash) as a corrective response, and treat
   non-zero-exit errors surfaced as `tool-result` text as errors. The
   calibration showed a session that handled every error well scoring
   `fail` purely because the scorer only looked for `Read`/`Grep`.
2. **`thrashing`** — stop flagging normal multi-edit. Raise the episode bar
   (e.g. ≥3 consecutive same-file edits, or same text-region) so "edit
   section A then section B" is not thrashing.
3. **`overall`** — demoted to *informational*; it is no longer a gate. The
   per-KPI verdicts (and the operator's ratings) are what matter.
4. The beads-centric criteria (`communication`, `workflow-touchpoints`) stay
   but are explicitly labelled "metaswarm-process criteria — expect `na` on
   non-metaswarm sessions"; the rating UI lets the operator pick `na`/`unsure`.

Every threshold/logic change is recorded in `.beads/knowledge/decisions.jsonl`
(anti-goal §12.9). We deliberately do **not** chase a perfect rubric — the
operator ratings are the ground truth; the rubric only needs to be a
non-embarrassing starting hint.

## 5. UI / UX — the "Sessions" view

New SPA route `/sessions` (and `/sessions/:project/:sessionId`).

### 5.1 Sessions list
```
 Sessions                                   project: [ all ▾ ]
 ────────────────────────────────────────────────────────────
  metaswarm-dashboard   2026-05-17 06:00  219 ev   suggest: fail   ● rated
  eleven/pos-monitoring 2026-05-15 12:48  107 ev   suggest: fail   ○ unrated
  …
```
Empty state: "No sessions found for <project>. Sessions appear once Claude
Code has written a transcript." Loading: skeleton rows. Error: the literal
error + a retry.

### 5.2 Session detail + rating survey
```
 ◀ Sessions   metaswarm-dashboard · 2026-05-17 06:00 · 219 events
 ────────────────────────────────────────────────────────────
  ▸ Timeline (219 events)                              [expand]

  Rate this session — how do you think it went?
  ┌──────────────────────────────────────────────────────────┐
  │ setup-discipline   ( ) pass ( ) watch ( ) fail ( ) na     │
  │                    ( ) unsure        note: [__________]   │
  │                    [ show rubric suggestion ]             │
  │ planning           …                                     │
  │  … 9 KPI rows …                                           │
  │ overall note: [____________________________]             │
  │                                   [ save rating ]        │
  └──────────────────────────────────────────────────────────┘
```
**Anchoring control:** the rubric's suggestion + evidence for a KPI is hidden
behind a per-row "show rubric suggestion" toggle, so the operator can record
their own recall first. After saving, the row shows agree/disagree vs the
rubric. The timeline is collapsed by default (jog-memory aid).

### 5.3 Calibration summary
A panel: per-KPI agreement bar (rubric vs operator, N sessions), so the
operator sees which criteria are pulling their weight and which to retire.

## 6. API contract (extends `packages/server`)

All endpoints localhost-only, no auth (single-operator, consistent with the
MVP — Security review to confirm acceptability).

- `GET /api/sessions?project=<name>` → `200` `{ sessions: SessionSummary[] }`.
  `SessionSummary` = id, project, span, eventCount, rubric `overall`, `rated`
  boolean. `400` on a malformed `project`.
- `GET /api/sessions/:project/:sessionId` → `200`
  `{ timeline: SessionTimeline, rubric: ProcessRubricScore, rating: SessionRating | null }`.
  `400` invalid params, `404` no such transcript.
- `GET /api/calibration` → `200` `{ summary: CalibrationSummary }`.
- `PUT /api/sessions/:project/:sessionId/rating` — body `SessionRating`
  (minus server-derived fields). `200` on upsert. `400` Zod-invalid body or
  params. Body size cap. Atomic write to the datalake.

## 7. Security

- Trust boundary: the `PUT .../rating` body and all `:project`/`:sessionId`
  path params. Zod-validate the body; sanitize params with WU-5's
  `^[A-Za-z0-9._-]+$` + `..` rejection; reuse WU-5's realpath containment.
- Body size limit on the write endpoint.
- Server bound to `127.0.0.1`; no auth — documented, single-operator.
- Ratings + notes may quote transcript content (operator secrets) — they
  live only in the local datalake, never transmitted. The existing
  secret-pattern CI-grep test (WU-1) keeps scanning the repo.

## 8. Work units (shape — detailed decomposition follows the design gate)

v3 WU-1..WU-5: **done.** v3 WU-4.5: **closed as superseded** by §1 (the
continuous rating UI replaces the one-off calibration; the run is recorded
in `docs/sessions-calibration.md`). v3 WU-6..WU-8 superseded by:

- **A — rubric → advisory + bug-fixes** (`packages/sessions/src/rubric`): §4.
- **B — rating schemas** (`packages/types/src/ratings.ts`): §3.
- **C — server read API** (`packages/server`): session discovery + the three
  `GET` endpoints, wiring `parseTranscript` + `scoreTimeline`.
- **D — server write API**: `PUT .../rating` + the datalake rating writer.
- **E — SPA Sessions view**: list + session detail + timeline.
- **F — SPA rating survey + calibration summary**: §5.2/§5.3; re-scope the
  write-guard lint rule (§2.4).
- **G — docs, follow-ups, the reframed 2-week usage check** (M1/M2/M3 redone
  for the rating UI).
- The v3 CLI (`audit`/`timeline`/`tail`) is **deferred to a follow-up** — the
  web view is v4's surface; `tail` (terminal monitoring, v3 UC-2) may return
  as a small follow-up.

## 9. Definition of done

- WUs A–G complete; `npm run build/typecheck/test/lint` green; coverage meets
  `.coverage-thresholds.json` (already green — bead `0nt`).
- The SPA "Sessions" view lists sessions, shows a timeline, and saves a
  per-KPI rating; ratings persist in the datalake and survive a reload.
- The calibration summary reflects saved ratings.
- Host repos are provably untouched; the SPA write-guard still blocks stray
  write literals.
- README + `docs/follow-ups/sessions.md` updated; STACK.md + decisions.jsonl
  reflect the v4 stack changes.

## 10. Open questions for the gate

- Q1: rating storage — one `*.rating.json` per session (proposed) vs a single
  per-project ratings file. Proposed: per-session, mirrors the snapshot layout.
- Q2: session discovery — does the server scan `~/.claude/projects/` live on
  each request, or cache? Proposed: live scan + short in-process cache.
- Q3: should an unrated session still show the rubric suggestion in the list,
  or only inside detail (anti-anchoring)? Proposed: list shows it (low-stakes);
  detail gates it per §5.2.
- Q4: keep `unsure` as a distinct verdict vs treat it as "skip/unrated"?
  Proposed: distinct — "I looked and can't tell" is a real, useful signal.
