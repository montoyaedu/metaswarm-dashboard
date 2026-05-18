// sessions-spike WU v4-2 (plan §v4-2) — the YAML config loader lifted from
// `packages/collector/src/config.ts` into `@metaswarm-dashboard/types`.
//
// These tests exercise the types-package copy (`../config.js`) so the lifted
// `config.ts` is covered by the types project's own run. They mirror the
// branch coverage of the original collector config tests, which stay in place
// and pass unchanged against the thin re-export.

import { describe, expect, it } from 'vitest';

import { Config, ConfigError, type LoadConfigOptions, ProjectEntry, loadConfig } from '../config.js';
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
    expect(cfg.projects).toEqual([
      { name: 'foo', path: '/home/test/code/foo', category: 'metaswarm' },
    ]);
  });

  it('preserves absolute paths unchanged', () => {
    const yaml = `projects:\n  - name: bar\n    path: /opt/bar\n`;
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) });
    expect(cfg.projects).toEqual([{ name: 'bar', path: '/opt/bar', category: 'metaswarm' }]);
  });

  it('honors explicit category: git-only on a project entry', () => {
    const yaml = `projects:\n  - name: vanilla\n    path: /opt/vanilla\n    category: git-only\n`;
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith(yaml) });
    expect(cfg.projects).toEqual([
      { name: 'vanilla', path: '/opt/vanilla', category: 'git-only' },
    ]);
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

  it('treats a null YAML document as an empty config (covers null/undefined branch)', () => {
    // An all-comments file parses to `null`; the loader normalizes it.
    const cfg = loadConfig('/cfg.yaml', { env: env(), read: loaderWith('# only a comment\n') });
    expect(cfg.projects).toEqual([]);
  });

  it('falls back to defaultEnv() when no env override is given', () => {
    // Exercises the `opts.env ?? defaultEnv()` branch — a real `~` expansion
    // resolves against the live home dir, so we only assert it does not throw.
    expect(() => loadConfig('/cfg.yaml', { read: loaderWith('') })).not.toThrow();
  });

  it('uses fs.readFileSync by default when no read override is given', () => {
    // Exercises the `opts.read ?? fs.readFileSync` branch — reading a path
    // that does not exist surfaces a ConfigError (ENOENT -> "not found").
    expect(() =>
      loadConfig('/definitely/missing/metaswarm-dashboard-config.yaml', { env: env() }),
    ).toThrow(ConfigError);
  });
});

describe('config schemas and types', () => {
  it('re-exports the ProjectEntry Zod schema with a category default', () => {
    const parsed = ProjectEntry.parse({ name: 'p', path: '/abs' });
    expect(parsed.category).toBe('metaswarm');
  });

  it('re-exports the Config Zod schema that defaults projects to []', () => {
    expect(Config.parse({}).projects).toEqual([]);
  });

  it('exposes LoadConfigOptions as an assignable type', () => {
    const opts: LoadConfigOptions = { env: env() };
    expect(opts.env?.homeDir).toBe(HOME);
  });

  it('ConfigError carries the default hint pointing at `config init`', () => {
    const err = new ConfigError('boom');
    expect(err.name).toBe('ConfigError');
    expect(err.hint).toContain('config init');
  });

  it('ConfigError accepts a custom hint', () => {
    const err = new ConfigError('boom', 'do the thing');
    expect(err.message).toContain('do the thing');
  });
});
