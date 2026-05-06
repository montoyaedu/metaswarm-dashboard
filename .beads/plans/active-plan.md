# Implementation Plan — Issue #1 (v3)

- **status:** draft (awaiting Plan Review Gate v3)
- **created_at:** 2026-05-06
- **issue:** [#1 — feat: MVP read-only dashboard for multi-project metaswarm visibility](https://github.com/montoyaedu/metaswarm-dashboard/issues/1)
- **beads_epic:** `metaswarm-dashboard-lo0`
- **author:** orchestrator (Claude) after round-2 plan-review-gate failures
- **target estimate:** ~1 working week
- **execution model:** metaswarm orchestrated-execution (4-phase per WU: IMPLEMENT → VALIDATE → ADVERSARIAL REVIEW → COMMIT)

---

## 0. Out-of-band setup (NOT a WU; already executed by the operator)

These steps were performed before the Plan Review Gate v3 and are deliberately **NOT** tracked as a WU because they fall under "metaswarm framework setup", not "issue #1 dashboard scope":

- `dolt sql-server -H 127.0.0.1 -P 3307` started in the background with data-dir at `~/.local/share/metaswarm-dashboard-bd-server/`.
- `BEADS_DOLT_PASSWORD="" bd init --server` against that server. `.beads/dolt-server.port` and the rest of the BEADS scaffold are committed via `bd init`'s own auto-commit.
- Root `.gitignore` adjusted to NOT exclude `.beads/plans|context|knowledge|issues.jsonl` (the metaswarm setup default would have broken cross-machine portability).
- BEADS knowledge base (`.beads/knowledge/*.jsonl`) restored from the metaswarm plugin source.
- Initial `bd export -o .beads/issues.jsonl` committed.

The README's Prerequisites section (WU-7) will tell new cloners how to recreate this state in one paragraph and link to the upstream BEADS docs. **No bootstrap script is shipped**: that would be metaswarm-framework scope, not dashboard scope.

**Metaswarm OOTB gap discovered (track upstream, not in this plan):** `bd init` defaults to embedded Dolt requiring CGO; on CGO-less hosts it fails immediately. `/start-task` and other metaswarm skills do not gate on `bd ready`/`bd doctor`, so the workflow proceeds with a file-based fallback as if BEADS were healthy. Fix belongs in the marketplace `metaswarm:start` skill (pre-flight `bd ready` check). Captured in user-level memory and to-be-filed as upstream issue.

---

## 1. Summary

- Stand up an npm-workspaces monorepo (`packages/{types,collector,server,web}`) with TypeScript strict, Vitest, ESLint 9, Prettier 3, a thin `bin/metaswarm-dashboard` ESM shebang dispatching to per-workspace `cli/` modules, and a `.nvmrc`-pinned `22.12.0` toolchain.
- Implement a read-only collector that reads `.beads/` JSONL + `bd list --json` + (optionally, when `gh` is authenticated) `gh pr list` for each project in `config.yaml`, and writes XDG-aware per-project daily/weekly UTC snapshots — host repos remain byte-identical, asserted by an automated test.
- Implement a minimal Fastify server that refuses non-GET methods, fails fast on missing/invalid config, exposes 3 typed read-only endpoints, and serves the built SPA from `packages/web/dist` via `@fastify/static` with a `setNotFoundHandler` SPA fallback.
- Ship a Vue 3 + naive-ui SPA with three views (Projects index, Project detail, Agents cross-project) using `vue-router@5` history mode, composition-API state, and jest-axe a11y assertions on every view.
- Enforce 100% coverage from `.coverage-thresholds.json` (wired into `vitest.config.ts` via ESM JSON import), wire CI on ubuntu + macos with node 22.12.0, and document install / `config init` / `collect` / `serve` with three screenshots in the README.

---

## 2. Architecture decisions

### 2.1 Workspace layout — **npm workspaces, four packages**

- **Decision:** `npm workspaces` with `packages/types`, `packages/collector`, `packages/server`, `packages/web`. The four-package shape is **deliberate, not over-engineering**: it produces a clean dependency hierarchy (`types` ← {`collector`, `server`, `web`}; no cross-edges between consumers) which makes round-1's vendored-DTO drift impossible by construction.
- **Trade-off:** One extra `package.json`. Mitigated by `packages/types` containing only `.ts` declarations and Zod schemas — no runtime code, no separate build step. Consumers import via npm-workspaces symlinks (`@metaswarm-dashboard/types: "*"`); Vite resolves the symlinks the same way it resolves any node_modules dependency, independent of TS project references.

### 2.2 Snapshot file naming — **UTC daily-key + ISO-8601 weekly-key**

- Daily file: `YYYY-MM-DD.json` from `Date.toISOString().slice(0,10)` (UTC). Weekly file: `YYYY-Www.json` (literal `W`, four-digit ISO week-year, two-digit zero-padded week number).
- **Why UTC:** eliminates DST-induced double-day or skipped-day bugs.
- **Test coverage required:** week 1 from prior calendar year (2024-12-30 ⇒ 2025-W01), week 53 in long years (2026-12-31 ⇒ 2026-W53), DST-spring-forward (2026-03-29 EU), DST-fall-back (2026-10-25 EU) — each must produce one and only one daily key.

### 2.3 API + snapshot schemas — **defined in `@metaswarm-dashboard/types`**

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

export interface AgentBreakdown { agent: string; tasksCompleted: number; successRate: number; avgDurationSeconds: number; }
export interface RecentWorkUnit { id: string; title: string; status: "open" | "in_progress" | "blocked" | "closed"; agent: string | null; closedAt: string | null; }
export interface ThroughputPoint { date: string; closed: number; }   // YYYY-MM-DD UTC; 14 days, gaps server-filled with closed=0

export interface ProjectDetail {
  name: string;
  agents: AgentBreakdown[];
  throughput: ThroughputPoint[];   // exactly 14 entries; aggregator (server) is the owner of gap-filling
  recentWorkUnits: RecentWorkUnit[]; // newest first, max 25
  lastActivityAt: string | null;
}
export type GetProjectByNameResponse = ProjectDetail;

export interface AgentAggregate { agent: string; totalTasksCompleted: number; weightedSuccessRate: number; avgDurationSeconds: number; projects: { name: string; tasksCompleted: number }[]; }
export type GetAgentsResponse = AgentAggregate[];

export interface ApiError { error: { code: string; message: string; hint?: string }; }
```

```ts
// packages/types/src/snapshots.ts
export const DailySnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string(),
  generatedAt: z.string().datetime({ offset: false }), // ISO-8601 UTC
  agents: z.array(AgentMetrics),
  totals: SwarmMetrics,
  prsMergedLast7d: z.number().int().nonnegative().nullable(),
});
export const WeeklySnapshot = DailySnapshot.extend({
  isoWeek: z.string().regex(/^\d{4}-W\d{2}$/),
  complete: z.boolean(),    // false when prior week had no daily snapshots; collector still writes a row
});
```

`DailySnapshot` and `WeeklySnapshot` are imported by collector (write-side) and server (read-side). One source of truth.

### 2.4 SPA routing — **history mode + Fastify SPA fallback via `@fastify/static`**

- `vue-router@5` (latest) with `createWebHistory()`. `@fastify/static` serves `packages/web/dist/` (the **real build output** in production, an injectable `staticRoot` in tests). `setNotFoundHandler` returns `index.html` for non-`/api`, non-asset GETs.
- Test fixture (a tiny SPA stub) lives at `packages/server/src/__tests__/fixtures/spa-dist/index.html` — **NOT** in `packages/web/dist/` — so Vite's normal `dist/` git-ignore is preserved and tests do not depend on a prior `npm run build`.

### 2.5 State management — **composition-API composables only**

- `useProjects`, `useProjectDetail`, `useAgents` composables, one per endpoint. No Pinia.

### 2.6 PRs merged last 7d — **`gh pr list` per project, token-gated, degraded `null`**

- For each project, derive `<owner>/<repo>` from `git -C <project-path> remote get-url origin`. If derivable, run `gh pr list --repo <owner/repo> --state merged --json number,mergedAt --jq 'map(select(.mergedAt > "<ISO_7d_ago>")) | length'`. Use `--json` + `--jq` instead of `--search 'merged:>='` because `--state merged` already filters merged PRs and `mergedAt` is a precise timestamp comparison (the search filter is date-only and timezone-fuzzy).
- **Degraded mode (`null`):** any of: `GITHUB_TOKEN` unset, `gh auth status` fails, `gh` not on PATH, project has no GitHub remote, the GH API call fails, or the JSON parse fails. README documents the degraded state and the install/auth steps to recover it.
- The collector's `--all` summary line includes `(prsMergedLast7d: degraded)` for any project whose value is `null`, so the operator notices.

### 2.7 Cross-package type sharing — **workspace dependency on `@metaswarm-dashboard/types`**

- `packages/types` is a private workspace package (no `version`/`publish`). Consumers declare `"@metaswarm-dashboard/types": "*"` in their `package.json`. Imports resolve via npm-workspaces symlinks; both `tsc` and Vite consume them transparently.
- A `tsconfig.base.json` with `"composite": true` on the types project enables `tsc --build` to do incremental typechecking; Vite's bundler ignores TS project references but resolves the workspace via symlinks anyway, so this works end-to-end.

### 2.8 Node version pinning — **`.nvmrc 22.12.0` + `engines.node: ">=22.12.0"`**

- Why `22.12.0` specifically: Vite 8 requires `^20.19.0 || >=22.12.0`. `>=22` would let 22.0.0–22.11.x slip through.

### 2.9 CLI dispatcher — **thin shebang glue, logic in workspace `cli/` modules**

- `bin/metaswarm-dashboard` is a 10-line ESM shebang that:
  1. Imports `runCollect` from `@metaswarm-dashboard/collector/cli/collect.js`, `runServe` from `@metaswarm-dashboard/server/cli/serve.js`, `runConfigInit` from `@metaswarm-dashboard/collector/cli/config-init.js`.
  2. Uses `commander` (declared as a runtime dep of `packages/collector`, hoisted to root by npm workspaces and resolvable from `bin/`) to route subcommands.
- All testable logic lives in the imported modules and is covered in-process by their package's vitest run. The shebang itself is excluded from coverage via `vitest.config.ts` `coverage.exclude: ['bin/**']`. A single spawn-based smoke test in WU-6 asserts `--help` works end-to-end.

### 2.10 Coverage thresholds wiring — **ESM JSON import**

```ts
// vitest.config.ts (root, ESM)
import thresholds from './.coverage-thresholds.json' with { type: 'json' };
// ...
coverage: {
  provider: 'v8',
  reporter: ['text', 'json-summary'],
  thresholds: thresholds.thresholds,   // { lines: 100, branches: 100, functions: 100, statements: 100 }
  exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**'],
}
```

ESM import-attribute syntax (`with { type: 'json' }`) is supported on node ≥22.12 and is the canonical way to import JSON in pure-ESM projects.

---

## 3. Work Unit Decomposition

**8 WUs** (was 10 in v2; WU-0 dropped per scope review, WU-7 absorbed into WU-1's CLI scaffold). File scopes are disjoint across non-dependent WUs.

### WU-1 — Workspace skeleton, tooling, CLI dispatcher, CI matrix

- **id:** WU-1
- **title:** Bootstrap npm workspaces (4 packages), TypeScript strict, ESLint 9 / Prettier 3, Vitest 4 with coverage thresholds wired from JSON, ESM dispatcher in `bin/`, CI on ubuntu+macos × node 22.12.0
- **depends_on:** none
- **human_checkpoint:** false
- **file_scope:**
  - `package.json` (root: `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": {"node": ">=22.12.0"}`, scripts `lint`, `typecheck`, `test`, `test:coverage`, `format:check`, `build`)
  - `.nvmrc` (`22.12.0`)
  - `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, project references), `tsconfig.json` (root, references all four packages)
  - `.eslintrc.cjs` (ESLint 9 flat-config equivalent if needed; ESLint 9 supports legacy `.eslintrc` via FLAT_CONFIG fallback), `.prettierrc`, `.prettierignore`, `.editorconfig`
  - `vitest.config.ts` (root; ESM JSON import of `.coverage-thresholds.json`; workspace projects: types/collector/server/web; v8 coverage; `coverage.exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**']`)
  - `packages/types/package.json` (private, name `@metaswarm-dashboard/types`), `packages/types/tsconfig.json` (`composite: true`), `packages/types/src/index.ts` (re-exports), `packages/types/src/api.ts` (placeholder skeleton, populated in WU-3/WU-4), `packages/types/src/snapshots.ts` (placeholder skeleton, populated in WU-3)
  - `packages/collector/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `commander`, `js-yaml`, `zod`), `packages/collector/tsconfig.json` (with `references: [{ path: "../types" }]`), `packages/collector/src/index.ts` (placeholder)
  - `packages/server/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `fastify`, `@fastify/static`, `zod`), `packages/server/tsconfig.json` (references types), `packages/server/src/index.ts` (placeholder)
  - `packages/web/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `vue`, `vue-router@5`, `naive-ui`, `vite`, `@vue/test-utils`, `jsdom`, `vitest-axe`), `packages/web/tsconfig.json` (references types), `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.ts` (naive-ui dark provider only)
  - `bin/metaswarm-dashboard` (10-line ESM shebang dispatcher; imports `runCollect`/`runServe`/`runConfigInit` from collector + server packages; uses `commander`)
  - `.github/workflows/ci.yml` (rewrite: `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22.12.0, runs lint/typecheck/test:coverage/build; ubuntu-only smoke `node ./bin/metaswarm-dashboard --help` after build; runs `shellcheck` on any `bin/*.sh` that already exist from setup)
