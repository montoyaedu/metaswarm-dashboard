// WU-2.1, WU-2.2, WU-2.3 — paths resolution + ~ expansion + XDG override.

import { describe, expect, it } from 'vitest';

import {
  PathExpansionError,
  configFile,
  dataDir,
  expandHome,
  type PathsEnv,
} from '../paths.js';

const HOME = '/home/test';

function env(
  platform: NodeJS.Platform,
  envVars: Record<string, string | undefined> = {},
): PathsEnv {
  return { platform, homeDir: HOME, env: envVars };
}

describe('paths.dataDir', () => {
  it('darwin: defaults to ~/Library/Application Support/metaswarm-dashboard', () => {
    expect(dataDir(env('darwin'))).toBe(
      '/home/test/Library/Application Support/metaswarm-dashboard',
    );
  });

  it('linux: defaults to ~/.local/share/metaswarm-dashboard', () => {
    expect(dataDir(env('linux'))).toBe('/home/test/.local/share/metaswarm-dashboard');
  });

  it('linux: honors XDG_DATA_HOME', () => {
    expect(dataDir(env('linux', { XDG_DATA_HOME: '/tmp/xdg-data' }))).toBe(
      '/tmp/xdg-data/metaswarm-dashboard',
    );
  });

  it('linux: ignores empty-string XDG_DATA_HOME', () => {
    expect(dataDir(env('linux', { XDG_DATA_HOME: '' }))).toBe(
      '/home/test/.local/share/metaswarm-dashboard',
    );
  });

  it('METASWARM_DASHBOARD_DATA_DIR override wins on every platform', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        dataDir(env(platform, { METASWARM_DASHBOARD_DATA_DIR: '/custom/dir' })),
      ).toBe('/custom/dir');
    }
  });

  it('override expands ~ via the home dir', () => {
    expect(
      dataDir(env('linux', { METASWARM_DASHBOARD_DATA_DIR: '~/custom' })),
    ).toBe('/home/test/custom');
  });

  it('falls through to linux behavior on other platforms', () => {
    // freebsd is a node-supported platform.
    expect(dataDir(env('freebsd'))).toBe('/home/test/.local/share/metaswarm-dashboard');
  });
});

describe('paths.configFile', () => {
  it('darwin: defaults to the same Application Support dir as dataDir', () => {
    expect(configFile(env('darwin'))).toBe(
      '/home/test/Library/Application Support/metaswarm-dashboard/config.yaml',
    );
  });

  it('linux: defaults to ~/.config/metaswarm-dashboard/config.yaml', () => {
    expect(configFile(env('linux'))).toBe(
      '/home/test/.config/metaswarm-dashboard/config.yaml',
    );
  });

  it('linux: honors XDG_CONFIG_HOME', () => {
    expect(
      configFile(env('linux', { XDG_CONFIG_HOME: '/tmp/xdg-cfg' })),
    ).toBe('/tmp/xdg-cfg/metaswarm-dashboard/config.yaml');
  });

  it('METASWARM_DASHBOARD_CONFIG override wins on every platform', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(
        configFile(
          env(platform, { METASWARM_DASHBOARD_CONFIG: '/custom/path/config.yaml' }),
        ),
      ).toBe('/custom/path/config.yaml');
    }
  });
});

describe('paths.expandHome', () => {
  it('exact "~" returns the home dir', () => {
    expect(expandHome('~', '/h')).toBe('/h');
  });

  it('"~/foo" expands to <home>/foo', () => {
    expect(expandHome('~/foo', '/h')).toBe('/h/foo');
  });

  it('"~/foo/bar" expands to <home>/foo/bar', () => {
    expect(expandHome('~/foo/bar', '/h')).toBe('/h/foo/bar');
  });

  it('absolute paths pass through unchanged', () => {
    expect(expandHome('/absolute/path', '/h')).toBe('/absolute/path');
  });

  it('relative paths pass through unchanged (caller decides if rejection is required)', () => {
    expect(expandHome('relative/path', '/h')).toBe('relative/path');
  });

  it('"~user" (other-user expansion) is rejected', () => {
    expect(() => expandHome('~alice', '/h')).toThrow(PathExpansionError);
    expect(() => expandHome('~alice/foo', '/h')).toThrow(PathExpansionError);
  });
});
