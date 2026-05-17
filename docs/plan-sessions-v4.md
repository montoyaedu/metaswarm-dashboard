# Implementation Plan — Sessions Observability v4

> Status: **draft — heading to the plan-review gate.**
> Source of truth: `docs/design-sessions-spike-v4.md` (design-review gate
> APPROVED 5/5, 2026-05-17). This plan decomposes design v4 §9 (WU-A..G) into
> executable work units. It does **not** restate the design — the API
> contract (design §7), schemas (§4), UI (§6) and security model (§8) live
> there and are referenced by section.

## 1. Overview

v4 builds the dashboard "Sessions" feature on top of the committed v3
WU-1..WU-5 (parser, schemas, 9 rubric scorers, snapshot writer). The rubric
becomes an advisory suggestion; a Vue "Sessions" view + a Fastify write API
let the operator rate sessions; ratings persist in the datalake.

**9 work units.** Dependency DAG:

```
v4-1 (rating schemas) ─┐
v4-2 (shared lifts) ───┼─► v4-4 (discovery) ─► v4-5 (read API) ─┬─► v4-7 (SPA list/detail) ─┐
v4-3 (rubric advisory)─┘                              │         │                          ├─► v4-8 (rating UI) ─► v4-9 (integration+docs)
                                                      └────────────► v4-6 (write API) ──────┘
```
v4-1, v4-2, v4-3 are independent (parallelizable). v4-4←v4-2. v4-5←v4-1,3,4.
v4-6←v4-1,5. v4-7←v4-5. v4-8←v4-6,7. v4-9←all.

Each WU is executed via the metaswarm 4-phase orchestrated loop (IMPLEMENT →
VALIDATE → ADVERSARIAL REVIEW → COMMIT). TDD is mandatory. `.coverage-
thresholds.json` (currently green) must stay green per WU on a no-regression
basis; each WU's own new files meet the thresholds.

## 2. Work units

Format per WU: **spec** (design ref) · **file scope** · **DoD** · **deps**.

### v4-1 — Rating schemas
- **spec:** design §4 — `packages/types/src/ratings.ts` with `OperatorVerdict`,
  `SessionRating`, `CalibrationSummary`. `verdicts` is `.max(9)` + a no-
  duplicate-`key` refinement; `verdict` enum includes `unsure`;
  `rubricAtRating` embeds `ProcessRubricScore`.
- **file scope:** `packages/types/src/ratings.ts` (new),
  `packages/types/src/__tests__/ratings.test.ts` (new),
  `packages/types/src/index.ts`, `packages/types/package.json` (add
  `./ratings` exports entry).
- **DoD:** round-trip `safeParse` tests per schema incl. the `.max(9)` + dedup
  + `unsure`; build/typecheck/test/lint green; `ratings.ts` 100% covered.
- **deps:** none.

### v4-2 — Shared lifts (config loader + transcriptsDir)
- **spec:** design §3.5. Lift `loadConfig` + `Config`/`ProjectEntry` (and any
  helper types) from `packages/collector/src/config.ts` to a new
  `packages/types/src/config.ts`; `packages/types/package.json` gains a
  `./config` exports entry and the `js-yaml` dep; `packages/collector/src/
  config.ts` re-imports + re-exports from `@metaswarm-dashboard/types/config`
  for back-compat (the WU-1 `fs-utils` pattern). Add `transcriptsDir(env)` to
  `packages/types/src/paths.ts` (default `~/.claude/projects`,
  `METASWARM_DASHBOARD_TRANSCRIPTS_DIR` override). **Decision:** `config` is
  exposed subpath-only (`./config`), parallel to `paths` — not added to the
  `index.ts` barrel `[gate-r3: ARCH suggestion]`.
- **file scope:** `packages/types/src/config.ts` (new), `paths.ts`,
  `index.ts`, `package.json`; `packages/collector/src/config.ts`; new
  `packages/types/src/__tests__/config.test.ts`, `paths.test.ts` (extend).
- **DoD:** ALL existing collector tests pass **unchanged**; `transcriptsDir`
  tested (default + override); build/typecheck/test/lint green; no behaviour
  change in collector.
- **deps:** none.