- **out_of_scope:** product code (collector reading, server endpoints, SPA views), README content (WU-7).
- **dod_items:**
  1. `nvm use && npm ci && npm run lint && npm run typecheck && npm run test:coverage && npm run build` exits 0 on a fresh clone with node 22.12.0.
  2. TS strict (`"strict": true, "noUncheckedIndexedAccess": true`) inherited by all four packages.
  3. ESLint config bans `any` (`@typescript-eslint/no-explicit-any: error`).
  4. CI workflow runs lint/typecheck/test:coverage/build on `strategy.matrix.os: [ubuntu-latest, macos-latest]` with node 22.12.0.
  5. CI runs `shellcheck` on every executable `bin/*.sh` (catches drift in the existing setup-time helper scripts).
  6. `bin/metaswarm-dashboard --help` exits 0 and prints the three subcommand names.
  7. Root `npm run build` script fans out via `npm run build --workspaces --if-present` (single canonical invocation everywhere).
  8. `vitest.config.ts` reads coverage thresholds from `.coverage-thresholds.json` via ESM JSON import; thresholds change in the JSON file are picked up without code edits.
  9. A trivial test in each package imports a type from `@metaswarm-dashboard/types` and asserts type compatibility — proves the workspace dependency wiring is healthy.
- **tests:**
  - `packages/{types,collector,server,web}/src/__tests__/sanity.test.ts` — trivial.
  - `packages/web/src/__tests__/types-import.test.ts` etc. — see DoD #9.
