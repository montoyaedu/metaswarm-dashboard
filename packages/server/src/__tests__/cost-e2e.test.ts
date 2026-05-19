// End-to-end integration test for the v5 AI-cost feature (sessions-spike WU
// v5-10 / design §12). This is the only cost test that exercises the REAL
// wiring — NO stubbed `sessions` or `cost` deps:
//
//   - a real `config.yaml` on disk, loaded by the real `loadConfig`;
//   - a real transcripts dir holding a real Claude Code `.jsonl` carrying
//     `message.usage` (the v5-2 usage parser runs);
//   - a real `~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl` tree (the v5-3
//     hardened Codex walk runs);
//   - a real metaswarm `external-tools.jsonl` ledger (the v5-4 Gemini
//     allow-list reader runs);
//   - real `discoverSessions` / `parseTranscriptUsage` / `computeSessionCost`
//     / `discoverCodexRuns` / `discoverGeminiRuns` / `aggregateProjectCost`.
//
// The server is built via `resolveSessionsOptions` + `resolveCostOptions`
// driven by a real `PathsEnv` whose env vars re-point the config /
// transcripts / Codex / ledger resolvers at deterministic temp locations —
// exactly the path a production `serve` run takes, only re-pointed away from
// `~/.claude/`, `~/.codex/`, and the real home datalake. `process.env` is
// never touched.
//
// What the round-trip proves (design §12): one Claude session's cost, one
// Codex run's cost, and one Gemini run's cost all flow from real files
// through the readers + the §5 aggregation to the §7 API response shapes —
// the Claude + Codex cost attributed to the project by cwd, the cwd-less
// Gemini cost landing in the §7 `unattributed` bucket (design §4.4).

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { encodeTranscriptDirName } from '@metaswarm-dashboard/sessions';
import { ProjectCostSummary, SessionCost } from '@metaswarm-dashboard/types/cost';
import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, resolveCostOptions, resolveSessionsOptions } from '../server.js';

/** The SPA build stub the server's static plugin serves. */
const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');

/** The test project's name + a deterministic server clock. */
const PROJECT_NAME = 'sample-widget-service';
const SESSION_ID = 'sess-cost-e2e-2026-05-18';
const NOW = new Date('2026-05-18T12:00:00.000Z');

