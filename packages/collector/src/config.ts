// YAML config loader (per plan §2.3 / WU-2.4).
//
// Validates with Zod, expands `~` in project paths, and surfaces a
// `ConfigError` with an actionable hint pointing to `config init` on any
// failure.

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { expandHome, type PathsEnv, defaultEnv } from '@metaswarm-dashboard/types/paths';
import yaml from 'js-yaml';
import { z } from 'zod';


export const ProjectEntry = z.object({
  name: z.string().min(1, 'project name must be a non-empty string'),
  path: z.string().min(1, 'project path must be a non-empty string'),
  /**
   * Whether the project has `.beads/` (metaswarm-managed) or is just
   * a vanilla git repo surfaced for visibility. Defaults to `metaswarm`
   * for backwards-compat with configs written before this field landed.
   */
  category: z.enum(['metaswarm', 'git-only']).default('metaswarm'),
});
export type ProjectEntry = z.infer<typeof ProjectEntry>;

export const Config = z.object({
  projects: z.array(ProjectEntry).default([]),
});
export type Config = z.infer<typeof Config>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly hint: string = 'Run `metaswarm-dashboard config init` to write a starter config.',
  ) {
    super(`${message}\n  Hint: ${hint}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /** Optional override for `process.env` etc. (used in tests). */
  env?: PathsEnv;
  /** Read implementation — overridable for tests. Defaults to `fs.readFileSync`. */
  read?: (path: string) => string;
}

/**
 * Load and validate the YAML config file at the given path. Project paths
 * are expanded (`~/foo` → absolute). Relative-path project entries are
 * rejected — operators must be explicit.
 */
export function loadConfig(path: string, opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? defaultEnv();
  const read = opts.read ?? ((p: string) => readFileSync(p, 'utf8'));

  let raw: string;
  try {
    raw = read(path);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new ConfigError(`Config file not found at ${path}.`);
    }
    throw new ConfigError(`Could not read config file at ${path}: ${error.message}`);
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    const error = err as Error;
    throw new ConfigError(`Invalid YAML in ${path}: ${error.message}`);
  }

  if (parsed === null || parsed === undefined) {
    parsed = { projects: [] };
  }

  const result = Config.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Config validation failed for ${path}:\n${issues}`);
  }

  // Expand `~` and reject relative project paths.
  const expanded: ProjectEntry[] = result.data.projects.map((p) => {
    const resolved = expandHome(p.path, env.homeDir);
    if (!isAbsolute(resolved)) {
      throw new ConfigError(
        `Project '${p.name}' has a relative path '${p.path}'. Project paths must be absolute (or start with '~').`,
      );
    }
    return { name: p.name, path: resolved, category: p.category };
  });

  return { projects: expanded };
}