- **validation_commands:**
  - `nvm use`
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
  - `packages/collector/src/paths.ts` (XDG resolution: data dir + config file, env overrides, `~` expansion via `os.homedir()`)
  - `packages/collector/src/config.ts` (load + validate `config.yaml` with Zod)
  - `packages/collector/src/cli/config-init.ts` (writes a starter config; refuses overwrite without `--force`; creates parent dirs)
  - `packages/collector/src/__tests__/{paths,config,config-init}.test.ts`
- **out_of_scope:** the dispatcher (WU-1 already wired), the collector core (WU-3), the server (WU-4).
- **dod_items:**
  1. `paths.dataDir()`/`paths.configFile()` honor darwin and linux conventions and `METASWARM_DASHBOARD_*` env overrides; both branches tested via mocked `process.platform` AND exercised by the real platform on the CI matrix.
  2. `loadConfig()` parses YAML, expands `~`, returns typed `{ projects: { name; path }[] }`, throws `ConfigError` with hint pointing to `config init` on missing/invalid config.
  3. `config init` writes a starter YAML (two commented-out example entries); refuses overwrite without `--force`; creates parent dirs.
  4. **Rollback note:** revertable by deleting the written `config.yaml` (or via the `config init` `--force` overwrite).
- **tests:** `process.env` mocking with `pool: 'forks'`; `os.homedir` injection; `memfs` is **not** introduced (round-2 reviewer flagged it as scope creep) — instead, tests use real-fs writes into the `vitest` temp dir via `fs.mkdtempSync`.
- **validation_commands:** `npm run typecheck --workspace packages/collector` ; `npm run test:coverage --workspace packages/collector`

### WU-3 — Collector core: schemas, readers, metrics, atomic writer, GitHub PR fetch, zero-footprint test

