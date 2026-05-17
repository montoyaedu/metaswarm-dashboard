// Session discovery (sessions-spike WU v4-4, design §3.6 / §8.2).
//
// Discovery maps each configured project to the Claude Code transcript files
// stored under `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. It is
// READ-ONLY over `TRANSCRIPTS_DIR` — it never writes, never creates and never
// follows a symlink out of the tree.
//
// Path-safety per design §8.2 (read-path traversal hardening):
//   - the encoded-cwd → dir mapping is validated: the candidate dir must
//     `realpath`-resolve to a child of the resolved transcripts root;
//   - `lstat` only — a symlink at the project-dir or transcript-file
//     position is REFUSED, not followed (a symlink could point outside
//     `TRANSCRIPTS_DIR`);
//   - each `sessionId` (the `.jsonl` basename) must match a strict
//     `^[A-Za-z0-9._-]+$` allow-list and carry no `..` sequence.
// A check failing here surfaces to the caller as an empty result for that
// project (and, at the route layer, a `404`) — never a thrown error.
//
// Discovery does NOT parse transcripts. It produces path-level `SessionRef`s;
// parsing (`parseTranscript`) and the mtime/size cache are WU v4-5's job.

import {
  lstatSync as nodeLstatSync,
  readdirSync as nodeReaddirSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs';
import { join, sep } from 'node:path';

import type { Config } from '@metaswarm-dashboard/types/config';

/**
 * A path-level reference to a discovered session. Discovery stops here;
 * `parseTranscript` (WU v4-5) turns a `transcriptPath` into a timeline.
 */
export interface SessionRef {
  /** The `config.yaml` project name this transcript belongs to. */
  projectName: string;
  /** The `.jsonl` basename with the extension removed. */
  sessionId: string;
  /** Absolute path to the `.jsonl` transcript file. */
  transcriptPath: string;
}

/** A minimal `fs.Stats`-like shape — only the predicates discovery needs. */
interface StatsLike {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}

/**
 * Injectable filesystem hooks for `discoverSessions`. Defaults to `node:fs`.
 * Tests pass stubs (or point the functions at a temp tree) so every branch
 * is reachable without touching the real `~/.claude/projects/`.
 */
export interface DiscoveryFsHooks {
  /** List the entries of a directory. */
  readdirSync: (dir: string) => string[];
  /** `lstat` a path — MUST NOT follow symlinks (symlink detection relies on it). */
  lstatSync: (path: string) => StatsLike;
  /** Resolve a path to its canonical location (follows symlinks). */
  realpathSync: (path: string) => string;
}

const DEFAULT_FS: DiscoveryFsHooks = {
  readdirSync: (dir) => nodeReaddirSync(dir),
  lstatSync: (path) => nodeLstatSync(path),
  realpathSync: (path) => nodeRealpathSync(path),
};

/**
 * Allow-list for a `sessionId` (the `.jsonl` basename). Claude Code names
 * transcripts with a UUID, but the allow-list also tolerates the dots,
 * underscores and dashes a UUID-adjacent name could carry. Anything outside
 * this charset — or a `..` sequence — is rejected (design §8.2).
 */
const SESSION_ID_ALLOWED = /^[A-Za-z0-9._-]+$/;

/** The `.jsonl` extension discovery looks for. */
const JSONL_EXT = '.jsonl';

/**
 * Encode an absolute project path to its Claude Code transcript directory
 * name. Claude Code stores each project's transcripts under
 * `~/.claude/projects/<encoded-cwd>/`.
 *
 * Encoding rule (reverse-engineered, design §3.6 / risk R1): EVERY
 * non-alphanumeric character of the absolute path is replaced with a single
 * dash — `/`, `.`, `_`, spaces and punctuation alike. Alphanumeric characters
 * (including their case) are preserved. So:
 *   `/Users/x/ethiclab/repo`        → `-Users-x-ethiclab-repo`
 *   `/Users/x/metaswarm-dashboard`  → `-Users-x-metaswarm-dashboard`
 *   `/tmp/CR_20260228_PROD`         → `-tmp-CR-20260228-PROD`
 *
 * This was verified by matching all 19 directories under a real
 * `~/.claude/projects/` against the `cwd` field recorded inside their
 * transcripts (zero mismatches), including a path with underscores.
 *
 * The mapping is intentionally lossy (`-` and `/` both encode to `-`), so it
 * is used in the encode direction only; discovery never decodes a dir name.
 */
export function encodeTranscriptDirName(absProjectPath: string): string {
  return absProjectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Discover every Claude Code session transcript for the configured projects.
 *
 * @param config - The loaded dashboard config (its `projects[].path` values
 *   are absolute, expanded by the config loader).
 * @param transcriptsDir - The transcripts root (`~/.claude/projects` or the
 *   `METASWARM_DASHBOARD_TRANSCRIPTS_DIR` override).
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @returns Path-level `SessionRef`s, sorted by `projectName` then `sessionId`.
 *   Returns `[]` if `transcriptsDir` does not exist.
 */
export function discoverSessions(
  config: Config,
  transcriptsDir: string,
  fs: DiscoveryFsHooks = DEFAULT_FS,
): SessionRef[] {
  // Resolve the transcripts root once. If it does not exist, there is
  // nothing to discover — return empty rather than throwing.
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync(transcriptsDir);
  } catch {
    return [];
  }

  const refs: SessionRef[] = [];
  for (const project of config.projects) {
    collectProject(project.name, project.path, resolvedRoot, fs, refs);
  }

  // Deterministic order so callers (and tests) see a stable result.
  refs.sort((a, b) =>
    a.projectName === b.projectName
      ? a.sessionId.localeCompare(b.sessionId)
      : a.projectName.localeCompare(b.projectName),
  );
  return refs;
}

/**
 * Resolve one project's transcript dir and push a `SessionRef` for each valid
 * `.jsonl` file into `refs`. Any path-safety failure skips the project (or
 * the offending file) silently — discovery never throws.
 */
function collectProject(
  projectName: string,
  projectPath: string,
  resolvedRoot: string,
  fs: DiscoveryFsHooks,
  refs: SessionRef[],
): void {
  const candidateDir = join(resolvedRoot, encodeTranscriptDirName(projectPath));

  // `lstat` (NOT `stat`): a symlink at the project-dir position is refused,
  // never followed — it could point outside `TRANSCRIPTS_DIR` (design §8.2).
  let dirStats: StatsLike;
  try {
    dirStats = fs.lstatSync(candidateDir);
  } catch {
    // ENOENT (project never run under Claude Code) or any stat error → skip.
    return;
  }
  if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
    return;
  }

  // Containment: the candidate must canonically resolve to a child of the
  // resolved root. This catches a symlinked PARENT segment that `lstat` on
  // the leaf cannot see.
  let resolvedDir: string;
  try {
    resolvedDir = fs.realpathSync(candidateDir);
  } catch {
    return;
  }
  if (!isWithin(resolvedDir, resolvedRoot)) {
    return;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(candidateDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(JSONL_EXT)) {
      continue;
    }
    const sessionId = entry.slice(0, -JSONL_EXT.length);
    // Reject a basename outside the allow-list or carrying a `..` sequence.
    if (!SESSION_ID_ALLOWED.test(sessionId) || sessionId.includes('..')) {
      continue;
    }

    const transcriptPath = join(candidateDir, entry);
    // `lstat` again: a symlinked `.jsonl` is refused, never followed; the
    // entry must be a regular file.
    let fileStats: StatsLike;
    try {
      fileStats = fs.lstatSync(transcriptPath);
    } catch {
      continue;
    }
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      continue;
    }

    refs.push({ projectName, sessionId, transcriptPath });
  }
}

/**
 * True if `target` is `root` itself or a descendant of it. Uses the path
 * separator boundary so `/a/bc` is NOT treated as inside `/a/b`.
 */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep);
}
