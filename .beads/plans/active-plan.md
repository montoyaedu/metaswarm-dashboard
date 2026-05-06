# Implementation Plan — Issue #1 (v5, FINAL — gate iteration closed)

- **status:** **APPROVED FOR EXECUTION** (operator-binding; no further plan-review-gate iterations)
- **created_at:** 2026-05-06
- **issue:** [#1 — feat: MVP read-only dashboard for multi-project metaswarm visibility](https://github.com/montoyaedu/metaswarm-dashboard/issues/1)
- **beads_epic:** `metaswarm-dashboard-lo0`
- **author:** orchestrator (Claude) after round-4 plan-review-gate; operator declared gate iteration closed (round-4 → v5, option "B")
- **target estimate:** ~1 working week
- **execution model:** metaswarm orchestrated-execution (4-phase per WU: IMPLEMENT → VALIDATE → ADVERSARIAL REVIEW → COMMIT)
- **GATE-BINDING DECISIONS (NOT to be re-litigated by future reviewers):**
  - **Coverage thresholds relaxed for the MVP merge** — `lines: 100` retained; `branches: 92, functions: 97, statements: 98` accepted as the merge gate after WU-7 (operator-approved 2026-05-07, option "B" with pragmatic close-out). Lines coverage IS 100%; the residual non-line gaps are concentrated in defensive guards (`/* v8 ignore */` annotated where genuinely unreachable) and `v-if`/`v-else-if` template branches that are awkward to drive through jsdom in unit tests. Tracking issue [#3](https://github.com/montoyaedu/metaswarm-dashboard/issues/3) closes out the rest with a follow-up. **The `100/100/100/100` strict goal in original §2.10 is the long-term target, deferred — not abandoned.**
  - `prsMergedLast7d: null` always in MVP — operator opted out of `gh` integration (round-3 → v4, option "a"). README troubleshooting documents the deliberate scope reduction.
  - a11y `vitest-axe` removed — not in issue scope (round-3 → v4, option "a").
  - Coverage 100% threshold runs only at root `test:coverage` (gated to WU-7), so intermediate WUs aren't blocked by other-package incompleteness (round-3 → v4, option "a").
  - §0 BEADS setup is out-of-band (no portable bootstrap script ships) — operator chose this over WU-0 (round-2 → v3, option "c").
  - `packages/types` four-package shape kept — operator chose this over consolidating into a consumer (round-2 → v3, option "a").
  - Walkthrough WU-7 is operator-real only, no nightly-fixture CI duplication (round-2 → v3, option "b").
  - **Plan-review-gate ends at v4.** Subsequent reviewers should evaluate IMPLEMENTATION via the orchestrated-execution adversarial-review gate (per-WU PASS/FAIL), not re-open these decisions.

---

## 0. Out-of-band setup (operator-approved override; explicitly NOT a WU)

These steps were performed before the Plan Review Gate v4 and are deliberately **NOT** tracked as a WU. The operator explicitly chose this trade-off (option "c" during round-2 → v3 iteration) over shipping a portable bootstrap script. Reasoning recorded here so future reviewers don't re-litigate:

- `dolt sql-server -H 127.0.0.1 -P 3307` started in the background with data-dir at `~/.local/share/metaswarm-dashboard-bd-server/`.
- `BEADS_DOLT_PASSWORD="" bd init --server` against that server. `.beads/dolt-server.port` and the rest of the BEADS scaffold are committed via `bd init`'s own auto-commit.
- Root `.gitignore` adjusted to NOT exclude `.beads/plans|context|knowledge|issues.jsonl` (the metaswarm setup default would have broken cross-machine portability). **Locked down by an automated test in WU-1** (see WU-1.10).
- BEADS knowledge base (`.beads/knowledge/*.jsonl`) restored from the metaswarm plugin source.
- Initial `bd export -o .beads/issues.jsonl` committed.

The README's Prerequisites section (WU-7) tells new cloners how to recreate this state in one paragraph and links to the upstream BEADS docs. **No bootstrap script is shipped**: that is metaswarm-framework scope, not dashboard scope.

**Metaswarm OOTB gap discovered (track upstream, not in this plan):** `bd init` defaults to embedded Dolt requiring CGO; on CGO-less hosts it fails immediately. `/start-task` and other metaswarm skills do not gate on `bd ready`/`bd doctor`, so the workflow proceeds with a file-based fallback as if BEADS were healthy. Fix belongs in the marketplace `metaswarm:start` skill (pre-flight `bd ready` check). Captured in user-level memory; to-be-filed as upstream issue.

---

## 1. Summary

- Stand up an npm-workspaces monorepo (`packages/{types,collector,server,web}`) with TypeScript strict, Vitest, ESLint 9, Prettier 3, a thin `bin/metaswarm-dashboard` ESM shebang dispatching to per-workspace compiled `cli/` modules, and a `.nvmrc`-pinned `22.12.0` toolchain.
- Implement a read-only collector that reads `.beads/` JSONL + `bd list --json` for each project in `config.yaml` and writes XDG-aware per-project daily/weekly UTC snapshots — host repos remain byte-identical, asserted by an automated test.
- Implement a minimal Fastify server that refuses non-GET methods, fails fast on missing/invalid config, exposes 3 typed read-only endpoints, and serves the built SPA from `packages/web/dist` via `@fastify/static` with a `setNotFoundHandler` SPA fallback.
- Ship a Vue 3 + naive-ui SPA with three views (Projects index, Project detail, Agents cross-project) using `vue-router@4` history mode and composition-API state.
- Enforce 100% coverage from `.coverage-thresholds.json` **only at the root `npm run test:coverage` invocation** (gated in WU-7); intermediate WUs use per-workspace `npm run test` (no global threshold) so the gate doesn't block on incomplete packages.
- CI runs on ubuntu + macos × node 22.12.0, including the dispatcher smoke on **both** OSes.

---

## 2. Architecture decisions

### 2.1 Workspace layout — **npm workspaces, four packages**

- `packages/types`, `packages/collector`, `packages/server`, `packages/web`. Operator opted (round-2 → v3, option "a") to keep the four-package shape rather than collapse types into a consumer. Justification: clean dependency hierarchy (`types` ← {`collector`, `server`, `web`}; no cross-edges between consumers) makes cross-WU schema drift impossible by construction. The WU-4 cross-package integration test is a belt-and-braces second guarantee.

### 2.2 Snapshot file naming — **UTC daily-key + ISO-8601 weekly-key**

- Daily file: `YYYY-MM-DD.json` from `Date.toISOString().slice(0,10)` (UTC). Weekly file: `YYYY-Www.json` (literal `W`, four-digit ISO week-year, two-digit zero-padded week number).
- **Why UTC:** eliminates DST-induced double-day or skipped-day bugs.
- **Weekly backfill behavior (decided here):** the weekly file is written **only on the Monday-UTC run** for the prior ISO week. Non-Monday runs do **NOT** backfill missing weekly files. Operators who skip a Monday accept that the missing weekly file stays missing; this matches typical cron semantics and avoids the temptation to invent data after the fact.

### 2.3 API + snapshot schemas — **defined in `@metaswarm-dashboard/types`**

```ts
// packages/types/src/api.ts
export interface ProjectSummary {
  name: string;
  activeTasks: number;
  blockedTasks: number;
  prsMergedLast7d: number | null;   // ALWAYS null in MVP (see §2.6)
  lastActivityAt: string | null;    // ISO-8601 UTC
  hasMetrics: boolean;
}
export type GetProjectsResponse = ProjectSummary[];

export interface AgentBreakdown { agent: string; tasksCompleted: number; successRate: number; avgDurationSeconds: number; }
export interface RecentWorkUnit { id: string; title: string; status: "open" | "in_progress" | "blocked" | "closed"; agent: string | null; closedAt: string | null; }
export interface ThroughputPoint { date: string; closed: number; }   // YYYY-MM-DD UTC; aggregator owns gap-fill to exactly 14 entries

export interface ProjectDetail {
  name: string;
  agents: AgentBreakdown[];
  throughput: ThroughputPoint[];   // length === 14
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
  prsMergedLast7d: z.literal(null),     // hard-coded null per §2.6
});
export const WeeklySnapshot = DailySnapshot.extend({
  isoWeek: z.string().regex(/^\d{4}-W\d{2}$/),
  complete: z.boolean(),    // false when prior week had no daily snapshots
});
```

### 2.4 SPA routing — **vue-router@4 history mode + Fastify SPA fallback via `@fastify/static`**

- `vue-router@^4.6.4` (NOT v5: v5 mandates `pinia` as a peer dep, contradicting §2.5). `createWebHistory()` for clean URLs (`/projects/foo`).
- `@fastify/static` serves `staticRoot` (production: `path.resolve('packages/web/dist')`; tests: an injectable fixture root). `setNotFoundHandler` returns `index.html` for non-`/api`, non-asset GETs.
- Test fixture (a tiny SPA stub) lives at `packages/server/src/__tests__/fixtures/spa-dist/index.html` — **NOT** in `packages/web/dist/` — so Vite's normal `dist/` git-ignore stays clean.

### 2.5 State management — **composition-API composables only**

- `useProjects`, `useProjectDetail`, `useAgents` composables, one per endpoint. No Pinia.

### 2.6 PRs merged last 7d — **always `null` in MVP (operator-approved scope reduction)**

- The metric is in the issue's "Projects index → 4 metrics", but the issue does not specify a data source. `.beads/` does not track PR-merge events natively, and the operator (round-3 → v4, option "a") ruled out shelling to `gh` as scope-creep against `external_tools: false`.
- **MVP behavior:** the collector hard-codes `prsMergedLast7d: null` in every snapshot. The server passes it through unchanged. The SPA renders "—" everywhere this field is shown.
- **Documented limit:** README has a "Why is PRs-merged showing '—'?" troubleshooting entry that explains the deliberate scope reduction and links to a follow-up issue (filed in WU-7) that will pick a source (BEADS-native PR tracking once available, or opt-in `gh` integration behind a config flag) in a Step-2 effort.

### 2.7 Cross-package type sharing — **`@metaswarm-dashboard/types` workspace dep with explicit build step**

- `packages/types` is a private workspace package. Consumers declare `"@metaswarm-dashboard/types": "*"` in their `package.json` and import from `@metaswarm-dashboard/types/api` and `@metaswarm-dashboard/types/snapshots`.
- **Build is explicit, not magical:** `packages/types/package.json` declares a `"build": "tsc"` script that emits `dist/`. `packages/types/package.json` `"exports"` map points the import subpaths at `dist/`. The root `package.json` declares `"prebuild": "npm run build -w packages/types"`, `"pretypecheck": "npm run build -w packages/types"`, `"pretest": "npm run build -w packages/types"` so consumers always see fresh declarations + Zod runtime artifacts before they typecheck/test.
- **No `composite: true` and no TS project references.** Round-3 reviewer correctly flagged that hybrid as inconsistent with "no separate build step". v4 commits to "yes, there is a build step for types, and it runs in the npm script lifecycle".
- Vite (used by `packages/web`) resolves `@metaswarm-dashboard/types` via npm workspace symlinks → reads the compiled `dist/` artifacts. Same as any other dep.

### 2.8 Node version pinning — **`.nvmrc 22.12.0` + `engines.node: ">=22.12.0"`**

- Why `22.12.0` specifically: Vite 8 requires `^20.19.0 || >=22.12.0`. `>=22` would let 22.0.0–22.11.x slip through.

### 2.9 CLI dispatcher — **thin shebang glue, deps in collector workspace, exports field everywhere**

- `bin/metaswarm-dashboard` is a 12-line ESM shebang that imports from compiled `dist/`:
  ```js
  #!/usr/bin/env node
  import { Command } from 'commander';
  import { runCollect } from '@metaswarm-dashboard/collector/cli/collect';
  import { runConfigInit } from '@metaswarm-dashboard/collector/cli/config-init';
  import { runServe } from '@metaswarm-dashboard/server/cli/serve';
  // …commander wiring
  ```
- `commander` and `js-yaml` are runtime deps of `packages/collector` (where the CLIs live); npm workspaces hoists them, so `bin/metaswarm-dashboard` resolves them via the root `node_modules/`.
- **`exports` map required**: each consuming workspace declares an `"exports"` map in its `package.json` so the bare-specifier subpath imports resolve. Example for collector:
  ```json
  "exports": {
    ".": "./dist/index.js",
    "./cli/collect": "./dist/cli/collect.js",
    "./cli/config-init": "./dist/cli/config-init.js"
  }
  ```
- `bin/**` is excluded from coverage (`vitest.config.ts` `coverage.exclude`). All testable logic lives in the `cli/` modules and is covered in-process. A single spawn-based smoke test in WU-6 asserts `--help` works end-to-end.

### 2.10 Coverage thresholds wiring — **ESM JSON import, gated only at root**

```ts
// vitest.config.ts (root, ESM)
import thresholds from './.coverage-thresholds.json' with { type: 'json' };
export default {
  // …workspace projects
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: thresholds.thresholds,   // 100/100/100/100
      exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**'],
    },
  },
};
```

- **Critical:** the 100% threshold gate runs **only** when invoking `npm run test:coverage` at the root. The per-package `npm run test --workspace packages/X` script does NOT load the root vitest config and therefore does NOT enforce thresholds — by design. This is what allows intermediate WUs to validate against their own package without being blocked by other-package incompleteness.
- WU-7 is the first (and only) WU whose validation_commands include the root `npm run test:coverage` — that's the global gate.

---

## 3. Work Unit Decomposition

**8 WUs**, sequential. File scopes disjoint across non-dependent WUs.

### WU-1 — Workspace skeleton, tooling, CLI dispatcher, CI matrix, gitignore invariant test

- **id:** WU-1
- **title:** Bootstrap npm workspaces (4 packages with build pipelines + exports maps), TS strict, ESLint 9 / Prettier 3, Vitest 4 with coverage thresholds wired from JSON, ESM dispatcher in `bin/`, CI on ubuntu+macos × node 22.12.0
- **depends_on:** none
- **human_checkpoint:** false
- **file_scope:**
  - `package.json` (root: `"type": "module"`, `"workspaces": ["packages/*"]`, `"engines": {"node": ">=22.12.0"}`, scripts: `lint`, `typecheck`, `test`, `test:coverage`, `format:check`, `build`, `prebuild` / `pretypecheck` / `pretest` all running `npm run build -w packages/types`)
  - `.nvmrc` (`22.12.0`)
  - `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), `tsconfig.json` (root, no project references — keeps things simple per §2.7)
  - `.eslintrc.cjs` ESLint-9-compatible (or `eslint.config.js` flat-config — pick whichever ESLint 9 prefers as primary; document the choice), `.prettierrc`, `.prettierignore`, `.editorconfig`
  - `vitest.config.ts` (root; ESM JSON import of `.coverage-thresholds.json`; workspace projects: types/collector/server/web; v8 coverage; `coverage.exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**']`)
  - `packages/types/package.json` (private, name `@metaswarm-dashboard/types`, `"build": "tsc"`, `"exports": { "./api": "./dist/api.js", "./snapshots": "./dist/snapshots.js" }`), `packages/types/tsconfig.json` (`outDir: "./dist"`, no `composite`), `packages/types/src/{api,snapshots,index}.ts` (placeholder skeletons populated in WU-3)
  - `packages/collector/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `commander`, `js-yaml`, `zod`; `"build": "tsc"`, `"exports"` map covering `.`, `./cli/collect`, `./cli/config-init`), `packages/collector/tsconfig.json` (`outDir: "./dist"`), `packages/collector/src/index.ts` (placeholder)
  - `packages/server/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `fastify`, `@fastify/static`, `zod`; `"build": "tsc"`, `"exports"` map covering `.`, `./cli/serve`), `packages/server/tsconfig.json`, `packages/server/src/index.ts` (placeholder)
  - `packages/web/package.json` (deps: `@metaswarm-dashboard/types: "*"`, `vue`, `vue-router@^4.6.4`, `naive-ui`, `vite`, `@vue/test-utils`, `jsdom`; `"build": "vite build"`), `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.ts` (naive-ui dark provider only)
  - `bin/metaswarm-dashboard` (12-line ESM shebang per §2.9; `chmod +x`)
  - `.github/workflows/ci.yml` (rewrite: `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22.12.0, runs lint/typecheck/test:coverage/build/smoke; **smoke runs on BOTH OSes**: `node ./bin/metaswarm-dashboard --help` after build; `shellcheck bin/*.sh` ubuntu-only since shellcheck is not pre-installed on macos GH runners)
- **out_of_scope:** product code (collector reading, server endpoints, SPA views), README content (WU-7).
- **dod_items:**
  0. **Node-version precondition (run first):** `node --version` reports `v22.12.0` or higher. If absent, the operator runs `nvm install 22.12.0 && nvm use 22.12.0` before anything else. CI satisfies this via `actions/setup-node@v4 with node-version-file: .nvmrc`. WU-1 cannot proceed otherwise. (Closes round-4 Feas-1.)
  1. `nvm use && npm ci && npm run lint && npm run typecheck && npm run test && npm run build` exits 0 on a fresh clone with node 22.12.0.
  2. TS strict (`"strict": true, "noUncheckedIndexedAccess": true`) inherited by all four packages.
  3. ESLint config bans `any` (`@typescript-eslint/no-explicit-any: error`).
  4. CI workflow runs lint/typecheck/test:coverage/build on `strategy.matrix.os: [ubuntu-latest, macos-latest]` with node 22.12.0.
  5. CI runs `shellcheck` on `bin/*.sh` (ubuntu lane only).
  6. `bin/metaswarm-dashboard --help` exits 0 and prints the three subcommand names — verified on **both** ubuntu and macos lanes after build.
  7. Root `npm run build` script orchestrates: build types first, then collector + server + web. `prebuild`/`pretypecheck`/`pretest` lifecycle hook ensures types/dist is fresh before any consumer typecheck or test.
  8. `vitest.config.ts` reads coverage thresholds from `.coverage-thresholds.json` via ESM JSON import (`with { type: 'json' }`); thresholds change in the JSON file are picked up without code edits. **Vitest 4 field name is `test.projects`** (not the deprecated `vitest.workspace.ts` file).
  9. A trivial test in each consumer package (`packages/{collector,server,web}/src/__tests__/types-import.test.ts`) imports a type AND a Zod schema from `@metaswarm-dashboard/types` and asserts compatibility — proves the workspace dep + build pipeline + exports map are healthy end-to-end.
  10. **`.gitignore` invariant test (expanded):** `packages/collector/src/__tests__/gitignore-invariant.test.ts` runs `git check-ignore --quiet --` against ONE representative path per protected directory plus the issues.jsonl: `.beads/plans/active-plan.md`, `.beads/context/.keep`, `.beads/knowledge/patterns.jsonl`, `.beads/knowledge/decisions.jsonl`, `.beads/knowledge/anti-patterns.jsonl`, `.beads/issues.jsonl`. Each call must exit non-zero (not ignored). The test also reads `.beads/.gitignore` and asserts none of the listed paths are matched by patterns there. (Closes round-4 Comp-2.)
  11. **Rollback note:** revertable by `git revert` of the WU-1 commit; the only side effect is `node_modules/` which `npm ci` rebuilds.
- **tests:** sanity tests per package; types-import test (DoD #9); gitignore-invariant test (DoD #10).
- **validation_commands:**
  - `nvm use`
  - `npm ci`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test --workspaces` (per-package, no threshold check)
  - `npm run build`

### WU-2 — Config + paths module (XDG-aware) and `config init` subcommand

- **id:** WU-2
- **title:** Implement XDG-aware path resolution, YAML config loader, `metaswarm-dashboard config init`, with full `~`/`XDG_*` coverage
- **depends_on:** [WU-1]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/collector/src/paths.ts` (XDG resolution: data dir + config file; env overrides `METASWARM_DASHBOARD_DATA_DIR`, `METASWARM_DASHBOARD_CONFIG`; `~` expansion via `os.homedir()`)
  - `packages/collector/src/config.ts` (load + validate `config.yaml` with Zod)
  - `packages/collector/src/cli/config-init.ts` (writes a starter config; refuses overwrite without `--force`; creates parent dirs; `--help` text per DoD #5)
  - `packages/collector/src/__tests__/{paths,config,config-init,config-init-help}.test.ts`
- **out_of_scope:** the dispatcher (WU-1 done), the collector core (WU-3), the server (WU-4).
- **dod_items:**
  1. `paths.dataDir()`/`paths.configFile()` honor darwin and linux conventions and `METASWARM_DASHBOARD_*` env overrides; both branches tested via mocked `process.platform` AND exercised by the real platform on the CI matrix.
  2. **`~` expansion explicitly tested:** `~`, `~/foo`, `~/foo/bar` all expand to `os.homedir()`-rooted absolute paths. `~user` (other-user home) is rejected with `ConfigError`. Absolute paths are passed through unchanged. Relative paths in config are rejected with `ConfigError` (force operators to be explicit).
  3. **XDG override explicitly tested:** setting `XDG_DATA_HOME=/tmp/foo` or `XDG_CONFIG_HOME=/tmp/bar` (linux only) routes paths through the override. Tests use temp dirs created via `fs.mkdtempSync`, never the real `$HOME`.
  4. `loadConfig()` parses YAML, expands `~`, returns typed `{ projects: { name; path }[] }`, throws `ConfigError` with hint pointing to `config init` on missing/invalid config.
  5. `config init` writes a starter YAML (two commented-out example entries); refuses overwrite without `--force`; creates parent dirs.
  6. **`metaswarm-dashboard config init --help` text:** asserted by `config-init-help.test.ts` to contain (a) a one-line description, (b) the `--force` flag with description, (c) the resolved target path on the current platform, (d) one example invocation. The test imports the help text from `cli/config-init.ts` directly (no spawn).
  7. **Rollback note:** revertable by deleting the written `config.yaml` (or via `--force` overwrite).
- **tests:** `process.env` mocking with vitest `pool: 'forks'`; `os.homedir` injection; real-fs writes into vitest temp dirs.
- **validation_commands:** `npm run typecheck --workspace packages/collector` ; `npm run test --workspace packages/collector` (per-package; no global threshold)

### WU-3 — Collector core: schemas, readers, metrics, atomic writer, zero-footprint test

- **id:** WU-3
- **title:** Implement collector that reads host `.beads/` JSONL + `bd list --json`, computes per-agent metrics, writes daily + weekly UTC snapshots; populate `@metaswarm-dashboard/types` schemas
- **depends_on:** [WU-2]
- **human_checkpoint:** **TRUE** — issue checkpoint #1 ("after data-layer schema is firm"). Deliverable: `docs/samples/daily-snapshot.example.json` committed.
- **file_scope:**
  - `packages/types/src/snapshots.ts` (populate Zod schemas from §2.3 — `prsMergedLast7d: z.literal(null)`)
  - `packages/types/src/api.ts` (populate from §2.3)
  - `packages/collector/src/beads-reader.ts` (reads `.beads/*.jsonl` line-by-line, skips malformed rows with `console.warn`, runs `bd list --json` via `child_process.execFile` with 30s timeout)
  - `packages/collector/src/metrics.ts` (pure: rows → `AgentMetrics`/`SwarmMetrics`; UTC daily key; ISO week-year + week computation)
  - `packages/collector/src/writer.ts` (atomic write: `fs.writeFile` to a temp path under the same dir, then `fs.rename`; on rename failure, deletes the temp; idempotent)
  - `packages/collector/src/cli/collect.ts` (handles `--project <name>` and `--all`; per-project summary line; exit 0 even when individual projects skipped; `--help` text per DoD #18)
  - `packages/collector/src/__tests__/{schema,beads-reader,metrics,writer,writer-error-paths,collect,collect-help,zero-footprint}.test.ts`
  - `packages/collector/src/__tests__/fixtures/host-repos/{empty-project,mixed-tasks,malformed-jsonl,missing-path}/.beads/issues.jsonl` (≤50 lines per file; no `dolt/` subtree)
  - `docs/samples/daily-snapshot.example.json` (committed; checkpoint #1 review artifact)
- **out_of_scope:** the dispatcher (WU-1), the server (WU-4), any UI code, any GitHub/`gh` integration (`prsMergedLast7d` is hard-coded `null` per §2.6).
- **dod_items:**
  1. `collect --project <name>` writes `<data-dir>/projects/<name>/daily/YYYY-MM-DD.json` matching `DailySnapshot` Zod schema.
  2. `collect --all` iterates every project in `config.yaml`.
  3. Re-running same UTC day overwrites snapshot; no duplicate entries.
  4. Monday (UTC) run also writes `<data-dir>/projects/<name>/weekly/YYYY-Www.json` for the prior ISO week. Asserted by fake-timer tests on Monday + Tuesday + Sunday. **Non-Monday runs do NOT backfill missing weekly files** (per §2.2).
  5. Empty project (no `.beads/`) → skip + clear log line, exit 0.
  6. Malformed JSONL row → skip + log, never crash.
  7. Missing project path → skip + log, exit 0.
  8. Agent with 0 completed tasks → `AgentMetrics` row with `tasksCompleted: 0, successRate: 0`.
  9. Agent with all-success → `successRate: 1.0` (no division-by-zero).
  10. **Single-snapshot weekly fallback:** if the prior week had no daily snapshots, the weekly file contains `{ ..., complete: false }`. Schema explicitly includes the `complete` field.
  11. DST coverage: tests assert that **all four** DST transition days (US spring-forward 2026-03-08, EU spring-forward 2026-03-29, US fall-back 2026-11-01, EU fall-back 2026-10-25) produce exactly one daily key each (UTC). Each test runs with `process.env.TZ` set to the relevant zone (`America/Los_Angeles`, `Europe/Berlin`) plus a UTC baseline to prove TZ independence. (Closes round-4 Comp-3.)
  12. ISO-week boundaries: 2024-12-30 UTC → daily `2024-12-30`, weekly `2025-W01`. 2026-12-31 UTC → weekly `2026-W53`.
  13. **Zero-footprint:** `zero-footprint.test.ts` snapshots fixture host repos' contents (recursive sha256), runs `collect --project` and `collect --all`, re-snapshots, asserts equality.
  14. `bd` invoked with `execFile` (no shell) and 30s timeout; ENOENT surfaces actionable error referencing the README's "BEADS prerequisite" section.
  15. `prsMergedLast7d` is hard-coded `null` in every snapshot (per §2.6). Asserted by a single test that the field is always `null` regardless of input.
  16. **Atomic-write error paths:** `writer.ts` is tested for `fs.rename` failure (simulated via injected fs); on failure, the temp file is removed and the error is propagated with a clear message; coverage of error branches verified.
  17. `docs/samples/daily-snapshot.example.json` parses through `DailySnapshot` Zod schema in a CI test — drift fails the build.
  18. **`metaswarm-dashboard collect --help` text:** asserted by `collect-help.test.ts` to contain (a) one-line description, (b) `--project <name>` and `--all` flags with descriptions, (c) one example invocation. The test imports the help text from `cli/collect.ts` directly (no spawn).
  19. **Rollback note:** revertable by deleting written snapshot files in the data dir; no host-repo state mutated (zero-footprint).
- **tests:** as listed above; **no `fast-check`** (round-2 reviewer scope-flagged it; enumerated date cases in DoD #11–12 are sufficient).
- **validation_commands:** `npm run typecheck --workspace packages/collector` ; `npm run test --workspace packages/collector` ; `npm run typecheck --workspace packages/types`

### WU-4 — Snapshot reader + aggregator + Fastify server

- **id:** WU-4
- **title:** Implement server-side snapshot reader, aggregator (gap-filled throughput), Fastify with read-only API + 405 method guard + SPA fallback
- **depends_on:** [WU-3]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/server/src/data/snapshot-reader.ts` (lists snapshots under `<data-dir>/projects/<name>/daily/`, parses with `DailySnapshot` from `@metaswarm-dashboard/types/snapshots`, returns most-recent + 14-day window)
  - `packages/server/src/data/aggregator.ts` (pure: `toProjectSummary`, `toProjectDetail` (owns the 14-day throughput gap-fill — fewer than 14 daily files ⇒ missing days emitted as `closed: 0`, schema invariant: `throughput.length === 14`), `toAgentAggregates`)
  - `packages/server/src/server.ts` (factory: `buildServer({ dataDir, staticRoot })` returns Fastify instance — testable via built-in `app.inject()`)
  - `packages/server/src/routes/{projects,projects-by-name,agents}.ts`
  - `packages/server/src/plugins/method-guard.ts` (rejects non-GET on `/api/*` with 405 + `Allow: GET`)
  - `packages/server/src/plugins/spa.ts` (registers `@fastify/static` against `staticRoot` parameter; `setNotFoundHandler` returns `index.html` for non-`/api`, non-asset GETs)
  - `packages/server/src/cli/serve.ts` (parses `--port`, defaults 5174, fails fast on bad config, passes `staticRoot: path.resolve('packages/web/dist')` in production; `--help` text per DoD #18)
  - `packages/server/src/__tests__/{snapshot-reader,aggregator,server,routes,method-guard,spa,serve,serve-help,integration-with-collector}.test.ts`
  - `packages/server/src/__tests__/fixtures/spa-dist/index.html` (tiny SPA stub for `setNotFoundHandler` tests; lives outside `packages/web/dist/`)
  - `packages/server/src/__tests__/fixtures/data-dir/` (2 fixture projects, ≥14 days of snapshots; each JSONL ≤50 lines)
- **out_of_scope:** SPA code (WU-5/WU-6), CLI dispatcher (WU-1 done), schema changes (in `@metaswarm-dashboard/types`).
- **dod_items:**
  1. `snapshotReader.listProjects()` returns all dirs under `<data-dir>/projects/` with ≥1 daily snapshot.
  2. `snapshotReader.latestDaily(name)` returns the lex-greatest `YYYY-MM-DD.json` parsed via Zod (or `null`).
  3. `aggregator.toProjectSummary` produces exact `ProjectSummary` shape, including `hasMetrics: false` when no daily snapshots and `prsMergedLast7d: null` always.
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
  17. **`metaswarm-dashboard serve --help` text:** asserted by `serve-help.test.ts` to contain (a) one-line description, (b) `--port` flag with default value, (c) one example invocation. Imports help from `cli/serve.ts` directly.
  18. **Rollback note:** revertable by `git revert`; no persistent state mutated outside the data dir.
- **validation_commands:** `npm run typecheck --workspace packages/server` ; `npm run test --workspace packages/server`

### WU-5 — SPA scaffold + Projects index view

- **id:** WU-5
- **title:** Implement Vue 3 + naive-ui SPA scaffold with `vue-router@4` history routing and the Projects index view
- **depends_on:** [WU-4]
- **human_checkpoint:** **TRUE** — issue checkpoint #2 ("after projects-index view ships"). Deliverable: `docs/screenshots/projects-index.png` (deterministic, against committed fixture data dir).
- **file_scope:**
  - `packages/web/src/main.ts`, `packages/web/src/App.vue`, `packages/web/src/router.ts`
  - `packages/web/src/views/ProjectsIndex.vue`
  - `packages/web/src/composables/useProjects.ts`
  - `packages/web/src/components/{ProjectCard,EmptyState}.vue`
  - `packages/web/src/api/client.ts` (typed `fetch` wrapper using `@metaswarm-dashboard/types/api`)
  - `packages/web/src/__tests__/{ProjectsIndex,ProjectCard,EmptyState,useProjects}.test.ts`
  - `packages/web/src/__tests__/fixtures/server-data-dir/` (committed fixture data dir served by the WU-4 server during screenshot capture; matches the WU-4 fixture data shape)
  - `docs/screenshots/projects-index.png` (committed)
- **out_of_scope:** Project detail and Agents views (WU-6); API server (done in WU-4); a11y assertion library (operator opted out of vitest-axe at round-3 → v4).
- **dod_items:**
  1. `npm run build --workspace packages/web` produces `packages/web/dist/index.html` plus assets, exits 0.
  2. ProjectsIndex renders one `<NCard>` per project with all four metrics (`activeTasks`, `blockedTasks`, `prsMergedLast7d` rendered as "—" when `null` (which is **always** in MVP per §2.6), `lastActivityAt` formatted relative-time **OR "Never" when `null`** — explicit null-handling, no crash). (Closes round-4 Comp-5.)
  3. Clicking a card navigates via `router.push({ name: 'project-detail', params: { name } })` — asserted in jsdom test against the real `vue-router@4` instance with `createWebHistory()`. **Back-nav minimal (with stub ProjectDetail):** the same test mounts a minimal stub component at the `project-detail` route, calls `router.back()`, and asserts the route is back at `projects-index` AND ProjectsIndex is re-rendered. The full E2E with the real ProjectDetail is in WU-6.5; this WU-5 minimal back-nav guarantees the router config is correct **before** checkpoint #2 ships. (Closes round-4 Comp-1.)
  4. Empty state: when `hasMetrics === false`, view shows `EmptyState` with text ``No metrics yet — run `metaswarm-dashboard collect` ``.
  5. naive-ui `NConfigProvider` wraps the app with `darkTheme`.
  6. **Deterministic screenshot:** captured via the `metaswarm:visual-review` skill against the committed fixture data dir served by a local instance of the WU-4 server. Reproducible via `npm run screenshots:projects-index`. CI does NOT auto-regenerate.
  7. **Rollback note:** revertable by `git revert`.
- **validation_commands:** `npm run typecheck --workspace packages/web` ; `npm run test --workspace packages/web` ; `npm run build --workspace packages/web`

### WU-6 — Project detail view + Agents view + sparkline + back-nav E2E + dispatcher smoke + lint guard against UI writes

- **id:** WU-6
- **title:** Implement Project detail and cross-project Agents views with sortable tables, throughput sparkline, full back-nav E2E with the real ProjectDetail mounted, dispatcher smoke, and an ESLint rule that blocks write-method literals in the SPA source
- **depends_on:** [WU-5]
- **human_checkpoint:** false
- **file_scope:**
  - `packages/web/src/views/{ProjectDetail,AgentsView}.vue`
  - `packages/web/src/composables/{useProjectDetail,useAgents}.ts`
  - `packages/web/src/components/{AgentTable,ThroughputSparkline}.vue`
  - `packages/web/src/__tests__/{ProjectDetail,AgentsView,AgentTable,ThroughputSparkline,useProjectDetail,useAgents,back-nav-e2e}.test.ts`
  - `packages/web/.eslintrc.cjs` (extension of root: adds `no-restricted-syntax` rule blocking `Literal[value="POST"]`, `Literal[value="PUT"]`, `Literal[value="DELETE"]`, `Literal[value="PATCH"]` in `src/**/*.{ts,vue}` source files. The rule is configured to ignore `__tests__/**`)
  - `packages/collector/src/__tests__/cli-dispatcher-smoke.test.ts` (spawn-based smoke against `bin/metaswarm-dashboard --help`; verifies the dispatcher wires up after WU-3 + WU-4 cli modules exist)
- **out_of_scope:** Projects index (WU-5 done).
- **dod_items:**
  1. ProjectDetail renders `<NDataTable>` with sortable columns: agent, tasksCompleted, successRate (% formatted), avgDurationSeconds.
  2. ProjectDetail renders the throughput sparkline (14 days from `ThroughputPoint[]`) and a list of recent work units (max 25).
  3. AgentsView renders cross-project aggregates from `GET /api/agents`.
  4. **No write actions in the UI** — enforced at two layers: (a) ESLint `no-restricted-syntax` rule on `packages/web/src/**/*.{ts,vue}` covers `<script>` block literals (the AST selector `Literal[value="POST"]` etc. matches ESTree `Literal` nodes only); (b) **Vue `<template>` blocks are explicitly NOT covered by the ESLint rule** because `vue-eslint-parser` produces a separate AST (V-prefixed nodes). The runtime 405 method guard in WU-4.11 is the load-bearing guarantee for any write attempt originating in a template. The DoD bullet is satisfied by the union: ESLint catches script-side mistakes early; Fastify 405 catches anything that slips through at runtime. (Closes round-4 Feas-2.)
  5. **Back-nav E2E (issue DoD bullet, full version):** `back-nav-e2e.test.ts` mounts `App.vue` with the real `vue-router@4` instance, navigates from ProjectsIndex → ProjectDetail (**real component**) via card click, then calls `router.back()`, and asserts the route is back at `projects-index` AND the cards re-render. This is the only test that exercises the full nav cycle with the real ProjectDetail. (WU-5.3 already covered the minimal version with a stub ProjectDetail, so checkpoint #2 ships with verified router config.)
  6. Dispatcher smoke (top-level): `child_process.execFile('node', ['./bin/metaswarm-dashboard', '--help'])` exits 0 and stdout contains "collect", "serve", "config init".
  7. **Per-subcommand dispatcher smoke (closes round-4 Comp-4):** three additional spawn-based tests assert that `bin/metaswarm-dashboard collect --help`, `bin/metaswarm-dashboard serve --help`, `bin/metaswarm-dashboard config init --help` each exit 0 and produce output that contains the per-subcommand description text registered by the respective `cli/*.ts` module. Catches commander wiring bugs that the in-process help-text imports (WU-2.6, WU-3.18, WU-4.17) cannot.
  8. Validation_commands include a build step **before** the smoke tests, so `packages/{collector,server}/dist` exists when the dispatcher imports from them. (Closes round-4 Feas/Comp warning.)
  9. **Rollback note:** revertable by `git revert`.
- **validation_commands:** `npm run typecheck --workspace packages/web` ; `npm run test --workspace packages/web` ; `npm run lint --workspace packages/web` (catches ESLint guard violations) ; `npm run test --workspace packages/collector` ; **`npm run build`** (root, builds all packages so dispatcher can resolve subpath imports) ; `node ./bin/metaswarm-dashboard --help` ; `node ./bin/metaswarm-dashboard collect --help` ; `node ./bin/metaswarm-dashboard serve --help` ; `node ./bin/metaswarm-dashboard config init --help`

### WU-7 — README, screenshots, walkthrough log, follow-up issues, **global coverage gate**

- **id:** WU-7
- **title:** Document install / config / collect / serve, capture remaining screenshots, run operator-real walkthrough, file follow-up issues, run the **global** 100% coverage gate
- **depends_on:** [WU-6]
- **human_checkpoint:** **TRUE** — issue checkpoint #3 ("before merging the MVP — full walkthrough on real `.beads/` data from at least 2 projects, confirm zero-footprint guarantee").
- **file_scope:**
  - `README.md` (replace stub: install with `nvm use && npm ci`, prerequisites — node 22.12.0, dolt for BEADS server-mode (one-paragraph "the operator already set this up" pointer to upstream BEADS docs), `config init`, `collect`, `serve`, troubleshooting (missing config, missing `bd`, port collision, **"Why is PRs-merged showing —?"** explaining the deliberate MVP scope reduction with a link to the follow-up issue), Roadmap (Step 2/3 explicit non-goals))
  - `docs/screenshots/{project-detail,agents-view}.png`
  - `docs/CHECKPOINT-3-WALKTHROUGH.md` (template + filled-in log: enumerated steps, host repo paths used, `git status` outputs before/after each real project, screenshot refresh log)
  - any final test additions to hit 100% lines/branches/functions/statements per `.coverage-thresholds.json`
- **out_of_scope:** new product features.
- **dod_items:**
  1. README has all required sections (see file_scope).
  2. All three screenshots present and referenced inline in README.
  3. **Global coverage gate (the only place this runs):** `npm run test:coverage` at the workspace root passes the `.coverage-thresholds.json` 100/100/100/100 enforcement, on **both** ubuntu and macos in CI.
  4. **Operator-real walkthrough (issue-mandated):** `docs/CHECKPOINT-3-WALKTHROUGH.md` records a manual walkthrough against ≥2 real `.beads/` projects on the operator's machine, with pre/post `git status` per real project (proving zero-footprint), screenshot refresh log, and a one-paragraph operator sign-off note. Satisfies the issue's literal "real `.beads/` data from at least 2 projects" requirement.
  5. **Follow-up issues filed:** at least two GitHub issues opened against this repo: (a) "Pick a source for `prsMergedLast7d` (BEADS-native PR tracking, opt-in `gh`, or other)" and (b) any other deferred items (e.g., interactive `config add` if scoped). Issue numbers cited in the README's troubleshooting section.
  6. **Upstream metaswarm issue filed:** one issue opened against the metaswarm marketplace plugin repo describing the OOTB gap (`/start-task` does not gate on `bd ready`; `bd init` defaults to embedded Dolt requiring CGO and fails silently). Issue URL recorded in `.beads/knowledge/gotchas.jsonl` for future-self.
  7. **Rollback note:** revertable by `git revert` of WU-7 commit; nothing persistent on disk except `~/.local/share/metaswarm-dashboard/` (operator's data dir, expected and removable).
- **validation_commands:** `npm run lint` ; `npm run typecheck` ; `npm run test:coverage` (THIS IS THE GLOBAL GATE) ; `npm run build`

---

## 4. Cross-cutting concerns

### 4.1 Coverage strategy
- 100% threshold gate runs **only** at `npm run test:coverage` from the workspace root, gated to WU-7. Per-package `npm run test --workspace X` does NOT load thresholds — by design. This resolves the round-3 "intermediate WU coverage gate contradiction".
- v8 coverage provider. `coverage.exclude: ['bin/**', '**/dist/**', '**/__tests__/fixtures/**']`. Each WU adds tests so the cumulative threshold is hit by WU-7.

### 4.2 Lint / format
- ESLint 9 (use `eslint.config.js` flat-config — primary supported format in v9; the `.eslintrc` legacy path is opt-in via env var and is brittle). `@typescript-eslint/recommended-type-checked` + `eslint-plugin-vue` (web only). `@typescript-eslint/no-explicit-any: error`. WU-6 adds `no-restricted-syntax` for the SPA write-method guard. Prettier 3, single quote, trailing commas all, 100-col line.

### 4.3 CI
- Single workflow file. `strategy.matrix.os: [ubuntu-latest, macos-latest]`, node 22.12.0, npm 10. Per OS: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` (global threshold check), `npm run build`, `node ./bin/metaswarm-dashboard --help` smoke. ubuntu-only: `shellcheck bin/*.sh`. **CI does not install `dolt` or `bd`** — collector tests inject the executor and never invoke real `bd`.

### 4.4 README sections (WU-7)
Overview, Architecture sketch, Prerequisites (node 22.12.0 via `.nvmrc`, dolt for BEADS server-mode + one-paragraph operator-pre-setup pointer to upstream BEADS docs), Install (`nvm use && npm ci`), `config init`, `collect`, `serve`, Screenshots (3), Troubleshooting including **"Why is PRs-merged showing —?"** with link to the follow-up issue picking a source, Roadmap (Step 2/3 explicit non-goals).

### 4.5 Cross-package type sharing
`packages/types` is the single source of truth (§2.7). Build is explicit: `prebuild`/`pretypecheck`/`pretest` lifecycle hooks run `npm run build -w packages/types` so consumers always see fresh `dist/` artifacts. No `composite: true`, no TS project references — kept simple.

### 4.6 Root-level runtime deps
`commander` and `js-yaml` declared in `packages/collector` (where the CLI commands live) and hoisted to root by npm workspaces, resolvable from `bin/metaswarm-dashboard`. **No deps live at the root `package.json`.**

### 4.7 No GitHub integration
The MVP does NOT shell to `gh` or fetch from the GitHub API. `prsMergedLast7d` is hard-coded `null` per §2.6. Any future change to this requires a follow-up issue and explicit operator sign-off (the deliberate MVP scope reduction is documented in README troubleshooting).

---

## 5. Risk register

| # | Risk | Source | Lik | Imp | Mitigation |
|---|------|--------|-----|-----|------------|
| R1 | `bd list --json` shape changes between minor versions | issue | M | H | Pin `bd` minor in README prereq; WU-3 wraps `bd` output in Zod; loud parse error. |
| R2 | macOS XDG ambiguity (`~/Library/Application Support` vs `~/.config`) | issue | M | M | Default to Apple HIG path on darwin; honor `XDG_*` overrides; both branches tested via mocked `process.platform` AND CI matrix on real platforms. |
| R3 | `~` expansion + Windows path edge cases | issue | L | M | `os.homedir()` + `path.join`; explicit dod_item WU-2.2; Windows documented as not supported; CI ubuntu+macos only. |
| R4 | Config-YAML UX clunky with many projects | issue | M | L | Out of scope for MVP; follow-up. |
| R5 | Zero-footprint contract violated by stray write | architect | L | H | WU-3 zero-footprint test recursive-sha256-diffs both directories. |
| R6 | `dolt` not on operator's machine | architect | M | M | README "Prerequisites" links to upstream BEADS docs; WU-3 ENOENT handler points to README. |
| R7 | Cross-package type resolution breaks (workspace symlinks vs `exports` map vs build artifacts) | architect | M | M | WU-1.9 sanity test imports a type AND a Zod schema from `@metaswarm-dashboard/types` in each consumer; build pipeline + `prebuild` hook documented in §2.7. |
| R8 | naive-ui major-version churn | architect | L | M | Pin to caret-minor (`^2.40.0`); package-lock.json committed. |
| R9 | 100% coverage brittle on platform-specific branches | architect | M | M | Tests mock `process.platform` AND CI matrix runs both real platforms. |
| R10 | `bd` binary missing on operator's machine | architect | M | M | WU-3 ENOENT handler points to README. |
| R11 | node 18 vs 22.12 mismatch | round-1 | H | M | `.nvmrc 22.12.0` + `engines.node: ">=22.12.0"` + README. |
| R12 | `prsMergedLast7d: null` causes UI confusion | architect | M | L | README troubleshooting + UI shows "—" + follow-up issue cited. |
| R13 | Metaswarm OOTB gap (`/start-task` does not gate on `bd ready`) | meta | H | M | Tracked in §0; filed as upstream issue in WU-7.6. |
| R14 | ESLint 9 flat-config migration friction | architect (round-3) | L | L | WU-1 picks flat-config (`eslint.config.js`) primary; documented. |

---

## 6. Traceability — issue DoD bullets → WU dod_items

| Issue DoD bullet | WU.dod_item |
|---|---|
| Zero-footprint guarantee | WU-3.13 |
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
| Click project card → detail; **back navigation works** | WU-5.3 (initial click+back) **+ WU-6.5 (full E2E with real ProjectDetail)** |
| Project detail per-agent table sortable | WU-6.1 |
| Project detail throughput sparkline + recent work units | WU-6.2 |
| Agents view cross-project aggregation | WU-6.3 |
| No write/POST/PUT/DELETE actions in UI | WU-6.4 (ESLint guard) + WU-4.11 (server runtime guard) |
| Empty-state messaging | WU-5.4 |
| `npm run build` from `packages/web/` exits 0 | WU-5.1 |
| TypeScript strict, no `any` | WU-1.2, .3 |
| ESLint + Prettier pass on all packages | WU-1.1, §4.2 |
| Coverage meets `.coverage-thresholds.json` | WU-7.3 (the ONLY place the global gate runs) |
| All three subcommands have useful `--help` | WU-1.6 (top-level) + WU-2.6 (config init) + WU-3.18 (collect) + WU-4.17 (serve) |
| README documents install/config/collect/serve + screenshots | WU-7.1, .2 |
| `prsMergedLast7d` (4th metric on Projects index) | WU-3.15 (collector hard-codes `null`) + WU-4.3 (passes through) + WU-5.2 (renders "—") + README troubleshooting (WU-7.1) + follow-up issue (WU-7.5) |
| `.beads/` set up for metaswarm orchestration of this repo | §0 (operator-approved out-of-band) + WU-1.10 (gitignore invariant test) |
| CI matrix runs on multiple OSes given platform-specific code | WU-1.4, §4.3 |
| Sample snapshot JSON (checkpoint #1 deliverable) | WU-3.17 |
| Projects-index screenshot (checkpoint #2 deliverable) | WU-5.6 |
| Walkthrough log (checkpoint #3 deliverable) | WU-7.4 |

**No DoD bullets remain unmapped.**

---

## 7. Orchestration notes

- **Parallelization graph (sequential):** WU-1 → WU-2 → WU-3 → WU-4 → WU-5 → WU-6 → WU-7.
- **Human checkpoints:** WU-3 (`docs/samples/daily-snapshot.example.json`), WU-5 (`docs/screenshots/projects-index.png`), WU-7 (`docs/CHECKPOINT-3-WALKTHROUGH.md`).
- **External-tools delegation:** disabled per `.metaswarm/project-profile.json` (`external_tools: false`). All work runs through Claude.
- **Rollback:** every WU has an explicit "Rollback note" dod_item. Greenfield repo; revert-by-commit always works. Side effects are confined to (a) operator's `~/.local/share/metaswarm-dashboard/` data dir (expected, removable), (b) the BEADS dolt server in `~/.local/share/metaswarm-dashboard-bd-server/` (already running pre-plan, owned by §0).

---

## 8. Round-3 → v4 fixes (audit trail)

| Round-3 finding | Resolution in v4 | Where |
|---|---|---|
| **Feas-1** `vue-router@5` mandates `pinia` peer | Re-pinned to `vue-router@^4.6.4` | §2.4, WU-1 file_scope |
| **Feas-2** `vitest-axe` only `1.0.0-pre.5` for vitest 4 | Dropped: a11y removed from plan (operator opted out, see Scope-2) | §1, WU-5, WU-6, packages/web deps |
| **Feas-3** Bare-specifier subpath imports need `exports` map | `exports` maps in every consumer's `package.json` | §2.9, WU-1 file_scope |
| **Feas-4** No build step for workspace packages | Explicit `"build": "tsc"` per package + root `prebuild`/`pretypecheck`/`pretest` lifecycle hooks running `npm run build -w packages/types` | §2.7, §4.5, WU-1.7 |
| **Feas-5** TS `composite:true` incompatible with "no build step" | Dropped `composite` and project references entirely; rely on standard `tsc` build + npm workspace symlinks | §2.7 |
| **Feas-6** `gh pr list --jq` null-guard + page size | N/A: `gh` removed entirely (Scope-1 / operator opt-out) | §2.6, WU-3, §4.7 |
| **Compl-1** Per-subcommand `--help` not tested | New dod_items: WU-2.6 (config init), WU-3.18 (collect), WU-4.17 (serve), each with explicit content assertion | WU-2.6, WU-3.18, WU-4.17 |
| **Compl-2** Back-nav E2E with real ProjectDetail missing | New dod_item WU-6.5 mounts real ProjectDetail with real router | WU-6.5 |
| **Compl-3** WU-2 missing `~`/`XDG_*` dod_items | New dod_items WU-2.2 (`~` cases) and WU-2.3 (XDG overrides) | WU-2.2, WU-2.3 |
| **Compl-4** Coverage gate contradiction (100% per-WU) | Global threshold runs ONLY at root `npm run test:coverage` (WU-7); per-WU uses `npm run test --workspace X` (no thresholds) | §2.10, §4.1, WU-7.3 |
| **Compl-5** `.gitignore` invariant not locked-down | New dod_item WU-1.10 runs `git check-ignore` and asserts non-ignored | WU-1.10 |
| **Compl-6** Smoke ubuntu-only despite XDG platform diffs | Smoke now runs on **both** ubuntu and macos | WU-1.6, §4.3 |
| **Scope-1** `gh pr list` scope creep | `prsMergedLast7d` hard-coded `null` in MVP; documented limit + follow-up issue in WU-7.5 | §2.6, §4.7, WU-3.15, WU-7.5 |
| **Scope-2** `vitest-axe` a11y scope creep | Removed entirely | §1, WU-5, WU-6 |
| **Scope-3** §0 out-of-band smuggling | Documented as explicit operator-approved override; gitignore invariant test in WU-1.10 prevents silent regressions | §0, WU-1.10 |
| **Scope-W4** `packages/types` over-engineering | Operator opted to keep (round-2 → v3, option "a"); justification recorded | §2.1 |
| **Scope-W5** Walkthrough fixture+real gold-plating | Dropped fixture-CI nightly path; only operator-real walkthrough remains (issue's literal requirement). WU-3.13 zero-footprint test already provides the fixture-based CI guard. | WU-7.4 |
| **OQ backfill behavior** | Decided: no backfill on non-Monday runs | §2.2, WU-3.4 |
| **OQ no-write static check** | Replaced manual review with ESLint `no-restricted-syntax` rule scoped to web src | WU-6.4 |
| **OQ fixture data dir not in WU-5 file_scope** | Added explicitly | WU-5 file_scope |

---

## 9. Round-4 → v5 fixes (audit trail; FINAL)

Round 4 produced 9 blockers + 8 warnings. Of these, **2 blockers are operator-binding decisions** the gate cannot revisit (see status header at top): `prsMergedLast7d: null` (round-3 → v4 option "a") and §0 out-of-band setup (round-2 → v3 option "c"). These were correctly re-flagged by ciecutamente reviewers but are off-limits for further iteration. The remaining 7 refinements are applied here as v5; warnings deemed marginal are noted.

| Round-4 finding | Resolution in v5 | Where |
|---|---|---|
| **Feas-1** Node 22.12.0 not installed on host | New WU-1.0 precondition: verify node version before any other action; CI uses `setup-node@v4 with node-version-file: .nvmrc` | WU-1.0 |
| **Feas-2** ESLint `no-restricted-syntax` blind to Vue `<template>` blocks | DoD claim narrowed: ESLint covers `<script>`; Fastify 405 (WU-4.11) is the load-bearing guard for any write attempt at runtime; both layers documented as the union that satisfies the issue's no-write DoD | WU-6.4 |
| **Feas-W3** vitest 4 `test.projects` field name | Documented explicitly | WU-1.8 |
| **Feas-W4** CI rewrite removes existing enforcement-command parser | Acknowledged; `.coverage-thresholds.json.enforcement.command` becomes documentation-only, root vitest config wires thresholds directly | §2.10, §4.1 |
| **Feas-W5** `bin/` resolution chain fragility | Caught by WU-6.6 + WU-6.7 dispatcher smoke tests; root `npm run build` step added as a precondition (WU-6.8) | WU-6.8 |
| **Compl-1** WU-5 ships checkpoint #2 without back-nav verified | WU-5.3 expanded: minimal back-nav with stub ProjectDetail BEFORE the checkpoint; full E2E with real ProjectDetail still in WU-6.5 | WU-5.3 |
| **Compl-2** Gitignore invariant test path-incomplete | Expanded to one path per protected directory (`plans`, `context`, `knowledge`× multiple files, `issues.jsonl`); also asserts `.beads/.gitignore` does not match these | WU-1.10 |
| **Compl-3** DST coverage US-blind | Added US dates (2026-03-08, 2026-11-01) + tests run with `process.env.TZ` set to LA / Berlin / UTC | WU-3.11 |
| **Compl-4** Per-subcommand `--help` not verified end-to-end via dispatcher | New WU-6.7: spawn `bin/metaswarm-dashboard {collect,serve,config init} --help` and assert each subcommand's description text appears | WU-6.7 |
| **Compl-5** `lastActivityAt: null` undefined behavior | Renders "Never" when null; explicit dod_item; no crash | WU-5.2 |
| **Compl-W6** WU-6 smoke fragile without prior `npm run build` | Added explicit `npm run build` to WU-6 validation_commands before any smoke | WU-6.8, WU-6 validation |
| **Compl-W7** WU-4 isolation fragility | Per-package `npm run test --workspace packages/server` is ordered after WU-3; no separate fix needed since plan is sequential per §7 | n/a |
| **Scope-1** `prsMergedLast7d: null` violates issue DoD literal | **Operator-binding decision (round-3 → v4 option "a")** — gate exception per status header. README troubleshooting is the documented mitigation; follow-up issue WU-7.5 captures the deferral. | header, §2.6, WU-7.5 |
| **Scope-2** §0 out-of-band smuggling | **Operator-binding decision (round-2 → v3 option "c")** — gate exception per status header. WU-1.10 catches `.gitignore` regressions. | header, §0 |
| **Scope-W3** `packages/types` over-engineering | **Operator-binding (round-2 → v3 option "a")** — kept | header, §2.1 |
| **Scope-W4** ESLint duplicate of 405 guard | Kept (script-side fast feedback) but DoD claim narrowed to script blocks; runtime 405 is load-bearing | WU-6.4 |
| **Scope-W5** WU-1.10 gitignore test over-engineered | Kept and expanded — round-3 Compl-5 had explicitly required this; the two reviewers' opinions diverge and the operator preserves the test | WU-1.10 |

---

## 10. Implementation kickoff

Status is **APPROVED FOR EXECUTION**. Next action: orchestrator begins WU-1, applying the 4-phase metaswarm orchestrated-execution loop (IMPLEMENT → VALIDATE → ADVERSARIAL REVIEW → COMMIT). Subsequent reviewers operate at the IMPLEMENTATION level (per-WU PASS/FAIL with file:line evidence), not at the plan level.
