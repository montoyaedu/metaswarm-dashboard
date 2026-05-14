# Design — Sessions Observability Spike (v3)

> Status: design v3 — post Design Review Gate round 2, 5/5 APPROVED on 2026-05-14.
> v3 absorbs ~22 non-blocking suggestions from PM/Architect/Designer/Security/CTO into the design itself, so the executor has fewer ad-hoc decisions to make at WU time.
> Author: operator (drafted via sibling Claude session, revised in-repo).
> Scope: spike for Step 3 (observability) — session intelligence only.
> Target audience: the agent that will execute the WUs below.

---

## 0. Changelog

### v1 → v2 (commits `5162bb9` → `9a2e19c`)

Addressed 19 blockers across PM/Designer/Security/CTO from gate round 1.
Key structural changes (see git log for detail):

- PoC `packages/session-observer/` retired in WU-1 (was WU-7).
- `atomicWriteJson` lifted to `@metaswarm-dashboard/types/fs-utils` in WU-1.
- New WU-4.5 calibration gate (≥80% agreement vs operator ground truth on 2 sessions; failed criteria dropped).
- `scope-drift` scorer dropped → rubric is 9 not 10.
- Privacy story rewritten: `summary` is NOT a privacy boundary; 3-layer fixture guards; path traversal hardened.
- `RubricPointer` discriminated union; env var renamed; 80-col audit table fully specified.
- DoD measurable; 2-week post-merge usage gate (M1+M2) + kill switches.

### v2 → v3 (this revision)

Absorbs all gate round 2 non-blocking suggestions. No structural change; no
blockers were raised in round 2.

Key edits (each linked to its origin reviewer):

- §6.1, §6.3, §7: `setup-discipline` scorer never returns `na` — design says
  so explicitly so the all-`na` aggregate logic isn't misread (**CTO**).
- §8.1: `--persist` secret warning sent to **stderr** (not stdout) so
  `audit --json` produces a clean machine-readable stdout stream (**Designer**).
- §8.1: explicit behaviour for `--exit-on-fail` + in-flight session: the
  partial-timeline `fail` exits non-zero; the README CI example acknowledges
  this. Operator can pass `--no-exit-on-fail-if-in-flight` to suppress
  (**Designer**).
- §8.2: footer line **always** shows all 4 counts (`pass`, `watch`, `fail`,
  `na`) including zero-counts. No elision (**Designer**).
- §8.4: duration parser grammar pinned: `/^(\d+)(ms|s)?$/i`. Integer-only
  (no decimals), suffixless = milliseconds, `0` rejected, negative rejected.
  WU-6 tests pin every case (**Designer**).
- §9.4: "≥80% agreement on N=2" clarified as **binary** — 2-of-2 or 1-of-2
  with explicit written justification. No percentage arithmetic
  (**CTO + Architect**).
- §9.4 + WU-4.5: deliverable explicitly requires `npm run build` of
  `packages/types` after any schema edit (RubricKey enum or items.length)
  so dependent packages typecheck cleanly (**Architect + CTO**).
- §9.2 + WU-1: marker-line assertion is **load-bearing**; the `.gitignore`
  rule for `*.real.*` is defense-in-depth. Documented in code comments so
  no one removes the assertion thinking the gitignore covers it (**Security**).
- §11.5 + WU-5: `dataDir` containment uses **realpath**, not lexical
  comparison. Sanitization rejects symlinks pointing outside the resolved
  data dir (**Security + Architect**).
- §11.5 + WU-6: `isInsideGitWorkingTree(dir)` extracted as a small helper
  in `packages/sessions/src/git-check.ts` so tests can stub it; `git
  rev-parse --show-toplevel` invoked with `cwd=<dataDir>`, 2-second
  timeout, missing-binary degrades silently (**Architect + Security**).
- §9.3 + Appendix B11: new edge-case `B11` — JSON line with deeply-nested
  object (10 k levels) → parser must not stack-overflow. Zod `passthrough`
  branches must also be safe (**Security**).
- §15.2: **M2 strengthened** from "≥1 behavioural change" to "**≥2
  distinct behavioural changes across ≥2 distinct sibling repos**, each
  recorded in a bead or `.agents/notes.md` entry (auditable post-hoc)"
  (**PM**).
- §15.2: **new M3** — "≥1 `sessions tail` invocation in the 2-week window"
  — drives the data-driven decision to keep or cut `tail` in follow-ups
  (**PM**).
- §15.2 + WU-8: bead records **only counts and outcome categories**.
  No session IDs, no transcript excerpts, no prompt content (**Security**).
- WU-7: opens a **recurring-calibration follow-up bead** to re-calibrate
  on ≥5 sessions after the 2-week usage window, so calibration becomes a
  recurring discipline (**PM**).
- WU-1 + §9.2: new **CI-grep test** that fails the suite if any committed
  file matches high-confidence secret patterns (`sk-`, `ghp_`, `AKIA`,
  `eyJ`, `xoxb-`). Belt-and-braces against the calibration-doc leakage
  vector (**Security**).
- WU-1 + §15.1 DoD: explicit test asserting `audit --persist` default is
  off (anti-goal §12.11 was already in v2; v3 adds the test) (**PM**).
- WU-1 + WU-2: `packages/types/package.json` gains TWO new exports map
  entries: `./fs-utils` (lifted writer) AND `./sessions` (the new schema
  module), matching the existing `./api` / `./snapshots` / `./paths`
  convention. Without these subpath exports, `@metaswarm-dashboard/types/
  fs-utils` and `@metaswarm-dashboard/types/sessions` imports fail at
  runtime under strict Node ESM resolution (**Architect**).
- §9.7: synthetic fixture **soft target raised** from ~5 KB to ~15-20 KB
  to comfortably hold the ~120 events Appendix A enumerates with
  realistic `thinking` blocks; 50 KB hard cap stays (**CTO**).
- Appendix B1: empty-file `startedAt` pinned to **file mtime, falling
  back to epoch (`1970-01-01T00:00:00.000Z`) if mtime unavailable**
  — implementor no longer decides (**CTO**).

---

## 1. Why now, and the operator pain this spike addresses

Step 1 MVP (cross-project beads visibility) reached WU-7 on 2026-05-07 and has
been quiescent since: 50 test files, 249 passing tests, coverage above the
configured thresholds. Step 2 is deferred. This spike formalizes the minimum
useful subset of Step 3.

