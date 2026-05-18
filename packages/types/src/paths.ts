// XDG-aware path resolution for the dashboard's data dir and config file.
// Per plan §2.3 / WU-2.1–3.

import { homedir } from 'node:os';
import { join } from 'node:path';

const APP = 'metaswarm-dashboard';

export interface PathsEnv {
  /** `process.platform` — overridable for tests. */
  platform: NodeJS.Platform;
  /** `os.homedir()` value — overridable for tests. */
  homeDir: string;
  /** Process env. */
  env: Record<string, string | undefined>;
}

export function defaultEnv(): PathsEnv {
  return {
    platform: process.platform,
    homeDir: homedir(),
    env: process.env,
  };
}

/**
 * Resolve the dashboard data directory.
 *
 * Precedence:
 *   1. `METASWARM_DASHBOARD_DATA_DIR` env var (if set).
 *   2. darwin → `~/Library/Application Support/metaswarm-dashboard/`.
 *   3. linux  → `${XDG_DATA_HOME:-~/.local/share}/metaswarm-dashboard/`.
 *
 * Other platforms fall through to the linux behavior.
 */
export function dataDir(env: PathsEnv = defaultEnv()): string {
  const override = env.env.METASWARM_DASHBOARD_DATA_DIR;
  if (override !== undefined && override !== '') {
    return expandHome(override, env.homeDir);
  }
  if (env.platform === 'darwin') {
    return join(env.homeDir, 'Library', 'Application Support', APP);
  }
  const xdg = env.env.XDG_DATA_HOME;
  const base = xdg !== undefined && xdg !== '' ? xdg : join(env.homeDir, '.local', 'share');
  return join(expandHome(base, env.homeDir), APP);
}

/**
 * Resolve the directory holding Claude Code session transcript files.
 *
 * Precedence:
 *   1. `METASWARM_DASHBOARD_TRANSCRIPTS_DIR` env var (if set).
 *   2. `~/.claude/projects` (the default Claude Code transcript location).
 *
 * The default is platform-independent — Claude Code writes transcripts under
 * `~/.claude/projects` on every OS.
 */
export function transcriptsDir(env: PathsEnv = defaultEnv()): string {
  const override = env.env.METASWARM_DASHBOARD_TRANSCRIPTS_DIR;
  if (override !== undefined && override !== '') {
    return expandHome(override, env.homeDir);
  }
  return join(env.homeDir, '.claude', 'projects');
}

/**
 * Resolve the directory holding Codex CLI run telemetry (rollout files).
 *
 * Precedence:
 *   1. `METASWARM_DASHBOARD_CODEX_SESSIONS_DIR` env var (if set).
 *   2. `~/.codex/sessions` (the default Codex CLI rollout location).
 *
 * Codex CLI writes one `rollout-<ts>-<uuid>.jsonl` per run under
 * `~/.codex/sessions/<YYYY>/<MM>/<DD>/` on every OS, so the default is
 * platform-independent — mirroring `transcriptsDir`. The rotated
 * `~/.codex/archived_sessions/` tree is deliberately NOT covered by this
 * helper (sessions-spike design §2 — out of scope for v5).
 */
export function codexSessionsDir(env: PathsEnv = defaultEnv()): string {
  const override = env.env.METASWARM_DASHBOARD_CODEX_SESSIONS_DIR;
  if (override !== undefined && override !== '') {
    return expandHome(override, env.homeDir);
  }
  return join(env.homeDir, '.codex', 'sessions');
}

/**
 * Resolve the metaswarm external-tools ledger file.
 *
 * Precedence:
 *   1. `METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER` env var (if set).
 *   2. `~/.claude/sessions/external-tools.jsonl` (metaswarm's default).
 *
 * metaswarm's external-tools adapter (`log_session` in
 * `skills/external-tools/adapters/_common.sh`) appends one JSONL envelope
 * per Codex/Gemini delegation run to this single file. It is the only
 * capture point for Gemini token usage (Gemini CLI persists nothing to
 * disk — sessions-spike design §4.3). The default is platform-independent,
 * mirroring `transcriptsDir` / `codexSessionsDir`.
 */
export function externalToolsLedger(env: PathsEnv = defaultEnv()): string {
  const override = env.env.METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER;
  if (override !== undefined && override !== '') {
    return expandHome(override, env.homeDir);
  }
  return join(env.homeDir, '.claude', 'sessions', 'external-tools.jsonl');
}

/**
 * Resolve the dashboard config file path.
 *
 * Precedence:
 *   1. `METASWARM_DASHBOARD_CONFIG` env var (if set).
 *   2. darwin → `~/Library/Application Support/metaswarm-dashboard/config.yaml`.
 *   3. linux  → `${XDG_CONFIG_HOME:-~/.config}/metaswarm-dashboard/config.yaml`.
 */
export function configFile(env: PathsEnv = defaultEnv()): string {
  const override = env.env.METASWARM_DASHBOARD_CONFIG;
  if (override !== undefined && override !== '') {
    return expandHome(override, env.homeDir);
  }
  if (env.platform === 'darwin') {
    return join(env.homeDir, 'Library', 'Application Support', APP, 'config.yaml');
  }
  const xdg = env.env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg !== '' ? xdg : join(env.homeDir, '.config');
  return join(expandHome(base, env.homeDir), APP, 'config.yaml');
}

/**
 * Expand a path that starts with `~/` or is exactly `~` to the home dir.
 *
 * `~user` (other-user expansion) is rejected with `PathExpansionError`.
 * Absolute paths pass through unchanged.
 *
 * Relative paths are NOT rejected here (this helper is called for env-var
 * inputs which can legitimately be paths the user controls). The stricter
 * check for relative paths in YAML config entries lives in `config.ts`.
 */
export function expandHome(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/')) return join(home, input.slice(2));
  if (input.startsWith('~')) {
    // ~user — not supported; we only know the current user's home.
    throw new PathExpansionError(
      `Refusing to expand "${input}": only "~" / "~/..." for the current user are supported.`,
    );
  }
  return input;
}

export class PathExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathExpansionError';
  }
}
