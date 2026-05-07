# Stack

This file is the **single source of truth for which tools, frameworks, and
versions this repo uses**. Tool-agnostic: any agent or human picks it up
without depending on a specific platform's "context hub."

If you change anything here, also update:
- `package.json` (engines + lockfile-driven versions)
- `.nvmrc`
- `.coverage-thresholds.json` (if testing tooling changes)
- `CLAUDE.md` and `.beads/knowledge/decisions.jsonl` (so metaswarm agents pick it up)

---

## Approved tech stack (Step 1 MVP)

| Layer | Tool | Version pin | Why |
|---|---|---|---|
| Runtime | Node | `>=22.12.0` (`.nvmrc`, `engines.node`) | Vite 8 + Vitest 4 floor |
| Package manager | npm | `>=10` (npm workspaces) | Operator consensus; npm 10 workspaces are mature; lockfile is `package-lock.json` (committed) |
| Language | TypeScript | `^5.7.2` | strict + `noUncheckedIndexedAccess` |
| Frontend framework | Vue | `^3.5.13` | Composition API with `<script setup>` |
| UI library | naive-ui | `^2.40.4` | Single design system; `darkTheme` default |
| Routing | vue-router | `^4.6.4` | History mode; v5 mandates Pinia peer (rejected, see plan §2.4) |
| State | composition-API composables only | n/a | No Pinia in MVP (plan §2.5) |
| Build (web) | Vite | `^6.0.5` | |
| Backend framework | Fastify | `^5.2.1` | + `@fastify/static@^8.0.3` |
| Validation | Zod | `^3.24.1` | Schemas live in `@metaswarm-dashboard/types` |
| YAML | js-yaml | `^4.1.0` | |
| CLI parser | commander | `^12.1.0` | Hoisted via `packages/collector` |
| Test runner | Vitest | `^4.0.0` | + `@vitest/coverage-v8` |
| Test utilities | `@vue/test-utils` `^2.4.6` + `jsdom@^25` | | Component testing |
| E2E screenshots | Playwright | `^1.59.1` (devDep, root) | Out-of-band; CI does not auto-regenerate |
| Linter | ESLint | `^9.16.0` (flat-config) | + `typescript-eslint`, `eslint-plugin-vue`, `eslint-plugin-import` |
| Formatter | Prettier | `^3.4.2` | single quote, trailing comma all, 100-col |
| Type checker | tsc / vue-tsc | tsc `^5.7.2`, vue-tsc `^2.1.10` | |
| BEADS runtime | Dolt SQL server (server mode) | `dolt >= 1.85` | CGO-less hosts can't use embedded mode |

## Approved package-manager + node-manager combinations

`.nvmrc 22.12.0` is the universal pin. Read by:
- `nvm` (`nvm use`)
- `n` (`sudo n auto`)
- `fnm` (`fnm use`)
- `volta` (with `volta install node@22.12.0`)

Pick whichever you have installed. Don't mix two on the same machine.

For package management: **npm** is the only sanctioned option for this repo.
Operator consensus: yarn classic (v1) is in maintenance, yarn berry has slow
adoption, pnpm is technically superior but the secondary developer prefers npm.
The lockfile is `package-lock.json` and is committed.

## Excluded / rejected (with reasons)

| Tool | Why excluded |
|---|---|
| Pinia | No cross-view state to share in MVP; reconsider in Step 2 if evals introduces shared state |
| `@vitejs/plugin-vue-jsx` | We don't write JSX; Vue SFCs only |
| Tailwind / UnoCSS / Windi | naive-ui ships its own scoped styles; one design system rule |
| Vitest workspace file (`vitest.workspace.ts`) | Deprecated; we use the modern `test.projects` field in `vitest.config.ts` |
| `@types/node` < 22 | engines field is `>=22.12.0` |
| `vue-router@5` | Mandates Pinia peer dep; conflicts with §2.5 |
| `vitest-axe` (a11y) | Not in issue scope; UI is a single-operator local tool |
| `gh pr list` integration | Plan §2.6 hard-codes `prsMergedLast7d: null` in MVP; see follow-up issue #2 |

## How to extend this in future steps

When Step 2 (evals) or Step 3 (observability) starts:

1. **Don't change anything here without an architecture decision in `.beads/knowledge/decisions.jsonl`** (use `bd remember` or `bd decision`).
2. Pin the new version explicitly. Caret ranges only on minor/patch.
3. Update `CLAUDE.md`'s "Code Quality" + "Tech Stack" sections to match.
4. Update this file + the table above so agents see one truth.

---

## Why a local STACK.md instead of a hosted "context hub"

Hosted context hubs (Andrew Ng's, OpenAI's, etc.) are cool but:
- Adoption is uneven across tooling (Cursor, Claude Code, Continue, Aider, Codex CLI all read different files)
- They add an external dependency for a build artifact (your project's stack)
- They don't survive `git clone` on a new machine offline

`STACK.md` + `CLAUDE.md` + `.beads/knowledge/decisions.jsonl` is the redundant-by-design local equivalent:
- Every agent that reads markdown / Claude / Cursor / IDE picks up the constraints.
- `.beads/knowledge/decisions.jsonl` is machine-readable for metaswarm agents specifically.
- Zero external dependency; survives clones, branches, restores, dotenvs.
