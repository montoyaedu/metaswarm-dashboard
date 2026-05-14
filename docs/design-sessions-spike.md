# Design — Sessions Observability Spike

> Status: design (pre-WU)
> Author: operator (drafted via Claude on a sibling session, 2026-05-14)
> Scope: spike for Step 3 (observability) — session intelligence only
> Target audience: the agent that will execute the WU breakdown below

---

## 1. Why now, and why this scope

Step 1 MVP (cross-project beads visibility) reached WU-7 on 2026-05-07 and has
been quiescent since: 50 test files, 249 passing tests, coverage above the
configured thresholds. The MVP is shipped and in use; there is no momentum to
preserve and no follow-up WU on the original plan currently in flight.

In parallel, the operator runs several Claude Code sessions on sibling repos
(`platform-current-production`, `backoffice-ui-current-production`). Each
session emits a JSONL transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` containing every prompt,
text response, `thinking` chunk, tool invocation (name + args), and tool
result. The file is updated live as the session works.

These transcripts are a **process** signal that the existing beads-based
collector cannot surface: granularity is per-tool-call (not per-issue),
latency is near-live (not per-day), and the questions they answer are
qualitative ("did the agent follow TDD?", "did it drift outside the ticket
scope?", "is it brute-forcing failing tests?"). They are exactly the kind of
data Step 3 of the 3-step arc was meant to address — see issue #1.

This spike formalizes a **minimum useful subset** of Step 3:

- Parse JSONL transcripts into a typed timeline.
- Score each session against a fixed **process rubric** (10 criteria).
- Expose both via a new CLI subcommand. **No web view in this spike.**

Everything else that "observability" could mean — CI metrics, deploy metrics,
inference cost, latency dashboards — is deferred. Adding scope here is the
single largest failure mode for this spike; see §10.

A standalone Python proof-of-concept already exists at `/tmp/observe.py`
(operator machine). It parses one JSONL transcript and emits a flat timeline.
This spike ports that PoC to TypeScript, formalizes the schema, and earns the
repo's quality bar (Zod-first, 100% lines coverage, TDD per
`.coverage-thresholds.json` and `CLAUDE.md`).

## 2. Scope

### In scope (this spike)

1. New workspace package `packages/sessions` (sibling to `collector`, not
   internal to it — see §3 for rationale).
2. New Zod schemas in `@metaswarm-dashboard/types/sessions` — additive only;
   the existing `snapshots.ts`, `paths.ts`, `api.ts` are not modified.
3. JSONL parser: `(filePath) → SessionTimeline` (pure, fs injectable).
4. Process rubric: ten pure scorer functions
   `(timeline) → RubricItem`, composed into `ProcessRubricScore`.
5. CLI subcommand `metaswarm-dashboard sessions` with three actions:
   - `timeline <project>` — print the latest session's flat timeline.
   - `audit <project>` — apply the rubric to the latest session, print
     score table with verdict (`pass` / `watch` / `fail`).
   - `tail <project>` — follow the most-recent JSONL of the configured
     project; print each new event as it arrives.
6. Snapshot persistence: writer emits one JSON file per session under
   `<dataDir>/projects/<name>/sessions/<YYYY-MM-DD>/<session-id>.json`,
   atomic-write, idempotent (overwrites on re-run).
7. Tests: unit tests for parser, each rubric scorer, writer; integration
   tests using fixtures derived from the operator's real transcripts as
   golden masters (see §7).
8. Lockfile-clean dependency footprint: no new runtime deps. Stay on
   `zod`, `commander`, node `>=22.12.0` builtins.

### Out of scope (this spike — deferred to follow-up issues)

- Web view ("Sessions" tab in the SPA). Schema must support it; UI is not
  shipped here. Follow-up issue to be opened at WU-7 close.
- Live aggregation across projects (cross-session metrics, e.g. "rubric
  score over time"). Single-session view only.
- CI / deploy / inference-cost metrics (the rest of Step 3 generically).
- Sanitization of secrets/PII before persistence. See §9 — flag exists in
  the schema but defaults to off for single-operator local use.
- GitHub PR linkage, Linear/YouTrack cross-ref enrichment.
- Streaming push to a remote dashboard. Local-only.

## 3. Architecture — why a new package

The existing `collector` is **batch-oriented**: invoked once per
`./start.sh` cycle, reads `.beads/`, writes a daily snapshot, exits. The
sessions observer has fundamentally different runtime characteristics:

| Axis | `collector` (existing) | `sessions` (new) |
|---|---|---|
| Trigger | One-shot CLI invocation | One-shot **and** tail (`-f`) modes |
| Source | `.beads/` + `bd list --json` | `~/.claude/projects/<cwd>/<sid>.jsonl` |
| Cadence | Per-day rollup | Per-session, possibly mid-flight |
| Output frequency | One file per project per day | One file per session (could be many per day) |
| Failure mode tolerated | Skip project, warn | Skip session, warn — same |

Folding sessions into `collector` would conflate the batch and stream
runtime models. A sibling package keeps the boundary clean and lets each
evolve independently. Shared concerns (`PathsEnv`, `Config`, atomic writer,
project discovery) are already in `@metaswarm-dashboard/types` or
`packages/collector/src/{config,writer}` and are imported, not duplicated.

### Module layout

```
packages/sessions/
├── package.json                  # name: @metaswarm-dashboard/sessions
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts              # mirrors collector's
└── src/
    ├── index.ts                  # public re-exports
    ├── jsonl-reader.ts           # JSONL → SessionTimeline
    ├── rubric/
    │   ├── index.ts              # composeRubric() — orchestrates the 10 scorers
    │   ├── setup-discipline.ts
    │   ├── planning.ts
    │   ├── tdd.ts
    │   ├── scope-drift.ts
    │   ├── error-handling.ts
    │   ├── thrashing.ts
    │   ├── cross-reference.ts
    │   ├── communication.ts
    │   ├── prompt-coherence.ts
    │   └── workflow-touchpoints.ts
    ├── transcript-discovery.ts   # project → latest JSONL path
    ├── writer.ts                 # session snapshot writer (atomic, sibling to collector/writer)
    ├── tail.ts                   # JSONL follower (poll + incremental parse)
    ├── cli/
    │   ├── timeline.ts
    │   ├── audit.ts
    │   └── tail.ts
    └── __tests__/                # unit + integration tests
