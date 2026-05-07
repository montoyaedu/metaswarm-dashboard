// `metaswarm-dashboard config init` (per plan WU-2.5–6).
//
// Writes a starter config.yaml at the XDG-aware location. Refuses to
// overwrite without `--force`. Creates parent dirs.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { configFile, type PathsEnv, defaultEnv } from '@metaswarm-dashboard/types/paths';

export interface ConfigInitOptions {
  /** Overwrite an existing config.yaml. */
  force?: boolean;
  /** Optional env override (used in tests). */
  env?: PathsEnv;
  /** Filesystem hooks (used in tests). */
  fs?: {
    existsSync: typeof existsSync;
    mkdirSync: typeof mkdirSync;
    writeFileSync: typeof writeFileSync;
  };
}

export interface ConfigInitResult {
  path: string;
  written: boolean;
  reason?: 'already-exists';
}

/**
 * Description used by the dispatcher's `--help` and asserted by the
 * `config-init-help` test (per WU-2.6).
 */
export const HELP_DESCRIPTION = 'Write a starter config.yaml at the XDG-aware location';

/** Example invocations shown in `--help`. */
export const HELP_EXAMPLES = [
  'metaswarm-dashboard config init',
  'metaswarm-dashboard config init --force',
];

/** Compose a fresh `--help` text fragment for the subcommand. */
export function buildConfigInitHelpText(env: PathsEnv = defaultEnv()): string {
  const target = configFile(env);
  return [
    `Description: ${HELP_DESCRIPTION}`,
    '',
    'Options:',
    '  --force    Overwrite an existing config.yaml (default: false)',
    '',
    `Target on this platform: ${target}`,
    '',
    'Examples:',
    ...HELP_EXAMPLES.map((e) => `  ${e}`),
  ].join('\n');
}

// IMPORTANT: the starter uses `projects:` (open list) rather than
// `projects: []` (closed empty array). With `[]` the array is "closed" in
// YAML and any items added below at indented `- name: …` would actually
// land at the document root, NOT inside `projects:` — silently parsed as
// `projects: []` again. Keeping `projects:` open lets a manual editor (or
// `start.sh`'s discovery append) add items directly without touching this
// line. The loader (config.ts) treats a missing/null projects key as
// `[]` via Zod's `.default([])`.
const STARTER_YAML = `# metaswarm-dashboard config
#
# Each entry under \`projects\` declares a metaswarm-managed project to
# collect from. The dashboard NEVER writes to these paths; it only reads
# the project's \`.beads/\` directory and runs \`bd list --json\`.
#
# Paths must be absolute (or use \`~/\` for your home directory).
#
# Example (uncomment + edit):
# projects:
#   - name: foo
#     path: ~/code/foo
#   - name: bar
#     path: /Users/you/work/bar

projects:
`;

export function runConfigInit(opts: ConfigInitOptions = {}): ConfigInitResult {
  const env = opts.env ?? defaultEnv();
  const fsHooks = opts.fs ?? { existsSync, mkdirSync, writeFileSync };
  const target = configFile(env);

  if (fsHooks.existsSync(target) && !opts.force) {
    process.stderr.write(
      `metaswarm-dashboard config init: ${target} already exists. Use --force to overwrite.\n`,
    );
    return { path: target, written: false, reason: 'already-exists' };
  }

  fsHooks.mkdirSync(dirname(target), { recursive: true });
  fsHooks.writeFileSync(target, STARTER_YAML, 'utf8');
  process.stdout.write(`metaswarm-dashboard config init: wrote ${target}\n`);
  return { path: target, written: true };
}
