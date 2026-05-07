// Operator-facing help text for collection warnings. Pure: given a
// warning string, returns one or more "fix now" / "prevent next time"
// hints. Pattern-matches on stable substrings emitted by the collector
// + bd. Drives the ProjectCard info popover.

export interface WarningHelp {
  /** Short label shown next to the warning. */
  label: string;
  /** What to do right now to recover. */
  fixNow: string;
  /** How to prevent this from recurring. */
  preventNextTime: string;
}

interface WarningPattern {
  match: (msg: string) => boolean;
  build: (msg: string) => WarningHelp;
}

const PATTERNS: WarningPattern[] = [
  {
    match: (m) => m.includes('no beads database found'),
    build: () => ({
      label: 'No BEADS database',
      fixNow:
        'cd into the project and run `bd init --server` (or `bd init` if your bd binary supports CGO). The directory has a `.beads/` folder but no database was created.',
      preventNextTime:
        'After cloning a metaswarm-managed project, always run `bd init --server` (or `bd sync --from-main` if `.beads/issues.jsonl` is committed) before letting metaswarm orchestrate. metaswarm currently does not gate on this — see issue #4.',
    }),
  },
  {
    match: (m) => m.includes('Dolt server unreachable'),
    build: () => ({
      label: 'Dolt server not running',
      fixNow:
        'cd into the project and run `bd dolt start` to bring the Dolt SQL server up. Each project tracks its own port in `.beads/dolt-server.port`; multiple projects can coexist on different ports.',
      preventNextTime:
        'Either keep `bd dolt start` running (e.g. via launchd/systemd), OR set `dolt.auto-start: true` in the project\'s `.beads/config.yaml` so `bd` boots its own server on demand.',
    }),
  },
  {
    match: (m) => m.includes('embedded Dolt requires CGO'),
    build: () => ({
      label: 'CGO not available for embedded Dolt',
      fixNow:
        'Re-run `bd init --server` (instead of plain `bd init`). The `--server` flag uses an external Dolt SQL server that doesn\'t need CGO.',
      preventNextTime:
        'On macOS Apple Silicon (and any other CGO-less host), always pass `--server` to `bd init`. Document this in your team\'s onboarding.',
    }),
  },
  {
    match: (m) => m.includes('not found on PATH'),
    build: () => ({
      label: '`bd` binary missing',
      fixNow:
        'Install the `bd` CLI per https://github.com/steveyegge/beads, then re-run collection.',
      preventNextTime:
        'Add `bd` to your shell startup (e.g. brew installs into `/opt/homebrew/bin`). The dashboard collector calls `bd list --json`; without it you only get whatever was exported into `.beads/issues.jsonl`.',
    }),
  },
  {
    match: (m) => m.includes('not valid JSON') || m.includes('expected an array'),
    build: () => ({
      label: '`bd list --json` produced unexpected output',
      fixNow:
        'Run `bd list --json` directly in the project. If it errors, fix the underlying BEADS issue. If it succeeds but the dashboard still flags this, your bd version may have changed schema.',
      preventNextTime:
        'Pin a bd version in your dev setup; metaswarm\'s upstream PR #4 (filed) tracks adding a schema check.',
    }),
  },
  {
    match: (m) => m.includes('malformed JSONL row') || m.includes('malformed row'),
    build: () => ({
      label: 'Malformed row in `.beads/issues.jsonl`',
      fixNow:
        'Open the file and either delete the bad line or fix it. The collector skips it gracefully; this warning is informational.',
      preventNextTime:
        'Don\'t hand-edit `.beads/issues.jsonl` — let `bd` write it via `bd export` or hooks.',
    }),
  },
  {
    match: (m) => m.includes('no .beads/'),
    build: () => ({
      label: 'No `.beads/` directory',
      fixNow:
        'Either remove this project from your dashboard `config.yaml`, or run `bd init --server` inside it to start tracking.',
      preventNextTime:
        'Only list metaswarm-managed projects in `config.yaml`. The discovery script (`./bin/discover-projects.sh`) skips dirs without `.beads/`.',
    }),
  },
  {
    match: (m) => m.includes('project path does not exist'),
    build: () => ({
      label: 'Project path missing on disk',
      fixNow:
        'Either correct the `path:` entry in `config.yaml` or remove the project entry entirely.',
      preventNextTime:
        'Use absolute paths in `config.yaml` and re-run discovery if you\'ve renamed/moved a project root.',
    }),
  },
  {
    match: (m) => m.includes('failed to read'),
    build: () => ({
      label: 'Filesystem read error',
      fixNow:
        'Check permissions on the project\'s `.beads/` files. The collector reads only — it never writes — so EACCES or similar means another process owns the file.',
      preventNextTime:
        'Avoid running `bd` as root or under sudo on a path you also access as a regular user; ownership conflicts produce read errors here.',
    }),
  },
];

/**
 * Generic catch-all when no pattern matches. The full message is shown
 * in the popover; the operator at least sees the literal warning.
 */
const FALLBACK: WarningHelp = {
  label: 'Collection warning',
  fixNow:
    'See the warning text above; the literal message is the most reliable source. If unfamiliar, search the bd / metaswarm issue trackers.',
  preventNextTime:
    'If this warning is recurring across multiple collection runs, file an issue against this dashboard with the literal message attached.',
};

/** Map a single warning message to operator-facing help. */
export function helpForWarning(msg: string): WarningHelp {
  for (const p of PATTERNS) if (p.match(msg)) return p.build(msg);
  return FALLBACK;
}

export interface CollectionAdvice {
  /** One-line summary of the project's collection status. */
  summary: string;
  /** Per-warning help. */
  warnings: { message: string; help: WarningHelp }[];
}

export function buildCollectionAdvice(
  status: 'ok' | 'degraded' | 'failed',
  warnings: string[],
): CollectionAdvice {
  if (status === 'ok' || warnings.length === 0) {
    return {
      summary: 'Collection succeeded with no warnings.',
      warnings: [],
    };
  }
  const summary =
    status === 'failed'
      ? 'Collection FAILED — the project was skipped entirely.'
      : 'Collection succeeded with warnings; some data may be incomplete.';
  return {
    summary,
    warnings: warnings.map((m) => ({ message: m, help: helpForWarning(m) })),
  };
}
