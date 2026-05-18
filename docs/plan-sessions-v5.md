# Implementation Plan — Sessions-spike v5

<!-- status: APPROVED — plan-review gate 3/3 (Feasibility/Completeness/Scope), 2 rounds -->
<!-- design: docs/design-sessions-spike-v5.md (design-review gate APPROVED 5/5) -->
<!-- epic: metaswarm-dashboard-r9e -->

Canonical design: `docs/design-sessions-spike-v5.md`. Branch: `sessions-v5`
(off `sessions-spike`; rebases onto `main` once PR #6 merges — execution
starts only after that merge, per design §2).

## Work units (10)

| WU | Title | Deps |
|----|-------|------|
| v5-1 | cost foundation: types + pricing table + calculator + cwd resolver | — |
| v5-2 | Claude usage/model parse + `computeSessionCost` | v5-1 |
| v5-3 | Codex rollout reader + hardened recursive walk + attribution | v5-1 |
| v5-4 | Gemini ledger reader (allow-list parse) + empty-state | v5-1 |
| v5-5 | per-project per-vendor aggregation + aggregate cache | v5-2, v5-3, v5-4 |
| v5-6 | `ai-title` parse → `SessionTimeline.aiTitle` | v5-2 |
| v5-7 | server API: extend GETs + namespace join + caches **[HUMAN CHECKPOINT]** | v5-5, v5-6 |
| v5-8 | F1 SPA survey-context panel | v5-6, v5-7 |
| v5-9 | F2 SPA cost widgets — Sessions list + detail | v5-7 |
| v5-10 | F2 SPA cost widgets — repo views + integration test + docs | v5-1..v5-9 |

## Execution order

v5-1 → v5-2 → v5-3 → v5-4 → v5-5 → v5-6 → v5-7 (**human checkpoint after
commit**) → v5-8 → v5-9 → v5-10.
(v5-2/3/4 are independent after v5-1 and could parallelize; sequential here.
v5-6 follows v5-2 — both touch `jsonl-reader.ts`.)

Each WU runs the orchestrated 4-phase loop: IMPLEMENT → VALIDATE →
ADVERSARIAL REVIEW → COMMIT. Coverage gate per `.coverage-thresholds.json`.

---

## v5-1 — cost foundation

**Deps:** none. **Design:** §5, §6, §4.4.

**Files**
- new `packages/types/src/cost.ts` — `TokenUsage`, `VendorId`,
  `ModelPricing`, `PricingTable`, `VendorCost`, `SessionCost`,
  `DelegationRun`, `ProjectCostSummary` Zod schemas (§6).
- modified `packages/types/src/index.ts` — export `./cost`.
- modified `packages/types/package.json` — `exports` entry for `./cost`.
- new `packages/sessions/src/cost/model-prices.json` — the pinned price
  table (§5.1); prices populated from vendor public pricing pages.
- new `packages/sessions/src/cost/model-prices.source.md` — cited price
  sources + `pricingAsOf` rationale.
- new `packages/sessions/src/cost/pricing.ts` — imports `model-prices.json`
  via a static JSON `import` (`resolveJsonModule` — `tsc` inlines it into
  `dist/`, so no build-copy step is needed); Zod-validates it; exposes
  `loadPricingTable()` and a content hash.
- new `packages/sessions/src/cost/calculator.ts` — `costFor(usage, model,
  table): VendorCost` per §5.2/§5.3 (unknown model → `costUsd: null`,
  `priced: false`).
- new `packages/sessions/src/cost/attribution.ts` — `resolveProjectForCwd`
  (§4.4 — exact/prefix match on `realpath`-resolved paths; `unattributed`
  bucket).
- modified `packages/sessions/src/index.ts` — public exports.

**DoD**
- All §6 schemas defined, exported, and round-trip parse.
- `costFor` implements the §5.2 formula exactly; an unknown model id yields
  `{ costUsd: null, priced: false }`, never `0`.
- The shipped `model-prices.json` validates against `PricingTable` and
  carries `pricingAsOf` + a `source`; it prices the observed models
  (Claude 4.x family, the Codex model, the Gemini model).
- `resolveProjectForCwd` matches a cwd to a configured project by
  exact/prefix on resolved absolute paths; a non-matching cwd → `null`
  (`unattributed`); `repo` never captures `repo-secret`.
- Model-id matching normalizes known dated-suffix aliases to their
  canonical priced id; the normalization is documented.
- `pricing.ts` exposes the table via a static JSON import — verified by
  `npm run build -w packages/sessions` (no missing-asset failure at runtime).
- build / typecheck / lint / coverage gate green.

