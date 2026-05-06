# Checkpoint #3 — pre-merge walkthrough

This document is the WU-7 deliverable for issue #1's third human checkpoint:

> Before merging the MVP — full walkthrough on real `.beads/` data from at least 2 projects, confirm zero-footprint guarantee on host projects.

Two parts:

1. **Fixture-based pass** (committed; runs in CI as part of `zero-footprint.test.ts`). Reproducible, byte-deterministic. Documented below for transparency.
2. **Operator-real pass** — the operator runs the dashboard against ≥2 of their actual metaswarm-managed projects, takes pre/post `git status`, refreshes screenshots if anything looks off, and signs off below.

---

## Part 1 — Fixture-based pass (CI-reproducible)

The committed fixtures under `packages/collector/src/__tests__/fixtures/host-repos/` simulate three host projects:

- `mixed-tasks/` — 8 tasks across two agents (5 closed in the last 7d, 1 blocked, 2 open/in-progress)
- `malformed-jsonl/` — exercises the "skip + log, never crash" path
- `empty-project/` — exercises the "no `.beads/` → skip + log, exit 0" path

The zero-footprint test (`packages/collector/src/__tests__/zero-footprint.test.ts`) does:

1. Walk each fixture and recursive-`sha256` every file → `before`.
2. Run `runCollect({ all: true, ... })` writing to a `mkdtempSync` data dir.
3. Walk again → `after`.
4. Assert `before` and `after` are identical maps (path → hash).
5. Repeat with `--project` instead of `--all`.

This test passes in CI on both ubuntu-latest and macos-latest, locking the zero-footprint contract per-commit. **Any host-repo write — even a stray `.DS_Store` — fails the build.**

A second cross-WU integration test (`packages/server/src/__tests__/integration-with-collector.test.ts`) writes a snapshot via the same `DailySnapshot` Zod schema the collector uses, then reads it back via `SnapshotReader`. This proves the writer/reader contract is single-sourced through `@metaswarm-dashboard/types`.

---

## Part 2 — Operator-real walkthrough (manual, signed off)

The operator runs the steps below against ≥2 of their **real** metaswarm-managed projects. Sign-off goes at the end.

### Prereqs

- node 22.12.0 (`nvm use`)
- `bd` CLI on PATH
- Dolt SQL server running on `127.0.0.1:3307` (if `bd` was built without CGO)

### Steps

```bash
# 1. From a fresh clone (or after `git pull`):
nvm use && npm ci && npm run build

# 2. Configure the operator's real projects:
metaswarm-dashboard config init   # if not already done
$EDITOR ~/.config/metaswarm-dashboard/config.yaml
# add ≥2 entries pointing at real .beads/-tracked projects

# 3. Snapshot the host repos BEFORE collection.
for p in <project-A-path> <project-B-path>; do
  echo "=== $p (before) ==="
  ( cd "$p" && git status --short && find .beads -type f | xargs sha256sum | sort )
done > /tmp/walkthrough-before.txt

# 4. Run a full collection.
metaswarm-dashboard collect --all

# 5. Snapshot AFTER. The diff against /tmp/walkthrough-before.txt MUST be empty.
for p in <project-A-path> <project-B-path>; do
  echo "=== $p (after) ==="
  ( cd "$p" && git status --short && find .beads -type f | xargs sha256sum | sort )
done > /tmp/walkthrough-after.txt
diff -u /tmp/walkthrough-before.txt /tmp/walkthrough-after.txt
# expected: no output (zero-footprint guarantee)

# 6. Refresh screenshots if any view changed visibly.
npm run screenshots

# 7. Serve the dashboard and click through the three views.
metaswarm-dashboard serve
# → http://127.0.0.1:5174 in the browser
# Verify visually:
#   - Projects index card per real project, all 4 metrics rendered ("—" for prsMergedLast7d).
#   - Click a card → detail view opens, agent table populated.
#   - Browser back returns to the index.
#   - /agents shows cross-project aggregates.
#   - Send a manual `curl -X POST http://127.0.0.1:5174/api/projects` → expect 405 + Allow: GET.
```

### Sign-off

| Field | Value |
|---|---|
| Date | _TBD by operator_ |
| Real projects walked | _TBD: e.g., `~/code/foo`, `~/code/bar`_ |
| `diff` between before/after `.beads/` snapshots | _expected: empty (no output)_ |
| 405 guard verified via `curl -X POST` | _yes / no_ |
| Screenshots refreshed | _yes / no — only if a view changed_ |
| Operator note | _free text, e.g. "all green" or "found X — filed follow-up Y"_ |
| Operator signature | _initials_ |

> **This sign-off block is intentionally left blank in the committed file. The merging operator fills it in as part of the final pre-merge review and re-commits.**
