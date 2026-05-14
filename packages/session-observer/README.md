# session-observer (PoC)

Read-only PoC that summarises Claude Code session transcripts already on disk under
`~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. Zero dependencies (Node 22+ built-ins
only). The host transcripts are never modified.

Intended as the seed for **metaswarm-dashboard Step 3 (observability)**. If it proves
useful, it gets promoted to a real package with types, tests, and a UI view.

## Commands

```bash
# Recent sessions across all projects (most recent first)
node cli.mjs list --since=7 --limit=10

# Filter by project name substring
node cli.mjs list --project=legal-advisor

# Summary of a single session ("what happened, in general")
node cli.mjs summary 3badeb29

# Full timeline (every tool call, prompt, thinking block)
node cli.mjs show 3badeb29

# Cross-project subagent invocations
node cli.mjs agents --since=30
```

## What `summary` shows

Per session:

- Time range and duration
- Project (cwd), git branch, model, plugins/skills attribution
- Counts: prompts, assistant turns, tool calls (per tool)
- Token totals and rough USD cost estimate (Opus/Sonnet pricing heuristic)
- **Sub-agents invoked**, grouped by `subagent_type`, with descriptions
- User prompts (first 8, truncated)
- Files modified (Write / Edit / MultiEdit)
- Bash patterns by description (top 8)

## What `agents` shows

Across every session matching `--since`: a roll-up of every `Agent` tool invocation
grouped by `subagent_type`. Lets you see, retrospectively, which specialised agents
have actually been used (e.g. `penalista-anticorrupcion`, `civilista-bienes`,
`metaswarm:code-review-agent`, etc.).

## Limits of the PoC

- Cost is a rough heuristic based on public Anthropic list prices; not authoritative.
- No persistent storage / no SQLite cache — every command re-reads JSONL from disk.
- No web UI yet; terminal output only. Step 3 of the dashboard would wire this into
  the existing Fastify + Vue SPA.
- Doesn't follow sidechain references to nested sub-agent transcripts beyond what
  Claude Code embeds inline. (The current transcripts seem to inline tool results,
  so this is fine for now.)

## Promotion criteria

Promote to a real `packages/session-observer` (with types and tests) only if the
output of `summary` answers "what did agent X actually do, in general?" without
the operator needing to read the raw JSONL. If gaps emerge, fix the PoC iteratively
before adding scaffolding.