let TMP: string;
let HOME: string;
let TRANSCRIPTS: string;
let DATALAKE: string;
let CODEX_DIR: string;
let LEDGER: string;
let CONFIG_PATH: string;
let PROJECT_PATH: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-cost-e2e-'));
  HOME = join(TMP, 'home');
  TRANSCRIPTS = join(TMP, 'transcripts');
  DATALAKE = join(TMP, 'datalake');
  CODEX_DIR = join(TMP, 'codex-sessions');
  LEDGER = join(TMP, 'external-tools.jsonl');
  PROJECT_PATH = join(TMP, 'repos', PROJECT_NAME);
  CONFIG_PATH = join(TMP, 'config.yaml');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(DATALAKE, { recursive: true });
  mkdirSync(PROJECT_PATH, { recursive: true });

  // (1) A real Claude Code transcript under `<encoded-cwd>/<sessionId>.jsonl`.
  // One assistant record bills `claude-opus-4-7` ($15/M in, $75/M out) with
  // 1M input + 1M output tokens → $90.
  const encodedDir = join(TRANSCRIPTS, encodeTranscriptDirName(PROJECT_PATH));
  mkdirSync(encodedDir, { recursive: true });
  const transcriptLines = [
    JSON.stringify({
      type: 'user',
      uuid: 'u-0',
      timestamp: '2026-05-18T00:00:00.000Z',
      sessionId: SESSION_ID,
      cwd: PROJECT_PATH,
      message: { role: 'user', content: 'do the thing' },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a-1',
      timestamp: '2026-05-18T00:30:00.000Z',
      sessionId: SESSION_ID,
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
        content: [{ type: 'text', text: 'done' }],
      },
    }),
  ];
  writeFileSync(
    join(encodedDir, `${SESSION_ID}.jsonl`),
    `${transcriptLines.join('\n')}\n`,
    'utf8',
  );

  // (2) A real Codex rollout under `<CODEX_DIR>/<Y>/<M>/<D>/`. Its `cwd`
  // matches the configured project so it is attributed to it. `gpt-5.5`
  // ($1.25/M in) with 1M input tokens → $1.25.
  const codexDay = join(CODEX_DIR, '2026', '05', '18');
  mkdirSync(codexDay, { recursive: true });
  const codexLines = [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-05-18T10:00:00.000Z',
      payload: { cwd: PROJECT_PATH },
    }),
    JSON.stringify({
      type: 'turn_context',
      timestamp: '2026-05-18T10:00:01.000Z',
      payload: { model: 'gpt-5.5' },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-05-18T10:00:02.000Z',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
          },
        },
      },
    }),
  ];
  writeFileSync(
    join(codexDay, 'rollout-2026-05-18T10-00-00-abc.jsonl'),
    `${codexLines.join('\n')}\n`,
    'utf8',
  );

  // (3) A real metaswarm external-tools ledger. The reader keeps only
  // `tool == "gemini"` entries; the codex entry is structurally ignored.
  // `gemini-3-pro` ($2/M in, $12/M out) with 1M input + 1M output → $14.
  const ledgerLines = [
    JSON.stringify({
      schema_version: '1',
      tool: 'gemini',
      model: 'gemini-3-pro',
      cost: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      timestamp: '2026-05-18T11:00:00Z',
      git_sha: 'deadbeef',
      command: 'gemini -p "secret in here SHOULD NOT be parsed"',
      raw_log: 'verbose log SHOULD NOT be parsed',
    }),
    JSON.stringify({
      schema_version: '1',
      tool: 'codex',
      model: 'gpt-5.3-codex',
      cost: { input_tokens: 500_000, output_tokens: 0 },
      timestamp: '2026-05-18T11:05:00Z',
      git_sha: 'cafef00d',
      command: 'codex exec "ignored — only gemini entries are read"',
      raw_log: '',
    }),
  ];
  writeFileSync(LEDGER, `${ledgerLines.join('\n')}\n`, 'utf8');

  // (4) A real `config.yaml` declaring the one project at the matching path.
  writeFileSync(
    CONFIG_PATH,
    `projects:\n  - name: ${PROJECT_NAME}\n    path: ${PROJECT_PATH}\n`,
    'utf8',
  );
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * A `PathsEnv` whose env vars point the config / transcripts / datalake /
 * Codex / ledger resolvers at this test's temp tree — the exact env shape
 * `resolveSessionsOptions` + `resolveCostOptions` consume in a `serve` run.
 */
function envOf(): PathsEnv {
  return {
    platform: 'linux',
    homeDir: HOME,
    env: {
      METASWARM_DASHBOARD_CONFIG: CONFIG_PATH,
      METASWARM_DASHBOARD_DATA_DIR: DATALAKE,
      METASWARM_DASHBOARD_TRANSCRIPTS_DIR: TRANSCRIPTS,
      METASWARM_DASHBOARD_CODEX_SESSIONS_DIR: CODEX_DIR,
      METASWARM_DASHBOARD_EXTERNAL_TOOLS_LEDGER: LEDGER,
    },
  };
}

/**
 * Build a server wired the way production wires it: the `sessions` and `cost`
 * blocks are the output of the REAL `resolveSessionsOptions` /
 * `resolveCostOptions` — not hand-injected stubs.
 */
async function makeRealServer() {
  const sessions = resolveSessionsOptions(envOf());
  const cost = resolveCostOptions(envOf());
  return buildServer({
    dataDir: sessions.dataDir,
    staticRoot: STATIC_ROOT,
    now: () => NOW,
    sessions,
    cost,
  });
}

