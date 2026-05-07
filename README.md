# metaswarm-dashboard

## Overview

Read-only multi-project dashboard for metaswarm-managed projects (Vue 3 + naive-ui + Fastify + npm workspaces).

A single-operator local tool that gives one human visibility across N metaswarm-managed projects without `cd`-ing between them. Reads `.beads/` data from each configured project and serves a small SPA with three views.

This is **Step 1 of a 3-step arc** ([issue #1](https://github.com/montoyaedu/metaswarm-dashboard/issues/1)). Step 2 (evals scoring) and Step 3 (observability) are explicit non-goals here.

## Screenshots

| | |
|:-:|:-:|
| ![Projects index](docs/screenshots/projects-index.png) | ![Project detail](docs/screenshots/project-detail.png) |
| Projects index | Project detail (with sortable agent table + 14-day throughput sparkline) |
| ![Agents view](docs/screenshots/agents-view.png) | |
| Agents (cross-project aggregate) | |

## Architecture

```
host project A/.beads/  ─┐  (read-only, byte-identical before/after)
host project B/.beads/  ─┼── metaswarm-dashboard collect ──> central data dir
host project C/.beads/  ─┘                                          │
                                                                    ▼
                                            metaswarm-dashboard serve (Fastify, port 5174)
                                                                    │
                                                                    ▼
                                                    Vue 3 + naive-ui SPA (browser)
```

**Zero footprint** in host repos is the load-bearing invariant. The collector reads `.beads/`-tracked JSONL plus `bd list --json`, then writes per-project snapshots into a central XDG-aware data dir under your home. Host project files are never modified — verified by an automated test that recursive-sha256-diffs fixture host repos before/after a `collect --all` run.

## Prerequisites

- **Node 22.12.0+** (pinned via `.nvmrc`; required by Vite 8 / Vitest 4). The repo uses `.nvmrc` which is read by every major version manager: `nvm use`, `fnm use`, `volta install node@22.12.0`, or `sudo n auto` all work. Pick whichever you have.
- **`bd` CLI** (the [BEADS](https://github.com/steveyegge/beads) issue tracker that metaswarm uses). The collector runs `bd list --json` against each configured project. Install per the upstream BEADS docs.
- **Dolt SQL server** for BEADS `--server` mode (only required if your `bd` binary was compiled without CGO — common on macOS Apple Silicon). Run `brew install dolt` (or equivalent), then `dolt sql-server -H 127.0.0.1 -P 3307` in a background terminal/launchd entry. `bd init --server` then connects to it. See the [BEADS server-mode docs](https://github.com/steveyegge/beads) for details.
- **Optional**: a real GitHub authentication via `gh auth login` is *not* required by the MVP — `prsMergedLast7d` is hard-coded `null` in this release (see [Why is PRs-merged showing —?](#why-is-prs-merged-showing-)).

## Install

```bash
git clone git@github.com:montoyaedu/metaswarm-dashboard.git
cd metaswarm-dashboard
nvm use            # picks up .nvmrc (22.12.0). Or: `n auto`, `fnm use`, `volta install node@22.12.0`
npm ci             # installs all four workspace packages
npm run build      # builds packages/types, collector, server, web
```

`npm run build` emits compiled JS under each workspace's `dist/`. The `bin/metaswarm-dashboard` ESM dispatcher imports those compiled subpaths.

## Discovering existing `.beads/`-tracked projects

The MVP doesn't auto-discover projects (`config.yaml` is explicit by design — see [STACK.md](STACK.md) for the rationale). To find candidates under a parent dir, use the bundled helper:

```bash
./bin/discover-projects.sh ~/code ~/ethiclab
# Prints YAML you can paste into ~/.config/metaswarm-dashboard/config.yaml
```

A future `metaswarm-dashboard config discover` subcommand will integrate this — see [issue #5](https://github.com/montoyaedu/metaswarm-dashboard/issues/5).

## Quick start

The fastest path is the bundled starter:

```bash
# Verifies node, builds if needed, initializes config.yaml on first run,
# then collect --all, then serve. Idempotent — safe to re-run anytime.
./start.sh

# First-time setup tip: scan one or more parent dirs for .beads/-tracked
# projects and review-then-append them to config.yaml interactively:
./start.sh --discover ~/code ~/work

# See `./start.sh --help` for --reinit / --no-collect / --no-serve / --port flags.
```

If you prefer the manual path (or want to script the steps individually):

```bash
# 1. Write a starter config.yaml at the XDG-aware location.
metaswarm-dashboard config init
# → ~/.config/metaswarm-dashboard/config.yaml on linux
# → ~/Library/Application Support/metaswarm-dashboard/config.yaml on macOS

# 2. Edit config.yaml: list every project you want collected.
# projects:
#   - name: foo
#     path: ~/code/foo
#   - name: bar
#     path: ~/work/bar

# 3. Collect snapshots from every project.
metaswarm-dashboard collect --all
# → writes <data-dir>/projects/<name>/daily/YYYY-MM-DD.json (UTC)
# → on Monday-UTC runs also writes <data-dir>/projects/<name>/weekly/YYYY-Www.json

# 4. Serve the SPA + read-only API on port 5174.
metaswarm-dashboard serve
# → open http://127.0.0.1:5174
```

## Subcommands

### `metaswarm-dashboard config init`

Writes a starter `config.yaml` at the XDG-aware location. Refuses to overwrite an existing file unless you pass `--force`.

| Flag | Description |
|---|---|
| `--force` | Overwrite an existing `config.yaml` |

### `metaswarm-dashboard collect`

Reads each configured project's `.beads/` directory + `bd list --json` output, computes per-agent and project-wide metrics, and writes one snapshot per UTC day. Idempotent: re-running on the same UTC day overwrites the day's file. Monday-UTC runs additionally write a weekly file for the prior ISO week. Non-Monday runs do **not** backfill missing weekly files.

| Flag | Description |
|---|---|
| `--project <name>` | Collect a single project from `config.yaml` |
| `--all` | Collect every project listed in `config.yaml` |

Skips projects whose path is missing or whose `.beads/` is absent (with a clear log line). Malformed JSONL rows are skipped with a warning, never crash.

### `metaswarm-dashboard serve`

Starts the local Fastify server. Refuses non-GET methods on `/api/*` with HTTP 405 (the dashboard is structurally read-only). Falls back to `index.html` for any non-`/api` GET so the SPA's history-mode router works on direct navigation.

| Flag | Description |
|---|---|
| `--port <port>` | Port to listen on (default 5174) |

| Env var | Description |
|---|---|
| `METASWARM_DASHBOARD_DATA_DIR` | Override the snapshots data dir |
| `METASWARM_DASHBOARD_CONFIG` | Override the config.yaml path |

## Troubleshooting

### Why is PRs-merged showing "—"?

The MVP intentionally leaves `prsMergedLast7d: null` — so the SPA renders "—" everywhere this metric is shown. This is a deliberate scope reduction (the issue lists the metric, but specifying a data source would have pulled in either external GitHub fetches or extending BEADS itself, both out of scope for Step 1). A follow-up issue tracks picking a source: [issue #2](https://github.com/montoyaedu/metaswarm-dashboard/issues/2).

### `bd: command not found`

The collector shells out to `bd list --json` per project. Install the BEADS CLI per the upstream docs (`https://github.com/steveyegge/beads`) and ensure `bd` is on PATH. The collector surfaces a clear error referencing this section when ENOENT is hit.

### `metaswarm-dashboard serve: config file not found`

Run `metaswarm-dashboard config init` to write a starter `config.yaml`, then edit it to list your projects.

### Port 5174 already in use

Pass `--port <other>`: `metaswarm-dashboard serve --port 8080`.

### `EBADENGINE` warnings during `npm ci`

Your node version is below `22.12.0`. Run `nvm use` (the repo pins `.nvmrc 22.12.0`) and re-run `npm ci`.

### Snapshots aren't appearing in the SPA

`metaswarm-dashboard serve` reads from the data dir (default `~/Library/Application Support/metaswarm-dashboard/` on macOS or `~/.local/share/metaswarm-dashboard/` on linux). If you set `METASWARM_DASHBOARD_DATA_DIR` for `collect`, set the same env var when running `serve`.

## Coverage + CI

The project enforces 100% line/branch/function/statement coverage at the workspace root via `vitest` v8 coverage with thresholds wired from `.coverage-thresholds.json` (ESM JSON import). The threshold gate runs only at `npm run test:coverage` from the root — per-package `npm run test --workspace X` invocations skip the gate so intermediate WUs aren't blocked by other-package incompleteness.

CI (`.github/workflows/ci.yml`) runs `lint / typecheck / test:coverage / build` on a `[ubuntu-latest, macos-latest]` matrix with node 22.12.0, plus a `node ./bin/metaswarm-dashboard --help` smoke and `shellcheck bin/*.sh` (ubuntu-only).

## Roadmap

- **Step 2 — Evals scoring** of hot-path agents using metaswarm's existing `rubrics/`. Out of scope here.
- **Step 3 — Observability** (per-agent I/O capture, latency, cost). Out of scope here.
- The longer-term ambition (band.ai-style real-time multi-peer governance) is **explicitly out of scope** for this repo, but the architecture should not preclude it.

## Repository layout

```
metaswarm-dashboard/
├── package.json                 # npm workspaces root
├── packages/
│   ├── types/                   # shared TS types + Zod schemas (one source of truth)
│   ├── collector/               # CLI + readers + metrics + atomic writer
│   ├── server/                  # Fastify server + snapshot reader + aggregator
│   └── web/                     # Vue 3 + naive-ui + vue-router 4 SPA
├── bin/metaswarm-dashboard      # thin ESM shebang dispatcher
├── docs/                        # screenshots + sample snapshot + walkthrough log
├── scripts/take-screenshots.mjs # Playwright capture harness
├── .beads/                      # metaswarm orchestration state (committed)
├── CLAUDE.md                    # metaswarm project instructions
└── .coverage-thresholds.json    # 100% coverage gate
```

## License

To be added.
