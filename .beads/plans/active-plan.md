# Implementation Plan — Issue #1 (v2)

- **status:** draft (awaiting Plan Review Gate v2)
- **created_at:** 2026-05-06
- **issue:** [#1 — feat: MVP read-only dashboard for multi-project metaswarm visibility](https://github.com/montoyaedu/metaswarm-dashboard/issues/1)
- **beads_epic:** `metaswarm-dashboard-lo0`
- **author:** orchestrator (Claude) after round-1 plan-review-gate failures
- **target estimate:** ~1 working week + 0.5 day for WU-0 bootstrap
- **execution model:** metaswarm orchestrated-execution (4-phase per WU: IMPLEMENT → VALIDATE → ADVERSARIAL REVIEW → COMMIT)
- **changelog vs v1:**
  - Added **WU-0** (BEADS bootstrap) — supersedes the v1 deferral; the `.beads/` runtime is no longer optional, it is a documented prereq runnable by any cloner.
  - Replaced vendored DTO sync with a fourth workspace package `packages/types`.
  - `prsMergedLast7d` is now implemented via `gh pr list` (token-gated, degraded-mode `null` when unavailable, UI renders "—").
  - Replaced grep-based "no write methods" static check with reliance on the server 405 guard + manual review.
  - Pinned node 22 via `.nvmrc` + `engines.node`; added the prereq to README.
  - WU-5 file_scope now includes a stub `packages/web/dist/index.html` so SPA-fallback tests can run before WU-6a builds the real one.
  - WU-6 split into **WU-6a** (Projects index → checkpoint #2) and **WU-6b** (Project detail + Agents view).
  - WU-7 validation scoped to collector + server workspaces only (was root, would have run WU-6 in parallel).
  - WU-8 walkthrough uses fixture host repos checked into the test tree (no need for a working `bd init` on the operator's machine for this step).
  - Removed external-tools delegation suggestion (user setup chose `external_tools: false`).
  - TZ for daily snapshot key is now **UTC** (was ambiguous in v1).
  - CI matrix `[ubuntu-latest, macos-latest]` is now an explicit WU-1 DoD bullet.

---

## 1. Summary

- Stand up an npm-workspaces monorepo (`packages/{types,collector,server,web}`) with TypeScript strict, Vitest, ESLint, Prettier, a single `bin/metaswarm-dashboard` ESM dispatcher, and a `.nvmrc`-pinned node 22 toolchain.
- Bootstrap BEADS in dolt-server mode as a documented prereq (WU-0) — no machine-specific deferral; cross-machine portability is preserved via `.beads/issues.jsonl` + `.beads/knowledge/*.jsonl`.
- Implement a read-only collector that reads `.beads/` JSONL + `bd list --json` + (optionally) `gh pr list` for each project in `config.yaml` and writes XDG-aware per-project daily/weekly snapshots — host repos remain byte-identical, asserted by an automated test.
- Implement a minimal Fastify server that refuses non-GET methods, fails fast on missing/invalid config, exposes 3 typed read-only endpoints, and serves the built SPA from `packages/web/dist`.
- Ship a Vue 3 + naive-ui SPA with three views (Projects index, Project detail, Agents cross-project) using history-mode routing and composition-API state — no Pinia, no writes anywhere in the UI.
- Enforce 100% coverage from `.coverage-thresholds.json`, wire CI on ubuntu + macos with node 22, and document install / `config init` / `collect` / `serve` with three screenshots in the README.

---

## 2. Architecture decisions

These resolve the open questions surfaced by the issue and round-1 plan-review-gate findings. Each is re-validated by the v2 Plan Review Gate.

### 2.1 Workspace layout — **npm workspaces, four packages**

- **Decision:** `npm workspaces` with `packages/types`, `packages/collector`, `packages/server`, `packages/web`.
- **Justification:** A dedicated `packages/types` package lets the API contract (`ProjectSummary`, `ProjectDetail`, `AgentAggregate`, `DailySnapshot`, `WeeklySnapshot`) live in one place. `collector` writes against `DailySnapshot`, `server` reads against the same schema, `web` consumes the API response types — all import from `@metaswarm-dashboard/types`. No vendored copy, no sync test, no drift.
- **Trade-off:** One extra `package.json`. Mitigated by the package containing only `.ts` declarations and Zod schemas — no runtime code, no separate build step (consumers compile the source directly via TS project references).

### 2.2 BEADS bootstrap — **server-mode dolt is a documented prereq (WU-0)**

- **Context:** `bd 0.63.3` with embedded Dolt requires CGO, which is unavailable on the dev machine. Round 1 plan deferred BEADS dogfooding; the operator (correctly) rejected that.
- **Decision:** WU-0 ships a `bin/bootstrap-beads.sh` script that any cloner runs once: it (1) checks for `dolt >= 1.85`, (2) creates `~/.local/share/metaswarm-dashboard-bd-server/` if absent, (3) starts `dolt sql-server -H 127.0.0.1 -P 3307` as a background process (idempotent — exits 0 if already running), (4) runs `BEADS_DOLT_PASSWORD="" bd init --server` if `.beads/dolt/` is absent, (5) runs `bd sync --from-main` if `.beads/issues.jsonl` exists. Cross-machine portability is preserved by `.beads/issues.jsonl` (committed) — a fresh clone replays it into the new server's database.
- **What is committed (cross-machine portable):** `.beads/issues.jsonl`, `.beads/knowledge/*.jsonl`, `.beads/plans/*.md`, `.beads/context/*.md`, `.beads/config.yaml`, `.beads/metadata.json`, `.beads/hooks/*`, `.beads/AGENTS.md`, `.beads/.gitignore`. The `.beads/dolt/` binary store and per-machine runtime files (`.beads/.beads-credential-key`, `.beads/dolt-server.*`, `.beads/.local_version`) are git-ignored by `.beads/.gitignore`.
- **Justification:** Honors the issue's "set up `.beads/` for metaswarm orchestration of this repo itself (dogfooding)" file-scope item without forcing CGO availability on every machine.

### 2.3 Snapshot file naming — **UTC daily-key + ISO-8601 weekly-key**

- **Decision:** Daily file: `YYYY-MM-DD.json` based on `Date.toISOString().slice(0,10)` — **UTC, not local TZ**. Weekly file: `YYYY-Www.json` (literal `W` separator, four-digit ISO week-year, two-digit zero-padded week number) computed from the same UTC instant.
- **Justification:** UTC eliminates DST-induced double-day or skipped-day bugs. ISO `YYYY-Www` removes `2026-01.json`-vs-week-1-of-2027 ambiguity, sorts lexicographically by week, and is what `Temporal.PlainDate.from(...).weekOfYear` and `date-fns/formatISO` emit.
- **Test coverage required:** week 1 from prior calendar year (2024-12-30 ⇒ 2025-W01), week 53 in long years (2026-12-31 ⇒ 2026-W53), DST-spring-forward day (2026-03-29 EU), DST-fall-back day (2026-10-25 EU) — each must produce one and only one daily key.

### 2.4 API response schemas — **defined in `@metaswarm-dashboard/types`**

```ts
// packages/types/src/api.ts
export interface ProjectSummary {
  name: string;
  activeTasks: number;
  blockedTasks: number;
  prsMergedLast7d: number | null;   // null when GITHUB_TOKEN missing or gh unavailable
  lastActivityAt: string | null;    // ISO-8601 UTC
  hasMetrics: boolean;
}
export type GetProjectsResponse = ProjectSummary[];

export interface AgentBreakdown {
  agent: string;
  tasksCompleted: number;
  successRate: number;              // 0..1
  avgDurationSeconds: number;
}
export interface RecentWorkUnit {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "closed";
  agent: string | null;
  closedAt: string | null;
}
export interface ThroughputPoint { date: string; closed: number; }   // YYYY-MM-DD UTC
export interface ProjectDetail {
  name: string;
  agents: AgentBreakdown[];
  throughput: ThroughputPoint[];   // last 14 days, gaps filled with closed=0
  recentWorkUnits: RecentWorkUnit[]; // newest first, max 25
  lastActivityAt: string | null;
}
export type GetProjectByNameResponse = ProjectDetail;

export interface AgentAggregate {
  agent: string;
  totalTasksCompleted: number;
  weightedSuccessRate: number;
  avgDurationSeconds: number;
  projects: { name: string; tasksCompleted: number }[];
}
export type GetAgentsResponse = AgentAggregate[];

export interface ApiError {
  error: { code: string; message: string; hint?: string };
}
```

`DailySnapshot` and `WeeklySnapshot` Zod schemas also live in `@metaswarm-dashboard/types/src/snapshots.ts` — collector imports them to write, server imports them to read. **One source of truth.**

### 2.5 SPA routing — **history mode + Fastify SPA fallback via `@fastify/static`**

- **Decision:** `vue-router@4` with `createWebHistory()`. Fastify uses `@fastify/static` to serve `packages/web/dist/`, and a `setNotFoundHandler` returning `index.html` for any GET that does not match `/api/*` or a real static asset.
- **Justification:** Issue mandates Fastify + SPA. History mode gives clean URLs (`/projects/foo`) — a back/forward navigation DoD bullet for project detail. `@fastify/static` is the canonical plugin for this use case.

### 2.6 State management — **composition-API composables only, no Pinia**

- **Decision:** `useFetch`-style composables in `packages/web/src/composables/` (one per endpoint: `useProjects`, `useProjectDetail`, `useAgents`). State is local to each view; no global store.
- **Justification:** Three independent read-only views, zero shared state. Pinia would buy nothing for the MVP and can be added later without breaking these composables.

### 2.7 PRs merged last 7d — **`gh pr list` per project, token-gated, degraded-mode `null`**

- **Decision:** During collection, for each project, attempt `gh pr list --repo <owner/repo> --state merged --search 'merged:>=YYYY-MM-DD' --json number --jq 'length'` where the repo is derived from the project's `git remote get-url origin`. If `GITHUB_TOKEN` is unset, `gh` is missing, the project has no GitHub remote, or the call fails for any reason, `prsMergedLast7d` is set to `null` and the UI renders "—" instead of "0".
- **Justification:** Issue lists this metric as in-scope. Hardcoding 0 would have shipped a structurally broken metric; a token-gated implementation honors the DoD without making `GITHUB_TOKEN` mandatory.

### 2.8 Cross-package type sharing — **workspace dependency on `@metaswarm-dashboard/types`**

- **Decision:** `packages/types` is a private workspace package (no `version`/`publish`). `packages/collector`, `packages/server`, `packages/web` declare `"@metaswarm-dashboard/types": "*"` in their `package.json`. Imports use `@metaswarm-dashboard/types/api` and `@metaswarm-dashboard/types/snapshots`. `tsconfig.base.json` configures TS project references so `tsc` resolves source-to-source without a build step.
- **Justification:** Replaces v1's vendored-copy + sync-test approach. Build order is implicit (TS project references), no copy script, no drift possible.

### 2.9 Node version pinning — **`.nvmrc` + `engines.node` + README prereq**

- **Decision:** Root `.nvmrc` pins `22`. Each `package.json` declares `"engines": { "node": ">=22" }`. README "Prerequisites" section documents `nvm use` (or `volta install node@22`) as the first step.
- **Justification:** Vitest 4 / Vite 8 require node ≥20; the dev machine is currently on 18.20.8. Without a pin, `npm ci` fails silently or with cryptic engine warnings.

---

## 3. Work Unit Decomposition

Sized for ~4-hour chunks; total **10 WUs** (was 8 in v1; added WU-0 and split WU-6). File scopes are disjoint across non-dependent WUs.

### WU-0 — BEADS bootstrap script and operator docs

- **id:** WU-0
- **title:** Ship a portable BEADS bootstrap script and document the dolt-server prereq
- **depends_on:** none (already partially done by orchestrator; this WU formalizes it)
- **human_checkpoint:** false
- **file_scope:**
  - `bin/bootstrap-beads.sh` (idempotent: checks `dolt`, starts `dolt sql-server` in background if absent, runs `bd init --server` if `.beads/dolt/` absent, runs `bd sync --from-main` if `issues.jsonl` exists)
  - `bin/bootstrap-beads.test.sh` (smoke test using a temp HOME)
  - `docs/BEADS-BOOTSTRAP.md` (why server-mode, troubleshooting, port collision, manual stop/start)
- **out_of_scope:** none of the dashboard product code; CLI dispatcher (WU-7).
- **dod_items:**
  1. `bin/bootstrap-beads.sh` exits 0 on a fresh clone with `dolt` installed and no prior `.beads/dolt/`.
  2. Re-running the script while the server is up exits 0 without restarting it.
  3. If `dolt` is not on PATH, exits 1 with a one-line install hint linking to `docs/BEADS-BOOTSTRAP.md`.
  4. After running, `bd ready` returns successfully (exit 0).
  5. README "Prerequisites" section references the script as the first setup step.
- **tests:**
  - `bin/bootstrap-beads.test.sh` runs the script in a temp dir with `HOME=$TMPDIR` and asserts `bd ready` works after.
- **validation_commands:**
  - `bash bin/bootstrap-beads.sh`
  - `bd ready`
  - `bash bin/bootstrap-beads.test.sh` (CI-suitable; skipped if `dolt` is not installed in CI)

### WU-1 — Workspace skeleton, tooling, CI matrix

- **id:** WU-1
- **title:** Bootstrap npm workspaces, TypeScript strict, ESLint, Prettier, Vitest, CI on ubuntu+macos, node 22 pin
- **depends_on:** [WU-0]
- **human_checkpoint:** false
- **file_scope:**
  - `package.json` (root: `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": {"node": ">=22"}`, runtime deps `commander` and `js-yaml`, scripts `lint`, `typecheck`, `test`, `test:coverage`, `format:check`, `build`, `bootstrap`)
  - `.nvmrc` (`22`)
  - `tsconfig.base.json`, `tsconfig.json` (root, references all four packages)
  - `.eslintrc.cjs`, `.prettierrc`, `.prettierignore`, `.editorconfig`
  - `vitest.config.ts` (root, workspace projects: types/collector/server/web, v8 coverage provider, thresholds from `.coverage-thresholds.json`)
  - `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`
  - `packages/collector/package.json`, `packages/collector/tsconfig.json`, `packages/collector/src/index.ts` (placeholder)
  - `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/index.ts` (placeholder)
  - `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.ts` (naive-ui dark provider only)
  - `.github/workflows/ci.yml` (rewrite: `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22, runs lint/typecheck/test:coverage/build, smoke step `node ./bin/metaswarm-dashboard --help` after build — gated to ubuntu-only since macOS does not need it for the smoke)
- **out_of_scope:** any product code (collector/server/web logic), README content, CLI entry script (WU-7), bootstrap script (WU-0).
- **dod_items:**
  1. `npm ci && npm run lint && npm run typecheck && npm run test:coverage && npm run build` exits 0 from a fresh clone on node 22.
  2. TypeScript strict (`"strict": true, "noUncheckedIndexedAccess": true`) inherited by all four packages.
  3. ESLint config bans `any` (`@typescript-eslint/no-explicit-any: error`).
  4. CI workflow runs lint, typecheck, test:coverage, build with `strategy.matrix.os: [ubuntu-latest, macos-latest]` and node 22.
  5. Root `npm run build` script fans out to workspaces via `npm run build --workspaces --if-present` (single canonical invocation; same form used everywhere).
  6. `commander` and `js-yaml` are declared as runtime deps of the **root** `package.json` so `bin/metaswarm-dashboard` (top-level shebang script in WU-7) can resolve them without belonging to any sub-package.
- **tests:**
  - `packages/types/src/__tests__/sanity.test.ts`, ditto for collector/server/web — trivial assertion to prove vitest workspace wiring.
- **validation_commands:**
  - `npm ci`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build`

### WU-2 — Config + paths module (XDG-aware) and `config init` subcommand

- **id:** WU-2
- **title:** Implement XDG-aware path resolution, YAML config loader, and `metaswarm-dashboard config init`
- **depends_on:** [WU-1]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/collector/src/paths.ts` (XDG resolution: data dir + config file, env overrides `METASWARM_DASHBOARD_DATA_DIR`, `METASWARM_DASHBOARD_CONFIG`; `~` expansion via `os.homedir()`)
  - `packages/collector/src/config.ts` (load + validate `config.yaml` with Zod; uses `js-yaml`)
  - `packages/collector/src/cli/config-init.ts` (writes a starter config to the right XDG location; refuses to overwrite without `--force`; creates parent dirs)
  - `packages/collector/src/__tests__/{paths,config,config-init}.test.ts`
- **out_of_scope:** the `metaswarm-dashboard` binary dispatcher (WU-7), the collector itself (WU-3), the server (WU-5).
- **dod_items:**
  1. `paths.dataDir()` returns `~/Library/Application Support/metaswarm-dashboard/` on darwin, `${XDG_DATA_HOME:-~/.local/share}/metaswarm-dashboard/` on linux, and respects `METASWARM_DASHBOARD_DATA_DIR` override (asserted with mocked `process.platform`).
  2. `paths.configFile()` mirrors the same logic with `METASWARM_DASHBOARD_CONFIG` override and uses `~/.config/metaswarm-dashboard/config.yaml` on linux.
  3. `loadConfig()` parses YAML, expands `~`, returns typed `{ projects: { name: string; path: string }[] }`, and throws `ConfigError` with a hint pointing to `config init` on missing/invalid config.
  4. `config init` writes a starter YAML with two commented-out example entries; refuses to overwrite without `--force`; creates parent dirs.
  5. Both darwin and linux branches of `paths.ts` are exercised by tests (mock `process.platform`); 100% branch coverage.
- **tests:**
  - Unit tests using `process.env` mocking (in vitest with `pool: 'forks'` to avoid env bleed) and `os.homedir` mocking via dependency injection.
  - Snapshot test on the starter YAML output.
  - Negative tests: missing file, invalid YAML, missing `projects` key, project entry without `path`.
- **validation_commands:**
  - `npm run typecheck --workspace packages/collector`
  - `npm run test:coverage --workspace packages/collector`

### WU-3 — Collector core: read .beads/, compute metrics, write snapshots, GitHub PR fetch, zero-footprint test

- **id:** WU-3
- **title:** Implement collector that reads host `.beads/` JSONL + `bd list --json` + `gh pr list`, computes per-agent metrics, writes daily + weekly UTC snapshots
- **depends_on:** [WU-2]
- **human_checkpoint:** **TRUE** — satisfies issue checkpoint #1 ("after data-layer schema is firm"). Deliverable: `docs/samples/daily-snapshot.example.json` committed to the repo.
- **file_scope:**
  - `packages/types/src/snapshots.ts` (Zod schemas: `AgentMetrics`, `SwarmMetrics`, `DailySnapshot`, `WeeklySnapshot` — exported)
  - `packages/collector/src/beads-reader.ts` (reads `.beads/*.jsonl` line-by-line, skips malformed rows with `console.warn`, runs `bd list --json` via `child_process.execFile` with 30s timeout)
  - `packages/collector/src/github-reader.ts` (runs `gh pr list ... --json number` via `execFile` if `GITHUB_TOKEN` set and `gh` on PATH; returns `null` on any failure)
  - `packages/collector/src/metrics.ts` (pure: rows → `AgentMetrics`/`SwarmMetrics`; UTC daily key; ISO week-year + week computation)
  - `packages/collector/src/writer.ts` (atomic write: temp file + rename; idempotent; computes paths via WU-2 `paths`)
  - `packages/collector/src/cli/collect.ts` (handles `--project <name>` and `--all`; per-project summary line; exit 0 even when individual projects skipped)
  - `packages/collector/src/__tests__/{schema,beads-reader,github-reader,metrics,writer,collect}.test.ts`
  - `packages/collector/src/__tests__/zero-footprint.test.ts` ← **critical**: snapshots fixture host-repo state (recursive sha256) before/after collection, asserts byte-identical
  - `packages/collector/src/__tests__/fixtures/host-repos/{empty-project,mixed-tasks,malformed-jsonl,missing-path}/.beads/...` (fixture host repos with minimal `.beads/issues.jsonl` content for the zero-footprint and integration tests)
  - `docs/samples/daily-snapshot.example.json` (committed sample; also serves as the human-checkpoint #1 review artifact)
- **out_of_scope:** the dispatcher binary (WU-7), the server (WU-5), any UI code.
- **dod_items:**
  1. `collect --project <name>` writes `<data-dir>/projects/<name>/daily/YYYY-MM-DD.json` matching `DailySnapshot` Zod schema.
  2. `collect --all` iterates every project in `config.yaml`.
  3. Re-running same UTC day overwrites snapshot, no duplicate entries (asserted by writing twice and diffing).
  4. When invoked on a Monday (UTC), also writes `<data-dir>/projects/<name>/weekly/YYYY-Www.json` for the prior ISO week. Test uses fake timers (`vi.setSystemTime`) on Monday + Tuesday + Sunday to assert weekly logic.
  5. Empty project (no `.beads/`) → skip + clear log line, exit code 0.
  6. Malformed JSONL row → skip + log, never crash.
  7. Missing project path → skip + log, exit code 0.
  8. Agent with 0 completed tasks → produces an `AgentMetrics` row with `tasksCompleted: 0, successRate: 0`.
  9. Agent with 100% success rate → produces `successRate: 1.0` (no division-by-zero).
  10. Single-snapshot weekly fallback → if no daily snapshots exist for the prior week, weekly file contains `{ totals: {…}, complete: false }` rather than missing.
  11. DST-spring-forward (2026-03-29 EU) and DST-fall-back (2026-10-25 EU) each produce exactly one daily key (because keys are UTC).
  12. ISO week boundary: 2024-12-30 UTC → daily snapshot key `2024-12-30`, weekly key `2025-W01` (verified explicitly).
  13. ISO week 53 in long years: 2026-12-31 UTC → weekly key `2026-W53` (verified explicitly).
  14. **Zero-footprint:** `zero-footprint.test.ts` snapshots fixture host repos' contents (recursive sha256), runs collect against each, re-snapshots, asserts equality. Repeated for `--all`.
  15. `bd` invoked with `execFile` (no shell) and 30s timeout; ENOENT surfaces actionable error referencing `docs/BEADS-BOOTSTRAP.md`.
  16. `prsMergedLast7d` is populated via `gh pr list` when `GITHUB_TOKEN` is set, `gh` is on PATH, and the project has a recognizable GitHub remote; otherwise `null`. Asserted by 4 tests covering all 4 combinations.
  17. `docs/samples/daily-snapshot.example.json` is committed and validated by a test that parses it through `DailySnapshot` Zod schema — drift fails CI.
- **tests:**
  - Fixtures under `packages/collector/src/__tests__/fixtures/host-repos/{empty-project,mixed-tasks,malformed-jsonl,missing-path}/`.
  - `bd list --json` mocked via injectable executor (no real `bd` invocation in unit tests).
  - `gh pr list` mocked the same way.
  - Property tests for ISO-week computation across 2020-01-01 ↔ 2030-12-31 (using `fast-check` with run budget capped at 3s).
- **validation_commands:**
  - `npm run typecheck --workspace packages/collector`
  - `npm run test:coverage --workspace packages/collector`

### WU-4 — Snapshot reader + aggregator (server-side data access layer)

- **id:** WU-4
- **title:** Implement snapshot reader that aggregates per-project daily snapshots into the API response shapes, importing schemas from `@metaswarm-dashboard/types`
- **depends_on:** [WU-3]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/server/src/data/snapshot-reader.ts` (lists snapshots under `<data-dir>/projects/<name>/daily/`, parses with `DailySnapshot` from `@metaswarm-dashboard/types/snapshots`, returns most-recent + 14-day window)
  - `packages/server/src/data/aggregator.ts` (pure functions: `toProjectSummary`, `toProjectDetail`, `toAgentAggregates` — produce shapes from `@metaswarm-dashboard/types/api`)
  - `packages/server/src/__tests__/{snapshot-reader,aggregator,integration-with-collector}.test.ts`
- **out_of_scope:** Fastify wiring (WU-5), HTTP concerns; new schemas (live in `@metaswarm-dashboard/types`).
- **dod_items:**
  1. `snapshotReader.listProjects()` returns names of all dirs under `<data-dir>/projects/` that have ≥1 daily snapshot.
  2. `snapshotReader.latestDaily(name)` returns the lexicographically-greatest `YYYY-MM-DD.json` parsed via Zod (returns `null` if none).
  3. `aggregator.toProjectSummary` produces the exact `ProjectSummary` shape from `@metaswarm-dashboard/types/api`, including `hasMetrics: false` when no daily snapshots exist and `prsMergedLast7d` echoed through (preserves `null` from collector).
  4. `aggregator.toAgentAggregates` weights `successRate` by `tasksCompleted` across projects (verified by unit test with hand-computed expected values).
  5. Invalid/corrupt snapshot file → log + skip that file, surface remaining data.
  6. **Cross-WU integration test:** runs the WU-3 writer and the WU-4 reader against the same temp dir, asserts shape compatibility end-to-end. This test fails CI if WU-3's writer ever drifts from `@metaswarm-dashboard/types/snapshots`.
- **tests:**
  - Fixture data dir under `packages/server/src/__tests__/fixtures/data-dir/` with 2 projects, 14+ days of snapshots.
  - Edge cases: project with zero snapshots, single snapshot, snapshot with zero agents, snapshot with `prsMergedLast7d: null`.
- **validation_commands:**
  - `npm run typecheck --workspace packages/server`
  - `npm run test:coverage --workspace packages/server`

### WU-5 — Fastify server: 3 GET endpoints, 405 on writes, fail-fast on bad config, SPA static + fallback

- **id:** WU-5
- **title:** Wire Fastify with read-only API, method guard, config validation, and SPA fallback via `@fastify/static`
- **depends_on:** [WU-4]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/server/src/server.ts` (factory: `buildServer(opts)` returns Fastify instance — testable via built-in `app.inject()` without listening on a port)
  - `packages/server/src/routes/{projects,projects-by-name,agents}.ts`
  - `packages/server/src/plugins/method-guard.ts` (rejects non-GET on `/api/*` with 405 + `Allow: GET` header)
  - `packages/server/src/plugins/spa.ts` (uses `@fastify/static` to serve `packages/web/dist`; `setNotFoundHandler` returns `index.html` for non-`/api`, non-asset GETs)
  - `packages/server/src/cli/serve.ts` (parses `--port`, defaults 5174, fails fast on bad config with hint)
  - `packages/web/dist/index.html` ← **stub fixture** committed in WU-5 file_scope so SPA-fallback tests can run before WU-6a builds the real one. Replaced by the real Vite build in WU-6a — committed stub remains as a guard.
  - `packages/server/src/__tests__/{server,routes,method-guard,spa,serve}.test.ts`
- **out_of_scope:** SPA code (WU-6a/6b), CLI dispatcher (WU-7).
- **dod_items:**
  1. `serve` starts Fastify on 5174 (overridable via `--port`).
  2. `GET /api/projects` returns `GetProjectsResponse` (200, JSON, validated by Zod in test).
  3. `GET /api/projects/:name` returns `GetProjectByNameResponse`; 404 for unknown name with `ApiError` envelope.
  4. `GET /api/agents` returns `GetAgentsResponse`.
  5. `POST /api/projects` (and `PUT/DELETE/PATCH` on any `/api/*`) returns 405 with `Allow: GET` header.
  6. `serve` exits non-zero with stderr message ``Run `metaswarm-dashboard config init` `` when config is missing/invalid.
  7. Requests to `/`, `/projects/foo`, `/agents` (non-`/api`, non-asset) return `index.html` from `packages/web/dist`.
  8. Requests to `/assets/<hash>.js` return the file with correct content-type via `@fastify/static`.
  9. All HTTP tests use `app.inject()` (built-in, no port binding).
- **tests:** see file_scope; SPA-fallback test uses the committed stub `packages/web/dist/index.html`.
- **validation_commands:**
  - `npm run typecheck --workspace packages/server`
  - `npm run test:coverage --workspace packages/server`

### WU-6a — Vue 3 SPA scaffold + Projects index view

- **id:** WU-6a
- **title:** Implement Vue 3 + naive-ui SPA scaffold with history routing and the Projects index view
- **depends_on:** [WU-5]
- **human_checkpoint:** **TRUE** — satisfies issue checkpoint #2 ("after projects-index view ships"). Deliverable: `docs/screenshots/projects-index.png` captured via the `metaswarm:visual-review` skill, attached to the checkpoint message.
- **file_scope:**
  - `packages/web/src/main.ts`, `packages/web/src/App.vue`, `packages/web/src/router.ts`
  - `packages/web/src/views/ProjectsIndex.vue`
  - `packages/web/src/composables/useProjects.ts`
  - `packages/web/src/components/{ProjectCard,EmptyState}.vue`
  - `packages/web/src/api/client.ts` (typed `fetch` wrapper using `@metaswarm-dashboard/types/api`)
  - `packages/web/src/__tests__/{ProjectsIndex,ProjectCard,EmptyState,useProjects}.test.ts`
  - `docs/screenshots/projects-index.png` (committed)
- **out_of_scope:** Project detail and Agents views (WU-6b), API server (WU-5 done).
- **dod_items:**
  1. `npm run build --workspace packages/web` produces `packages/web/dist/index.html` plus assets, exits 0.
  2. ProjectsIndex renders one `<NCard>` per project with all four metrics from `ProjectSummary` (`activeTasks`, `blockedTasks`, `prsMergedLast7d` rendered as "—" when `null`, `lastActivityAt`).
  3. Clicking a card navigates via `router.push({ name: 'project-detail', params: { name } })`; browser back returns to index (jsdom test asserts route history).
  4. Empty state: when `hasMetrics === false`, view shows `EmptyState` with text ``No metrics yet — run `metaswarm-dashboard collect` ``.
  5. naive-ui `NConfigProvider` wraps the app with `darkTheme`.
  6. Screenshot of Projects index against fixture data captured and committed.
- **tests:**
  - Component tests with `@vue/test-utils` + jsdom.
  - Composable tests mock `fetch` via `vi.spyOn(globalThis, 'fetch')`.
- **validation_commands:**
  - `npm run typecheck --workspace packages/web`
  - `npm run test:coverage --workspace packages/web`
  - `npm run build --workspace packages/web`

### WU-6b — Project detail view + Agents view + sparkline

- **id:** WU-6b
- **title:** Implement Project detail and cross-project Agents views with sortable tables and throughput sparkline
- **depends_on:** [WU-6a]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/web/src/views/{ProjectDetail,AgentsView}.vue`
  - `packages/web/src/composables/{useProjectDetail,useAgents}.ts`
  - `packages/web/src/components/{AgentTable,ThroughputSparkline}.vue`
  - `packages/web/src/__tests__/{ProjectDetail,AgentsView,AgentTable,ThroughputSparkline,useProjectDetail,useAgents}.test.ts`
- **out_of_scope:** Projects index (WU-6a done), CLI binary (WU-7).
- **dod_items:**
  1. ProjectDetail renders an `<NDataTable>` with sortable columns: agent, tasksCompleted, successRate (% formatted), avgDurationSeconds.
  2. ProjectDetail renders the throughput sparkline (last 14 days, gaps as 0) and a list of recent work units (max 25).
  3. AgentsView renders cross-project aggregates from `GET /api/agents` with the same sortable column pattern.
  4. **No write actions in the UI** — verified by manual review during the WU-6b adversarial-review phase + by the server-side 405 method guard test in WU-5. (No grep/static check; the 405 guard is the runtime guarantee.)
- **tests:** as per file_scope.
- **validation_commands:**
  - `npm run typecheck --workspace packages/web`
  - `npm run test:coverage --workspace packages/web`
  - `npm run build --workspace packages/web`

### WU-7 — Single-binary CLI dispatcher and `--help` output

- **id:** WU-7
- **title:** Wire `bin/metaswarm-dashboard` ESM dispatcher to `collect`, `serve`, `config init` with helpful `--help`
- **depends_on:** [WU-3, WU-5]
- **human_checkpoint:** false
- **file_scope:**
  - `bin/metaswarm-dashboard` (Node ESM shebang script using `commander` declared at the root `package.json`)
  - `packages/collector/src/cli/help.ts`, `packages/server/src/cli/help.ts` (per-subcommand help text)
  - `packages/collector/src/__tests__/cli-dispatcher.test.ts`
- **out_of_scope:** SPA code, schema changes, root-level `npm run test:coverage` (would pull in WU-6 which may not be done yet during parallel execution).
- **dod_items:**
  1. `metaswarm-dashboard --help` lists all 3 subcommands with one-line descriptions.
  2. `metaswarm-dashboard collect --help`, `metaswarm-dashboard serve --help`, `metaswarm-dashboard config init --help` each print useful usage including default port (5174), env-var overrides, and example invocations.
  3. Unknown subcommand exits 2 with `--help` hint.
  4. Binary is `chmod +x` and works when invoked as `./bin/metaswarm-dashboard ...` after `npm run build`.
  5. End-to-end smoke test: spawn the binary with `--help`, assert exit 0 and stdout contains "collect", "serve", "config init".
- **tests:**
  - Spawn-based test using `child_process.execFile` against the actual binary.
- **validation_commands** (note: scoped to WU-7's deps, not root, to avoid triggering incomplete WU-6 packages):
  - `npm run build --workspace packages/types --workspace packages/collector --workspace packages/server`
  - `npm run test:coverage --workspace packages/collector --workspace packages/server`
  - `./bin/metaswarm-dashboard --help`

### WU-8 — README, screenshots, walkthrough checklist, final 100%-coverage polish

- **id:** WU-8
- **title:** Document install / config / collect / serve, capture remaining screenshots, run fixture-based zero-footprint walkthrough, finalize for merge
- **depends_on:** [WU-6b, WU-7]
- **human_checkpoint:** **TRUE** — satisfies issue checkpoint #3 ("before merging the MVP — full walkthrough on real `.beads/` data from at least 2 projects, confirm zero-footprint guarantee").
- **file_scope:**
  - `README.md` (replace stub: install, prerequisites linking to `docs/BEADS-BOOTSTRAP.md`, `config init`, `collect`, `serve`, troubleshooting, screenshots)
  - `docs/screenshots/{project-detail,agents-view}.png` (Projects index already captured in WU-6a)
  - `docs/CHECKPOINT-3-WALKTHROUGH.md` (template + filled-in log: enumerated steps, host repo paths used, `git status` outputs before/after, screenshot diffs)
  - any final test additions to hit 100% lines/branches/functions/statements per `.coverage-thresholds.json`
- **out_of_scope:** new product features.
- **dod_items:**
  1. README has sections: Overview, Architecture sketch, Prerequisites (link to `docs/BEADS-BOOTSTRAP.md`, `nvm use` step, `gh auth login` if PR-merged metric is wanted), Install, `config init`, `collect`, `serve`, Troubleshooting, Roadmap (Step 2/3 as explicit non-goals).
  2. All three screenshots present and referenced inline in README.
  3. `npm run test:coverage` passes the `.coverage-thresholds.json` enforcement (100/100/100/100) at the workspace root, on both ubuntu and macos in CI.
  4. **Fixture-based walkthrough:** `docs/CHECKPOINT-3-WALKTHROUGH.md` contains the filled-in template documenting `collect --all` against the two committed fixture host repos in `packages/collector/src/__tests__/fixtures/host-repos/`, including pre/post `git status` confirming zero-footprint, and screenshot refresh log. (Operator may additionally walkthrough on real personal `.beads/` projects, but the fixture-based pass is the DoD-required evidence — it is reproducible in CI and on every clone.)
- **tests:** coverage gate is the test.
- **validation_commands:**
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run build`

---

## 4. Cross-cutting concerns

### 4.1 Coverage strategy

- Root vitest config uses workspace projects so a single `npm run test:coverage` rolls up to one report. v8 coverage provider. Thresholds read from `.coverage-thresholds.json` (lines/branches/functions/statements all 100). Each WU adds its own tests so the threshold is hit incrementally; orchestrator rejects a WU commit if coverage is < 100 on the changed package.
- Pure functions (`metrics.ts`, `aggregator.ts`) get the heaviest property-test coverage. CLI dispatchers get spawn tests. `bin/metaswarm-dashboard` is included in vitest workspace projects via a dedicated `bin/` workspace project so its coverage is rolled up.

### 4.2 Lint / format

- Root `.eslintrc.cjs` extends `@typescript-eslint/recommended-type-checked` + `eslint-plugin-vue` (only in `packages/web`). `@typescript-eslint/no-explicit-any: error`. `eslint-plugin-import` for ordered imports. ESLint pinned to `^9.0.0`.
- Prettier 3, single quote, trailing commas all, 100-col line. `.prettierignore` excludes `dist/`, `coverage/`, snapshot fixtures.

### 4.3 CI

The existing `.github/workflows/ci.yml` is rewritten in WU-1:

1. `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22, npm 10.
2. Jobs (per OS): `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`.
3. ubuntu-only smoke step after build: `node ./bin/metaswarm-dashboard --help`.
4. CI does **not** install `dolt` or `bd` — collector tests inject the executor and never invoke real `bd`.

### 4.4 README sections (WU-8)

Required: Overview, Architecture sketch, Prerequisites (node 22 via `.nvmrc`, `dolt` for BEADS bootstrap, optional `gh auth login`), Install (`bin/bootstrap-beads.sh`), `metaswarm-dashboard config init`, `metaswarm-dashboard collect`, `metaswarm-dashboard serve`, Screenshots (3), Troubleshooting (missing config, missing `dolt`/`bd`, port in use, GITHUB_TOKEN missing → "—" rendering), Roadmap (Step 2 evals, Step 3 observability — explicit non-goals).

### 4.5 Cross-package type sharing

`packages/types` is the single source of truth. `tsconfig.base.json` defines TS project references; `packages/{collector,server,web}/tsconfig.json` add `references: [{ path: "../types" }]`. Imports resolve source-to-source — no build step for `packages/types`.

---

## 5. Risk register

| # | Risk | Source | Likelihood | Impact | Mitigation |
|---|------|--------|------------|--------|------------|
| R1 | `bd list --json` output shape changes between minor versions, silently breaking the collector | issue | M | H | Pin BEADS minor version in README prerequisite; WU-3 wraps `bd` output in a Zod schema and fails loudly on parse error. |
| R2 | macOS XDG conventions ambiguous (`~/Library/Application Support` vs `~/.config`) | issue | M | M | Default to Apple HIG path on darwin; honor `XDG_*` env vars when set; document both in README; cover both branches in WU-2 tests. |
| R3 | `~` expansion + Windows path edge cases | issue | L | M | Use `os.homedir()` + `path.join`; document Windows as not supported in MVP; CI runs ubuntu + macos only. |
| R4 | Config-YAML UX clunky if user has many projects | issue | M | L | Out of scope for MVP; schedule follow-up; ensure error messages always point to `config init`. |
| R5 | Zero-footprint contract violated by stray write | architect | L | H | WU-3 zero-footprint test runs `--all` against fixtures and recursive-sha256-diffs both directories; failing the test fails the WU. |
| R6 | `dolt` not on the cloner's machine | architect | M | M | WU-0 bootstrap script detects and prints actionable error; README documents `brew install dolt` / equivalent. |
| R7 | Cross-package TS project references break under npm workspaces hoisting | architect | L | M | WU-1 sanity test imports a type from `@metaswarm-dashboard/types` in each consumer package; failing typecheck fails the WU. |
| R8 | naive-ui major-version churn | architect | L | M | Pin to caret-minor (`^2.40.0`); package-lock.json committed. |
| R9 | Coverage at 100% brittle around platform-specific branches | architect | M | M | Tests mock `process.platform` to exercise both arms; CI matrix runs both real platforms as a second guarantee. |
| R10 | `bd` binary missing on the operator's machine | architect | M | M | WU-3 ENOENT handler points to `docs/BEADS-BOOTSTRAP.md`. |
| R11 | Node 18 (current dev machine) vs node 22 (target) — `npm ci` fails with engine errors | round-1 reviewer | H | M | `.nvmrc` + `engines.node: ">=22"` + README Prerequisites section. |
| R12 | `gh` CLI not authenticated when collector runs → `prsMergedLast7d` always `null` | architect | H | L | Documented degraded mode (UI shows "—"); WU-3 tests cover all 4 token/binary combinations. |
| R13 | `/start-task` does not gate on `bd ready` — workflow proceeds when BEADS is unavailable | meta (out of scope here) | H | M | Track as upstream issue against the metaswarm plugin marketplace; out of scope for #1. |

---

## 6. Traceability — issue DoD bullets → WU dod_items

| Issue DoD bullet | WU.dod_item |
|---|---|
| **Zero-footprint guarantee** — host project git status unchanged | WU-3.14 |
| `collect --project <name>` produces daily JSON matching schema | WU-3.1 |
| `collect --all` iterates every project | WU-3.2 |
| Re-running same day overwrites without duplicates | WU-3.3 |
| Monday run produces weekly file for prior ISO week | WU-3.4 |
| Unit tests: empty / mixed / malformed / missing path | WU-3.5, WU-3.6, WU-3.7 |
| `serve` starts Fastify on port 5174 (overridable) | WU-5.1 |
| `GET /api/projects` returns project summaries | WU-5.2 |
| `GET /api/projects/:name` returns project detail | WU-5.3 |
| `GET /api/agents` returns cross-project aggregate | WU-5.4 |
| Non-GET method returns 405 | WU-5.5 |
| Server refuses to start on missing/invalid config with hint | WU-5.6 |
| Projects index renders one card per project (4 metrics) | WU-6a.2 |
| Click project card → detail; back navigation works | WU-6a.3 |
| Project detail per-agent table sortable | WU-6b.1 |
| Project detail throughput sparkline + recent work units | WU-6b.2 |
| Agents view cross-project aggregation | WU-6b.3 |
| No write/POST/PUT/DELETE actions in UI | WU-6b.4 (manual review) + WU-5.5 (server-side runtime guard) |
| Empty-state messaging | WU-6a.4 |
| `npm run build` from `packages/web/` exits 0 | WU-6a.1 |
| TypeScript strict, no `any` | WU-1.2, WU-1.3 |
| ESLint + Prettier pass on all packages | WU-1.1, §4.2 |
| Coverage meets `.coverage-thresholds.json` | WU-8.3 (cumulative; each WU contributes) |
| All three subcommands have useful `--help` | WU-7.1, WU-7.2 |
| README documents install/config/collect/serve + screenshots | WU-8.1, WU-8.2 |
| **`prsMergedLast7d` (4th metric on Projects index)** | WU-3.16 (collector populates), WU-4 (passes through), WU-6a.2 (renders, "—" on null) |
| **`.beads/` set up for metaswarm orchestration of this repo (dogfooding)** | WU-0 (bootstrap script + docs), already executed by orchestrator before plan-review-gate v2 |
| CI matrix runs on multiple OSes given platform-specific code | WU-1.4, §4.3 |
| Sample snapshot JSON (human checkpoint #1 deliverable) | WU-3.17 |
| Projects-index screenshot (human checkpoint #2 deliverable) | WU-6a.6 |
| Walkthrough log (human checkpoint #3 deliverable) | WU-8.4 |

**No DoD bullets remain unmapped.**

---

## 7. Orchestration notes

- **Parallelization graph:**
  - WU-0 → WU-1 (sequential)
  - WU-1 → WU-2 → WU-3 (sequential, data layer first)
  - WU-3 → WU-4 → WU-5 (sequential, server consumes data layer)
  - WU-5 → WU-6a (sequential, SPA scaffold consumes server)
  - WU-6a → WU-6b (sequential, second-half views build on scaffold)
  - WU-3 + WU-5 → WU-7 (parallel-after-deps; WU-7 can run in parallel with WU-6a/6b)
  - WU-6b + WU-7 → WU-8 (final merge gate)
- **Human checkpoints:** WU-3 (data-layer schema firm; deliverable: `docs/samples/daily-snapshot.example.json`), WU-6a (Projects index visible; deliverable: `docs/screenshots/projects-index.png`), WU-8 (pre-merge walkthrough; deliverable: `docs/CHECKPOINT-3-WALKTHROUGH.md`).
- **External-tools delegation:** disabled per `.metaswarm/project-profile.json` (`external_tools: false`). All work runs through Claude.
- **Plan-review-gate (v2):** this plan is now the input to a fresh round of 3 adversarial reviewers (Feasibility, Completeness, Scope & Alignment). Round-1 blockers are addressed; new issues will surface only on truly novel claims.

---

## 8. Round-1 → v2 fixes (audit trail)

| Round-1 finding | Resolution in v2 | Where |
|---|---|---|
| F1: `@fastify/inject` doesn't exist | Use built-in `app.inject()` | WU-5.9 |
| F2: Node 18 vs 22 mismatch | `.nvmrc` + `engines.node: ">=22"` + README | §2.9, WU-1, R11 |
| F3: Inconsistent `npm run build` invocation | Single canonical `npm run build --workspaces --if-present` from a root `build` script | WU-1.5 |
| F4: WU-5 needs dist/index.html before WU-6 builds it | Stub `packages/web/dist/index.html` committed in WU-5 file_scope | WU-5 file_scope |
| F5: Vendored DTO sync handwaved | Replaced by `packages/types` workspace package + TS project references | §2.1, §2.8, §4.5 |
| F6: Grep "no write methods" self-matches | Removed entirely; rely on server 405 guard + manual review | WU-6b.4 |
| F7: WU-8 walkthrough requires real `.beads/` not available | Use committed fixture host repos in `packages/collector/src/__tests__/fixtures/host-repos/` | WU-3 file_scope, WU-8.4 |
| F8: WU-7 root `test:coverage` would re-run incomplete WU-6 | Validation scoped to collector + server workspaces only | WU-7 validation_commands |
| F9: Missing `"type": "module"` + commander resolution from `bin/` | Root `package.json` declares `"type": "module"` and runtime deps `commander`, `js-yaml` | WU-1 file_scope, WU-1.6 |
| C1: `prsMergedLast7d` cop-out (also S2) | Implemented via `gh pr list`, token-gated, degraded `null` | §2.7, WU-3.16, WU-6a.2 |
| C2: CI matrix not in DoD | Explicit `strategy.matrix.os: [ubuntu-latest, macos-latest]` DoD bullet | WU-1.4, §4.3 |
| C3: WU-3 edge cases miss agent-0/100%/DST/TZ | Enumerated; UTC chosen for daily key | WU-3.8–13, §2.3 |
| C4: Checkpoint deliverables not explicit | Each checkpoint WU now has a concrete committed artifact | WU-3.17, WU-6a.6, WU-8.4 |
| C5: BEADS dogfooding deferral needs sign-off | Replaced by WU-0 (bootstrap script + docs); operator already approved during plan-review-gate iteration | WU-0, §2.2 |
| C6: WU-4 schema-drift risk | Schemas live in `packages/types`; cross-WU integration test in WU-4 | §2.8, WU-4.6 |
| S1: External-tools mention contradicts user choice | Removed; §7 explicitly notes external tools disabled | §7 |