The operator runs several Claude Code sessions on sibling repos
(`platform-current-production`, `backoffice-ui-current-production`,
`metaswarm-dashboard` itself). Each session emits a JSONL transcript at
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` containing every prompt,
text response, `thinking` chunk, tool invocation (name + args), and tool
result. The file is updated live as the session works.

**Operator pain this spike is designed to fix** — concretely, a class of
incident, not a specific date-stamped one:

- A sibling session drifts from its declared scope (writes to files outside
  the active bead's intent) and the operator notices only at PR review.
- A session skips the TDD order (production code before test) and the
  operator finds out at coverage-gate failure or at PR review.
- A session enters an edit-retry-edit loop on the same file without
  diagnostic reads in between, and the operator notices via wall-clock time,
  not via the transcript.

These are **process** signals the existing beads-based collector cannot
surface: granularity is per-tool-call (not per-issue), latency is near-live
(not per-day), and the questions are qualitative.

What this spike will NOT prove:

- That the rubric's verdicts are correct on every session. The calibration
  WU validates verdicts on 2 sessions; broader correctness is out of scope.
  WU-7 opens a recurring-calibration follow-up that re-validates on ≥5
  sessions after the 2-week window.
- That the operator's behaviour will change. The DoD includes a 2-week
  usage check (§15); if the rubric is built but ignored, the spike has
  technically shipped but failed as a product, and the follow-up beads
  (web view, sanitization, cross-session aggregation) are **cancelled**,
  not deferred.

## 2. Use cases (WHO / WANTS / SO THAT / WHEN)

Each subcommand is justified by a concrete use case. If a subcommand has no
defensible use case post-revision, it is cut.

### UC-1 — Retrospective audit of a sibling session (drives `audit`)

- **WHO**: the operator, sitting in their "driver" Claude Code session.
- **WANTS**: to know, in one screen, whether the sibling session that just
  closed a WU followed the project's process (TDD, scope, error handling,
  workflow touchpoints).
- **SO THAT**: an off-process session is caught before PR review or before
  the next dependent WU starts on top of a drifted base.
- **WHEN**: every time a sibling session closes a WU, before the operator
  approves the merge / pulls the branch / starts the dependent WU.

This is the **primary** use case. `audit` is the headline verb.

### UC-2 — Spot-check a long-running session (drives `tail`)

- **WHO**: the operator running a long sibling session (e.g. a large refactor
  spread over 30+ minutes) while doing other work.
- **WANTS**: a stream of human-readable event summaries from the JSONL,
  visible in a terminal pane the operator can glance at without switching
  windows.
- **SO THAT**: a drift episode (edit-retry-edit thrashing, scope drift, an
  agent quietly disabling tests) is noticed within minutes, not at WU close.
- **WHEN**: a sibling session is expected to run >15 minutes unattended.

**Why not just watch the Claude Code TUI itself?** The TUI shows one
session's UI; `tail` shows the same data in a uniform format the operator
can pattern-match across many sessions, and runs in any terminal pane (tmux,
ssh, secondary monitor). It is intentionally redundant for the same-pane
case, distinct for the cross-pane case.

`tail`'s usage is monitored explicitly via §15.2 metric **M3**. If M3 isn't
met in the 2-week window, `tail` is the first follow-up to be cut and any
maintenance burden is removed.

### UC-3 — Forensic timeline for a specific session (drives `timeline`)

- **WHO**: the operator investigating "what did this session actually do?"
  after the fact (e.g. a PR went sideways and the operator wants the event
  trace).
- **WANTS**: a flat chronological listing of every prompt / thinking chunk /
  tool call / tool result for a specific session, with optional JSON dump.
- **SO THAT**: post-incident understanding does not require reading 1–2 MB
  of raw JSONL.
- **WHEN**: occasional. Lower frequency than UC-1 by design.

### UC-4 — Persist a snapshot for cross-session aggregation (drives `--persist`)

Deferred to follow-up. The `--persist` flag in this spike writes a snapshot
file with no consumer in-spike. The schema must support a future aggregation
view, but no aggregation lands here. Default is **off**; WU-1 lands a test
asserting this. Specifically excluded from the v3 DoD success criteria
beyond "the flag exists and defaults off".

## 3. Relationship to the `session-observer` PoC (deletion plan)

The PoC at `packages/session-observer/` (commit `29da62c`) answers a
different question:

- PoC `summary` / `list` / `agents`: "**what** ran across recent sessions"
  (counts, cost, prompts, files touched, sub-agent invocations).
- This spike's `audit` / `timeline` / `tail`: "**how well** a single session
  followed the project's process" (rubric verdicts, calibrated against
  operator judgment).

The PoC ships as a separate binary on the operator's PATH. Coexisting with
the new CLI risks (a) muscle-memory confusion (PoC `show` vs spike
`timeline`), (b) a permanently-stale exploratory tool that no one updates.

**Resolution**: WU-1 deletes `packages/session-observer/`. The PoC commit
`29da62c` stays in git history (recoverable). Any PoC capability that proves
to be missing from the new CLI is opened as a follow-up bead, not retained
as dead code.

## 4. Scope

### In scope (this spike)

1. New workspace package `packages/sessions` (sibling to `collector`, not
   internal). Build, typecheck, test green on its own.
2. New Zod schemas in `@metaswarm-dashboard/types/sessions` — additive only.
3. Lift of `atomicWriteJson` from `packages/collector/src/writer.ts:38` to
   a new `packages/types/src/fs-utils.ts`. Collector re-imports from there.
   No behaviour change for collector.
4. `packages/types/package.json` gains **two** new `exports` map entries:
   `./fs-utils` and `./sessions`, matching the existing `./api`,
   `./snapshots`, `./paths` convention.
5. JSONL parser: `(filePath) → SessionTimeline`. Pure, fs injectable.
6. Process rubric: **9** pure scorer functions (was 10 in v1).
   `scope-drift` removed; promoted candidates may replace it after WU-4.5
   calibration.
7. Calibration gate (WU-4.5): rubric verdicts validated against operator
   ground truth on 2 real sessions. Failed criteria are dropped before WU-6.
8. CLI subcommand `metaswarm-dashboard sessions` with three verbs (UC-1..3):
   - `audit <project>` — apply the rubric, print a 80-col verdict table.
   - `timeline <project>` — flat chronological event listing.
   - `tail <project>` — follow the most-recent JSONL, append-only.
9. Snapshot persistence (opt-in `--persist`): atomic write under
   `<dataDir>/projects/<name>/sessions/<YYYY-MM-DD>/<sessionId>.json`.
   Default off; WU-1 test asserts this.
10. **Mechanical fixture-vendoring guardrails**:
    - `.gitignore` rule for `*.real.*` (defense-in-depth).
    - Vitest setup-file enforces a synthetic-fixture marker line
      (**load-bearing** — the assertion is what actually stops a real
      transcript from landing in `__tests__/fixtures/`).
    - 50 KB hard size cap test on every `.jsonl` under that dir.
    - **CI-grep test** that fails the suite if any committed file matches
      `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{20,}`, `AKIA[A-Z0-9]{16}`,
      `xoxb-[A-Za-z0-9-]+`, or a JWT prefix (`eyJ[A-Za-z0-9_-]{20,}`).
11. Tests: per-scorer unit tests covering every verdict branch (Appendix A);
    parser edge-case tests (Appendix B); integration tests for CLI via
    `execa` on the synthetic fixture.
12. Lockfile-clean dependency footprint: no new runtime deps. Stay on
    `zod`, `commander`, node `>=22.12.0` builtins.

### Out of scope (deferred to follow-up beads opened in WU-7)

- Web view ("Sessions" tab in the SPA). Schema must support it; UI not shipped.
- Cross-session aggregation (rubric score over time, side-by-side compare).
- CI / deploy / inference-cost metrics.
- Secret-pattern redactor for `summary`. Schema has the hooks
  (`redactionApplied`, `persistedWithSanitization`); implementation is
  follow-up.
- GitHub PR linkage, Linear/YouTrack cross-ref.
- Sharing snapshots (bug-report exporter). Requires the secret redactor
  to land first.
- **Recurring calibration** on ≥5 sessions after the 2-week usage window.
  Closes the calibration-N=2 statistical concern (PM round 2).
- Re-introduction of `scope-drift` once `bd show --json` exposes the
  active bead's declared file scope.

## 5. Architecture — why a new package

The existing `collector` is **batch-oriented**: invoked once per
`./start.sh` cycle, reads `.beads/`, writes a daily snapshot, exits. The
sessions observer has fundamentally different runtime characteristics:

| Axis | `collector` (existing) | `sessions` (new) |
|---|---|---|
| Trigger | One-shot CLI invocation | One-shot **and** tail (`-f`) modes |
| Source | `.beads/` + `bd list --json` | `~/.claude/projects/<cwd>/<sid>.jsonl` |
| Cadence | Per-day rollup | Per-session, possibly mid-flight |
| Output frequency | One file per project per day | One file per session |
| Failure mode tolerated | Skip project, warn | Skip session, warn |

Folding sessions into `collector` would conflate the batch and stream
runtime models. A sibling package keeps the boundary clean.

Shared concerns (`PathsEnv`, atomic writer, project discovery) live in
`@metaswarm-dashboard/types` (after the WU-1 lift) and are imported, not
duplicated.

### 5.1 Module layout

```
packages/sessions/
├── package.json                  # exports map per §5.2
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
└── src/
    ├── index.ts                  # public re-exports
    ├── jsonl-reader.ts           # JSONL → SessionTimeline (pure)
    ├── transcript-discovery.ts   # project → JSONL path (allow-list + lstat)
    ├── git-check.ts              # isInsideGitWorkingTree(dir) helper, injectable
    ├── rubric/
    │   ├── index.ts              # scoreTimeline() composes the 9 scorers
    │   ├── setup-discipline.ts
    │   ├── planning.ts
    │   ├── tdd.ts
    │   ├── error-handling.ts
    │   ├── thrashing.ts
    │   ├── cross-reference.ts
    │   ├── communication.ts
    │   ├── prompt-coherence.ts
    │   └── workflow-touchpoints.ts
    ├── writer.ts                 # SessionSnapshot writer (uses lifted atomicWriteJson)
    ├── tail.ts                   # JSONL follower as a pure async iterable
    ├── cli/
    │   ├── audit.ts              # UC-1 (headline verb)
    │   ├── timeline.ts           # UC-3
    │   └── tail.ts               # UC-2
    └── __tests__/
        ├── fixtures/
        │   ├── synthetic-events.jsonl       # ~120 events, ~15-20 KB
        │   └── synthetic-events.expected.json
        └── ...
