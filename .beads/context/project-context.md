# Project Context — sessions-spike (Maintained by Orchestrator)

Source of truth: `docs/design-sessions-spike.md` v3 (gate-approved 5/5, 2026-05-14).
Work-unit chain: WU-1 → WU-2 → WU-3 → WU-4 → WU-4.5 → WU-5 → WU-6 → WU-7 → WU-8.

## Tooling
- Package manager: **npm** workspaces (`packages/*`). NOT pnpm/yarn (STACK.md).
- Test runner: vitest 4 — root `vitest.config.ts` defines `test.projects`; per-package minimal `vitest.config.ts`.
- Typecheck: `tsc --noEmit` per package; build: `tsc -p tsconfig.build.json`.
- Lint: eslint 9 flat-config (`eslint.config.js`).
- Node `>=22.12.0`.
- Coverage gate: `.coverage-thresholds.json` → `npm run test:coverage` (lines 100, branches 92, functions 97, statements 98).

## Established Patterns
- Each workspace pkg: `package.json` (exports map), `tsconfig.json` (noEmit), `tsconfig.build.json` (emit to dist), `vitest.config.ts`.
- Cross-package imports go through `@metaswarm-dashboard/types` exports map only — never deep-import package internals (design anti-goal §12.10).
- `types` must be built before dependents typecheck/test — root `prebuild`/`pretypecheck`/`pretest` hooks run `npm run build -w packages/types`.
- Defensive unreachable branches: `/* v8 ignore */`.
- TDD mandatory: failing test first.

## Completed Work Units
| WU | Title | Key Files | Notes |
|----|-------|-----------|-------|
| WU-1 | skeleton + PoC delete + atomicWriteJson lift + guards | `packages/sessions/*`, `packages/types/src/fs-utils.ts`, `packages/collector/src/writer.ts` | commit 3664778. `atomicWriteJson`/`WriterError`/`WriterFsHooks` now in `@metaswarm-dashboard/types/fs-utils` (subpath export). `packages/session-observer/` deleted. Branch `sessions-spike`. |

## Open follow-ups discovered
- `metaswarm-dashboard-0nt` (P2 bug) — `main` fails `npm run test:coverage` on every axis (pre-existing MVP debt). WU-7 depends on it; must be green before the spike PR (design §15.1).

## Active Services
See SERVICE-INVENTORY.md