**Tests**
- `calculator.test.ts` — uses a **fixed in-test pricing table** (not the
  shipped JSON): each §5.2 term, the 1h/5m cache split + blended fallback,
  Codex `cached_input_tokens`/`reasoning` terms, unknown model → null, and
  a dated-suffix alias resolving to its canonical priced id.
- `pricing.test.ts` — the **shipped** `model-prices.json` validates against
  the schema.
- `attribution.test.ts` — exact match, prefix match, the `repo`/`repo-secret`
  non-capture, symlinked/relative cwd, no-match → null.

---

## v5-2 — Claude usage/model parse + `computeSessionCost`

**Deps:** v5-1. **Design:** §4.1, §5.2.

**Files**
- modified `packages/sessions/src/jsonl-reader.ts` — capture
  `message.usage` (incl. `cache_creation.ephemeral_1h/5m`) and
  `message.model` on `assistant` records (main + `isSidechain`).
- new `packages/sessions/src/cost/session-cost.ts` — `computeSessionCost`
  → `SessionCost` (per-model `VendorCost[]`, `totalCostUsd`, `hasUnpriced`).
- modified `packages/sessions/src/index.ts` — exports.

**DoD**
- The parser captures per-`assistant`-record `usage` + `model` without
  breaking any v4 `SessionTimeline` consumer (additive only — the carrier
  must not alter existing event shapes).
- `computeSessionCost` sums usage per model over all assistant records
  (main thread **and** `isSidechain`) and returns a `SessionCost`;
  `hasUnpriced` is `true` iff any model was unpriced; `totalCostUsd` is the
  priced-sum.
- Uses top-level `usage.*` figures, not `iterations[]`.
- build / typecheck / lint / coverage gate green.

**Tests**
- Against a **redacted real transcript** fixture: per-model usage tally,
  the 1h/5m split is preserved, subagent (`isSidechain`) records counted.
- A transcript whose model is absent from the table → `hasUnpriced: true`,
  partial `totalCostUsd`.
- A transcript with zero assistant records → `totalCostUsd: 0`.

---

## v5-3 — Codex rollout reader

**Deps:** v5-1. **Design:** §4.2, §4.4, §9.

**Files**
- new `packages/sessions/src/cost/codex-reader.ts` — discovers
  `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`, parses each to a
  `DelegationRun`.
- new path helper in `packages/types/src/paths.ts` —
  `codexSessionsDir(env)` (`METASWARM_DASHBOARD_CODEX_SESSIONS_DIR` →
  `~/.codex/sessions`).
- modified `packages/sessions/src/index.ts` — exports.

**DoD**
- Reads token usage from the **last `token_count` record whose `info` is
  non-null** → `info.total_token_usage`; a rollout with **zero** such
  records → `DelegationRun` with `costUsd: null` (`priced: false`), never
  `0`.
- Model from the **last `turn_context.payload.model`**; cwd from
  `session_meta.payload.cwd`; cwd attributed via `resolveProjectForCwd`.
- §9 recursive-walk hardening: per-level `lstat` + symlink refusal,
  per-level `realpath` containment, per-segment path sanitizer, **max depth
  4**, max-files-visited cap; `~/.codex/archived_sessions/` is **not**
  walked.
- Parses via a Zod schema that picks only allow-listed fields — Codex
  prompt/response text is never deserialized.
- build / typecheck / lint / coverage gate green.

**Tests**
- Against **redacted real rollout** fixtures, including a mandated
  `info`-null-only rollout → `costUsd: null`.
- A rollout that ended abnormally but has ≥1 non-null-`info` `token_count`
  record is still costed (a number, not `null`).
- A symlinked date directory is refused, not followed.
- A rollout below a malformed/oversized line skips the line and counts it.
- cwd outside any project → `projectName: null`.

---

## v5-4 — Gemini ledger reader

**Deps:** v5-1. **Design:** §4.3, §9.

**Files**
- new `packages/sessions/src/cost/ledger-reader.ts` — reads
  `~/.claude/sessions/external-tools.jsonl`, yields `DelegationRun[]` for
  `tool == "gemini"`.
- new path helper in `packages/types/src/paths.ts` —
  `externalToolsLedger(env)` (`METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER`).
- modified `packages/sessions/src/index.ts` — exports.

**DoD**
- Parses each line via a Zod schema that `.pick()`s only `schema_version`,
  `tool`, `model`, `cost`, `timestamp`, `git_sha` — `command` and `raw_log`
  are structurally dropped.
- An unrecognized `schema_version` → line skipped and counted.
- Only `tool == "gemini"` entries become Google `DelegationRun`s; failed
  runs (`exit_code`/`error_type`) are still costed.
- An **absent ledger file** → empty result, no error (empty-state).
- Per-line `MAX_LINE_BYTES` cap **and** a total-file-size cap.
- build / typecheck / lint / coverage gate green.

