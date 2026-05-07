// WU-2.6 — `config init --help` text contains description, --force flag,
// resolved target path on the current platform, and one example.

import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import { describe, expect, it } from 'vitest';

import {
  HELP_DESCRIPTION,
  HELP_EXAMPLES,
  buildConfigInitHelpText,
} from '../cli/config-init.js';

describe('config init --help text', () => {
  it('contains a one-line description', () => {
    expect(HELP_DESCRIPTION).toMatch(/starter config\.yaml/i);
  });

  it('contains at least one example invocation', () => {
    expect(HELP_EXAMPLES.length).toBeGreaterThan(0);
    expect(HELP_EXAMPLES[0]).toContain('metaswarm-dashboard config init');
  });

  it('renders the target path on linux', () => {
    const env: PathsEnv = {
      platform: 'linux',
      homeDir: '/home/example',
      env: {},
    };
    const text = buildConfigInitHelpText(env);
    expect(text).toContain('Description:');
    expect(text).toContain('--force');
    expect(text).toContain('/home/example/.config/metaswarm-dashboard/config.yaml');
    expect(text).toContain('Examples:');
    expect(text).toContain('metaswarm-dashboard config init');
  });

  it('renders the target path on darwin', () => {
    const env: PathsEnv = {
      platform: 'darwin',
      homeDir: '/Users/example',
      env: {},
    };
    const text = buildConfigInitHelpText(env);
    expect(text).toContain(
      '/Users/example/Library/Application Support/metaswarm-dashboard/config.yaml',
    );
  });
});
