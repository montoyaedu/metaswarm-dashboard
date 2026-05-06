// WU-2.4 — YAML loader: parse, expand `~`, validate, reject relative paths,
// surface ConfigError with hint pointing to `config init`.

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../config.js';
import type { PathsEnv } from '../paths.js';

const HOME = '/home/test';

function env(): PathsEnv {
  return { platform: 'linux', homeDir: HOME, env: {} };
}

function loaderWith(yaml: string) {
  return (path: string): string => {
    if (path === '/cfg.yaml') return yaml;
    const err = new Error(`unexpected read: ${path}`);
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    throw err;
  };
}

describe('loadConfig', () => {
  it('loads an empty (valid) config and defaults projects to []', () => {
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith('') });
    expect(cfg.projects).toEqual([]);
  });

  it('parses a project entry and expands ~', () => {
    const yaml = `projects:\n  - name: foo\n    path: ~/code/foo\n`;
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) });
    expect(cfg.projects).toEqual([{ name: 'foo', path: '/home/test/code/foo' }]);
  });

  it('preserves absolute paths unchanged', () => {
    const yaml = `projects:\n  - name: bar\n    path: /opt/bar\n`;
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) });
    expect(cfg.projects).toEqual([{ name: 'bar', path: '/opt/bar' }]);
  });

  it('rejects relative project paths', () => {
    const yaml = `projects:\n  - name: rel\n    path: code/rel\n`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(/relative path/);
  });

  it('throws ConfigError with hint when file is missing', () => {
    const read = (): string => {
      const err = new Error('not found');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    };
    let caught: ConfigError | undefined;
    try {
      loadConfig('/missing.yaml', { env: env(), read });
    } catch (err) {
      caught = err as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.message).toContain('config init');
  });

  it('throws ConfigError on read errors that are not ENOENT', () => {
    const read = (): string => {
      const err = new Error('eperm');
      (err as NodeJS.ErrnoException).code = 'EACCES';
      throw err;
    };
    expect(() => loadConfig('/no.yaml', { env: env(), read })).toThrow(ConfigError);
  });

  it('throws ConfigError on invalid YAML syntax', () => {
    const yaml = `projects: [unclosed`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when a project entry is missing the path key', () => {
    const yaml = `projects:\n  - name: only-name\n`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when projects is not an array', () => {
    const yaml = `projects: nope`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when root is a non-object scalar (covers "(root)" branch)', () => {
    const yaml = `42`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when a project name is empty', () => {
    const yaml = `projects:\n  - name: ""\n    path: /opt\n`;
    expect(() =>
      loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) }),
    ).toThrow(ConfigError);
  });
});