**Tests**
- Against a ledger fixture **generated by running `emit_json` from
  metaswarm's `_common.sh`** (not hand-authored), then **committed** under
  `packages/sessions/src/__tests__/fixtures/` so the test is reproducible
  off this machine: a gemini entry is costed, a codex entry is ignored, an
  unknown-version line is skipped.
- Absent ledger → empty `DelegationRun[]`, no throw.
- `command`/`raw_log` are provably absent from the parsed objects.

---

## v5-5 — per-project per-vendor aggregation

**Deps:** v5-2, v5-3, v5-4. **Design:** §5.4, §6, §4.4.

**Files**
- new `packages/sessions/src/cost/aggregate.ts` —
  `aggregateProjectCost(...)` → `ProjectCostSummary` per project + an
  `unattributed` bucket.
- modified `packages/sessions/src/index.ts` — exports.

**DoD**
- Combines Claude `SessionCost` + Codex/Gemini `DelegationRun`s into
  per-project `ProjectCostSummary` (`byVendor` for all three vendors;
  zero-run vendors present with `costUsd: 0, runCount: 0`).
- `totalCostUsd` = priced-sum; `hasUnpriced` set when any contribution was
  unpriced; an empty project → `0 / false`.
- Cost that resolves to no project lands in the `unattributed` bucket.
- build / typecheck / lint / coverage gate green.

**Tests**
- A project with Claude + Codex + Gemini cost aggregates correctly.
- A project with only Claude sessions → OpenAI/Google rows `0 / 0 runs`.
- An unpriced contribution → `hasUnpriced: true`, lower-bound total.
- An unattributed run → the `unattributed` bucket.

---

## v5-6 — `ai-title` parse + session schema extensions

**Deps:** v5-2 (same file). **Design:** §3, §6.

**Files**
- modified `packages/sessions/src/jsonl-reader.ts` — `mapEntry` gains an
  `ai-title` branch; the **last** `ai-title` value → a new additive field.
- modified `packages/types/src/sessions.ts` — `SessionTimeline.aiTitle:
  string | null`; and the additive `SessionSummary` fields `aiTitle:
  string | null`, `costUsd: number | null`, `hasUnpriced: boolean`.

**DoD**
- `SessionTimeline.aiTitle` = the last `ai-title` record's value, or `null`
  when absent (the ~85% common case).
- `mapEntry` no longer early-returns `[]` for the `ai-title` record type;
  no other record type's handling changes.
- The additive `SessionSummary` fields are defined; all v4 `SessionSummary`
  consumers still type-check (additive only).
- `SessionSummary.costUsd` contract: `null` **iff** the session has no
  costable assistant records; otherwise the priced-sum number (populated by
  v5-7). `hasUnpriced` flags that the total is a lower bound.
- build / typecheck / lint / coverage gate green.

**Tests**
- A real transcript **with** `ai-title` → `aiTitle` populated (last value).
- A real transcript **with no** `ai-title` → `aiTitle: null` (the common
  case — explicitly tested).
- The extended `SessionSummary` schema round-trips; `costUsd: null` and
  `costUsd: 0` are both representable.

---

## v5-7 — server API **[HUMAN CHECKPOINT]**

**Deps:** v5-5, v5-6. **Design:** §7, §5.4.

**Files**
- modified `packages/server/src/routes/sessions.ts` — `SessionSummary`
  gains `aiTitle` + `costUsd` + `hasUnpriced`; detail gains
  `cost: SessionCost`.
- modified `packages/server/src/routes/projects.ts` &
  `projects-by-name.ts` — `totalCostUsd`/`hasUnpriced` on rows; `cost:
  ProjectCostSummary` on detail; the §7 namespace join.
- new `packages/server/src/data/cost-cache.ts` — the two-level cost cache
  (§5.4: per-file `(path,mtime,size)`; aggregate `(path-set, max mtime,
  pricing-table content hash)`); LRU-256.
- modified `packages/server/src/routes/sessions-deps.ts` — the route
  dependency interface gains the cost-cache / aggregation deps.
- modified `packages/server/src/server.ts` — `buildServer` constructs the
  cost cache and injects it (mirroring the `createTranscriptCache` wiring).

**DoD**
- All four GETs return the §7 shapes; `pricingAsOf` rides along.
- The §7 namespace join: a config-only project and a snapshot-only project
  both still render.
- `SessionSummary.costUsd` is `null` iff the session has no costable
  assistant records, otherwise the priced-sum number (incl. `0`);
  `hasUnpriced` is set when any model contributing to the session was
  unpriced.
- Cost is computed on read, never persisted; the aggregate cache serves
  repeat loads; a changed source file or price table invalidates correctly.
- No write route added; the v4 `method-guard` allow-list is unchanged.
- build / typecheck / lint / coverage gate green.

