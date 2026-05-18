// Tests for `resolveSessionsOptions` (sessions-spike WU v4-5). The function
// resolves the v4-5 sessions inputs from a `PathsEnv`: the config via
// `loadConfig` (consumed through `@metaswarm-dashboard/types/config`, never a
// collector deep-import), and the transcripts dir + datalake via
// `@metaswarm-dashboard/types/paths`. The `env` parameter is injectable so
// both branches — config found, config missing — are deterministic here.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveSessionsOptions } from '../server.js';

let TMP: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-resolve-opts-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * Build a `PathsEnv` whose env vars point the config / data / transcripts
 * resolvers at deterministic temp locations.
 */
function envOf(overrides: Record<string, string>): PathsEnv {
  return {
    platform: 'linux',
    homeDir: TMP,
    env: overrides,
  };
}

describe('resolveSessionsOptions', () => {
  it('loads the configured projects when the config file exists', () => {
    const configPath = join(TMP, 'config.yaml');
    const repoPath = join(TMP, 'repos', 'alpha');
    writeFileSync(
      configPath,
      `projects:\n  - name: alpha\n    path: ${repoPath}\n`,
      'utf8',
    );

    const result = resolveSessionsOptions(
      envOf({
        METASWARM_DASHBOARD_CONFIG: configPath,
        METASWARM_DASHBOARD_DATA_DIR: join(TMP, 'data'),
        METASWARM_DASHBOARD_TRANSCRIPTS_DIR: join(TMP, 'transcripts'),
      }),
    );

    expect(result.config.projects).toHaveLength(1);
    expect(result.config.projects[0]).toMatchObject({ name: 'alpha', path: repoPath });
    expect(result.transcriptsDir).toBe(join(TMP, 'transcripts'));
    expect(result.dataDir).toBe(join(TMP, 'data'));
  });

  it('degrades to an empty project list when the config file is missing', () => {
    const result = resolveSessionsOptions(
      envOf({
        METASWARM_DASHBOARD_CONFIG: join(TMP, 'does-not-exist.yaml'),
        METASWARM_DASHBOARD_DATA_DIR: join(TMP, 'data'),
        METASWARM_DASHBOARD_TRANSCRIPTS_DIR: join(TMP, 'transcripts'),
      }),
    );

    expect(result.config.projects).toEqual([]);
    expect(result.transcriptsDir).toBe(join(TMP, 'transcripts'));
  });

  it('degrades to an empty project list when the config YAML is invalid', () => {
    const configPath = join(TMP, 'bad.yaml');
    mkdirSync(TMP, { recursive: true });
    writeFileSync(configPath, 'projects:\n  - name:\n', 'utf8');

    const result = resolveSessionsOptions(
      envOf({
        METASWARM_DASHBOARD_CONFIG: configPath,
        METASWARM_DASHBOARD_DATA_DIR: join(TMP, 'data'),
        METASWARM_DASHBOARD_TRANSCRIPTS_DIR: join(TMP, 'transcripts'),
      }),
    );

    expect(result.config.projects).toEqual([]);
  });
});