```

### 5.2 Package exports map (matches collector's pattern)

`packages/sessions/package.json` MUST declare:

```json
{
  "exports": {
    ".":             { "types": "./dist/index.d.ts",        "import": "./dist/index.js" },
    "./cli/audit":   { "types": "./dist/cli/audit.d.ts",    "import": "./dist/cli/audit.js" },
    "./cli/timeline":{ "types": "./dist/cli/timeline.d.ts", "import": "./dist/cli/timeline.js" },
    "./cli/tail":    { "types": "./dist/cli/tail.d.ts",     "import": "./dist/cli/tail.js" }
  }
}
```

`packages/types/package.json` MUST gain TWO new entries alongside the
existing `.`, `./api`, `./snapshots`, `./paths`:

```json
{
  "exports": {
    "./fs-utils": { "types": "./dist/fs-utils.d.ts", "import": "./dist/fs-utils.js" },
    "./sessions": { "types": "./dist/sessions.d.ts", "import": "./dist/sessions.js" }
  }
}
```

Without these subpath exports, `@metaswarm-dashboard/types/fs-utils` and
`@metaswarm-dashboard/types/sessions` imports fail at runtime under strict
Node ESM resolution. WU-1 adds `fs-utils`; WU-2 adds `sessions`.

The CLI dispatcher in `bin/metaswarm-dashboard` gains one new dispatch arm
for the `sessions` verb (same pattern as `collect` and `config init`).

### 5.3 `atomicWriteJson` lift (WU-1)

`packages/types/src/fs-utils.ts` (NEW) — exports `atomicWriteJson` and its
`WriterFsHooks` type. Lifted verbatim from
`packages/collector/src/writer.ts`. The collector's `writer.ts` re-imports
from `@metaswarm-dashboard/types/fs-utils` and re-exports for back-compat
with its existing call sites (zero behaviour change). All existing
collector tests must pass unchanged after the lift.

## 6. Zod schemas (additive to `@metaswarm-dashboard/types`)

A new file `packages/types/src/sessions.ts`. `index.ts` re-exports.
**No modification to existing schemas.**

### 6.1 ToolUseEvent

```typescript
export const ToolUseEventKind = z.enum([
  'user-prompt',
  'user-command',
  'assistant-text',
  'assistant-thinking',
  'tool-use',
  'tool-result',
  'tool-error',
]);
export type ToolUseEventKind = z.infer<typeof ToolUseEventKind>;

export const ToolUseEvent = z.object({
  /** UTC ISO-8601 timestamp from the JSONL entry. */
  at: z.string().datetime({ offset: false }),
  kind: ToolUseEventKind,
  /** For `tool-use`: the tool name (Read/Write/Edit/Bash/Agent/...). */
  toolName: z.string().nullable(),
  /** Short summary for the timeline view (≤200 chars, single-line).
   *  MAY CONTAIN OPERATOR SECRETS. See §11. */
  summary: z.string(),
  /** Which redactors fired before truncation. Empty in this spike. */
  redactionApplied: z.array(z.string()).default([]),
  /** Original JSONL entry's UUID, for cross-reference / debugging. */
  uuid: z.string().nullable(),
});
export type ToolUseEvent = z.infer<typeof ToolUseEvent>;
```

### 6.2 SessionTimeline

```typescript
export const SessionTimeline = z.object({
  schemaVersion: z.literal(1),
  transcriptPath: z.string(),
  sessionId: z.string(),
  projectCwd: z.string(),
  startedAt: z.string().datetime({ offset: false }),
  lastEventAt: z.string().datetime({ offset: false }),
  eventCount: z.number().int().nonnegative(),
  /** Count of JSONL lines skipped because they failed to parse, exceeded
   *  the 1 MiB line cap, or contained non-UTF-8 bytes. Surfaced in
   *  audit/timeline output. */
  skippedLineCount: z.number().int().nonnegative().default(0),
  events: z.array(ToolUseEvent),
});
export type SessionTimeline = z.infer<typeof SessionTimeline>;
```

### 6.3 RubricItem + ProcessRubricScore

```typescript
export const RubricVerdict = z.enum(['pass', 'watch', 'fail', 'na']);
export type RubricVerdict = z.infer<typeof RubricVerdict>;

export const RubricKey = z.enum([
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
]);
export type RubricKey = z.infer<typeof RubricKey>;

/** Discriminated union — replaces v1's ambiguous `pointer: string | null`. */
export const RubricPointer = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uuid'),  value: z.string() }),
  z.object({ kind: z.literal('index'), value: z.number().int().nonnegative() }),
]);
export type RubricPointer = z.infer<typeof RubricPointer>;

export const RubricItem = z.object({
  key: RubricKey,
  label: z.string(),
  verdict: RubricVerdict,
  /** One short sentence describing the evidence (≤200 chars).
   *  MAY CONTAIN OPERATOR SECRETS. See §11. */
  evidence: z.string().max(200),
  pointer: RubricPointer.nullable(),
});
export type RubricItem = z.infer<typeof RubricItem>;

