# Design — Sessions-spike v5: AI cost per-vendor + rating-survey context

<!-- status: draft — awaiting design-review gate -->
<!-- epic: metaswarm-dashboard-r9e -->
<!-- supersedes nothing; extends docs/design-sessions-spike-v4.md -->

## §1 Goals

Two operator-confirmed features for the dashboard, both extending the v4
sessions surface:

- **F1 — rating-survey context.** When the operator rates a session, the
  survey must remind them *what the session was* — the Claude-generated
  title, the prompts asked, and a compact summary of what was done. Today
  `RatingSurvey.vue` shows only the nine bare KPI questions.
- **F2 — AI cost per vendor, in every view.** Every Sessions view and every
  repo/project view must surface AI spend, broken down by vendor
  (Anthropic / OpenAI / Google). Cost is *derived* from telemetry the
  vendors' own tools already leave on disk — the dashboard becomes a reader
  of that telemetry, never an instrumenter of it.

## §2 Scope

**In scope**

- Parsing per-message **token usage + model** from Claude Code transcripts.
- A new read-only reader for **Codex** run telemetry (`~/.codex/sessions/`).
- A new read-only reader for the **metaswarm external-tools ledger**
  (`~/.claude/sessions/external-tools.jsonl`) — the only Gemini cost source.
- A pinned, in-repo **model→price table** and a tokens→USD cost calculator.
- Per-session Claude cost; per-repo per-vendor cost aggregation.
- Cost widgets in the Sessions list, the session detail, and the repo views.
- The F1 survey-context panel (title + prompts + action summary).

**Out of scope**

- Any new **write** endpoint or write surface. v5 is read-only; the v4 write
  API (PUT rating) is untouched.
- **Instrumenting or wrapping** Codex/Gemini invocations. We read only what
  already lands on disk.
- **Fixing metaswarm's** broken external-tools adapter (tracked: bead
  `metaswarm-dashboard-d2u`, to be reported upstream).
- **Live price fetching** / any network call. Prices are pinned in-repo.
- **Heuristic per-session delegation attribution** — see §4.4 (operator
  decision: repo-level attribution only).
- Recovering **historical Gemini cost** — none exists on disk (see §4.3).

## §3 Background

v4 made the dashboard read Claude Code transcripts under `~/.claude/projects/`
and rate sessions. v5 builds on that:

- The transcript parser (`packages/sessions`) already walks every transcript
  but **drops** the `message.usage` and `message.model` fields and ignores
  the `ai-title` record type. v5 stops dropping them.
- Two other AI vendors are reachable on this machine — Codex CLI and Gemini
  CLI, both delegated to by metaswarm's external-tools workflow. Their cost
  telemetry lives in different places and has different recoverability
  (§4.2, §4.3).

## §4 Data sources & shapes

### §4.1 Anthropic / Claude — `~/.claude/projects/**/*.jsonl`

Each `assistant` record carries:

```
message.model  → e.g. "claude-opus-4-7"
message.usage  → { input_tokens, output_tokens,
                   cache_creation_input_tokens, cache_read_input_tokens }
```

`costUSD` exists on the record but is `null` — cost is **computed** by v5,
not read. Per-session cost = the sum over the session's `assistant` records
(main thread **and** `isSidechain` subagent records — all share one
`sessionId`/file). Recoverable **retroactively** for every transcript on
disk. Vendor is always `anthropic` for a Claude Code session.

### §4.2 OpenAI / Codex — `~/.codex/sessions/**/rollout-*.jsonl`

Codex CLI writes one `rollout-<ts>-<uuid>.jsonl` per run (interactive *and*
`codex exec`, which is what metaswarm uses). Rotated files move to
`~/.codex/archived_sessions/`. Relevant records:

```
session_meta.payload → { cwd, originator, source, ... }   (run identity + repo)
turn_context.payload.model                                (e.g. "gpt-5.5")
event_msg payload.type == "token_count"
  → payload.info.total_token_usage = { input_tokens, cached_input_tokens,
       output_tokens, reasoning_output_tokens, total_tokens }
```

The **last** `token_count` record holds the cumulative usage. Recoverable
**retroactively**. The dashboard reads these files **directly** — it does
*not* trust metaswarm's ledger for Codex, because metaswarm's
`extract_cost_codex()` looks for a `.usage` key Codex 0.130 no longer emits
(bead `d2u`).

### §4.3 Google / Gemini — `~/.claude/sessions/external-tools.jsonl`

Gemini CLI persists **nothing** to disk — token usage exists only on
`--output-format json` stdout at invocation time. The single capture point
is metaswarm's external-tools adapter, which appends a per-run envelope to
`~/.claude/sessions/external-tools.jsonl`:

```
{ tool, command, model, cost: { input_tokens, output_tokens },
  duration_seconds, git_sha, files_changed, timestamp }
```

Consequences, accepted:

- **No historical Gemini cost is recoverable** — the ledger has never been
  written in this environment.
- The dashboard reads the ledger if/when it appears; entries with
  `tool == "gemini"` feed Google cost. (Codex entries in this ledger are
  ignored — §4.2.)
