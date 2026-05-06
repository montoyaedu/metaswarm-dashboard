// WU-6.{6,7,8} — dispatcher smoke (top-level + per-subcommand) via spawn.
//
// Spec note: WU-6 validation_commands run `npm run build` before this test,
// so dist/ artifacts exist. The test asserts that bin/metaswarm-dashboard
// resolves the workspace subpath imports correctly AND that commander
// registers the subcommand help text reachable via the dispatcher.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const DISPATCHER = resolve(REPO_ROOT, 'bin/metaswarm-dashboard');

function distArtefactsExist(): boolean {
  return (
    existsSync(resolve(REPO_ROOT, 'packages/collector/dist/cli/collect.js')) &&
    existsSync(resolve(REPO_ROOT, 'packages/collector/dist/cli/config-init.js')) &&
    existsSync(resolve(REPO_ROOT, 'packages/server/dist/cli/serve.js'))
  );
}

describe('CLI dispatcher smoke (WU-6.6, WU-6.7)', () => {
  it.skipIf(!distArtefactsExist())(
    'top-level --help exits 0 and lists the three subcommands',
    async () => {
      const { stdout } = await execFileAsync('node', [DISPATCHER, '--help']);
      expect(stdout).toContain('collect');
      expect(stdout).toContain('serve');
      expect(stdout).toContain('config');
    },
  );

  it.skipIf(!distArtefactsExist())(
    'collect --help exits 0 and references --project / --all',
    async () => {
      const { stdout } = await execFileAsync('node', [DISPATCHER, 'collect', '--help']);
      expect(stdout).toContain('--project');
      expect(stdout).toContain('--all');
    },
  );

  it.skipIf(!distArtefactsExist())(
    'serve --help exits 0 and references --port',
    async () => {
      const { stdout } = await execFileAsync('node', [DISPATCHER, 'serve', '--help']);
      expect(stdout).toContain('--port');
      expect(stdout).toContain('5174');
    },
  );

  it.skipIf(!distArtefactsExist())(
    'config init --help exits 0 and references --force',
    async () => {
      const { stdout } = await execFileAsync('node', [
        DISPATCHER,
        'config',
        'init',
        '--help',
      ]);
      expect(stdout).toContain('--force');
    },
  );
});