export const ProcessRubricScore = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string(),
  scoredAt: z.string().datetime({ offset: false }),
  /** Exactly one entry per RubricKey, in the enum's declaration order.
   *  Length is mutated to N ∈ [6, 9] by WU-4.5 if criteria are dropped. */
  items: z.array(RubricItem).length(9),
  /** `fail` if any item is fail; else `watch` if any is watch; else `pass`.
   *  `na` items are excluded; all-`na` → `na`.
   *
   *  NOTE: `setup-discipline` never returns `na` (no `na` branch in §7),
   *  so the all-`na` aggregate is only reachable in degenerate sessions
   *  where setup-discipline ALSO has no Read events to score against. In
   *  practice, `overall === 'na'` is rare. */
  overall: RubricVerdict,
});
export type ProcessRubricScore = z.infer<typeof ProcessRubricScore>;
```

### 6.4 SessionSnapshot (what the writer persists)

```typescript
export const SessionSnapshot = z.object({
  schemaVersion: z.literal(1),
  projectName: z.string().min(1),
  generatedAt: z.string().datetime({ offset: false }),
  /** False in this spike. Future secret-pattern redactor flips this to
   *  true; downstream sharers (bug-report exporter) must check it.
   *  Type-level kill: any future PR flipping this without landing the
   *  redactor must change the Zod literal — blocks at review. */
  persistedWithSanitization: z.boolean(),
  timeline: SessionTimeline,
  rubric: ProcessRubricScore,
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;
```

## 7. Rubric — 9 criteria with explicit failure modes

Each scorer is a pure function `(SessionTimeline) → RubricItem`. The verdict
mapping below is the default; thresholds may be parameterized in WU-4 if
needed, but defaults stand for the spike. **No silent threshold tweaking** —
see §12 anti-goal 9.

For each criterion, the **Failure mode caught** column names the operator
incident class the scorer is designed to flag. WU-4.5 calibration validates
each criterion against operator-declared ground truth on 2 real sessions;
any criterion failing the §9.4 agreement bar is dropped from the rubric and
from `RubricKey` before WU-6.

| key | label | Signal | Verdict rule | Failure mode caught |
|---|---|---|---|---|
| `setup-discipline` | Setup discipline | Count of `Read` events targeting `AGENTS.md` / `CLAUDE.md` / `.agents/**` / `.coverage-thresholds.json` **before** the first `Write`/`Edit` | ≥3 → `pass`; 1–2 → `watch`; 0 → `fail`. **No `na` branch — always scored.** | "Agent started editing without reading the project's conventions" |
| `planning` | Planning vs cowboy | Presence of `bd create` or `bd update --claim` **before** the first `Write` of source code (`src/**`) | ≥1 `bd create` before src-write → `pass`; only `.agents/` writes before src-write → `watch`; src-write with no prior bd activity → `fail` | "Agent skipped the beads issue and started coding" |
| `tdd` | TDD discipline | For each test file written (`**/__tests__/**` or `*.test.*` or `*.spec.*`), is the production sibling written **after**? | All test files precede production → `pass`; mixed → `watch`; production-first → `fail`; no test files → `na` | "Agent wrote production code before its test" |
| `error-handling` | Error handling | Tool errors followed by **either** a corrective read/grep within ≤2 events, **or** a clear diagnostic in the next assistant text; vs retry-loops with no investigation | ≥80% errors get a corrective response → `pass`; 50–80% → `watch`; <50% → `fail`; zero errors → `na` | "Agent retry-looped on a failing tool without investigating" |
| `thrashing` | No thrashing | Consecutive `Edit` on the same file with `<5s` gap, or consecutive `Bash` calls differing only in trivial flags | 0 episodes → `pass`; 1–3 → `watch`; ≥4 → `fail` | "Agent edit-retried in a tight loop without reading the file" |
| `cross-reference` | Cross-ref to context | `Read` of files outside `src/` that document the work (`.agents/**`, sibling ticket files, schema/contract files) when the work clearly depends on them | ≥1 cross-ref read when work touches multiple packages → `pass`; none → `watch`; single-package work → `na` | "Agent edited a contract without reading its consumers" |
| `communication` | External communication | Presence of `bd close`, `bd update --notes`, or `mini yt comment` events | ≥1 `bd close` or `bd update` AND ≥1 `.agents/` write → `pass`; only one of the two → `watch`; neither → `fail`; session <10 events → `na` | "Agent finished work without closing the bead or updating notes" |
| `prompt-coherence` | Coherence with prompt | Does the first user-prompt mention WU/ticket IDs that show up later in `bd create` titles? Token overlap (≥3-char tokens, case-insensitive, ≥1 shared) between first prompt and each created bead title | ≥50% of bd titles share ≥1 token with the user prompt → `pass`; <50% → `watch`; no bd titles → `na` (covered by `planning`) | "Agent drifted from the user's framing while creating beads" |
| `workflow-touchpoints` | Workflow touchpoints | Distinct workflow tools invoked: `bd`, `mini yt`, `.agents/` writes, `.coverage-thresholds.json` reads | ≥3 distinct → `pass`; 1–2 → `watch`; 0 → `fail` | "Agent ignored the project's workflow tooling entirely" |

### 7.1 Why `scope-drift` was dropped (v1 → v2)

v1's `scope-drift` scorer defaulted to `na` whenever scope-set could not be
inferred from the active bead's title — which it admitted (v1 §11 Q1) was
most sessions. Shipping a scorer that is `na` 80% of the time inflates the
rubric without informing it. The scope-drift question matters, but the right
signal is "files written outside the bead's declared file scope", and the
active bead's declared file scope is not currently captured in `bd` output.
WU-7 opens a follow-up: extend `bd show --json` to expose declared file
scope, then re-introduce `scope-drift` as a 10th scorer.

### 7.2 Aggregate

`overall` =
- `fail` if any item is `fail`,
- else `watch` if any item is `watch`,
- else `pass`.

`na` items do not contribute. If all 9 items are `na`, `overall` is `na` —
but this is degenerate (`setup-discipline` has no `na` branch).

## 8. CLI surface

### 8.1 `metaswarm-dashboard sessions audit <project>` (UC-1, headline verb)

- Resolves `<project>` against `config.yaml` (same loader as `collect`).
- **Input validation** (§11): `<project>` must match `^[A-Za-z0-9._-]+$`
  before any path resolution. Reject `..` and control chars.
- Discovers JSONL via `<TRANSCRIPTS_DIR>/<encoded-cwd>/*.jsonl`. Uses
  `lstat`; symlinks pointing outside `TRANSCRIPTS_DIR` are refused.
- Picks the most recently modified `.jsonl` (or `--session <id>`).
- **In-flight session policy**: if `lastEventAt` is within the last 60 s,
  prints a warning to **stderr** (`"session may still be in progress"`)
  and proceeds; the rubric is computed on the partial timeline.
- Runs the rubric, prints the table from §8.2.

Flags:
- `--session <id>` — pick a specific session instead of latest.
- `--json` — emit `ProcessRubricScore` as JSON to **stdout** (clean for
  `| jq`). Full `evidence` field preserved. All warnings/notices go to
  **stderr**, not stdout.
- `--persist` — also write the `SessionSnapshot`. Default: off (asserted
  by test in WU-1).
  On every successful write, prints to **stderr** the absolute output
  path **and** the line `"snapshot may contain operator secrets — review
  before sharing"`. **Never stdout** — stdout stays clean for `--json`.
- `--exit-on-fail` — exit non-zero when `overall === 'fail'`. Default off.
  Enables CI / pre-commit-hook usage. **Interaction with in-flight
  warning**: if the session is in-flight AND `--exit-on-fail` is set AND
  `overall === 'fail'`, the CLI **still exits non-zero**. README example
  for CI use must note this explicitly. Operator can pass
  `--no-exit-on-fail-if-in-flight` to suppress the non-zero exit in this
  one case.
- `--no-exit-on-fail-if-in-flight` — opt-out, only meaningful with
  `--exit-on-fail`. Suppresses non-zero exit if `lastEventAt` is within
  the in-flight window (60 s).

### 8.2 Audit table rendering (80-col deterministic)

Column widths fit a standard 80-col terminal:

```
KEY                   VERDICT  EVIDENCE
setup-discipline      pass     Read AGENTS.md, CLAUDE.md, .agents/index.md before first…
planning              pass     4 bd create before first src Write
tdd                   watch    skeleton WU wrote production before test (documented int…
error-handling        pass     2/2 errors followed by corrective read
thrashing             pass     0 thrash episodes
cross-reference       na       single-package work
communication         watch    bd close present but no .agents/ writes
prompt-coherence      pass     5/6 bd titles share a token with first user prompt
workflow-touchpoints  pass     bd + .agents/ + .coverage-thresholds.json (3 distinct)

Overall: watch  (6 pass, 2 watch, 0 fail, 1 na)  skipped JSONL lines: 0
```

Rules:
- KEY column: 20 chars left-padded (longest `RubricKey` is `workflow-touchpoints` at 20).
- VERDICT column: 6 chars left-padded, color-coded if stdout is a TTY
  (pass=green, watch=yellow, fail=red, na=dim). Color disabled with `NO_COLOR`.
- EVIDENCE column: rest of the row, truncated to 53 chars with `…` suffix
  if longer. Full evidence available via `--json`. **No multi-line wrap.**
- `OVERALL` rendered as a **footer line**, not a table row (because it has
  no `evidence` field in the schema). Format:
  `Overall: <verdict>  (<n_pass> pass, <n_watch> watch, <n_fail> fail, <n_na> na)  skipped JSONL lines: <count>`.
- **Always shows all 4 counts**, including zero-counts. No elision —
  consumers can rely on a stable format.
- All output goes to **stdout**. Warnings (in-flight, `--persist` secret
  notice, `dataDir`-inside-git notice) go to **stderr**.

### 8.3 `metaswarm-dashboard sessions timeline <project>` (UC-3)

- Same project resolution / validation as `audit`.
- Prints a flat table: `HH:MM:SS  KIND   SUMMARY` (SUMMARY truncated as
  above) to stdout.
- Flags: `--session <id>`, `--limit <n>`, `--json`.

### 8.4 `metaswarm-dashboard sessions tail <project>` (UC-2)

- Discovers most-recent JSONL (or `--session <id>`).
- Tracks position by **byte offset** (JSONL files are append-only by
  Claude Code's writer; this is documented in the code comment, with an
  `lstat`-based inode check between polls — if the inode changes,
  emit a stderr warning and re-open).
- Polls every 1 s (configurable via `--interval <duration>`).

**`--interval` grammar (pinned)**:
- Regex: `/^(\d+)(ms|s)?$/i`
- Integer-only. No decimals (`1.5s` rejected).
- Suffixless = milliseconds. So `--interval 500` = 500 ms, same as
  `--interval 500ms`.
- Case-insensitive suffix (`2s` and `2S` both valid).
- `0` rejected (would busy-loop).
- Negative rejected (regex enforces).
- Max 60 000 (1 minute) — beyond is almost certainly an operator typo.
- WU-6 tests pin each case.

- On each tick, parses any new lines since last poll, prints them to
  stdout in `timeline` format. Partial-line writes (no trailing `\n`) are
  held in a buffer until the line completes.
- `--from-start` replays existing events before tailing.
- Ctrl-C exits cleanly. Signal handler branches marked `/* v8 ignore */`
  in the implementation (§10 WU-6 owns this).
- **`tail.ts` exposes a pure async iterable** in addition to the CLI surface,
  so tests can drive it deterministically (poll-interval set to 10 ms in
  tests, file appended-to via the test driver).

### 8.5 Environment variables

All three subcommands respect:
- `METASWARM_DASHBOARD_DATA_DIR` (existing).
- `METASWARM_DASHBOARD_CONFIG` (existing).
- `METASWARM_DASHBOARD_TRANSCRIPTS_DIR` — **new in this spike**.
  Defaults to `~/.claude/projects`. Documented in README alongside the
  other two.

## 9. Test strategy

### 9.1 Synthetic fixture (§A enumerates per-scorer events)

A single hand-crafted JSONL fixture at
`packages/sessions/src/__tests__/fixtures/synthetic-events.jsonl`
(~120 events, ~15-20 KB with realistic `thinking` blocks per Appendix A).
First line of the file is a marker:

```
{"meta":"synthetic-fixture-do-not-replace-with-real-transcript","schemaVersion":1}
```

A vitest setup-file checks that every `.jsonl` under
`packages/sessions/src/__tests__/fixtures/` begins with this marker line.
**This assertion is the load-bearing privacy guard.** **Failing this check
fails the test suite** — mechanical enforcement of anti-goal §12.3.

The `.gitignore` rule and the 50 KB size cap below are **defense-in-depth**:
they reduce the blast radius if the marker assertion is bypassed (e.g. a
real transcript renamed to start with the marker would still be too big,
and would still match the secret-pattern grep). Code comments in the
setup-file MUST say so, so no one removes the marker assertion thinking
the gitignore covers it.

### 9.2 Mechanical guards on fixture vendoring + secrets

WU-1 lands all four:

1. **`.gitignore`** rule (defense-in-depth):
   ```
   # Real Claude Code transcripts must never be vendored. Synthetic fixtures
   # do NOT use `.real.` in their name; if a fixture file is named `*.real.*`
   # it is ignored by git.
   packages/sessions/src/__tests__/fixtures/*.real.*
   ```
2. **Marker-line setup file** as in §9.1 (load-bearing).
3. **Size cap test**: any `.jsonl` file under
   `packages/sessions/src/__tests__/fixtures/` larger than 50 KB fails
   the test suite. Synthetic fixtures are ~15-20 KB; real transcripts are
   500 KB – 2 MB. The cap is a wide trip wire.
4. **CI-grep test**: runs over every staged-or-committed text file under
   the repo (excluding `node_modules`, `dist`, `.git`). Fails the suite
   if any of these patterns appear:
   - `sk-[A-Za-z0-9]{20,}` (OpenAI / Anthropic API keys)
   - `ghp_[A-Za-z0-9]{20,}` (GitHub Personal Access Tokens)
   - `AKIA[A-Z0-9]{16}` (AWS Access Key IDs)
   - `xoxb-[A-Za-z0-9-]+` (Slack bot tokens)
   - `eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.` (JWT signatures)
   Belt-and-braces against the calibration-doc leakage vector (§9.4)
   and any future accidental commit.

### 9.3 Parser edge cases (Appendix B enumerates)

The JSONL parser's test list (WU-3) MUST include every entry in
Appendix B (11 cases including the new B11 deeply-nested-JSON case).

### 9.4 Calibration (WU-4.5)

Inputs: 2 real sibling-session transcripts the operator has selected and
labeled with an expected verdict for each of the 9 scorers (so 18 ground-
truth labels total). Labels are recorded in
`docs/sessions-calibration.md`. **If the labels would reveal proprietary
detail** from the operator's other repos, commit ONLY the per-criterion
agreement counts and decisions — not the raw labels. The CI-grep test
(§9.2 #4) catches the easy mistakes; operator judgment covers the rest.

**Agreement rule (clarified)**: with N=2, the "≥80% agreement" bar is
**binary**, not arithmetic:
- 2-of-2 sessions agree → criterion KEEPS.
- 1-of-2 sessions agree → criterion KEEPS only with **explicit written
  justification** in the calibration doc (the one disagreement is a
  legitimate corner case, not a systematic failure).
- 0-of-2 → criterion DROPS.

When a criterion DROPS, WU-4.5 must also:
1. Delete the scorer module from `packages/sessions/src/rubric/`.
2. Remove the key from `RubricKey` enum in `packages/types/src/sessions.ts`.
3. Update `ProcessRubricScore.items.length(N)` where N is the new count.
4. Re-run `npm run build` in `packages/types/` so the new types propagate
   to `packages/sessions/` and `packages/collector/` before WU-6 starts.
5. Update §7 table to reflect the dropped row.

WU-4.5 deliverable: a brief `docs/sessions-calibration.md` showing, per
criterion: operator label, rubric verdict, agreement (Y/N), keep/drop
decision (and justification text if 1-of-2 with keep).

**Statistical limit acknowledged**: N=2 is thin. WU-7 opens a recurring-
calibration follow-up bead to re-validate on ≥5 sessions after the
2-week usage window.

### 9.5 Coverage

`.coverage-thresholds.json` (already in place) stands. New package must
contribute 100% lines and meet the existing branch/function/statement
thresholds. Defensive unreachable paths use `/* v8 ignore */` mirroring the
`collector` pattern.

Signal-handler branches in `tail.ts`, the `git rev-parse` no-binary
fallback in `git-check.ts`, and any other I/O-bound unreachables are
`/* v8 ignore */` from day one — decided in code at WU-1/WU-6, not
retrofitted at coverage-failure time.

### 9.6 Bash command summary content (known limitation)

Bash summaries take the first 120 chars of the command. **A 120-char Bash
command can leak credentials** (e.g. `export OPENAI_API_KEY=sk-...`,
`curl -H 'Authorization: Bearer ...'`). This spike does NOT redact such
content; `summary` is explicitly marked "may contain operator secrets"
(§11). The secret-pattern redactor follow-up replaces this with a
deny-list of suspicious command prefixes and pattern-based masking.

### 9.7 Fixture size guidance

Synthetic fixture **soft target**: ~15-20 KB. Enough to hold ~120 events
covering Appendix A with realistic `thinking` blocks (~50-100 chars
each). 50 KB **hard cap** stays — real transcripts are ≥500 KB so the
cap is a wide trip wire.

## 10. Work units

The spike decomposes into **9 WUs**. Each WU has its own bead, claimed
before starting, closed after its commit passes lint + tests + coverage.
Follow the project's TDD policy: failing test first.

| WU | Title | Dep | Deliverable |
|---|---|---|---|
| WU-1 | Workspace skeleton + PoC deletion + atomicWriteJson lift + fixture & secret guards | — | (a) `packages/sessions/` created with `package.json` (exports map per §5.2), tsconfigs, vitest config, empty `src/index.ts`. (b) `packages/session-observer/` **deleted**. (c) `packages/types/src/fs-utils.ts` created with `atomicWriteJson` lifted from `collector/src/writer.ts`; collector re-imports. (d) **`packages/types/package.json` gains `./fs-utils` exports entry** (and stub `./sessions` entry — file lands in WU-2). (e) `.gitignore` rule for `*.real.*` fixtures. (f) Vitest setup-file enforcing marker line on fixtures, with a code comment "load-bearing: do NOT remove". (g) Size-cap test (50 KB) for fixtures. (h) **CI-grep test** for secret patterns per §9.2 #4. (i) **Test asserting `audit --persist` default is off** (placeholder stub — full audit lands in WU-6, but the flag-default test asserts the parser config). Build + typecheck + test green; no behaviour change in collector. |
| WU-2 | Zod schemas | WU-1 | `packages/types/src/sessions.ts` with all schemas from §6 incl. `RubricKey` enum, `RubricPointer` discriminated union, `redactionApplied`, `persistedWithSanitization`, `skippedLineCount`. Re-export from `index.ts`. **Update `packages/types/package.json` `./sessions` exports entry to point at the now-built dist file.** Tests: round-trip `safeParse` per schema; length(9) constraint; discriminated-union parse: valid uuid variant, valid index variant, invalid (missing kind), invalid (extra kind value). |
| WU-3 | JSONL parser | WU-2 | `packages/sessions/src/jsonl-reader.ts` exporting `parseTranscript(filePath, fs?) → SessionTimeline`. Pure, fs injectable. Tests cover every case in Appendix B (B1–B11). |
| WU-4 | Rubric scorers (9) | WU-3 | Nine files in `src/rubric/*.ts`, one per `RubricKey`. `src/rubric/index.ts` exports `scoreTimeline(timeline) → ProcessRubricScore`. Unit tests per scorer covering all verdict branches per Appendix A (~30 test cases). |
| WU-4.5 | Calibration gate | WU-4 | `docs/sessions-calibration.md` per §9.4. Each criterion's keep/drop decision recorded. Failed criteria deleted from §7, `RubricKey`, scorer module set, AND `npm run build` of `packages/types` re-run so dependents typecheck. **Hard gate**: WU-6 blocked until this closes. |
| WU-5 | Snapshot writer | WU-2 | `packages/sessions/src/writer.ts` exporting `writeSessionSnapshot(snapshot, dataDir, fs?)`. Uses lifted `atomicWriteJson`. **Path sanitization**: `projectName` and `sessionId` validated against `^[A-Za-z0-9._-]+$` and rejected if `..` present. **Containment**: `path.resolve(realpath(dataDir))` — uses the resolved realpath, not lexical comparison, to defeat pre-existing symlinks at the dataDir root. Tests: idempotency, path layout, sanitization rejections, fs error propagation, **realpath-based containment assertion** (test creates a symlinked dataDir and verifies the writer still confines writes). |
| WU-6 | CLI subcommands | WU-3, WU-4.5, WU-5 | `src/cli/{audit,timeline,tail}.ts` + dispatcher arm in `bin/metaswarm-dashboard`. `audit` is the headline verb. Implements §8.1–§8.5 incl.: stderr/stdout split (warnings → stderr, JSON/table → stdout), `--exit-on-fail` + `--no-exit-on-fail-if-in-flight` interaction, in-flight 60s warning, 80-col table per §8.2 with full 4-count footer, `--interval` duration grammar per §8.4. `git-check.ts` extracted as `isInsideGitWorkingTree(dir)` with `cwd=<dir>`, **2-second timeout**, **graceful no-binary** (returns `false`, no crash) — injectable for tests. `tail.ts` as pure async iterable. Tests via `execa`; `tail` test uses `--interval 10ms`. |
| WU-7 | Docs + follow-ups | WU-1..WU-6 | README section "Observing Claude Code sessions" (audit first, timeline/tail second). README CI example notes `--exit-on-fail` interaction with in-flight sessions. `docs/follow-ups/sessions.md` listing deferred items. **Open ≥4 follow-up beads**: (1) web view, (2) cross-session aggregation, (3) secret-pattern redactor, (4) **recurring-calibration on ≥5 sessions** post 2-week window. Plus optional: bug-report exporter (depends on #3), `scope-drift` re-introduction once `bd show --json` exposes declared file scope. STACK.md unchanged (no new deps). |
| WU-8 | 2-week post-merge usage check (M1, M2, M3) | WU-7 | Bead opened at WU-7 merge with a 2-week deadline. Operator records **only counts and outcome categories** — no session IDs, no transcript excerpts, no prompt content. Targets per §15.2: M1 ≥5 audit runs, M2 ≥2 distinct behavioural changes across ≥2 distinct sibling repos (each recorded in a bead or `.agents/notes.md` entry — auditable), M3 ≥1 `tail` invocation. If ALL THREE met → close as "follow-ups proceed". If any missed → close as "follow-ups cancelled — reason X". |

Each WU's bead title: `spike-sessions WU-N: <short>`. Use `bd dep add` to
encode the chain above.

## 11. Privacy and security

Transcripts contain prompts and tool results verbatim. They MAY contain:

- Source code from any private codebase the operator works on.
- Secrets surfaced by tool calls (`printenv`, `cat .env`, API keys in tool
  args, OAuth tokens in `curl` Authorization headers).
- File paths, repo names, branch names, customer identifiers.
- Operator prose, agent `thinking` blocks.

For a single-operator local tool, **the transcripts themselves never leave
the machine**. The risks this spike addresses are:

1. **Snapshot egress** — opt-in `--persist` writes a JSON snapshot. The
   snapshot **may contain operator secrets**. Mitigation: explicit "may
   contain operator secrets" warning on every `--persist` write to
   **stderr** (§8.1); `SessionSnapshot.persistedWithSanitization: false`
   in this spike so any future sharer can refuse unsafe snapshots;
   `--persist` defaults to off, asserted by test.
2. **Fixture vendoring** — accidental commit of a real transcript as a
   fixture. Mitigation: §9.2 four-layer defense — load-bearing marker
   assertion + defense-in-depth `.gitignore` + 50 KB size cap + secret-
   pattern CI-grep.
3. **Path traversal** — a maliciously-crafted `<project>` config value
   could escape the transcripts directory. Mitigation: §8.1 input allow-
   list (`^[A-Za-z0-9._-]+$`), reject `..` and control chars, post-
   resolution containment assertion, `lstat`-only (no symlink-follow).
4. **Snapshot path injection** — `projectName` / `sessionId` flow into
   filesystem paths. Mitigation: WU-5 sanitizes both against
   `^[A-Za-z0-9._-]+$`, **realpath-based** containment under
   `<dataDir>` (not lexical — defeats a pre-existing symlink at the
   dataDir root).
5. **dataDir-inside-git footgun** — if `<dataDir>` happens to be inside a
   git working tree, snapshots silently become committable. Mitigation:
   on `--persist`, `isInsideGitWorkingTree(dataDir)` is called — runs
   `git rev-parse --show-toplevel` with `cwd=<dataDir>`, **2-second
   timeout**, **graceful no-binary fallback** (returns `false`, never
   crashes the persist path). If `true`, prints a one-line warning to
   stderr (don't refuse — operator may have a deliberate reason). The
   helper lives in `packages/sessions/src/git-check.ts` and is
   injectable for tests so the test suite never spawns `git`.
6. **JSONL adversarial content** — huge lines, hostile JSON keys,
   deeply-nested objects. Mitigation: 1 MiB per-line cap in the parser
   (skip + count in `skippedLineCount`); Zod parsing isolates downstream;
   Appendix B11 explicitly tests 10 k-deep nested JSON for stack-overflow
   resilience.
7. **`tail` symlink swap** — between polls, a symlink swap could redirect
   reads. Mitigation: inode check (`lstat`) between polls; if inode
   changes, warn to stderr and re-open.

### 11.1 What this spike does NOT mitigate (acknowledged limits)

- `summary` truncation to 200 chars is **not** a privacy boundary. API keys
  (40–100 chars), JWTs (300+ chars but first 200 still leaks the signing
  alg + payload), AWS access keys (60 chars), GitHub PATs (40–93 chars),
  DB connection strings all fit comfortably inside 200 chars. Treat every
  `summary` as potentially containing secrets. The secret-pattern
  redactor follow-up replaces this with a pattern-based mask.
- Bash command summaries (§9.6) take the first 120 chars verbatim. Same
  limitation, same follow-up.
- `assistant-thinking` content flows into `summary` — these blocks
  frequently quote secrets verbatim. Same limitation. The follow-up may
  drop `thinking` blocks entirely from summaries.

The `scrub-and-vendor` helper from v1 §7.1 was **removed in v2**. It was
named in a way that implied a safety it could not deliver. Operators
wishing to share a snapshot must wait for the bug-report exporter
follow-up, which will run on top of the secret-pattern redactor.

## 12. Anti-goals — explicit guardrails for the executing agent

Read these before starting WU-1. Violating any one is grounds to stop and
re-confirm with the operator.

1. **Do not extend the `collector` package.** Sibling, not internal.
2. **Do not add a web view.** Schema must support it; UI is out of scope.
3. **Do not vendor real operator transcripts into the repo.** Synthetic
   fixtures only — guarded by §9.2's four-layer defense.
4. **Do not add new runtime dependencies.** `zod`, `commander`, node built-ins.
5. **Do not lower `.coverage-thresholds.json`.** 100% lines, 92% branches,
   97% functions, 98% statements stand. Defensive unreachables use
   `/* v8 ignore */`.
6. **Do not modify existing snapshots / api / paths schemas.** Add new file
   `sessions.ts`, re-export from `index.ts`. Additive only.
7. **Do not write `git push`.** Operator pushes manually.
8. **Do not skip the TDD order.** Failing test → implementation → green.
9. **Do not silently tweak default verdict thresholds in §7.** Any threshold
   change must land in a `.beads/knowledge/decisions.jsonl` entry with
   rationale. Rubric drift is a calibration killer.
10. **Do not deep-import from `@metaswarm-dashboard/collector` internals.**
    Use the package's declared `exports` map only. If a util is needed in
    `sessions`, lift it to `@metaswarm-dashboard/types` and import from
    there (WU-1 already does this for `atomicWriteJson`).
11. **Do not flip `--persist` default to on.** The default is off; WU-1
    tests assert this.
12. **Do not spawn `git` directly in tests.** Use the injectable
    `isInsideGitWorkingTree` helper; stub it in test setup.
13. **Do not remove the marker-line assertion in `__tests__/fixtures/`
    setup**. The `.gitignore` and size cap are defense-in-depth, not the
    primary guard. The marker assertion is load-bearing.

## 13. Open questions (decide during WU-1; defaults proposed)

| # | Question | Default if not raised |
|---|---|---|
| Q1 | Should `tail` re-run the rubric every N events? | Default: no — `tail` is timeline-only in this spike. `audit` is one-shot. |
| Q2 | Sessions older than X days — purge? | Default: no purging in this spike. Disk usage is negligible. Follow-up bead. |
| Q3 | Multi-session per day display order? | Default: writer keys by `<sessionId>.json` under `<dayKey>/`. CLI `audit` picks the most-recently-modified JSONL. |
| Q4 | `prompt-coherence` token match — case-sensitive? | Default: **case-insensitive**, token length ≥3. |
| Q5 | Calibration sessions selection | Default: operator picks 1 "known-good" + 1 "known-drifted" sibling session, per §9.4. |
| Q6 | `--interval 0` behaviour | Rejected by grammar (§8.4). |

## 14. Reference — the deleted PoC

The PoC at `packages/session-observer/` was deleted in WU-1 (see §3 for
rationale). It is recoverable from commit `29da62c` in git history if any
specific capability turns out to be missing from the new CLI.

The PoC's intent — answering "what each agent did, in general" — is
partially covered by `metaswarm-dashboard sessions timeline <project>`
(UC-3). The cross-project aggregate (`agents`, `list --since`) is **not**
covered by this spike and is opened as a follow-up bead in WU-7.

## 15. Definition of done + failure exit criteria

### 15.1 DoD (must all be true to merge the spike)

- All 9 WUs (WU-1..WU-7, WU-4.5 inclusive) closed. WU-8 is open with a
  2-week deadline.
- `npm test` green; coverage meets `.coverage-thresholds.json`.
- `npm run lint` clean on new files (pre-existing baseline unchanged).
- WU-4.5 calibration completed: at least 6 of the 9 criteria pass the
  agreement bar per §9.4. If fewer than 6, the spike is paused and the
  operator decides per §15.3.
- `packages/session-observer/` no longer exists in the working tree.
- `atomicWriteJson` lifted to `@metaswarm-dashboard/types/fs-utils`;
  collector tests still green.
- `packages/types/package.json` declares both `./fs-utils` and
  `./sessions` exports map entries.
- Test asserts `audit --persist` default is off.
- README + `docs/follow-ups/sessions.md` committed.
- ≥4 follow-up beads opened (web view, cross-session aggregation,
  secret-pattern redactor, recurring-calibration) with links back to
  this design doc.
- `.gitignore`, marker assertion, size cap, and **CI-grep secret-pattern
  test** from §9.2 in effect.

### 15.2 Two-week post-merge usage check (WU-8)

The spike's user-facing success is measured AFTER merge, not at merge:

- **M1**: Operator runs `metaswarm-dashboard sessions audit` ≥ **5 times**
  in the 2 weeks post-merge against real sibling sessions.
- **M2**: At least **2 distinct behavioural changes across ≥2 distinct
  sibling repos**, where a behavioural change = operator stopped a
  session, re-read a transcript, rolled back a WU, opened a corrective
  bead, or adjusted a session's scope as a direct result of an `audit`
  output. **Each change is recorded in a bead or `.agents/notes.md` entry**
  so the metric is auditable post-hoc, not vibes.
- **M3**: At least **1 `metaswarm-dashboard sessions tail` invocation** in
  the 2-week window. Drives data-driven decision on whether `tail` stays
  in follow-ups or is cut.

If **all three** met → the WU-7 follow-up beads proceed. If any missed →
the follow-ups are **cancelled** (not deferred), the failure mode is
recorded in `docs/follow-ups/sessions.md`, and the rubric / CLI stays
as-is or is reduced further.

The WU-8 bead records only counts and outcome categories. No session IDs,
no transcript excerpts, no prompt content.

### 15.3 Failure exit criteria (kill switches)

- **Calibration kill**: <6 criteria pass §9.4 → operator decides; default
  is "pause and reassess", not "ship a degraded rubric silently". WU-4.5
  is open until this decision is recorded.
- **2-week usage kill**: any of M1/M2/M3 missed → follow-ups cancelled
  per §15.2.
- **Privacy regression**: any future PR that flips
  `persistedWithSanitization` to `true` without landing the secret-pattern
  redactor is blocked at the type-check level (Zod literal would need to
  change) and at review.

---

## Appendix A — Per-scorer, per-branch fixture event enumeration

The synthetic fixture at
`packages/sessions/src/__tests__/fixtures/synthetic-events.jsonl` MUST
exercise every (scorer × verdict) cell below. Each cell names the events
the fixture must contain to drive that branch in the scorer. This is what
WU-4 TDD writes its failing tests against.

| Scorer | `pass` events | `watch` events | `fail` events | `na` events |
|---|---|---|---|---|
| `setup-discipline` | ≥3 Read of `AGENTS.md`, `CLAUDE.md`, `.agents/index.md` before first Write | 1–2 such reads before first Write | 0 such reads, then Write to `src/foo.ts` | **n/a — never returns na** |
| `planning` | `bd create` ToolUse before first `src/` Write | `.agents/notes.md` Write before any `src/` Write, no `bd create` | `src/foo.ts` Write with no prior `bd` activity | n/a |
| `tdd` | Write `foo.test.ts` then Write `foo.ts` | Mixed: one test-first pair + one production-first pair | Write `foo.ts` with no test-write at all | No test files written |
| `error-handling` | 2 `tool-error` events each followed by a `Read`/`Grep` within ≤2 events | 1 of 2 errors get a corrective response | 4 errors with no corrective response | Zero errors in session |
| `thrashing` | No two consecutive `Edit` on same file within 5 s | 2 consecutive `Edit` on `foo.ts` within 5 s | 5 consecutive `Edit` on `foo.ts` within 5 s | n/a |
| `cross-reference` | Multi-package work + ≥1 Read of `.agents/` or sibling contract file | Multi-package work + 0 such reads | n/a (no `fail` branch) | Single-package work only |
| `communication` | `bd close` + `.agents/notes.md` Write | `bd close` but no `.agents/` Write | No `bd close` and no `.agents/` Write | Session <10 events |
| `prompt-coherence` | First user prompt mentions "WU-3 parser"; ≥3 of 6 created beads share a token | First user prompt mentions "WU-3"; only 1 of 6 beads matches | n/a | No beads created |
| `workflow-touchpoints` | ≥3 distinct: `bd` + `.agents/` Write + `.coverage-thresholds.json` Read | 1–2 distinct workflow tools | 0 workflow tools | n/a |

The fixture therefore needs ~30 logical events to drive every cell, plus
realistic `thinking` blocks, user prompts, and tool results bringing the
total to ~120 events, ~15-20 KB. The expected `SessionTimeline` and
`ProcessRubricScore` outputs live in `synthetic-events.expected.json` next
to the fixture (frozen golden master).

## Appendix B — Parser edge-case test list (WU-3)

| # | Input | Expected behaviour |
|---|---|---|
| B1 | Empty file (0 bytes) | `parseTranscript` returns `SessionTimeline` with `eventCount: 0`, `events: []`, **`startedAt` and `lastEventAt` = file mtime if available; epoch (`1970-01-01T00:00:00.000Z`) otherwise**. |
| B2 | Single valid line | `eventCount: 1` |
| B3 | Single malformed line (`{"bad":}`) | `eventCount: 0`, `skippedLineCount: 1` |
| B4 | 3 valid + 2 malformed interleaved | `eventCount: 3`, `skippedLineCount: 2` |
| B5 | Partial JSON at EOF (no trailing `\n`) | Last partial line treated as malformed → `skippedLineCount += 1` |
| B6 | CRLF line endings (`\r\n`) | Parsed normally (split on `\n`, trim `\r`) |
| B7 | Leading UTF-8 BOM | Parsed normally (BOM stripped from first line) |
| B8 | One line > 1 MiB | Line skipped + counted; parser does not OOM |
| B9 | Non-UTF-8 byte in a line | Line skipped + counted |
| B10 | Line with `__proto__: { ... }` key | Parsed by `JSON.parse`; Zod ignores extra keys; no prototype pollution downstream |
| B11 | Line with deeply-nested object (10 k levels) | Parser does not stack-overflow; Zod parsing also handles it (use `z.lazy` or iterative validation if needed); event is either accepted or skipped + counted, but the process does not crash |

---

End of design doc v3.
