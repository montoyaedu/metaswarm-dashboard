# Design — Sessions Observability, v4 (Calibration-UI re-scope)

> Status: **draft, revised after design-review-gate round 1** (5/5
> NEEDS_REVISION — 12 blockers; the re-scope *direction* was affirmed by all
> five reviewers). Every blocker is addressed below, tagged `[gate-r1: …]`.
> Re-submitting to the gate.
> Supersedes the *scope* decisions of `design-sessions-spike.md` v3. v3's
> WU-1..WU-5 (built, committed on branch `sessions-spike`) stand and are the
> foundation. Author: executor, on operator direction (2026-05-17).

## 0. Why v4

v3's WU-4.5 calibration ran (2026-05-17, `docs/sessions-calibration.md`):
the automatic rubric scored `overall: fail` on **all 7 real sessions
surveyed** — no discriminating power — and 4 of 9 criteria failed the §9.4
agreement bar. Per design §15.3 this is a calibration kill. Root cause is not
a bug: judging whether a coding session followed good process is inherently
subjective; a fixed rule set cannot be the oracle. The operator's recorded
§15.3 decision (`docs/sessions-calibration.md` "Decision"): make the human
judgment a first-class product feature. This document is that design.

## 1. The model shift

| | v3 (failed) | v4 |
|---|---|---|
| Rubric role | the verdict | an **advisory suggestion** |
| Ground truth | a one-off 2-session calibration | the **operator's ratings**, collected continuously through the dashboard |
| Calibration | WU-4.5, done once | a **continuous feature** — rubric-vs-operator agreement accrues with use; §10 defines the loop that retires a criterion |
| Surface | CLI only; no web view | a **"Sessions" view** in the dashboard SPA |

The rubric still runs and still emits a per-KPI suggestion + evidence, but is
never trusted blind: the operator reviews a session, records their own
per-KPI verdict, and the dashboard tracks agreement. The product is useful
from day one (a session logbook — UC-3) even while the rubric is mediocre.

## 2. Use cases `[gate-r1: PM-B1]`

WHO is always the single operator running Claude Code across many repos.

### UC-1 — Rate a closed session (drives the rating survey)
- **WANTS:** after a Claude Code session on any repo closes, to record — per
  KPI — how they think it actually went (pass/watch/fail/na/unsure).
- **SO THAT:** their judgment is captured while memory is fresh and becomes
  ground truth that calibrates the rubric.
- **WHEN:** occasionally, after a session the operator cares about — not
  every session. The flow MUST tolerate partial ratings (rate 3 of 9 KPIs)
  and rare use. This is the primary use case.

### UC-2 — Review calibration and decide a criterion's fate (drives §5.4)
- **WANTS:** to see, per KPI, how often the rubric's suggestion agreed with
  their own ratings across all sessions rated so far.
- **SO THAT:** a criterion that systematically disagrees is identified and
  **retired** (§10), and a criterion that agrees is trusted more.
- **WHEN:** periodically once ≥5 sessions are rated (small-N agreement is
  noise — §5.4 enforces a sample-size floor).

### UC-3 — The session logbook (drives the Sessions list + timeline)
- **WANTS:** to see, across all repos, which Claude Code sessions ran when,
  how long, how big, and to open any one's event timeline.