```

The CLI dispatcher in `bin/metaswarm-dashboard` gains one new dispatch arm
for the `sessions` verb — same pattern as `collect` and `config init` today.

## 4. Zod schemas (additive to `@metaswarm-dashboard/types`)

A new file `packages/types/src/sessions.ts` defines the contracts.
`index.ts` re-exports. **No modification to existing schemas.**

### 4.1 ToolUseEvent

```typescript
export const ToolUseEvent = z.object({
  /** UTC ISO-8601 timestamp from the JSONL entry. */
  at: z.string().datetime({ offset: false }),
  /** "user-prompt" | "user-command" | "assistant-text" | "assistant-thinking" |
   *  "tool-use" | "tool-result" | "tool-error". */
  kind: z.enum([
    'user-prompt',
    'user-command',
    'assistant-text',
    'assistant-thinking',
    'tool-use',
    'tool-result',
    'tool-error',
  ]),
  /** For `tool-use`: the tool name (Read/Write/Edit/Bash/Agent/...). */
  toolName: z.string().nullable(),
  /** Free-form short summary for the timeline view (≤200 chars, single-line). */
  summary: z.string(),
  /** Original raw JSONL entry's UUID, for cross-reference / debugging. */
  uuid: z.string().nullable(),
});
export type ToolUseEvent = z.infer<typeof ToolUseEvent>;
```

### 4.2 SessionTimeline

```typescript
export const SessionTimeline = z.object({
  schemaVersion: z.literal(1),
  /** Path of the JSONL transcript on disk. */
  transcriptPath: z.string(),
  /** sessionId from the JSONL entries. */
  sessionId: z.string(),
  /** cwd from the JSONL entries (the project root). */
  projectCwd: z.string(),
  /** When the first event was emitted. */
  startedAt: z.string().datetime({ offset: false }),
  /** When the most-recent event was emitted (may be < now for a live session). */
  lastEventAt: z.string().datetime({ offset: false }),
  /** Total event count after filtering noise. */
  eventCount: z.number().int().nonnegative(),
  /** Flat ordered list of events. */
  events: z.array(ToolUseEvent),
});
export type SessionTimeline = z.infer<typeof SessionTimeline>;
```

### 4.3 RubricItem + ProcessRubricScore

```typescript
export const RubricVerdict = z.enum(['pass', 'watch', 'fail', 'na']);
export type RubricVerdict = z.infer<typeof RubricVerdict>;