**Tests**
- Each endpoint's new fields, against fixtures.
- Namespace-join: config-only, snapshot-only, both.
- `SessionSummary.costUsd` is `null` for a session with no costable
  records, and a number (incl. `0`) otherwise.
- Cache hit/miss on a touched source file and a touched price table.
- A method-guard test re-confirms no new write route.

**HUMAN CHECKPOINT** — after commit, pause: the operator sanity-checks the
cost figures via the API before UI work begins.

---

## v5-8 — F1 survey-context panel

**Deps:** v5-6, v5-7. **Design:** §8.1.

**Files**
- modified `packages/web/src/components/RatingSurvey.vue` — the bordered
  context panel above the KPI rows.
- modified `packages/web/src/views/SessionDetailView.vue` — pass `timeline`
  to the survey.
- possibly new `packages/web/src/lib/session-context.ts` — prompt/action
  extraction helpers.

**DoD**
- The panel shows `aiTitle` (or "Untitled session"); the first user prompt
  (`kind === 'user-prompt'`, `user-command` excluded) with an inline
  "show all N prompts" expander that never pushes the KPI rows; the
  tool-use action summary (descending counts, "no tool calls recorded"
  when zero).
- Zero user prompts → the prompts block is omitted (no blank heading).
- All content rendered as text, never `v-html`.
- build / typecheck / lint / coverage gate green.

**Tests**
- Component tests: with/without `aiTitle`, with/without prompts, zero
  tool-uses, the expander, XSS-safety (text interpolation).

---

## v5-9 — F2 cost widgets: Sessions list + detail

**Deps:** v5-7; v5-8 (shared file `SessionDetailView.vue` — order-mandatory).
**Design:** §8.2.

**Files**
- modified `packages/web/src/views/SessionsView.vue` — a "Cost" column
  after "Events"; `aiTitle` as a title line above the `<sid[:8]>` suffix.
- modified `packages/web/src/views/SessionDetailView.vue` — the per-model
  cost panel.
- possibly new `packages/web/src/lib/cost-format.ts` — USD/“n/a” formatting.

**DoD**
- Cost column: `null` → "n/a", `0` → "$0.00", in-progress → partial; USD at
  4-decimal precision; the `<sid[:8]>` suffix is **kept**.
- Session detail shows the `byModel` breakdown + the session total; unpriced
  models show "n/a" + the tooltip; one `pricingAsOf` footnote per view.
- build / typecheck / lint / coverage gate green.

**Tests**
- Component tests: null/zero/in-progress cost cells, the 4-decimal format,
  `aiTitle` + suffix both present, the per-model panel, the unpriced
  tooltip.

---

## v5-10 — F2 repo views + integration + docs

**Deps:** v5-1..v5-9. **Design:** §8.2, §12, §13.

**Files**
- modified `packages/web/src/views/ProjectsIndex.vue` — per-card total
  cost; "$X + unpriced" when `hasUnpriced`.
- modified `packages/web/src/views/ProjectDetail.vue` — the fifth
  `<section>` "AI cost" (per-vendor rows, zero-run vendors shown).
- modified `packages/web/src/components/ProjectCard.vue` as needed.
- new `packages/server/src/__tests__/cost-e2e.test.ts` — real-wiring
  end-to-end: fixtures → readers → aggregation → API → shapes.
- modified `README.md`, `docs/follow-ups/sessions.md`, `STACK.md` (if a
  decision warrants), `.beads/knowledge/decisions.jsonl`.

**DoD**
- Projects index + detail show per-vendor cost per §8.2; unpriced → "n/a";
  lower-bound totals → "$X + unpriced"; one `pricingAsOf` footnote/view.
- The e2e test exercises the whole cost path with real-file fixtures, no
  stubbed readers.
- The design §9 F1 secret-exposure acceptance is **recorded** — in
  `docs/follow-ups/sessions.md` and a README security note — stating that
  F1 surfaces full prompt text + `aiTitle` which may contain operator
  secrets, and that the v4 in-repo secret-scan does not cover it.
- README + `docs/follow-ups/sessions.md` updated; ≥3 follow-up beads filed
  by the orchestrator (the `archived_sessions` reader; the F2 post-merge
  usage check mirroring v4 §10; price-drift warning).
- build / typecheck / lint / coverage gate green.

**Tests**
- Component tests for the index card + the detail section, including a
  project with `hasUnpriced: true` rendering "$X + unpriced" (never a bare
  number, never "n/a") on both the card and the detail section.
- `cost-e2e.test.ts` — real-wiring round-trip.

---

## State

Live state: `.beads/context/execution-state.md`. Approved plan persisted to
`.beads/plans/active-plan.md` after the plan-review gate + operator
approval. Per-WU beads created from this plan.
