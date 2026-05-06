// WU-2.5 — config init writes starter YAML, refuses overwrite without
// --force, creates parent dirs. Uses fs hooks so tests stay hermetic.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runConfigInit } from '../cli/config-init.js';
import type { PathsEnv } from '../paths.js';

let TMP_HOME: string;

beforeEach(() => {
  TMP_HOME = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-init-'));
});

afterEach(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

function env(): PathsEnv {
  return { platform: 'linux', homeDir: TMP_HOME, env: {} };
}

describe('runConfigInit', () => {
  it('writes a starter YAML at the XDG-aware location', () => {
    const result = runConfigInit({ env: env() });
    expect(result.written).toBe(true);
    expect(result.path).toBe(join(TMP_HOME, '.config', 'metaswarm-dashboard', 'config.yaml'));

    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('# metaswarm-dashboard config');
    expect(content).toContain('projects: []');
    expect(content).toContain('Example (uncomment + edit):');
  });

  it('creates parent dirs if missing', () => {
    const result = runConfigInit({ env: env() });
    expect(result.written).toBe(true);
    // Read should succeed if the dir was created.
    expect(() => readFileSync(result.path, 'utf8')).not.toThrow();
  });

  it('refuses to overwrite an existing config without --force', () => {
    // Pre-populate.
    const target = join(TMP_HOME, '.config', 'metaswarm-dashboard', 'config.yaml');
    mkdirSync(join(TMP_HOME, '.config', 'metaswarm-dashboard'), { recursive: true });
    writeFileSync(target, '# pre-existing\n', 'utf8');

    const result = runConfigInit({ env: env() });
    expect(result.written).toBe(false);
    expect(result.reason).toBe('already-exists');
    expect(readFileSync(target, 'utf8')).toBe('# pre-existing\n');
  });

  it('overwrites with --force', () => {
    const target = join(TMP_HOME, '.config', 'metaswarm-dashboard', 'config.yaml');
    mkdirSync(join(TMP_HOME, '.config', 'metaswarm-dashboard'), { recursive: true });
    writeFileSync(target, '# pre-existing\n', 'utf8');

    const result = runConfigInit({ env: env(), force: true });
    expect(result.written).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('# metaswarm-dashboard config');
  });
});
