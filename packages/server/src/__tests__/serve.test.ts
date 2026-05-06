// WU-4.{7,12,17} — `serve` CLI: port validation, fail-fast on missing config, --help text.

import { describe, expect, it } from 'vitest';

import {
  HELP_DESCRIPTION,
  HELP_EXAMPLES,
  buildServeHelpText,
  runServe,
} from '../cli/serve.js';

describe('serve --help text', () => {
  it('description references the default port', () => {
    expect(HELP_DESCRIPTION).toMatch(/5174/);
  });

  it('examples include the bare invocation and a --port form', () => {
    expect(HELP_EXAMPLES.some((e) => e.endsWith('serve'))).toBe(true);
    expect(HELP_EXAMPLES.some((e) => e.includes('--port'))).toBe(true);
  });

  it('rendered help contains description, --port flag, env section, examples', () => {
    const text = buildServeHelpText();
    expect(text).toContain('Description:');
    expect(text).toContain('--port <port>');
    expect(text).toContain('5174');
    expect(text).toContain('METASWARM_DASHBOARD_DATA_DIR');
    expect(text).toContain('Examples:');
  });
});

describe('runServe — fail-fast paths', () => {
  it('rejects an invalid --port value', async () => {
    const errs: string[] = [];
    const result = await runServe({
      port: -1,
      stderr: (l) => errs.push(l),
      skipListen: true,
    });
    expect(result.exitCode).toBe(1);
    expect(errs[0]).toContain('invalid --port');
  });

  it('exits non-zero with config-init hint when configPath is missing', async () => {
    const errs: string[] = [];
    const result = await runServe({
      configPath: '/nonexistent/config.yaml',
      stderr: (l) => errs.push(l),
      skipListen: true,
    });
    expect(result.exitCode).toBe(1);
    expect(errs.some((e) => e.includes('config init'))).toBe(true);
  });

  it('exits 0 when config is fine and skipListen is true', async () => {
    const result = await runServe({
      port: 8080,
      dataDir: '/tmp/whatever',
      staticRoot: '/tmp/whatever',
      skipListen: true,
      stderr: () => undefined,
    });
    expect(result.exitCode).toBe(0);
  });
});
