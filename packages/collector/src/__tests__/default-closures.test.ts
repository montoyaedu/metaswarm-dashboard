// Coverage gap closure: default-arg closures (defaultEnv, defaultHooks)
// that callers normally override. Calling them once gives v8 a hit.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runConfigInit } from '../cli/config-init.js';
import { ConfigError, loadConfig } from '../config.js';
import { defaultEnv } from '../paths.js';

describe('paths.defaultEnv', () => {
  it('returns the runtime platform/homeDir/env', () => {
    const env = defaultEnv();
    expect(env.platform).toBe(process.platform);
    expect(typeof env.homeDir).toBe('string');
    expect(env.homeDir.length).toBeGreaterThan(0);
    expect(env.env).toBe(process.env);
  });
});

describe('config.loadConfig with default read-fn', () => {
  it('throws ConfigError on missing file using default fs.readFileSync', () => {
    expect(() => loadConfig('/no-such-config-on-this-system.yaml')).toThrow(ConfigError);
  });
});

describe('config-init.runConfigInit with default fs hooks', () => {
  it('uses real fs by default and writes to a temp HOME via env override', () => {
    // Cover the `opts.fs ?? { existsSync, mkdirSync, writeFileSync }` and
    // `opts.env ?? defaultEnv()` default-arg branches. We need to call
    // runConfigInit() with NEITHER fs nor env explicitly set. To avoid
    // polluting the operator's HOME, we override HOME via the env-var
    // mechanism that `defaultEnv()` reads.
    const tmp = mkdtempSync(join(tmpdir(), 'config-init-defaults-'));
    const savedConfig = process.env.METASWARM_DASHBOARD_CONFIG;
    const targetCfg = join(tmp, 'config.yaml');
    process.env.METASWARM_DASHBOARD_CONFIG = targetCfg;
    try {
      const result = runConfigInit();
      expect(result.written).toBe(true);
      expect(result.path).toBe(targetCfg);
    } finally {
      if (savedConfig === undefined) delete process.env.METASWARM_DASHBOARD_CONFIG;
      else process.env.METASWARM_DASHBOARD_CONFIG = savedConfig;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