- **SO THAT:** retrospective questions ("which repo had the most off-process
  sessions last week", "did I skip TDD on Tuesday") are answerable without
  re-reading raw JSONL — value that exists even if zero sessions are rated.
- **WHEN:** any time. This is the day-1 value and the kill-switch floor (§10).

Out of scope (deferred, follow-up beads in WU-G): cross-session aggregation,
PR linkage, multi-operator, auth, the v3 CLI verbs. `[gate-r1: PM-S3]`

## 3. Architecture

### 3.1 No new language, no new server
The write API **extends the existing `packages/server` (Fastify 5)**. Go was
floated and explicitly delegated to the executor; evaluated and rejected —
the monorepo is uniformly TypeScript with shared Zod types and one
vitest/coverage/eslint apparatus; a second language fragments all of it for a
handful of endpoints. Recorded: `STACK.md` Excluded table,
`.beads/knowledge/decisions.jsonl`.

### 3.2 Read-write, scoped strictly to the datalake
The dashboard's own data dir (`METASWARM_DASHBOARD_DATA_DIR`, the "datalake")
becomes **read-write**. Observed host repos stay **strictly read-only** — the
zero-footprint invariant is unchanged. Transcripts under `~/.claude/projects/`
(`METASWARM_DASHBOARD_TRANSCRIPTS_DIR`) are read-only inputs. The only new
write surface is operator ratings, into the datalake.

### 3.3 The server-side write guard — `method-guard.ts` re-scope `[gate-r1: ARCH-B1, SEC-B1]`
`packages/server/src/plugins/method-guard.ts` registers an `onRequest` hook
that **rejects every non-GET request on `/api/*` with 405** before any
handler runs — the load-bearing enforcement of the v3 read-only stance. v4
re-scopes it: the guard changes from "block all non-GET" to "block all
non-GET **except an explicit allow-list**". The allow-list contains exactly
one entry: `PUT /api/sessions/:project/:sessionId/rating`. The guard stays
installed first, stays defense-in-depth, and still 405s every other write.
WU-D owns this change and the matching updates to
`default-closures.test.ts` / `spa-edge-cases.test.ts`.

### 3.4 The SPA write guard — eslint `[gate-r1: ARCH/CTO suggestions]`
`eslint.config.js` bans the literals `POST`/`PUT`/`DELETE`/`PATCH` in
`packages/web/src`. v4 keeps the ban and adds **one** sanctioned write path:
a single typed API module `packages/web/src/lib/ratings-api.ts` is the only
file added to the rule's `ignores`. Stray write literals anywhere else still
trip the rule. WU-F owns this.

### 3.5 `packages/sessions` public surface + server dependency `[gate-r1: ARCH-B2]`
`packages/sessions/src/index.ts` is currently `export {}`. WU-C populates it
with the public re-exports (`parseTranscript`, `scoreTimeline`,
`discoverSessions`, `writeSessionRating`) and `packages/server/package.json`
gains `"@metaswarm-dashboard/sessions": "*"`. The dangling `./cli/audit`,
`./cli/timeline`, `./cli/tail` entries in `packages/sessions/package.json`
`exports` (dist files that do not exist — the CLI is deferred) are removed in
WU-A; only `.` remains.

### 3.6 Data flow
```
~/.claude/projects/<encoded-cwd>/<sid>.jsonl   (read-only input)
   │ discoverSessions → parseTranscript (WU-3) → scoreTimeline (WU-4)
   ▼
 Fastify server (packages/server)            datalake (METASWARM_DASHBOARD_DATA_DIR)
   GET  /api/sessions          ─ read ─►       <dataDir>/projects/<name>/sessions/
   GET  /api/sessions/:p/:s    ─ read ─►         <YYYY-MM-DD>/<sid>.rating.json
   GET  /api/calibration       ─ read ─►       (operator ratings — the only writes)
   PUT  /api/sessions/:p/:s/rating ─ write ─►  via writeSessionRating (atomic, contained)
   ▲
   │ HTTP (localhost)
 Vue SPA  /sessions  ·  /sessions/:project/:sessionId
```

## 4. Data — new schemas (additive to `@metaswarm-dashboard/types`)

New file `packages/types/src/ratings.ts`, re-exported from `index.ts`; a
matching `./ratings` entry is added to `packages/types/package.json`
`exports` (v3 learned this for `./fs-utils`/`./sessions` — do not regress).
No existing schema touched.

- **`OperatorVerdict`** — per (session, KPI): `key: RubricKey`,
  `verdict: z.enum(['pass','watch','fail','na','unsure'])`,
  `note: z.string().max(500).optional()`, `ratedAt` ISO-8601.
- **`SessionRating`** — `schemaVersion: 1`, `sessionId`, `projectName`,
  `verdicts: OperatorVerdict[]` (0..N — partial ratings allowed),
  `overallNote: z.string().max(2000).optional()`, `ratedAt`,
  `rubricAtRating: ProcessRubricScore`. **`rubricAtRating` is derived
  server-side**, not accepted from the client (§8) — it freezes the
  suggestion the operator saw, so agreement is honest.
- **`CalibrationSummary`** — derived (not stored): per `RubricKey`
  `{ agree, disagree, na, total }` + ratio, aggregated over all
  `SessionRating`s. `na`/`unsure` verdicts are **excluded from agree/disagree**
  and counted separately (a non-metaswarm session where rubric=`fail` and
  operator=`na` is neither agreement nor disagreement). `[gate-r1: PM-Q3]`

## 5. Rubric — advisory, with two pinned bug-fixes `[gate-r1: CTO-B1]`

The rubric stays as the suggestion engine. `overall` is **demoted to
informational** — computed and displayed, never a gate. The two systematic
flaws the calibration found are fixed with concrete, recorded thresholds
(every change lands in `.beads/knowledge/decisions.jsonl`, anti-goal §12.9):

| scorer | v3 rule (flawed) | v4 rule (pinned) |
|---|---|---|
| `error-handling` | a `tool-error` is "handled" only if events[i+1..i+2] is a Read/Grep tool-use or an `assistant-text` — a diagnostic `Bash` (`git status`, `ls`) scored as unhandled, so competent sessions failed | "handled" if **any** of events[i+1], events[i+2] is an `assistant-text`, `assistant-thinking`, a Read/Grep tool-use, **or** a `Bash` tool-use whose summary is **not byte-identical** to the errored call. "unhandled" only when the next event is a byte-identical retry of the failed call, or the session ends. Ratio handled/total: ≥0.8 pass · 0.5–0.8 watch · <0.5 fail · 0 errors na |
| `thrashing` | every adjacent same-file `<5s` Edit pair = an "episode" (1–3 watch, ≥4 fail) — fired on normal "edit section A then section B" | a **thrash run** = a maximal run of **≥3** `Edit` events to the same file, each `<5000ms` after the previous, with no `Read` of that file between consecutive edits of the run. Count runs: 0 pass · 1 watch · ≥2 fail |

The 7 other scorers are unchanged. `communication` and `workflow-touchpoints`
remain (they are *metaswarm-process* criteria — expected `na`/`fail` on
non-beads repos; the rating UI lets the operator answer `na`). The inert
`cross-reference`/`prompt-coherence` are kept as suggestions; §10 defines how
the operator data retires a criterion. The rubric is deliberately **not**
chased to perfection — operator ratings are the ground truth; the rubric only
needs to be a non-embarrassing hint.

## 6. UI / UX

### 6.1 Navigation `[gate-r1: DES-B1]`
`packages/web/src/App.vue` is today a bare `<RouterView/>` — `/agents` is
already URL-only-reachable. WU-E adds a top-level nav bar (naive-ui `NMenu`,
horizontal) linking **Projects · Agents · Sessions**, rendered in `App.vue`
above the `<RouterView/>`. This un-orphans `/agents` as a side effect.

### 6.2 Sessions list — `/sessions`
naive-ui `NDataTable`. Columns: project, started-at, duration, event count,
a short `<sid[:8]>` suffix (disambiguates same-minute sessions), and a
**rated/unrated** dot. The rubric suggestion is **not** shown in the list —
resolving Q3 toward anti-anchoring (§6.3): the operator should not see a
verdict before opening detail. `[gate-r1: PM-S1, DES suggestion]`
- Project filter: `[ all ▾ ]`.
- Empty: "No sessions found. Sessions appear once Claude Code has written a
  transcript for a configured project."
- Loading: skeleton rows. Error: the literal error + a Retry button.

### 6.3 Session detail + rating survey — `/sessions/:project/:sessionId`
`[gate-r1: DES-B2, DES-B3]`
```
 ◀ Sessions   metaswarm-dashboard · 2026-05-17 06:00 · 219 events   [● in progress]
 ───────────────────────────────────────────────────────────────────
  ▸ Timeline (219 events)        [expand — fixed-height scroll region]

  Rate this session — how do you think it went?     [ show all suggestions ]
  ┌─────────────────────────────────────────────────────────────────┐
  │ setup-discipline   (•)pass ( )watch ( )fail ( )na ( )unsure  +note│
  │                    [ show rubric suggestion ]                    │
  │ …9 KPI rows…                                                     │
  │ overall note: [______________________]                          │
  │                              save rating (4 of 9 rated)          │
  └─────────────────────────────────────────────────────────────────┘
```
- **States:** loading (timeline+rubric+rating fetch) → skeleton; error → literal
  error + Retry; `404` (no such transcript) → "This session's transcript was
  not found — it may have been deleted." A failed `PUT` (network / `400` /
  `413`) → an inline error banner; **the operator's entered verdicts are
  retained in component state, never discarded** — Retry re-submits.
