// Reads `.beads/` JSONL + `bd list --json` for a host project.
// Per plan WU-3.{5,6,7,14,15}: empty/malformed/missing handled gracefully;
// `bd` invoked via `execFile` (no shell) with 30s timeout.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { BeadsTaskRow } from './metrics.js';

const BD_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

export interface BeadsReadResult {
  /** Tasks parsed from `bd list --json` and any `.beads/issues.jsonl` files. */
  rows: BeadsTaskRow[];
  /** True when no `.beads/` dir was found (project is skipped, not an error). */
  skipped: boolean;
  /** Operator-readable reason for `skipped`. */
  skipReason?: string;
  /** Diagnostic warnings (malformed JSONL rows, etc.). Never thrown. */
  warnings: string[];
}

export interface BeadsExecutor {
  (command: 'bd', args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string }>;
}

const defaultExecutor: BeadsExecutor = async (command, args, cwd, timeoutMs) => {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout };
};

export interface ReadHostBeadsOptions {
  /** Override for the `bd` invocation (used in tests). */
  execute?: BeadsExecutor;
  /** Override for the filesystem (used in tests). */
  fs?: {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
  };
}

/**
 * Read BEADS state from a host project, returning a flat list of task rows
 * and any non-fatal diagnostics. NEVER throws on bad data — malformed rows
 * are skipped with a warning.
 *
 * The function does NOT mutate `projectPath`. Zero-footprint is enforced by
 * the caller (the writer writes elsewhere).
 */
export async function readHostBeads(
  projectPath: string,
  opts: ReadHostBeadsOptions = {},
): Promise<BeadsReadResult> {
  const fsHooks = opts.fs ?? { existsSync, readFileSync };
  const executor = opts.execute ?? defaultExecutor;

  if (!fsHooks.existsSync(projectPath)) {
    return {
      rows: [],
      skipped: true,
      skipReason: `project path does not exist: ${projectPath}`,
      warnings: [],
    };
  }

  const beadsDir = join(projectPath, '.beads');
  if (!fsHooks.existsSync(beadsDir)) {
    return {
      rows: [],
      skipped: true,
      skipReason: `no .beads/ directory at ${projectPath}`,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const rows: BeadsTaskRow[] = [];

  // Step 1: parse `.beads/issues.jsonl` if present (line-by-line).
  const issuesJsonl = join(beadsDir, 'issues.jsonl');
  if (fsHooks.existsSync(issuesJsonl)) {
    let raw = '';
    try {
      raw = fsHooks.readFileSync(issuesJsonl, 'utf8');
    } catch (err) {
      const error = err as Error;
      warnings.push(`failed to read ${issuesJsonl}: ${error.message}`);
    }
    const lines = raw.split(/\r?\n/);
    for (const [idx, line] of lines.entries()) {
      if (line.trim() === '') continue;
      try {
        const parsed = JSON.parse(line) as Partial<BeadsTaskRow>;
        if (typeof parsed.id === 'string' && typeof parsed.status === 'string') {
          rows.push(parsed as BeadsTaskRow);
        } else {
          warnings.push(`malformed JSONL row at ${issuesJsonl}:${idx + 1} — missing id or status`);
        }
      } catch {
        warnings.push(`malformed JSONL row at ${issuesJsonl}:${idx + 1} — not valid JSON`);
      }
    }
  }

  // Step 2: invoke `bd list --json` for the freshest state.
  try {
    const { stdout } = await executor(
      'bd',
      ['list', '--json'],
      projectPath,
      BD_TIMEOUT_MS,
    );
    if (stdout.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (Array.isArray(parsed)) {
          for (const row of parsed as unknown[]) {
            if (
              row !== null &&
              typeof row === 'object' &&
              'id' in row &&
              'status' in row &&
              typeof (row as { id: unknown }).id === 'string' &&
              typeof (row as { status: unknown }).status === 'string'
            ) {
              rows.push(row as BeadsTaskRow);
            } else {
              warnings.push('bd list --json: malformed row skipped');
            }
          }
        } else {
          warnings.push('bd list --json: expected an array, got something else');
        }
      } catch {
        warnings.push('bd list --json: stdout is not valid JSON');
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { code?: string };
    if (error.code === 'ENOENT') {
      warnings.push(
        '`bd` binary not found on PATH. See README "Prerequisites" for installation. ' +
          'Continuing with .beads/issues.jsonl only.',
      );
    } else {
      warnings.push(`bd list --json failed: ${error.message ?? String(err)}`);
    }
  }

  return { rows, skipped: false, warnings };
}