export const RubricItem = z.object({
  /** Stable kebab-case key — matches the file name under rubric/. */
  key: z.string(),
  /** Short human label for the table view. */
  label: z.string(),
  verdict: RubricVerdict,
  /** One short sentence describing the evidence (≤200 chars). */
  evidence: z.string(),
  /** Optional pointer back into the timeline (UUID or event index) for the
   *  CLI to highlight on demand. */
  pointer: z.string().nullable(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const ProcessRubricScore = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  scoredAt: z.string().datetime({ offset: false }),
  items: z.array(RubricItem).length(10),
  /** Aggregate verdict: `fail` if any item is fail; else `watch` if any is
   *  watch; else `pass`. `na` items are excluded from the aggregate. */
  overall: RubricVerdict,
});
export type ProcessRubricScore = z.infer<typeof ProcessRubricScore>;
```

### 4.4 SessionSnapshot (what the writer persists)

```typescript
export const SessionSnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  generatedAt: z.string().datetime({ offset: false }),
  timeline: SessionTimeline,
  rubric: ProcessRubricScore,
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;
```

## 5. Rubric — formal definitions

Each scorer is a pure function `(SessionTimeline) → RubricItem`. The verdict
mapping below is the **default**; thresholds may be parameterized via a small
options object in WU-4 if needed, but defaults stand for the spike.

| key | label | Signal | Verdict rule |
|---|---|---|---|
| `setup-discipline` | Setup discipline | Count of `Read` events targeting `AGENTS.md` / `CLAUDE.md` / `.agents/**` / `.coverage-thresholds.json` **before** the first `Write`/`Edit` | ≥3 distinct setup files read before first mutation → `pass`; 1–2 → `watch`; 0 → `fail` |
| `planning` | Planning vs cowboy | Presence of `bd create` or `bd update --claim` **before** the first `Write` of source code (`src/**`) | ≥1 `bd create` before src-write → `pass`; only `.agents/` writes before src-write → `watch`; src-write with no prior bd activity → `fail` |
| `tdd` | TDD discipline | For each test file written (`**/__tests__/**` or `*.test.*` or `*.spec.*`), is the production sibling written **after**? | All test files precede their production siblings → `pass`; mixed → `watch`; production-first only → `fail`. `na` if no test files written at all |
| `scope-drift` | Scope drift | Edits/Writes outside an expected set of paths (parameterized; default = whatever the active bead's title hints at, fallback = full repo with no restriction → `na`) | All writes within scope → `pass`; ≤2 out-of-scope writes → `watch`; ≥3 → `fail`. Defaults to `na` when scope-set cannot be inferred |
| `error-handling` | Error handling | Tool errors followed by **either** a corrective read/grep within ≤2 events, **or** a clear diagnostic comment in the next assistant text; vs. retry-loops with no investigation | ≥80% of `tool-error` events have a corrective response → `pass`; 50–80% → `watch`; <50% → `fail`. `na` if zero errors |
| `thrashing` | No thrashing | Consecutive `Edit` on the same file with `<5s` gap, or consecutive `Bash` calls that differ only in trivial flags | 0 thrash episodes → `pass`; 1–3 → `watch`; ≥4 → `fail` |
| `cross-reference` | Cross-ref to context | `Read` of files outside `src/` that document the work (`.agents/**`, sibling ticket files, schema/contract files) when the work clearly depends on them | ≥1 cross-ref read when scope hints at cross-cutting work → `pass`; none → `watch`; if not applicable → `na` |
| `communication` | External communication | Presence of `bd close`, `bd update --notes`, or `mini yt comment` events in the session | ≥1 `bd close` or `bd update` AND ≥1 `.agents/` write → `pass`; only one of the two → `watch`; neither → `fail`. `na` if session is <10 events (probably aborted) |
| `prompt-coherence` | Coherence with prompt | Heuristic: does the first user-prompt mention WU/ticket IDs that show up later in `bd create` titles? Or do the `bd create` titles diverge from the prompt's wording? | ≥50% of bd titles share ≥1 token with the user prompt → `pass`; <50% → `watch`; 0 bd titles created → `na` (covered by `planning`) |
| `workflow-touchpoints` | Workflow touchpoints | Distinct workflow tools invoked: `bd`, `mini yt`, `.agents/` writes, `.coverage-thresholds.json` reads | ≥3 distinct → `pass`; 1–2 → `watch`; 0 → `fail` |

### 5.1 Aggregate

`overall` =
- `fail` if any item is `fail`,
- else `watch` if any item is `watch`,
- else `pass`.

`na` items do not contribute. If all items are `na` (degenerate session,
<5 events), `overall` is `na`.

## 6. CLI surface

### 6.1 `metaswarm-dashboard sessions timeline <project>`

- Resolves `<project>` against `config.yaml` (same loader as `collect`).
- Discovers JSONL transcripts via `~/.claude/projects/<encoded-cwd>/*.jsonl`
  where `encoded-cwd` is the project's absolute path with `/` → `-`.
- Picks the most recently modified `.jsonl`.
- Parses, prints a flat table: `HH:MM:SS  KIND   SUMMARY`.
- Flags:
  - `--session <id>`: pick a specific session instead of latest.
  - `--limit <n>`: print only the last `n` events (default: all).
  - `--json`: emit the `SessionTimeline` as JSON instead of the table.

### 6.2 `metaswarm-dashboard sessions audit <project>`

- Same discovery as `timeline`.
- Runs the rubric, prints a table:
  ```
  KEY                  VERDICT  EVIDENCE
  setup-discipline     pass     Read AGENTS.md, CLAUDE.md, .agents/index.md before first Write
  planning             pass     4 bd create before first src Write
  tdd                  watch    skeleton WU wrote production before test (documented intent)
  ...
  OVERALL              watch
  ```
- Flags:
  - `--session <id>`
  - `--json`: emit the `ProcessRubricScore` as JSON.
  - `--persist`: also write the `SessionSnapshot` (timeline + rubric) to
    `<dataDir>/projects/<name>/sessions/<dayKey>/<sessionId>.json`. Atomic
    write, idempotent. Default: do not persist (CLI is read-only by default).

### 6.3 `metaswarm-dashboard sessions tail <project>`

- Discovers the most-recent JSONL.
- Polls every 1s (configurable via `--interval <ms>`); on each tick, parses
  any new JSONL lines since last poll and prints them in `timeline` format.
- Ctrl-C exits cleanly.
- Flag: `--from-start`: replay all existing events before tailing.

All three subcommands respect:
- `METASWARM_DASHBOARD_DATA_DIR` (existing override).
- `METASWARM_DASHBOARD_CONFIG` (existing override).
- A new `CLAUDE_PROJECTS_DIR` env (default `~/.claude/projects`) so tests
  can point at fixture transcripts without touching the operator's real
  Claude Code state. This is the only new env var.

## 7. Test strategy

### 7.1 Fixture transcripts

The operator has real JSONL transcripts under
`~/.claude/projects/-Users-montoyaedu-ethiclab-eleven-backoffice-ui-current-production/`.
At the time of writing, the relevant ones are:

- `146d1ba3-3b69-4466-a640-10dfcd7a5ec2.jsonl` (~1.7 MB, EDK-636 session)
- `18051d9d-42ae-4084-8028-6cffb28c93ae.jsonl` (~531 KB, EDK-639 session,
  used as the golden master for the Python PoC)

These are operator-private; do NOT vendor them into the repo. Instead:

1. Create a small **synthetic** JSONL fixture under
   `packages/sessions/src/__tests__/fixtures/` that exercises every
   `ToolUseEvent.kind` and every rubric branch. Hand-crafted, ~100 lines.
2. Add a **scrub-and-vendor** test helper that takes a real transcript
   path (provided via `SESSIONS_FIXTURE_PATH` env var, opt-in), strips
   `cwd`, `homedir`, and any `tool_result` content >200 chars, and
   produces a redacted JSONL on stdout. This is the operator's escape
   hatch when adding a new edge-case fixture; not run in CI.
3. Each rubric scorer has its own unit test with a hand-crafted
   `SessionTimeline` that exercises the pass / watch / fail / na branches.

### 7.2 Coverage

Target: `.coverage-thresholds.json` already in place. New package must
contribute 100% lines and meet the existing branch/function/statement
thresholds. Defensive guards on unreachable paths use `/* v8 ignore */`
mirroring the `collector` pattern.

### 7.3 Property of the Python PoC

`/tmp/observe.py` (operator machine) is the reference implementation. The
TS parser MUST agree with it on the synthetic fixture. A small
`__tests__/parity-with-poc.test.ts` reads the synthetic fixture, invokes
the TS parser, and asserts the resulting timeline matches a checked-in
expected JSON. The Python script itself is not invoked by CI — its only
role was to validate feasibility on the operator's real data.

## 8. Work units

The spike decomposes into seven WUs with a dependency chain. Each WU MUST
have its own bead, claimed before starting, closed after the WU's commit
passes lint + tests + coverage. Follow the project's TDD policy: write the
failing test first.

| WU | Title | Dep | Deliverable |
|---|---|---|---|
| WU-1 | Workspace skeleton | — | `packages/sessions/` with `package.json`, `tsconfig*.json`, `vitest.config.ts`, empty `src/index.ts`, registered in root `package.json` workspaces (already a `packages/*` glob — should pick up automatically). Build + typecheck green. |
| WU-2 | Zod schemas | WU-1 | `packages/types/src/sessions.ts` with `ToolUseEvent`, `SessionTimeline`, `RubricItem`, `ProcessRubricScore`, `SessionSnapshot`. Re-exported from `index.ts`. Tests: round-trip parse via `safeParse` for each schema. |
| WU-3 | JSONL parser | WU-2 | `packages/sessions/src/jsonl-reader.ts` exporting `parseTranscript(filePath, fs?) → SessionTimeline`. Pure, fs injectable. Handles malformed lines gracefully (skip + count). Tests: synthetic fixture + edge cases (empty file, single line, mixed valid/invalid). |
| WU-4 | Rubric scorers | WU-3 | Ten files in `src/rubric/*.ts`, each exporting a pure scorer. `src/rubric/index.ts` exports `scoreTimeline(timeline) → ProcessRubricScore`. Unit tests for each scorer covering all verdict branches. |
| WU-5 | Writer | WU-2 | `packages/sessions/src/writer.ts` exporting `writeSessionSnapshot(snapshot, dataDir, fs?)`. Reuse `atomicWriteJson` from `collector/src/writer` if it's already exported; else lift to a shared util in `packages/types` (preferred over duplication). Tests: idempotency, path layout, fs error propagation. |
| WU-6 | CLI subcommands | WU-3, WU-4, WU-5 | `src/cli/{timeline,audit,tail}.ts` + dispatcher arm in `bin/metaswarm-dashboard`. Tests via `execa` against the built CLI on the synthetic fixture. `tail` test uses a temp JSONL file appended-to mid-test. |
| WU-7 | Docs + follow-up | WU-1..WU-6 | README section "Observing Claude Code sessions" with usage examples. `docs/follow-ups/sessions.md` listing deferred items (web view, sanitization, cross-session aggregation). Open follow-up beads. Update `STACK.md` if any new dep was unavoidable (none expected). |

Each WU's bead title: `spike-sessions WU-N: <short>`. Use `bd dep add` to
encode the chain above.

## 9. Privacy / sanitization

Transcripts contain prompts and tool results verbatim. For a single-operator
local tool, this is acceptable — the data never leaves the machine.

But the schema must be **future-proof for sanitization**, because:

1. The operator may later want to share a snapshot (e.g. as a bug report,
   or to compare runs across machines).
2. Tool results occasionally contain secrets if the agent ran `printenv` or
   similar.

Concrete provisions in this spike:

- `ToolUseEvent.summary` is **already** ≤200 chars and single-line, so
  truncation is the default. Full tool result content is **not stored** in
  the snapshot — only the summary.
- `--persist` is opt-in. Default is in-memory only.
- A follow-up issue (opened in WU-7) covers full sanitization: a
  configurable regex-list of patterns to mask in `summary` before persist.

No sanitization code in this spike beyond the truncation-by-default.

## 10. Anti-goals — explicit guardrails for the executing agent

Read these before starting WU-1. Violating any one is grounds to stop and
re-confirm with the operator.

1. **Do not extend the `collector` package.** Sibling, not internal.
2. **Do not add a web view.** Schema must support it; UI is out of scope.
3. **Do not vendor real operator transcripts into the repo.** Synthetic
   fixtures only.
4. **Do not add new runtime dependencies.** `zod`, `commander`, node built-ins.
5. **Do not lower `.coverage-thresholds.json`.** 100% lines, 92% branches,
   97% functions, 98% statements stand. Defensive unreachables use
   `/* v8 ignore */`.
6. **Do not modify existing snapshots / api / paths schemas.** Add new file
   `sessions.ts`, re-export from `index.ts`. Additive only.
7. **Do not write `git push`.** Operator pushes manually; this is a workspace
   rule for the operator's repos.
8. **Do not skip the TDD order.** Failing test → implementation → green.
   Documented in `CLAUDE.md`.

## 11. Open questions (decide during WU-1; defaults proposed)

| # | Question | Default if not raised |
|---|---|---|
| Q1 | Where does the rubric's "expected scope set" come from for `scope-drift`? | Default: parse the latest `bd ready` / `bd show` of the active bead's title for path-like tokens. If none found, scorer returns `na`. Refine in a follow-up. |
| Q2 | Should `tail` mode auto-rerun the rubric every N events? | Default: no — `tail` is timeline-only in this spike. `audit` is a one-shot. |
| Q3 | What about sessions older than X days — purge? | Default: no purging in this spike. Disk usage is negligible (synth fixture <100 KB, real snapshots ~1–5 KB after summary truncation). Follow-up issue. |
| Q4 | Multi-session per day — display order? | Default: writer keys by `<sessionId>.json` under `<dayKey>/`. CLI `audit` picks the most-recently-modified JSONL of the project's transcript dir. |

## 12. Reference — the Python PoC

A working reference implementation exists at `/tmp/observe.py` on the
operator's machine. The script is ~70 lines of Python that:

1. Walks the JSONL line by line.
2. For each line, maps it to one of `user-prompt | assistant-text |
   assistant-thinking | tool-use | tool-result | tool-error`.
3. For `tool-use`, summarizes the input args differently based on the tool
   (Bash → first 120 chars of `command`; Read/Write/Edit → file path with
   the repo prefix stripped; Agent → `subagent_type: description[:80]`;
   etc.).
4. Emits a flat table: `HH:MM:SS  KIND   SUMMARY`.

The executing agent should treat `/tmp/observe.py` as documentation of the
parsing intent, **not** as a file to translate line-by-line. Port the intent
to idiomatic TypeScript with Zod-validated boundaries.

If `/tmp/observe.py` is not present on the executing agent's machine, the
schema in §4 and the rubric in §5 are fully self-contained: the spike does
not require the Python file at runtime.

## 13. Definition of done

The spike is complete when all of the following are true:

- All seven WU beads closed.
- `npm test` green, 50+N test files, 249+M tests, all passing.
- `npm run test:coverage` meets `.coverage-thresholds.json`.
- `npm run lint` clean on new files (pre-existing baseline unchanged).
- `metaswarm-dashboard sessions audit <one-real-project>` on the operator's
  machine produces a `ProcessRubricScore` JSON that the operator
  inspects and confirms is informative.
- README section + `docs/follow-ups/sessions.md` committed.
- Three follow-up beads opened (web view, sanitization, cross-session
  aggregation) with links back to this design doc.

---

End of design doc.