- **Anchoring:** a KPI's rubric suggestion + evidence is hidden behind a
  per-row "show rubric suggestion" toggle; a header "show all suggestions"
  reveals them in bulk for an operator who wants a rubric-assisted pass. The
  anti-anchoring default (hidden) stays.
- **Already-rated session:** the survey rows are **pre-populated** with the
  saved `OperatorVerdict`s and remain editable; a re-`PUT` upserts. Each row
  shows the saved verdict vs `rubricAtRating` (agree/disagree) once a rating
  exists.
- **Partial rating:** an unselected row is omitted from `verdicts[]` (schema
  allows 0..N); the save button shows "N of 9 rated"; saving with any subset
  is valid.
- **Per-row notes** are revealed on demand ("+note"), keeping the 9-row
  survey scannable. `[gate-r1: DES-Q3]`
- **In-flight session:** a session whose transcript is still being appended
  is listable and ratable; the detail header shows an "● in progress" badge
  and the rubric is noted as computed on a partial timeline.

### 6.4 Calibration summary — panel on `/sessions`
Per `RubricKey`: an agreement bar (`agree / (agree+disagree)`), the sample
count `N`, and the `na`/`unsure` count. A KPI with `N < 5` is shown greyed
("not enough ratings yet" — small-N agreement is noise). A KPI below an
agreement floor (default 60%, `N ≥ 5`) is flagged "consider retiring".
Empty (no ratings): "Rate sessions to start calibrating." Loading/error as
elsewhere. `[gate-r1: DES-B2, DES-S "actionability"]`

