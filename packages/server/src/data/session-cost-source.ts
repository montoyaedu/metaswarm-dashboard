// Per-session cost-source resolver (sessions-spike WU v5-7).
//
// CRITICAL — the subagent-file merge (a v5-2 finding). Design §4.1 states a
// session's `isSidechain` subagent records "share one file" with the main
// thread. That is INACCURATE for real Claude Code: subagent records are
// written to SEPARATE `subagents/agent-*.jsonl` files NEXT TO the main
// transcript, e.g.:
//
//   ~/.claude/projects/<encoded-cwd>/
//     <sessionId>.jsonl                 ← the main thread
//     subagents/
//       agent-<id-1>.jsonl              ← one subagent's records
//       agent-<id-2>.jsonl              ← another's
//
// A session's cost MUST include its subagents (design §4.1: cost sums main
// thread AND `isSidechain` records). So `sessionCostSources(transcriptPath)`
// returns the ORDERED list of files whose `AssistantUsageRecord[]`s the
// v5-7 server concatenates before calling `computeSessionCost`: the main
// transcript first, then every sibling `subagents/agent-*.jsonl`. When no
// `subagents/` directory exists (the common case), it returns just the main
// file.
//
// READ-ONLY and path-safe: the `subagents/` directory is `lstat`'d (a
// symlink is refused, not followed); every agent-file name must pass the
// `^[A-Za-z0-9._-]+$` allow-list and carry no `..` sequence (mirroring
// `transcript-discovery.ts` §8.2 hardening). Any filesystem failure degrades
// to "just the main file" — resolution never throws.

import {
  lstatSync as nodeLstatSync,
  readdirSync as nodeReaddirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** A minimal `fs.Stats`-like shape — only the predicates resolution needs. */
interface StatsLike {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}

/**
 * Injectable filesystem hooks for `sessionCostSources`. Defaults to `node:fs`.
 * Tests point these at a temp tree so every branch is reachable.
 */
export interface SessionCostSourceFsHooks {
  /** List the entries of a directory. */
  readdirSync: (dir: string) => string[];
  /** `lstat` a path — MUST NOT follow symlinks (a symlink is refused). */
  lstatSync: (path: string) => StatsLike;
}

const DEFAULT_FS: SessionCostSourceFsHooks = {
  readdirSync: (dir) => nodeReaddirSync(dir),
  lstatSync: (path) => nodeLstatSync(path),
};

/** The sibling directory Claude Code writes subagent transcripts into. */
const SUBAGENTS_DIR = 'subagents';

/** Subagent transcripts are named `agent-<id>.jsonl`. */
const AGENT_PREFIX = 'agent-';
const JSONL_EXT = '.jsonl';

/**
 * Per-path-segment allow-list — every subagent file name must match this and
 * carry no `..` sequence (mirrors `transcript-discovery.ts`, design §8.2).
 */
const SEGMENT_ALLOWED = /^[A-Za-z0-9._-]+$/;

/**
 * Resolve a session's transcript path to the ordered list of source files
 * whose token usage feeds its cost: the main transcript first, then each
 * sibling `subagents/agent-*.jsonl` file.
 *
 * @param transcriptPath - Absolute path to the session's main `.jsonl`.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 * @returns `[transcriptPath, ...subagentFiles]`. The subagent files are
 *   sorted for a deterministic result. When no `subagents/` directory exists
 *   (or it is empty / a symlink / unreadable), returns `[transcriptPath]`.
 */
export function sessionCostSources(
  transcriptPath: string,
  fs: SessionCostSourceFsHooks = DEFAULT_FS,
): string[] {
  const sources = [transcriptPath];
  const subDir = join(dirname(transcriptPath), SUBAGENTS_DIR);

  // `lstat` (NOT `stat`): a symlinked `subagents/` is refused, never followed
  // — it could point outside the transcripts tree.
  let dirStats: StatsLike;
  try {
    dirStats = fs.lstatSync(subDir);
  } catch {
    // No `subagents/` dir (the common ~no-subagent case) → main file only.
    return sources;
  }
  if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
    return sources;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(subDir);
  } catch {
    return sources;
  }

  const agentFiles: string[] = [];
  for (const entry of entries) {
    // The entry must be a real `agent-*.jsonl` file with a safe name.
    if (!entry.startsWith(AGENT_PREFIX) || !entry.endsWith(JSONL_EXT)) {
      continue;
    }
    if (!SEGMENT_ALLOWED.test(entry) || entry.includes('..')) {
      continue;
    }
    const agentPath = join(subDir, entry);
    // `lstat` again: a symlinked agent file is refused; it must be a real file.
    let fileStats: StatsLike;
    try {
      fileStats = fs.lstatSync(agentPath);
    } catch {
      continue;
    }
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      continue;
    }
    agentFiles.push(agentPath);
  }

  // Deterministic order so callers (and tests) see a stable result.
  agentFiles.sort();
  return [...sources, ...agentFiles];
}