- v5 ships the reader with a graceful **empty state** ("no Gemini
  delegations recorded yet"). Operator decision: build it now.
- The ledger's `command` field may contain secrets — v5 reads only
  `tool`/`model`/`cost`/`timestamp`/`git_sha`, never surfaces `command`.

### §4.4 Attribution (cross-repo)

Operator decision — **repo-level, no heuristics**:

- A **Claude Code session** maps to one project (v4 already does this); its
  cost is attributed to that project and shown in the Sessions views.
- A **Codex run** is attributed by `session_meta.payload.cwd` → the matching
  configured project. A **Gemini ledger entry** is attributed by its
  `git_sha` / cwd to a project where determinable.
- A delegation whose cwd matches no configured project is bucketed as
  **`unattributed`** and shown only in a global total, never silently
  dropped.
- Codex/Gemini runs are **delegations, not rateable sessions** — they never
  appear as rows in the Sessions list. Their cost surfaces only in repo-level
  aggregates. No attempt is made to bind a delegation to the Claude session
  that spawned it.

## §5 Cost model

### §5.1 Pricing table

A pinned, version-controlled JSON resource:
`packages/sessions/src/cost/model-prices.json`, validated by a Zod schema.

```
{
  "pricingAsOf": "2026-05-18",
  "source": "vendor public pricing pages — see comment",
  "models": {
    "claude-opus-4-7":  { "input": …, "output": …,
                          "cacheWrite": …, "cacheRead": … },
    "gpt-5.5":          { "input": …, "output": …, "cacheRead": … },
    "gemini-2.x-pro":   { "input": …, "output": … },
    …
  }
}
```

- Prices are **per 1M tokens, USD**. The operator updates the file by hand
  when vendors change prices; `pricingAsOf` is surfaced in the UI so stale
  prices are visible ("prices as of YYYY-MM-DD").
- Model id matching is **exact**, with a documented normalization for known
  vendor aliases (e.g. dated suffixes). No fuzzy matching.
- An **unknown model** yields `costUsd: null` and `priced: false` — the UI
  shows "—/n.d.", **never a fake `0`**.

### §5.2 Computation

For one priced model's usage:

```
costUsd = ( input_tokens          × input
          + output_tokens         × output
          + cache_creation_tokens × (cacheWrite ?? input)
          + cache_read_tokens     × (cacheRead  ?? input)
          + reasoning_tokens      × output ) / 1_000_000
```

- Cache-write/cache-read prices fall back to the base `input` price when a
  model's table entry omits them (documented; conservative).
- Codex `reasoning_output_tokens` is billed at the `output` rate.
- Cost is **computed on read**, never persisted (persisting would freeze a
  stale price). Results are cached in memory keyed by the source file's
  mtime **and** the pricing table's mtime/hash, mirroring v4's
  `transcript-cache.ts`.

## §6 Schemas (new — `packages/types`)

Additive; no v4 schema is broken.

- `TokenUsage` — `{ inputTokens, outputTokens, cacheCreationTokens,
  cacheReadTokens, reasoningTokens }` (all int ≥ 0).
- `ModelPricing` / `PricingTable` — the §5.1 file schema.
- `VendorCost` — `{ vendor: 'anthropic'|'openai'|'google',
  model: string, usage: TokenUsage, costUsd: number | null,
  priced: boolean }`.
- `SessionCost` — a Claude session's own cost:
  `{ sessionId, vendor: 'anthropic', byModel: VendorCost[],
  totalCostUsd: number | null }`.
- `DelegationRun` — one Codex/Gemini run:
  `{ vendor, model, projectName: string | null, at, usage,
  costUsd: number | null }`.
- `ProjectCostSummary` — per repo:
  `{ projectName, byVendor: Record<vendor, {costUsd, runCount}>,
  totalCostUsd: number | null, pricingAsOf: string,
  hasUnpriced: boolean }`.

Extended v4 schemas (additive fields):

- `SessionTimeline` → `aiTitle: string | null` (last `ai-title` record).
- `SessionSummary` → `aiTitle: string | null`, `costUsd: number | null`.

## §7 Server API

All additions are **read-only GETs**. No write surface is added.

- `GET /api/sessions` — `SessionSummary[]` now carries `aiTitle` + `costUsd`.
- `GET /api/sessions/:project/:sessionId` — detail response gains
  `cost: SessionCost`; `timeline.aiTitle` is populated.
- `GET /api/projects` (index) — each project row gains `totalCostUsd`.
- `GET /api/projects/:name` (detail) — gains `cost: ProjectCostSummary`
  (the per-vendor breakdown).
- The pricing metadata (`pricingAsOf`) rides along on the cost-bearing
  responses so the UI can render the staleness caveat.

Each new read path reuses the v4 mtime-cache pattern. The `method-guard`
allow-list and §8.1 controls are unchanged (no new write route).

## §8 UI

### §8.1 F1 — survey context

`SessionDetailView.vue` passes the already-fetched `timeline` to
`RatingSurvey.vue`, which renders a **context panel above the KPI rows**:

- the `aiTitle` as a heading;
- the first user prompt, with a "show all N prompts" expander;
- a compact **action summary** — counts of tool-uses by tool, or the first
  ~8 timeline events.

All content is rendered as **text, never HTML** (XSS — `summary` may carry
secrets). The Sessions **list** also shows `aiTitle` instead of the bare
`sessionId` where present.

### §8.2 F2 — cost widgets

- **Sessions list** (`SessionsView.vue`): a "Cost" column — the Claude cost
  of each session, USD.
- **Session detail** (`SessionDetailView.vue`): a cost panel — per-model
  token breakdown (input / output / cache) and USD for that Claude session.
- **Projects index** (`ProjectsIndex.vue`): each project card shows its
  total AI cost.
- **Project detail** (`ProjectDetail.vue`): a per-vendor breakdown panel —
  Anthropic / OpenAI / Google, each with run/session count, tokens, USD.
- A "prices as of YYYY-MM-DD" caveat sits near any cost figure. Unpriced
  models render "n.d." with a tooltip, never `0`.

## §9 Security & privacy

- The two new read sources (`~/.codex/sessions/`, the metaswarm ledger) get
  the **same hardening v4 applied** to `~/.claude/projects/`: realpath
  containment, `lstat` symlink refusal, the `^[A-Za-z0-9._-]+$` + `..`-reject
  path sanitization, per-line size caps, malformed-line skipping.
- New read locations are configurable via env vars
  (`METASWARM_DASHBOARD_CODEX_SESSIONS_DIR`,
  `METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER`), mirroring
  `METASWARM_DASHBOARD_TRANSCRIPTS_DIR`; defaults are the real paths.
- The ledger `command` field and Codex prompt text are **never read or
  surfaced** — only token counts, model, timestamp, cwd.
- **Zero-footprint invariant unchanged**: all three sources are read-only;
  nothing is written to host repos. Cost is computed in memory; no new
  datalake file is created (v4 ratings storage is untouched).
- No network calls; the pricing table is in-repo and version-controlled.

## §10 Work units (high level — refined in the plan)

1. `v5-1` — pricing table + Zod schema + tokens→USD calculator.
2. `v5-2` — Claude usage/model extraction in the transcript parser; per-session `SessionCost`.
3. `v5-3` — Codex rollout reader + per-run cost + cwd attribution.
4. `v5-4` — Gemini ledger reader + cost, with empty-state.
5. `v5-5` — per-project per-vendor cost aggregation.
6. `v5-6` — `ai-title`/prompt capture in the parser → `SessionTimeline.aiTitle`.
7. `v5-7` — server API: extend the GETs + the mtime cache.
8. `v5-8` — F1 survey-context panel.
9. `v5-9` — F2 cost widgets: Sessions list + detail.
10. `v5-10` — F2 cost widgets: repo views; integration test + docs + follow-up beads.

(Final decomposition, DoD, file scope, and dependency DAG are produced by
the planning phase and pass the plan-review gate before execution.)

## §11 Anti-goals

- §11.1 No write surface, no new datalake file. v5 is read + compute only.
- §11.2 No instrumentation/wrapping of Codex/Gemini; no upstream metaswarm
  changes (bead `d2u` reports the adapter bug instead).
- §11.3 No network calls; no live/auto-updating prices.
- §11.4 No fuzzy model-id matching; no fake `0` for unpriced models.
- §11.5 No heuristic delegation→session binding (repo-level attribution only).
- §11.6 Codex/Gemini runs are not rateable and never enter the Sessions list.
- §11.7 No `git push` (operator pushes); no `--no-verify`; coverage gate
  enforced per `.coverage-thresholds.json`.

## §12 Definition of Done

- All work units complete; build / typecheck / test / lint green; coverage
  meets `.coverage-thresholds.json`.
- Claude per-session cost is computed from `message.usage` and shown in the
  Sessions list (column) and session detail (per-model panel).
- Codex runs are read from `~/.codex/sessions/`, costed, and attributed to a
  project by cwd; the project's per-vendor panel shows OpenAI cost.
- The Gemini ledger reader works and degrades to a clear empty state when
  `external-tools.jsonl` is absent.
- Repo views (index + detail) show per-vendor cost; an unpriced model shows
  "n.d.", never `0`; a "prices as of" caveat is visible.
- The rating survey shows the session's `aiTitle`, prompts, and an action
  summary.
- New read sources carry the v4 path-hardening; no write surface added; host
  repos provably untouched.
- README + `docs/follow-ups/sessions.md` updated; STACK.md / decisions.jsonl
  reflect any v5 decisions; ≥3 follow-up beads filed.

## §13 Follow-ups & open risks

- **Gemini history is unrecoverable** — accepted; cost accrues only from
  first ledger write forward.
- **metaswarm adapter bug** (`d2u`) — report upstream; until fixed, the
  Gemini ledger is the only Google source and the Codex ledger entries are
  unusable (v5 sidesteps both by reading `~/.codex/sessions/` directly).
- **Price drift** — manual table; a future follow-up could add a
  drift-warning when `pricingAsOf` is old.
- **Delegation→session binding** — rejected in v5 (§11.5); revisit only if a
  reliable link (e.g. a metaswarm-emitted parent-session id) appears.