## 7. API contract (extends `packages/server`)

All endpoints localhost-only (Fastify bound `127.0.0.1`). Session discovery
is a **live scan** of `TRANSCRIPTS_DIR` each request; parse+score results are
held in an **mtime+size-keyed** per-transcript cache (bounded, max 256
entries, LRU) — no time-based cache, so it is deterministically testable and
never serves stale `eventCount` for an in-flight session. `[gate-r1: ARCH/CTO Q]`

- `GET /api/sessions?project=<name>` → `200 {sessions: SessionSummary[]}`.
  `SessionSummary` = sessionId, project, startedAt, lastEventAt, eventCount,
  `rated: boolean`. (No rubric verdict — §6.2.) `400` malformed `project`.
- `GET /api/sessions/:project/:sessionId` → `200 {timeline, rubric, rating}`
  (`rating: SessionRating | null`). `400` invalid params, `404` no transcript.
- `GET /api/calibration` → `200 {summary: CalibrationSummary}`.
- `PUT /api/sessions/:project/:sessionId/rating` — request body
  `{verdicts: OperatorVerdict[], overallNote?: string}` **only** (the server
  derives `rubricAtRating`, `ratedAt`, `sessionId`, `projectName`). `200`
  returns the **persisted `SessionRating`** (so the SPA updates agreement
  without a refetch — `[gate-r1: DES-S]`). `400` Zod-invalid / sanitization
  reject, `413` over body cap, `415` wrong Content-Type.

`:project` is a **config.yaml project name** (resolved via the same config
loader the v3 collector uses → the project's filesystem path → encoded-cwd →
the transcript dir). `:sessionId` is the `.jsonl` basename. `[gate-r1: ARCH-Q]`

## 8. Security `[gate-r1: SEC-B2, SEC-B3]`