describe('AI cost — end-to-end (real wiring, no stubbed readers)', () => {
  it('resolves the cost env from a real PathsEnv', () => {
    // Precondition: the path resolvers honoured the env overrides.
    const sessions = resolveSessionsOptions(envOf());
    expect(sessions.config.projects).toHaveLength(1);
    expect(sessions.config.projects[0]).toMatchObject({
      name: PROJECT_NAME,
      path: PROJECT_PATH,
    });
    expect(sessions.transcriptsDir).toBe(TRANSCRIPTS);
    const cost = resolveCostOptions(envOf());
    expect(cost.codexSessionsDir).toBe(CODEX_DIR);
    expect(cost.externalToolsLedger).toBe(LEDGER);
  });

  it('GET /api/sessions costs a Claude session from a real transcript', async () => {
    const app = await makeRealServer();
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(1);
    const row = body.sessions[0];
    expect(row).toMatchObject({ projectName: PROJECT_NAME, sessionId: SESSION_ID });
    // 1 assistant record × ($15 + $75) per 1M tokens = $90.
    expect(row.costUsd).toBeCloseTo(90, 6);
    expect(row.hasUnpriced).toBe(false);
    expect(body.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it('GET /api/sessions/:project/:id returns a schema-valid SessionCost', async () => {
    const app = await makeRealServer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${PROJECT_NAME}/${SESSION_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(SessionCost.safeParse(body.cost).success).toBe(true);
    expect(body.cost.vendor).toBe('anthropic');
    expect(body.cost.totalCostUsd).toBeCloseTo(90, 6);
    expect(body.cost.byModel).toHaveLength(1);
    expect(body.cost.byModel[0].model).toBe('claude-opus-4-7');
    await app.close();
  });

  it('GET /api/projects/:name aggregates Claude + Codex cost from real files', async () => {
    const app = await makeRealServer();
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_NAME}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The detail honours the gcx fix — 14 zero-filled throughput entries.
    expect(body.throughput).toHaveLength(14);
    expect(ProjectCostSummary.safeParse(body.cost).success).toBe(true);
    const cost = body.cost;
    // Claude session — $90 of Anthropic cost, 1 run.
    expect(cost.byVendor.anthropic.costUsd).toBeCloseTo(90, 6);
    expect(cost.byVendor.anthropic.runCount).toBe(1);
    // Codex rollout — gpt-5.5, 1M input @ $1.25/M = $1.25, attributed by
    // cwd to this project (the rollout's `cwd` is the project path).
    expect(cost.byVendor.openai.costUsd).toBeCloseTo(1.25, 6);
    expect(cost.byVendor.openai.runCount).toBe(1);
    // The Gemini ledger record carries NO cwd — design §4.4: every Gemini
    // run is `unattributed`, so the project's Google row stays zero.
    expect(cost.byVendor.google.costUsd).toBe(0);
    expect(cost.byVendor.google.runCount).toBe(0);
    // The project total folds only the attributed vendors: 90 + 1.25.
    expect(cost.totalCostUsd).toBeCloseTo(91.25, 6);
    expect(cost.hasUnpriced).toBe(false);
    await app.close();
  });

  it('GET /api/projects carries the joined per-project cost + an unattributed Gemini row', async () => {
    const app = await makeRealServer();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const row = body.find((p: { name: string }) => p.name === PROJECT_NAME);
    expect(row).toBeDefined();
    // The §7 join sums the project's attributed vendors: 90 + 1.25 = 91.25.
    expect(row.totalCostUsd).toBeCloseTo(91.25, 6);
    expect(row.hasUnpriced).toBe(false);
    expect(row.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The cwd-less Gemini run lands in the synthetic `unattributed` row
    // (design §4.4 / §7): gemini-3-pro 1M in @ $2 + 1M out @ $12 = $14.
    const unattributed = body.find(
      (p: { name: string }) => p.name === 'unattributed',
    );
    expect(unattributed).toBeDefined();
    expect(unattributed.totalCostUsd).toBeCloseTo(14, 6);
    await app.close();
  });

  it('the ledger reader keeps only gemini entries — the codex entry is ignored', async () => {
    // The ledger holds one gemini + one codex entry. Only the gemini cost
    // ($14, unattributed) is read; the codex ledger entry is structurally
    // dropped — Codex cost comes exclusively from the rollout tree
    // (design §4.2/§4.3), so OpenAI's one run is the rollout, not the ledger.
    const app = await makeRealServer();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const body = res.json();
    const project = body.find((p: { name: string }) => p.name === PROJECT_NAME);
    const unattributed = body.find(
      (p: { name: string }) => p.name === 'unattributed',
    );
    // The project's single OpenAI run is the rollout ($1.25).
    expect(project.totalCostUsd).toBeCloseTo(91.25, 6);
    // The unattributed bucket holds ONLY the gemini cost — had the codex
    // ledger entry been read it would have added $0.625 (500k @ $1.25/M).
    expect(unattributed.totalCostUsd).toBeCloseTo(14, 6);
    await app.close();
  });
});