- **id:** WU-3
- **title:** Implement collector that reads host `.beads/` JSONL + `bd list --json` + `gh pr list`, computes per-agent metrics, writes daily + weekly UTC snapshots; populate `@metaswarm-dashboard/types` schemas
- **depends_on:** [WU-2]
- **human_checkpoint:** **TRUE** — issue checkpoint #1 ("after data-layer schema is firm"). Deliverable: `docs/samples/daily-snapshot.example.json` committed.
- **file_scope:**
  - `packages/types/src/snapshots.ts` (populate Zod schemas from §2.3)
  - `packages/types/src/api.ts` (populate schemas from §2.3)
  - `packages/collector/src/beads-reader.ts` (reads `.beads/*.jsonl` line-by-line, skips malformed rows with `console.warn`, runs `bd list --json` via `child_process.execFile` with 30s timeout)
  - `packages/collector/src/github-reader.ts` (`gh pr list --repo <o/r> --state merged --json number,mergedAt --jq 'map(select(.mergedAt > "<iso7dago>")) | length'` if `GITHUB_TOKEN` is set, `gh auth status` succeeds, `gh` is on PATH, and the project has a derivable GitHub remote; returns `null` on any failure)
  - `packages/collector/src/metrics.ts` (pure: rows → `AgentMetrics`/`SwarmMetrics`; UTC daily key; ISO week-year + week computation)
  - `packages/collector/src/writer.ts` (atomic write: `fs.writeFile` to a temp path under the same dir, then `fs.rename`; on rename failure, deletes the temp; idempotent)
  - `packages/collector/src/cli/collect.ts` (handles `--project <name>` and `--all`; per-project summary line includes `(prsMergedLast7d: degraded)` when `null`; exit 0 even when individual projects skipped)
  - `packages/collector/src/__tests__/{schema,beads-reader,github-reader,metrics,writer,collect,zero-footprint,writer-error-paths}.test.ts`
  - `packages/collector/src/__tests__/fixtures/host-repos/{empty-project,mixed-tasks,malformed-jsonl,missing-path}/.beads/issues.jsonl` (≤50 lines per file; no `dolt/` subtree; one realistic mixed-tasks fixture, three corner-case fixtures)
  - `docs/samples/daily-snapshot.example.json` (committed; checkpoint #1 review artifact)
- **out_of_scope:** the dispatcher (WU-1), the server (WU-4), any UI code.
- **dod_items:**
  1. `collect --project <name>` writes `<data-dir>/projects/<name>/daily/YYYY-MM-DD.json` matching `DailySnapshot` Zod schema.
  2. `collect --all` iterates every project in `config.yaml`.
  3. Re-running same UTC day overwrites snapshot; no duplicate entries.
  4. Monday (UTC) run also writes `<data-dir>/projects/<name>/weekly/YYYY-Www.json` for the prior ISO week. Asserted by fake-timer tests on Monday + Tuesday + Sunday.
  5. Empty project (no `.beads/`) → skip + clear log line, exit 0.
  6. Malformed JSONL row → skip + log, never crash.
  7. Missing project path → skip + log, exit 0.
  8. Agent with 0 completed tasks → `AgentMetrics` row with `tasksCompleted: 0, successRate: 0`.
  9. Agent with all-success → `successRate: 1.0` (no division-by-zero).
  10. **Single-snapshot weekly fallback:** if the prior week had no daily snapshots, the weekly file contains `{ ..., complete: false }`.
  11. DST-spring-forward (2026-03-29 EU) and DST-fall-back (2026-10-25 EU) each produce exactly one daily key (UTC).
  12. ISO-week boundaries: 2024-12-30 UTC → daily `2024-12-30`, weekly `2025-W01`. 2026-12-31 UTC → weekly `2026-W53`.
  13. **Zero-footprint:** `zero-footprint.test.ts` snapshots fixture host repos' contents (recursive sha256), runs `collect --project` and `collect --all`, re-snapshots, asserts equality.
  14. `bd` invoked with `execFile` (no shell) and 30s timeout; ENOENT surfaces actionable error referencing the README's "BEADS prerequisite" section.
  15. `prsMergedLast7d` populated when `GITHUB_TOKEN` set + `gh auth status` succeeds + `gh` on PATH + project has GitHub remote + API call succeeds; otherwise `null`. Asserted by 5 tests covering each failure axis individually.
  16. **Atomic-write error paths:** `writer.ts` is tested for `fs.rename` failure (simulated via injected fs); on failure, the temp file is removed and the error is propagated with a clear message; coverage of error branches verified.
  17. `docs/samples/daily-snapshot.example.json` parses through `DailySnapshot` Zod schema in a CI test — drift fails the build.
  18. **Rollback note:** revertable by deleting written snapshot files in the data dir; no host-repo state mutated (zero-footprint).
- **tests:** see file_scope. `bd list --json` and `gh pr list` mocked via injected executors. **No `fast-check`** (round-2 reviewer scope-flagged it; the enumerated date cases in DoD #11–12 are sufficient).
- **validation_commands:** `npm run typecheck --workspace packages/collector` ; `npm run test:coverage --workspace packages/collector` ; `npm run typecheck --workspace packages/types`

### WU-4 — Snapshot reader + aggregator + Fastify server

- **id:** WU-4
- **title:** Implement server-side snapshot reader, aggregator (gap-filled throughput), Fastify with read-only API + 405 method guard + SPA fallback
- **depends_on:** [WU-3]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/server/src/data/snapshot-reader.ts` (lists snapshots under `<data-dir>/projects/<name>/daily/`, parses with `DailySnapshot` from `@metaswarm-dashboard/types`, returns most-recent + 14-day window)
  - `packages/server/src/data/aggregator.ts` (pure: `toProjectSummary`, `toProjectDetail` (owns the 14-day throughput gap-fill — fewer than 14 daily files ⇒ missing days emitted as `closed: 0`, schema invariant: `throughput.length === 14`), `toAgentAggregates`)
  - `packages/server/src/server.ts` (factory: `buildServer({ dataDir, staticRoot })` returns Fastify instance — testable via built-in `app.inject()`)
  - `packages/server/src/routes/{projects,projects-by-name,agents}.ts`
  - `packages/server/src/plugins/method-guard.ts` (rejects non-GET on `/api/*` with 405 + `Allow: GET`)
  - `packages/server/src/plugins/spa.ts` (registers `@fastify/static` against `staticRoot` parameter; `setNotFoundHandler` returns `index.html` for non-`/api`, non-asset GETs)
  - `packages/server/src/cli/serve.ts` (parses `--port`, defaults 5174, fails fast on bad config, passes `staticRoot: path.resolve('packages/web/dist')` in production)
  - `packages/server/src/__tests__/{snapshot-reader,aggregator,server,routes,method-guard,spa,serve,integration-with-collector}.test.ts`
  - `packages/server/src/__tests__/fixtures/spa-dist/index.html` (tiny SPA stub for the `setNotFoundHandler` tests; lives outside `packages/web/dist/` so the Vite build output stays git-ignored)
  - `packages/server/src/__tests__/fixtures/data-dir/` (2 fixture projects, ≥14 days of snapshots; each JSONL ≤50 lines)
- **out_of_scope:** SPA code (WU-5/WU-6), CLI dispatcher (WU-1 done), schema changes (live in `@metaswarm-dashboard/types`).
- **dod_items:**
  1. `snapshotReader.listProjects()` returns all dirs under `<data-dir>/projects/` with ≥1 daily snapshot.
  2. `snapshotReader.latestDaily(name)` returns the lex-greatest `YYYY-MM-DD.json` parsed via Zod (or `null`).
  3. `aggregator.toProjectSummary` produces exact `ProjectSummary` shape, including `hasMetrics: false` when no daily snapshots and `prsMergedLast7d` echoed through (preserves `null`).
  4. `aggregator.toProjectDetail` always returns `throughput: ThroughputPoint[]` of length exactly 14, with missing days filled `{ date, closed: 0 }`. Asserted by tests with 0/1/7/14 daily snapshots.
  5. `aggregator.toAgentAggregates` weights `successRate` by `tasksCompleted` across projects (verified with hand-computed expected values).
  6. Invalid/corrupt snapshot file → log + skip that file, surface remaining data.
  7. `serve` starts Fastify on 5174 (overridable via `--port`).
  8. `GET /api/projects` returns `GetProjectsResponse` (200, JSON, validated by Zod in test).
  9. `GET /api/projects/:name` returns `GetProjectByNameResponse`; 404 for unknown name with `ApiError` envelope.
  10. `GET /api/agents` returns `GetAgentsResponse`.
  11. `POST /api/projects` (and `PUT/DELETE/PATCH` on any `/api/*`) returns 405 with `Allow: GET` header.
  12. `serve` exits non-zero with stderr ``Run `metaswarm-dashboard config init` `` when config is missing/invalid.
  13. Requests to `/`, `/projects/foo`, `/agents` return `index.html` from the configured `staticRoot`.
  14. Requests to `/assets/<hash>.js` return the file with correct content-type via `@fastify/static`.
  15. All HTTP tests use `app.inject()` (built-in) — no port binding.
  16. **Cross-WU integration test:** runs the WU-3 writer and the WU-4 reader against the same temp dir, asserts shape compatibility end-to-end. Fails CI if WU-3's writer ever drifts from `@metaswarm-dashboard/types/snapshots`.
  17. **Rollback note:** revertable by `git revert`; no persistent state mutated outside the data dir.
- **validation_commands:** `npm run typecheck --workspace packages/server` ; `npm run test:coverage --workspace packages/server`

### WU-5 — SPA scaffold + Projects index view + a11y

- **id:** WU-5
- **title:** Implement Vue 3 + naive-ui SPA scaffold with history routing, the Projects index view, and a11y assertions
- **depends_on:** [WU-4]
- **human_checkpoint:** **TRUE** — issue checkpoint #2 ("after projects-index view ships"). Deliverable: `docs/screenshots/projects-index.png` (deterministic, captured against a committed fixture data dir).
- **file_scope:**
  - `packages/web/src/main.ts`, `packages/web/src/App.vue`, `packages/web/src/router.ts`
  - `packages/web/src/views/ProjectsIndex.vue`
  - `packages/web/src/composables/useProjects.ts`
  - `packages/web/src/components/{ProjectCard,EmptyState}.vue`
  - `packages/web/src/api/client.ts` (typed `fetch` wrapper using `@metaswarm-dashboard/types/api`)
  - `packages/web/src/__tests__/{ProjectsIndex,ProjectCard,EmptyState,useProjects,a11y}.test.ts`
  - `docs/screenshots/projects-index.png` (committed)
- **out_of_scope:** Project detail and Agents views (WU-6); API server (done in WU-4).
- **dod_items:**
  1. `npm run build --workspace packages/web` produces `packages/web/dist/index.html` plus assets, exits 0.
  2. ProjectsIndex renders one `<NCard>` per project with all four metrics (`activeTasks`, `blockedTasks`, `prsMergedLast7d` rendered as "—" when `null`, `lastActivityAt` formatted relative-time).
  3. Clicking a card navigates via `router.push({ name: 'project-detail', params: { name } })`; jsdom test asserts route history (back returns to index).
  4. Empty state: when `hasMetrics === false`, view shows `EmptyState` with text ``No metrics yet — run `metaswarm-dashboard collect` ``.
  5. naive-ui `NConfigProvider` wraps the app with `darkTheme`.
  6. **a11y:** `vitest-axe` test on a rendered ProjectsIndex with mock data (3 cards) reports zero violations at the WCAG 2.1 AA level.
  7. **Deterministic screenshot:** captured via the `metaswarm:visual-review` skill against a committed fixture data dir served by the WU-4 server. Reproducible — `npm run screenshots:projects-index` regenerates it; CI does NOT auto-regenerate (avoids dirty-tree noise).
  8. **Rollback note:** revertable by `git revert`; no persistent client-side state.
- **validation_commands:** `npm run typecheck --workspace packages/web` ; `npm run test:coverage --workspace packages/web` ; `npm run build --workspace packages/web`

### WU-6 — Project detail view + Agents view + sparkline + dispatcher smoke + a11y

- **id:** WU-6
- **title:** Implement Project detail and cross-project Agents views with sortable tables, throughput sparkline, end-to-end dispatcher smoke, a11y assertions
- **depends_on:** [WU-5]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/web/src/views/{ProjectDetail,AgentsView}.vue`
  - `packages/web/src/composables/{useProjectDetail,useAgents}.ts`
  - `packages/web/src/components/{AgentTable,ThroughputSparkline}.vue`
  - `packages/web/src/__tests__/{ProjectDetail,AgentsView,AgentTable,ThroughputSparkline,useProjectDetail,useAgents,a11y-detail,a11y-agents}.test.ts`
  - `packages/collector/src/__tests__/cli-dispatcher-smoke.test.ts` (spawn-based smoke against `bin/metaswarm-dashboard --help`; verifies the dispatcher wires up after WU-3 + WU-4 cli modules exist)
- **out_of_scope:** Projects index (WU-5 done).
- **dod_items:**
  1. ProjectDetail renders `<NDataTable>` with sortable columns: agent, tasksCompleted, successRate (% formatted), avgDurationSeconds.
  2. ProjectDetail renders the throughput sparkline (14 days from `ThroughputPoint[]`) and a list of recent work units (max 25).
  3. AgentsView renders cross-project aggregates from `GET /api/agents`.
  4. **No write actions in the UI** — the runtime guarantee is the server-side 405 method guard (WU-4.11). The UI itself contains only `fetch(... { method: 'GET' })` (or default GET). Manual review during the WU-6 adversarial-review phase verifies no `POST/PUT/DELETE/PATCH` literals in `packages/web/src/`.
  5. **a11y:** `vitest-axe` tests on rendered ProjectDetail and AgentsView report zero WCAG 2.1 AA violations.
  6. Dispatcher smoke: `child_process.execFile('node', ['./bin/metaswarm-dashboard', '--help'])` exits 0 and stdout contains "collect", "serve", "config init".
  7. **Rollback note:** revertable by `git revert`.
- **validation_commands:** `npm run typecheck --workspace packages/web` ; `npm run test:coverage --workspace packages/web` ; `npm run test:coverage --workspace packages/collector` ; `npm run build --workspace packages/web` ; `node ./bin/metaswarm-dashboard --help`

### WU-7 — README, screenshots, walkthrough log, final 100%-coverage polish

- **id:** WU-7
- **title:** Document install / config / collect / serve, capture remaining screenshots, run fixture-based AND operator-real walkthroughs, finalize for merge
- **depends_on:** [WU-6]
- **human_checkpoint:** **TRUE** — issue checkpoint #3 ("before merging the MVP — full walkthrough on real `.beads/` data from at least 2 projects, confirm zero-footprint guarantee").
- **file_scope:**
  - `README.md` (replace stub: install with `nvm use && npm ci`, prerequisites — node 22.12.0, dolt for BEADS server-mode, `gh auth status` for `prsMergedLast7d`, `gh` install hint, `config init`, `collect`, `serve`, troubleshooting (missing config, missing `bd`, port collision, `gh` unauthenticated → "—" rendering), Roadmap (Step 2/3 explicit non-goals))
  - `docs/screenshots/{project-detail,agents-view}.png` (Projects index already captured in WU-5)
  - `docs/CHECKPOINT-3-WALKTHROUGH.md` (template + filled-in log: enumerated steps, host repo paths used, `git status` outputs before/after, screenshot refresh log)
  - any final test additions to hit 100% lines/branches/functions/statements per `.coverage-thresholds.json`
- **out_of_scope:** new product features.
- **dod_items:**
  1. README has all required sections (see file_scope).
  2. All three screenshots present and referenced inline in README.
  3. `npm run test:coverage` passes 100/100/100/100 at the workspace root, on both ubuntu and macos in CI.
  4. **Fixture-based walkthrough (CI guard):** `docs/CHECKPOINT-3-WALKTHROUGH.md` documents the fixture-based pass against the two committed fixture host repos in `packages/collector/src/__tests__/fixtures/host-repos/`, with pre/post `git status` confirming zero-footprint, AND a CI smoke job runs the same flow nightly so regressions surface without an operator.
  5. **Operator-real walkthrough (issue-mandated):** the SAME doc records a manual walkthrough against ≥2 real `.beads/` projects on the operator's machine, with pre/post `git status` per real project, screenshot refresh log, and a one-paragraph operator sign-off note. This satisfies the issue's literal "real `.beads/` data from at least 2 projects" requirement.
  6. **Rollback note:** revertable by `git revert` of the entire WU-7 commit; nothing persistent on disk except `~/.local/share/metaswarm-dashboard/` (operator's data dir, expected and removable by the operator).
- **validation_commands:** `npm run lint` ; `npm run typecheck` ; `npm run test:coverage` ; `npm run build`

---

## 4. Cross-cutting concerns

### 4.1 Coverage strategy
- Root vitest config wires thresholds from `.coverage-thresholds.json` via ESM JSON import (§2.10). v8 provider. `coverage.exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**']`. Each WU adds tests so the threshold is hit incrementally.

### 4.2 Lint / format
- ESLint 9 (legacy `.eslintrc` config still supported; flat-config migration deferred), `@typescript-eslint/recommended-type-checked` + `eslint-plugin-vue` (web only), `@typescript-eslint/no-explicit-any: error`, `eslint-plugin-import` for ordered imports. Prettier 3, single quote, trailing commas all, 100-col line. `.prettierignore` excludes `dist/`, `coverage/`, snapshot fixtures.

### 4.3 CI
- Single workflow file. `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22.12.0, npm 10. Per OS: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run build`. ubuntu-only smoke after build: `node ./bin/metaswarm-dashboard --help`. ubuntu-only `shellcheck bin/*.sh`. **CI does not install `dolt` or `bd`** — collector tests inject the executor.

### 4.4 README sections (WU-7)
Overview, Architecture sketch, Prerequisites (node 22.12.0 via `.nvmrc`, dolt for BEADS server-mode + one-paragraph "how the operator already set this up" pointer to upstream BEADS docs, `gh auth status` for `prsMergedLast7d`), Install, `config init`, `collect`, `serve`, Screenshots (3), Troubleshooting, Roadmap (Step 2/3 explicit non-goals).

### 4.5 Cross-package type sharing
`packages/types` is the single source of truth (§2.7). TS project references for `tsc`; npm-workspaces symlinks for Vite — both work end-to-end without a build step on `packages/types`.

### 4.6 Root-level runtime deps
`commander` is declared in `packages/collector` (where the CLI commands live) and hoisted to root by npm workspaces, so `bin/metaswarm-dashboard` resolves it via the hoisted `node_modules/commander`. `js-yaml` is declared in `packages/collector` for the same reason. **No deps live at root** — the boundary is preserved per round-2 scope-reviewer feedback.

---

## 5. Risk register

| # | Risk | Source | Lik | Imp | Mitigation |
|---|------|--------|-----|-----|------------|
| R1 | `bd list --json` shape changes between minor versions | issue | M | H | Pin `bd` minor in README prereq; WU-3 wraps `bd` output in Zod and fails loudly on parse error. |
| R2 | macOS XDG ambiguity (`~/Library/Application Support` vs `~/.config`) | issue | M | M | Default to Apple HIG path on darwin; honor `XDG_*` overrides; cover both branches in WU-2 tests AND on real CI matrix. |
| R3 | `~` expansion + Windows path edge cases | issue | L | M | `os.homedir()` + `path.join`; Windows documented as not supported; CI ubuntu+macos only. |
| R4 | Config-YAML UX clunky with many projects | issue | M | L | Out of scope; follow-up after MVP; clear errors always point to `config init`. |
| R5 | Zero-footprint contract violated by stray write | architect | L | H | WU-3 zero-footprint test recursive-sha256-diffs both directories; failing test fails the WU. |
| R6 | `dolt` not on operator's machine | architect | M | M | README "Prerequisites" links to upstream BEADS docs; WU-3 ENOENT handler points to README. |
| R7 | Cross-package TS resolution breaks under npm workspaces hoisting | architect | L | M | WU-1 sanity test imports a type from `@metaswarm-dashboard/types` in each consumer; failing typecheck fails the WU. |
| R8 | naive-ui major-version churn | architect | L | M | Pin to caret-minor (`^2.40.0`); package-lock.json committed. |
| R9 | 100% coverage brittle on platform-specific branches | architect | M | M | Tests mock `process.platform` AND CI matrix runs both real platforms. |
| R10 | `bd` binary missing on operator's machine | architect | M | M | WU-3 ENOENT handler points to README. |
| R11 | node 18 vs 22.12 mismatch | round-1 | H | M | `.nvmrc 22.12.0` + `engines.node: ">=22.12.0"` + README. |
| R12 | `gh` CLI not authenticated → `prsMergedLast7d` always `null` | architect | H | L | Documented degraded mode (UI "—"); collector summary line tags `(prsMergedLast7d: degraded)`; README documents `gh auth login`; WU-3 covers all 5 failure axes. |
| R13 | **Metaswarm OOTB gap** — `/start-task` does not gate on `bd ready`; `bd init` defaults to embedded Dolt requiring CGO and fails silently in many environments | meta (out of scope here) | H | M | **Tracked in user-level memory; will be filed as upstream issue against the metaswarm marketplace plugin's `start` skill (pre-flight `bd ready` check). NOT mitigated within this plan** — it is a framework concern, not a dashboard concern. |

---

## 6. Traceability — issue DoD bullets → WU dod_items

| Issue DoD bullet | WU.dod_item |
|---|---|
| Zero-footprint guarantee — host project git status unchanged | WU-3.13 |
| `collect --project <name>` produces daily JSON matching schema | WU-3.1 |
| `collect --all` iterates every project | WU-3.2 |
| Re-running same day overwrites without duplicates | WU-3.3 |
| Monday run produces weekly file for prior ISO week | WU-3.4 |
| Unit tests: empty / mixed / malformed / missing path | WU-3.5, .6, .7 |
| `serve` starts Fastify on port 5174 (overridable) | WU-4.7 |
| `GET /api/projects` returns project summaries | WU-4.8 |
| `GET /api/projects/:name` returns project detail | WU-4.9 |
| `GET /api/agents` returns cross-project aggregate | WU-4.10 |
| Non-GET method returns 405 | WU-4.11 |
| Server refuses to start on missing/invalid config with hint | WU-4.12 |
| Projects index renders one card per project (4 metrics) | WU-5.2 |
| Click project card → detail; back navigation works | WU-5.3 |
| Project detail per-agent table sortable | WU-6.1 |
| Project detail throughput sparkline + recent work units | WU-6.2 |
| Agents view cross-project aggregation | WU-6.3 |
| No write/POST/PUT/DELETE actions in UI | WU-6.4 (manual review) + WU-4.11 (server runtime guard) |
| Empty-state messaging | WU-5.4 |
| `npm run build` from `packages/web/` exits 0 | WU-5.1 |
| TypeScript strict, no `any` | WU-1.2, .3 |
| ESLint + Prettier pass on all packages | WU-1.1, §4.2 |
| Coverage meets `.coverage-thresholds.json` | WU-7.3 (cumulative) |
| All three subcommands have useful `--help` | WU-1.6 (skeleton) + per-cli help in WU-2/3/4 |
| README documents install/config/collect/serve + screenshots | WU-7.1, .2 |
| `prsMergedLast7d` (4th metric on Projects index) | WU-3.15 (collector populates) + WU-4.3 (passes through) + WU-5.2 (renders, "—" on null) |
| `.beads/` set up for metaswarm orchestration of this repo | §0 (executed out-of-band before plan-review-gate; not a WU) |
| CI matrix runs on multiple OSes given platform-specific code | WU-1.4, §4.3 |
| Sample snapshot JSON (checkpoint #1 deliverable) | WU-3.17 |
| Projects-index screenshot (checkpoint #2 deliverable) | WU-5.7 |
| Walkthrough log (checkpoint #3 deliverable) | WU-7.4 + WU-7.5 |

**No DoD bullets remain unmapped.**

---

## 7. Orchestration notes

- **Parallelization graph:**
  - WU-1 → WU-2 → WU-3 (sequential; data layer first)
  - WU-3 → WU-4 (sequential; server consumes data layer)
  - WU-4 → WU-5 (sequential; SPA scaffold consumes server)
  - WU-5 → WU-6 (sequential; second-half views build on scaffold)
  - WU-6 → WU-7 (final merge gate)
- **Human checkpoints:** WU-3 (data-layer schema firm; deliverable `docs/samples/daily-snapshot.example.json`), WU-5 (Projects index visible; deliverable `docs/screenshots/projects-index.png`), WU-7 (pre-merge walkthrough; fixture pass + operator-real pass; deliverable `docs/CHECKPOINT-3-WALKTHROUGH.md`).
- **External-tools delegation:** disabled per `.metaswarm/project-profile.json` (`external_tools: false`). All work runs through Claude.
- **Rollback strategy:** every WU has an explicit "Rollback note" dod_item. The repo is greenfield; revert-by-commit always works. Side effects are confined to: (a) operator's `~/.local/share/metaswarm-dashboard/` data dir (expected, removable), (b) the BEADS dolt server in `~/.local/share/metaswarm-dashboard-bd-server/` (already running pre-plan, owned by §0).

---

## 8. Round-2 → v3 fixes (audit trail)

| Round-2 finding | Resolution in v3 | Where |
|---|---|---|
| **F1** `bin/metaswarm-dashboard` cannot be a vitest workspace project | Thin shebang glue; logic in workspace `cli/` modules covered in-process; `bin/**` excluded from coverage | §2.9, WU-1 file_scope, §4.1, WU-6.6 |
| **F2** `engines.node: ">=22"` allows 22.0–22.11 (Vite 8 needs ≥22.12) | Pin `>=22.12.0` and `.nvmrc 22.12.0` | §2.8, WU-1 file_scope |
| **F3 / S2** `packages/web/dist/` committed conflicts with `.gitignore` | SPA-fallback fixture moved to `packages/server/src/__tests__/fixtures/spa-dist/`; plugin parametrized via `staticRoot` | §2.4, WU-4 file_scope |
| **F4** WU-0 bootstrap script mishandles `bd`↔`dolt` handshake | WU-0 dropped entirely (out-of-band §0); README documents the actual handshake | §0, WU-7 file_scope |
| **F5** CI rewrite drops `.coverage-thresholds.json` enforcement parser; ESM JSON import syntax not specified | `vitest.config.ts` snippet explicit (§2.10) with `with { type: 'json' }` | §2.10, WU-1 file_scope |
| **C1** `gh` not in prereq nor checked at runtime | README Prerequisites documents `gh` install + auth; collector summary line tags `(prsMergedLast7d: degraded)` for visibility | §2.6, WU-3.15, §4.4 |
| **C2** Atomic-write failure paths untested | New dod_item WU-3.16 covers `fs.rename` failure with simulated injected fs | WU-3.16 |
| **C3** A11y dark theme not asserted | `vitest-axe` tests on every view (WCAG 2.1 AA) | WU-5.6, WU-6.5 |
| **C4** Bootstrap script never lint-checked in CI | WU-0 dropped; existing `bin/*.sh` from setup are now `shellcheck`-ed in CI as a guard | WU-1.5, §4.3 |
| **C5** Walkthrough fixture-only violates issue's "real `.beads/`" | Both: fixture-based CI guard + operator-real walkthrough; both in WU-7 dod_items | WU-7.4, WU-7.5 |
| **S1** WU-0 is metaswarm-framework scope-bleed | WU-0 dropped; setup is §0 (out-of-band) | §0 |
| **S3** `fast-check` not in issue scope | Removed; enumerated date cases (WU-3.11–12) suffice | WU-3 tests |
| **S4** `packages/types` over-engineering | Kept and justified — produces a clean dependency hierarchy that makes drift impossible by construction; alternative (types in `packages/server`) introduces collector→server cross-edge | §2.1 |
| **S5** Fixture host repos uncapped size | ≤50 lines per JSONL, no `dolt/` subtree | WU-3 file_scope |
| **S6 / W6** Root deps `commander`/`js-yaml` muddy boundary | Moved into `packages/collector` (CLI lives there); hoisted to root by npm workspaces, resolvable from `bin/` | §4.6, WU-1 file_scope |
| **W11** R13 (`/start-task` not gating) buried in risk register | Promoted to §0 explicit "Metaswarm OOTB gap discovered" stanza + saved to user-level memory + flagged for upstream issue | §0, R13 |
| **W9** No per-WU rollback strategy | Every WU now has a "Rollback note" dod_item | each WU.dod_items, §7 |
| **OQ vue-router 4 vs 5** | Upgraded to vue-router@5 | §2.4, WU-1 file_scope |
| **OQ gh search semantics** | Changed to `--state merged --json mergedAt --jq` filter (precise timestamp comparison) | §2.6, WU-3 file_scope |
| **OQ TS project refs vs Vite** | Documented: Vite resolves via npm workspaces symlinks; TS project references are typecheck-only | §2.7 |
| **OQ screenshot reproducibility** | `npm run screenshots:projects-index` regenerates on demand; CI does NOT auto-regenerate | WU-5.7 |
| **OQ throughput gap-fill ownership** | Owned by aggregator (server) — `toProjectDetail` always returns 14 entries | §2.3, WU-4.4 |
| **OQ `complete:false` not in schema** | Added to `WeeklySnapshot` Zod schema | §2.3 |