### 8.1 Write-endpoint request contract (CSRF) `[SEC-B2]`
A no-auth localhost `PUT` is reachable by any browser tab. v4 requires, on
the write route: (a) `Content-Type: application/json` — anything else → `415`
(a non-simple content type forces a CORS preflight a malicious page cannot
satisfy); (b) a same-origin check — reject unless `Sec-Fetch-Site: same-origin`
(or, absent that header, an `Origin` matching the server's own); (c) **no
`@fastify/cors`** is registered — the default (no CORS headers) is kept, so
cross-origin reads/writes fail. (a)+(b)+(c) together close the browser-tab
CSRF/exfiltration vector. A concrete `bodyLimit` of **64 KB** is set on the
write route (a `SessionRating` is well under that); a test asserts an
over-cap body → `413`.

### 8.2 Read-path traversal hardening `[SEC-B3]`
`transcript-discovery.ts` is **new** (v3 §5.1 planned it; never built). The
`:project` and `:sessionId` params on every GET endpoint **and** in discovery
go through: `^[A-Za-z0-9._-]+$` allow-list + explicit `..`-segment rejection;
`lstat` only (symlinks pointing outside `TRANSCRIPTS_DIR` are refused, no
follow); realpath containment under `TRANSCRIPTS_DIR`. WU-5's writer.ts
sanitizer covers the **datalake write** path; discovery gets its **own**
sanitizer for the **transcript read** path (or a shared one lifted to
`@metaswarm-dashboard/types/fs-utils`). The encoded-cwd → dir mapping is
itself validated (the encoded name must resolve, via realpath, to a child of
`TRANSCRIPTS_DIR`).

### 8.3 Threat model summary
- **High → mitigated:** browser-tab CSRF/exfiltration (§8.1); server-side
  write guard bypass (§3.3 — re-scoped, not removed); read-path traversal
  (§8.2).
- **Medium → mitigated:** body-size abuse (64 KB cap); unbounded cache (LRU
  256); a client substituting `rubricAtRating` (server **re-derives** it,
  §4/§7 — the client body cannot inject content into the persisted rubric).
- **Acknowledged:** transcript content (operator secrets) now crosses into
  the browser over the localhost API. It never leaves the machine — no
  CORS, no telemetry, no external fetch. Ratings/notes live only in the
  datalake. The WU-1 secret-scan CI-grep continues to walk the repo
  (incl. new `ratings.ts` + server route files). The v3 §11.5
  `dataDir`-inside-git footgun check is applied to rating writes too.
- No auth: documented and accepted for a single-operator localhost tool —
  consistent with the v3 MVP. If a shared/hosted mode is ever envisioned,
  this decision must be revisited (it is MVP-only).

## 9. Work units (shape — full decomposition + the plan-review gate follow)

v3 WU-1..WU-5: **done.** v3 WU-4.5: **closed as superseded** (recorded in
`docs/sessions-calibration.md`). v3 WU-6..WU-8: superseded by:

- **A — rubric → advisory + bug-fixes** (`packages/sessions/src/rubric`,
  `packages/sessions/package.json`): §5; remove dangling `./cli/*` exports.
- **B — rating schemas** (`packages/types`): §4.
- **C — session discovery + server read API**: new
  `packages/sessions/src/transcript-discovery.ts` (own WU-3-sized edge-case
  test list); populate `packages/sessions/src/index.ts`; the three `GET`
  endpoints; the mtime cache.
- **D — server write API**: `PUT .../rating`; `writeSessionRating` (a sibling
  of WU-5's writer reusing `sanitizeSegment`/`assertPathWithinRoot`/
  `atomicWriteJson`); the `method-guard.ts` re-scope (§3.3); §8.1 contract.
- **E — SPA Sessions list + detail/timeline + nav bar** (§6.1, §6.2, §6.3
  read side).
- **F — SPA rating survey + calibration summary + eslint write-guard
  re-scope** (§6.3 write side, §6.4, §3.4).
- **G — integration test + docs + follow-ups**: an end-to-end test that the
  SPA saves a rating and the server persists it to the datalake; README +
  `docs/follow-ups/sessions.md`; open follow-up beads (the v3 CLI verbs incl.
  `tail`, cross-session aggregation); the §10 usage-check bead.

This §9 is the **shape**. After this design passes the gate it is expanded
into a full implementation plan (per-WU DoD, file scope, dependency graph,
test specs) that goes through the **plan-review gate** before execution.
`[gate-r1: CTO-Q]`

## 10. The calibration loop — success criterion + 2-week usage check `[gate-r1: PM-B2, PM-B3]`

The honest risk: the operator never rates, the rubric goes decorative. v4
closes the loop with a measurable post-merge check (a bead opened in WU-G,
2-week deadline), reframed from v3 §15.2 for the rating UI:

- **M1 — the rating habit:** the operator records a `SessionRating` for
  **≥5 sessions** across **≥2 repos** in the 2-week window.
- **M2 — behavioural impact:** **≥2 distinct behavioural changes** (stopped
  a session, re-ran a WU, opened a corrective bead, adjusted scope) traceable
  to a Sessions-view review, each recorded in a bead or `.agents/notes.md`.
- **M3 — the loop closes:** the operator reviews the calibration summary at
  least once **and** ≥1 systematically-disagreeing criterion (`N ≥ 5`, below
  the 60% floor) is **retired** — or, if none qualifies, the operator records
  "rubric reviewed, all criteria retained". The loop must *resolve*, not run
  inert forever. This is the success criterion that distinguishes continuous
  calibration from an abandoned rubric.

**Kill switch:** if **M1** is missed (≈zero ratings in 2 weeks) the
continuous-calibration model has failed — the rubric is decorative. The
follow-up beads are cancelled; the dashboard keeps only UC-3 (the logbook +
timeline viewer, which delivers value with zero ratings) and the rubric is
either cut or left as a silent hint. If M2 or M3 is missed → follow-ups
deferred, reassess. Recorded in `docs/follow-ups/sessions.md`.

## 11. Definition of done (measurable)

- WUs A–G complete; `npm run build/typecheck/test/lint` green; coverage meets
  `.coverage-thresholds.json` (currently green — bead `0nt`).
- The SPA "Sessions" view is reachable from the nav bar, lists sessions,
  shows a timeline, and saves a per-KPI rating; ratings persist in the
  datalake and survive a reload (WU-G integration test proves it).
- The calibration summary reflects saved ratings with the `N ≥ 5` floor.
- Re-rating a session pre-populates and upserts; a failed `PUT` retains the
  operator's input.
- `method-guard.ts` allows exactly the one write route and 405s all others
  (tested); the eslint write-guard still trips on stray write literals.
- Host repos are provably untouched; §8.1/§8.2 controls are tested.
- The §10 usage-check bead is open with its 2-week deadline and the M1/M2/M3
  targets + kill switch written into it.
- README + `docs/follow-ups/sessions.md` updated; STACK.md + decisions.jsonl
  reflect the v4 stack/threshold changes.

## 12. v3 → v4 carryover

Carried over and final: WU-1..WU-5 (package skeleton, `@metaswarm-dashboard/
types/sessions` schemas, `jsonl-reader.ts`, the 9 rubric scorers, `writer.ts`),
the `atomicWriteJson` lift, the WU-1 fixture/secret guards, the coverage-debt
fix (`0nt`). Superseded: v3's CLI-only scope, "no web view", the one-off
WU-4.5. Deferred to follow-up beads (opened in WU-G), not dropped: the v3 CLI
verbs `audit`/`timeline`/`tail` (`tail`/UC-2 explicitly parked, not killed),
cross-session aggregation, the secret-pattern redactor.

## 13. Resolved questions (v4 round-1 open questions, now decided)

- Rating storage: one `<sid>.rating.json` per session under
  `<dataDir>/projects/<name>/sessions/<YYYY-MM-DD>/` — mirrors the snapshot
  layout.
- Discovery: live scan per request + an mtime+size-keyed bounded LRU
  parse/score cache (§7).
- `unsure` is a distinct verdict — "I looked and can't tell" is a real
  signal, kept separate from "unrated".
- The sessions list does **not** show the rubric verdict (anti-anchoring,
  §6.2); detail gates it per-row (§6.3).
- `:project` = config.yaml project name (§7).
