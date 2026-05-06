// `metaswarm-dashboard serve` CLI (per WU-4.{7,12,17,18}).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildServer } from '../server.js';

const DEFAULT_PORT = 5174;
const DEFAULT_HOST = '127.0.0.1';

export const HELP_DESCRIPTION =
  'Start the local Fastify server on port 5174 (default) and serve the SPA';

export const HELP_EXAMPLES = [
  'metaswarm-dashboard serve',
  'metaswarm-dashboard serve --port 8080',
];

export function buildServeHelpText(): string {
  return [
    `Description: ${HELP_DESCRIPTION}`,
    '',
    'Options:',
    `  --port <port>      port number (default ${DEFAULT_PORT})`,
    '',
    'Environment:',
    '  METASWARM_DASHBOARD_DATA_DIR    override the snapshots data dir',
    '  METASWARM_DASHBOARD_CONFIG      override the config.yaml path',
    '',
    'Examples:',
    ...HELP_EXAMPLES.map((e) => `  ${e}`),
  ].join('\n');
}

export interface RunServeOptions {
  port?: number;
  /** Test injection. */
  dataDir?: string;
  staticRoot?: string;
  configPath?: string;
  /** Test injection: override existsSync. */
  fs?: { existsSync: typeof existsSync };
  stderr?: (line: string) => void;
  /** Test injection: skip the actual `listen()` call. */
  skipListen?: boolean;
}

export interface RunServeResult {
  exitCode: number;
}

export async function runServe(opts: RunServeOptions = {}): Promise<RunServeResult> {
  const stderr = opts.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const fs = opts.fs ?? { existsSync };

  const port = opts.port ?? DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
    stderr(`metaswarm-dashboard serve: invalid --port value: ${String(opts.port)}`);
    return { exitCode: 1 };
  }

  // Plan §4.1 / WU-4.12: refuse to start if config is missing/invalid.
  // (We don't actually parse the YAML here — collector did that. We just
  // check the file exists. Server doesn't need projects.yaml at runtime; it
  // reads the data dir written by `collect`. But the spec says fail fast on
  // missing config because that's the operator-visible signal that the
  // dashboard isn't usable yet.)
  const configPath = opts.configPath ?? process.env.METASWARM_DASHBOARD_CONFIG;
  if (configPath !== undefined && configPath !== '' && !fs.existsSync(configPath)) {
    stderr(
      `metaswarm-dashboard serve: config file not found at ${configPath}.\n` +
        '  Run `metaswarm-dashboard config init` to write a starter config.',
    );
    return { exitCode: 1 };
  }

  const dataDir =
    opts.dataDir ??
    process.env.METASWARM_DASHBOARD_DATA_DIR ??
    resolve(process.cwd(), '.metaswarm-dashboard-data');
  const staticRoot = opts.staticRoot ?? resolve(process.cwd(), 'packages/web/dist');

  const app = await buildServer({ dataDir, staticRoot });

  if (opts.skipListen) return { exitCode: 0 };

  await app.listen({ port, host: DEFAULT_HOST });
  return { exitCode: 0 };
}