### v4-3 — Rubric → advisory + the two bug-fixes
- **spec:** design §5. Rewrite `error-handling.ts` to the single
  complementary handled/unhandled definition over `(toolName, summary)`;
  rewrite `thrashing.ts` to the ≥3-edit-run rule. `overall` stays computed
  but is informational (code comment; no gating). Remove the dangling
  `./cli/{audit,timeline,tail}` entries from `packages/sessions/package.json`
  `exports`. Record both threshold changes in `.beads/knowledge/
  decisions.jsonl`. Re-freeze `synthetic-rubric.expected.json` (the rule
  changes shift the synthetic fixture's verdicts).
- **file scope:** `packages/sessions/src/rubric/error-handling.ts`,
  `thrashing.ts`, (`index.ts` comment); their tests under
  `__tests__/rubric/`; `packages/sessions/src/__tests__/fixtures/
  synthetic-rubric.expected.json`; `packages/sessions/package.json`;
  `.beads/knowledge/decisions.jsonl`.
- **DoD:** every verdict branch of both rewritten scorers covered, incl. a
  fixture for the `summary`-truncation edge case `[gate-r3: CTO suggestion]`;
  rubric files 100%; collector/web unaffected; build/typecheck/test/lint green.
- **deps:** none.

### v4-4 — Transcript discovery
- **spec:** design §3.6, §8.2. New `packages/sessions/src/transcript-
  discovery.ts` exporting `discoverSessions(env, fs?) → SessionSummary[]` —
  fs-injectable. Reverse-engineer + **pin Claude Code's cwd→dirname encoding**
  with a test against the known real dir names. Path safety per §8.2:
  `^[A-Za-z0-9._-]+$` allow-list, `..`-reject, `lstat`-only, realpath
  containment under `TRANSCRIPTS_DIR`; failures surface as the caller's 404.
  Populate `packages/sessions/src/index.ts` with the public re-exports
  (`parseTranscript`, `scoreTimeline`, `discoverSessions`).
- **file scope:** `packages/sessions/src/transcript-discovery.ts` (new),
  `index.ts`, new `__tests__/transcript-discovery.test.ts`.
- **DoD:** edge-case test list (missing dir, symlink-pointing-out refusal,
  traversal attempts, the encoding, empty/absent, non-`.jsonl` ignored);
  discovery 100% covered (fs-injected); **after this WU
  `packages/sessions/src/index.ts` exports exactly `parseTranscript`,
  `scoreTimeline`, `discoverSessions` — re-exporting the v3-built
  `jsonl-reader.ts` and `rubric/index.ts` modules, not only the new
  `transcript-discovery.ts` — with a test asserting that export set**
  (v4-6 later adds `writeSessionRating`); build/typecheck/test/lint green.
- **deps:** v4-2.

### v4-5 — Server read API
- **spec:** design §7 — three `GET` endpoints in `packages/server`
  (`/api/sessions`, `/api/sessions/:project/:sessionId`, `/api/calibration`),
  wiring `discoverSessions`+`parseTranscript`+`scoreTimeline`+config
  resolution. The mtime+size-keyed bounded-LRU parse/score cache (key
  `(realpath, mtimeMs, size)`). `:project`/`:sessionId` sanitized; failures →
  `404`. The server resolves `:project` through
  `@metaswarm-dashboard/types/config` (the v4-2 lifted loader).
  `packages/server/package.json` gains `@metaswarm-dashboard/sessions` as a
  workspace dep; cross-package resolution is npm-workspaces +
  `moduleResolution:Bundler` via the `exports` maps — this repo has no
  tsconfig project references and none are added.
- **file scope:** `packages/server/src/` (route module(s), the cache,
  registration in `server.ts`), `packages/server/package.json`; tests.
- **DoD:** endpoint tests via Fastify `app.inject` covering **all three**
  GET endpoints — `/api/sessions` + `/api/sessions/:project/:sessionId`
  (success, `400` malformed-project, `404`, the cache, traversal rejection),
  AND `/api/calibration` (success shape `{summary: CalibrationSummary}`; the
  **no-ratings** empty state; `na`/`unsure` verdicts excluded from
  agree/disagree and counted separately; the `N≥5` per-KPI sample floor —
  all derived server-side). The config loader is consumed via
  `@metaswarm-dashboard/types/config` — a grep confirms **no** deep-import of
  `@metaswarm-dashboard/collector` internals (anti-goal §12.10); coverage met
  (the live scan is fs-injected for tests); build/typecheck/test/lint green.
- **deps:** v4-1, v4-3, v4-4.

### v4-6 — Server write API  **[HUMAN CHECKPOINT]**
- **spec:** design §7, §8.1, §3.3. `PUT /api/sessions/:project/:sessionId/
  rating` — body `{verdicts, overallNote?}` only; the server **re-derives**
  `rubricAtRating`. New `writeSessionRating(rating, dataDir, fs?)` (a sibling
  of WU-5's writer reusing `sanitizeSegment`/`assertPathWithinRoot`/
  `atomicWriteJson`). The rating file is **day-independent** —
  `<dataDir>/projects/<name>/sessions/ratings/<sessionId>.rating.json`, keyed
  by `(project, sessionId)` only — so a re-rate **upserts (overwrites)** the
  single file. (This corrects design §13's day-keyed `<YYYY-MM-DD>/` path: a
  snapshot is a point-in-time artifact, but a rating is mutable operator
  state and must not be day-bucketed, else a cross-day re-rate would leave
  two files for one session.) Re-scope `packages/server/src/plugins/method-guard.ts`:
  it continues to allow `GET` and `HEAD` (the existing pass-through MUST be
  preserved) and now also allows exactly the one write route via an
  exact-match allow-list — rejecting extra segments, query strings, trailing
  slash and case variants `[gate-r3: SEC suggestion]`; every other
  method/route still 405s. §8.1 contract: `Content-Type: application/json`
  (else `415`), same-origin check **fail-closed**, 64 KB `bodyLimit` (`413`),
  no `@fastify/cors`. dataDir-inside-git warning applied to rating writes.
- **file scope:** `packages/server/src/` (write route, `method-guard.ts`),
  `packages/sessions/src/writer.ts` (+`writeSessionRating`) & `index.ts`;
  tests — method-guard updates land in **both** `server.test.ts` and
  `spa-edge-cases.test.ts` (both carry the existing 405 assertions that the
  re-scope changes).
- **DoD:** PUT happy/upsert; method-guard still allows `GET` + `HEAD`, now
  also the one `PUT` route, and 405s everything else — the `HEAD`
  pass-through is preserved (tested) and the exact-match rejections
  (`.../rating/`, `.../rating?x=1`, case variants, extra segments,
  `POST`/`DELETE` on the route) are all tested; `415`/`413`/
  fail-closed-origin tested; `writeSessionRating` tested (sanitization,
  containment, atomic, and **idempotent upsert — writing a rating for the
  same `(project, sessionId)` twice resolves to a single file, no duplicate,
  no calendar-day dependence**); build/typecheck/test/lint green; coverage met.
  **Human checkpoint** after COMMIT — first write surface, security-critical.
- **deps:** v4-1, v4-5.

### v4-7 — SPA Sessions list + detail/timeline + navigation
- **spec:** design §6.1, §6.2, §6.3 (read side). Nav bar in `App.vue`
  (`NMenu`, Projects·Agents·Sessions, active-route highlight); router entries
  `/sessions` + `/sessions/:project/:sessionId`. `SessionsView` (NDataTable,
  row-click → detail, empty/loading/error states). `SessionDetailView`
  (timeline in a fixed-height scroll region, states incl. `404`). Read-only
  `ratings-api.ts` client calls. **Transcript-derived content rendered as
  text only — no `v-html`** `[gate-r3: SEC suggestion]`.
- **file scope:** `packages/web/src/` — `App.vue`, `router.ts`, the two
  views, list/detail components, `lib/ratings-api.ts` (read methods); tests.
- **DoD:** component tests (@vue/test-utils) for the list, detail, nav, and
  all states (`App.vue` is coverage-excluded in `vitest.config.ts` — exercise
  the nav via a mounted component / the existing back-nav E2E pattern, not
  via `App.vue` coverage); no `v-html` on transcript content (test/lint
  guard); build/typecheck/test/lint green; coverage met.
- **deps:** v4-5.

### v4-8 — SPA rating survey + calibration summary
- **spec:** design §6.3 (write side), §6.4, §3.4. The rating survey
  (per-KPI rows, anchoring toggle + bulk reveal, partial rating, on-demand
  notes, **≥1 verdict required to save**, edit/re-rate pre-population). The
  calibration summary panel (per-KPI agreement bar, `N≥5` floor, retire
  flag). `ratings-api.ts` PUT method. Re-scope the eslint write-guard:
  `ratings-api.ts` is the one sanctioned file in the rule's `ignores`; stray
  write literals elsewhere still trip it.
- **file scope:** `packages/web/src/` — rating-survey + calibration
  components, `lib/ratings-api.ts` (PUT); `eslint.config.js`; tests.
- **DoD:** component tests for the survey flows (partial save, re-rate
  pre-population, save-failure retains input, anchoring), the calibration
  panel (N≥5 greyed, retire flag); eslint still trips on a stray write
  literal outside `ratings-api.ts`; build/typecheck/test/lint green; coverage.
- **deps:** v4-6, v4-7.

### v4-9 — Integration test, docs, follow-ups
- **spec:** design §9 WU-G, §10, §11, §12. An end-to-end test: the SPA saves
  a rating → the server persists it to a temp datalake → a reload reflects
  it. README "Observing Claude Code sessions" section; `docs/follow-ups/
  sessions.md`. Open follow-up beads: v3 CLI verbs (`audit`/`timeline`/
  `tail` — `tail` parked, not killed), cross-session aggregation, the
  secret-pattern redactor. Open the **2-week usage-check bead** with the
  M1/M2/M3 targets + kill switch from design §10 written into it. Close the
  stale v3 beads `metaswarm-dashboard-vcr`/`-pkl`/`-9qo` as superseded.
- **file scope:** `README.md`, `docs/follow-ups/sessions.md` (new), an
  integration test file; beads.
- **DoD:** the integration test passes; full `npm run test:coverage` green;
  README + follow-ups committed; the 4 follow-up beads + the usage-check bead
  opened; stale v3 beads closed.
- **deps:** v4-1..v4-8.

## 3. Cross-cutting

- **TDD:** every WU writes failing tests first. **Coverage:** `.coverage-
  thresholds.json` stays green; each WU's own files hit the thresholds; the
  live `~/.claude/projects/` scan and Fastify wiring are fs-injected or
  `/* v8 ignore */`'d with justification.
- **No new external dependencies.** `js-yaml` is already approved (STACK.md);
  it moves to `packages/types`. No Go, no new server (design §3.1).
- **The read-only invariant holds:** host repos are never written; only the
  datalake is. The SPA write-guard (eslint) and the server `method-guard`
  both stay as defense-in-depth, re-scoped, not removed.
- **Decisions** (`.beads/knowledge/decisions.jsonl`): the two rubric
  threshold changes (v4-3), already-recorded (no-Go, read-write datalake).

## 4. Human checkpoints

- **After v4-6 (server write API).** First write surface; security-critical
  (`method-guard` re-scope, CSRF contract). Present the write-path test
  evidence and pause for operator review before the SPA WUs build on it.

## 5. External dependencies

None requiring credentials. The feature reads `~/.claude/projects/`
transcripts (local, read-only) and writes ratings to the datalake (local).
Single-operator, localhost, no auth (design §8.3).

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Claude Code's cwd→dirname encoding is undocumented; discovery may mis-map a project | v4-4 reverse-engineers it and pins it with a test against real dir names; a mis-map surfaces as an empty session list, not a crash |
| R2 | `method-guard` runs `onRequest` (before routing) — a loose match re-opens the write surface | v4-6 uses an exact `(method, normalized-path)` match; tests assert `.../rating/`, `?x=1`, case variants, extra segments are all `405` |
| R3 | Coverage on the live directory scan / Fastify wiring | fs-injection (`discoverSessions(env, fs?)`), `app.inject` tests, `/* v8 ignore */` on genuine unreachables |
| R4 | The collector config-loader lift breaks collector behaviour | v4-2 DoD requires ALL existing collector tests pass unchanged (the WU-1 `fs-utils` lift precedent) |
| R5 | The operator never rates → the rubric is decorative | Out-of-plan: design §10's 2-week usage check + kill switch (bead opened in v4-9) measures this post-merge |

## 7. After the plan-review gate

On gate PASS this plan is presented to the operator with the **execution-
method choice** (orchestrated / subagent-driven / parallel-session, per
CLAUDE.md). On approval it is persisted to `.beads/plans/active-plan.md`, the
9 WU beads are created with the §1 dependency graph, and execution begins.
