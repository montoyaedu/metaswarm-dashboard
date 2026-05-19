// End-to-end tests for the v5-7 cost surface on the four GET endpoints
// (design §7), via Fastify `app.inject`:
//
//   - GET /api/sessions                 → SessionSummary[] gains aiTitle +
//                                          costUsd + hasUnpriced
//   - GET /api/sessions/:project/:id     → detail gains cost: SessionCost
//   - GET /api/projects                  → rows gain totalCostUsd + hasUnpriced;
//                                          the §7 namespace join
//   - GET /api/projects/:name            → detail gains cost: ProjectCostSummary
//
// Each test builds a self-contained temp tree: a transcripts root holding
// `<encoded-cwd>/<sessionId>.jsonl` Claude Code transcripts, a datalake
// holding `projects/<p>/daily/<key>.json` snapshots, and a `Config` mapping
// project names to absolute paths. The whole `buildServer` `sessions` block
// is injected, so the live `~/.claude/projects/` scan is never touched.
// Real transcripts carrying `message.usage` exercise the cost path end-to-end.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { encodeTranscriptDirName } from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import { SessionCost, ProjectCostSummary } from '@metaswarm-dashboard/types/cost';
import { SessionSummary } from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');
const NOW = new Date('2026-05-18T12:00:00.000Z');

let TMP: string;
let TRANSCRIPTS: string;
let DATALAKE: string;
let CODEX_DIR: string;
let LEDGER: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-cost-routes-'));
  TRANSCRIPTS = join(TMP, 'transcripts');
  DATALAKE = join(TMP, 'datalake');
  CODEX_DIR = join(TMP, 'codex-sessions');
  LEDGER = join(TMP, 'external-tools.jsonl');
  mkdirSync(TRANSCRIPTS, { recursive: true });
  mkdirSync(DATALAKE, { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** One assistant record carrying `message.usage` + `message.model`. */
function assistantLine(
  sessionId: string,
  i: number,
  model: string,
  usage: Record<string, unknown>,
  isSidechain = false,
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `a-${i}`,
    timestamp: `2026-05-18T0${i}:30:00.000Z`,
    sessionId,
    isSidechain,
    message: {
      role: 'assistant',
      model,
      usage,
      content: [{ type: 'text', text: `reply ${i}` }],
    },
  });
}

/**
 * Write a Claude Code transcript whose assistant records carry usage. Each
 * assistant record bills `model` with `1_000_000` input + `1_000_000` output
 * tokens — `claude-opus-4-7` ($15/M in, $75/M out) → $90 per record.
 * Optionally writes an `ai-title` record and `subagents/agent-*.jsonl`.
 */
function writeUsageTranscript(
  projectName: string,
  sessionId: string,
  opts: {
    assistantCount?: number;
    model?: string;
    aiTitle?: string;
    subagentRecords?: number;
  } = {},
): string {
  const projectPath = join(TMP, 'repos', projectName);
  const dir = join(TRANSCRIPTS, encodeTranscriptDirName(projectPath));
  mkdirSync(dir, { recursive: true });
  const model = opts.model ?? 'claude-opus-4-7';
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  const lines: string[] = [
    JSON.stringify({
      type: 'user',
      uuid: 'u-0',
      timestamp: '2026-05-18T00:00:00.000Z',
      sessionId,
      cwd: projectPath,
      message: { role: 'user', content: 'do the thing' },
    }),
  ];
  if (opts.aiTitle !== undefined) {
    lines.push(JSON.stringify({ type: 'ai-title', aiTitle: opts.aiTitle, sessionId }));
  }
  const count = opts.assistantCount ?? 1;
  for (let i = 0; i < count; i++) {
    lines.push(assistantLine(sessionId, i + 1, model, usage));
  }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`, 'utf8');

  if (opts.subagentRecords !== undefined && opts.subagentRecords > 0) {
    const subDir = join(dir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    const subLines: string[] = [];
    for (let i = 0; i < opts.subagentRecords; i++) {
      subLines.push(assistantLine(sessionId, 10 + i, model, usage, true));
    }
    writeFileSync(
      join(subDir, `agent-${sessionId}.jsonl`),
      `${subLines.join('\n')}\n`,
      'utf8',
    );
  }
  return projectPath;
}

/** Write a transcript with NO assistant records — a no-costable session. */
function writeNoCostTranscript(projectName: string, sessionId: string): string {
  const projectPath = join(TMP, 'repos', projectName);
  const dir = join(TRANSCRIPTS, encodeTranscriptDirName(projectPath));
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    type: 'user',
    uuid: 'u-0',
    timestamp: '2026-05-18T00:00:00.000Z',
    sessionId,
    cwd: projectPath,
    message: { role: 'user', content: 'just a prompt' },
  });
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${line}\n`, 'utf8');
  return projectPath;
}

/** Write a minimal valid daily snapshot so the project shows in /api/projects. */
function writeSnapshot(projectName: string): void {
  const dir = join(DATALAKE, 'projects', projectName, 'daily');
  mkdirSync(dir, { recursive: true });
  const snapshot = {
    schemaVersion: 1,
    projectName,
    projectPath: join(TMP, 'repos', projectName),
    category: 'metaswarm',
    generatedAt: '2026-05-18T00:00:00.000Z',
    dayKey: '2026-05-18',
    agents: [],
    totals: {
      totalActiveTasks: 0,
      totalBlockedTasks: 0,
      totalCompletedTasksLast7d: 0,
      lastActivityAt: null,
    },
    prsMergedLast7d: null,
  };
  writeFileSync(join(dir, '2026-05-18.json'), JSON.stringify(snapshot), 'utf8');
}

/**
 * Write a Codex `rollout-*.jsonl` under `<CODEX_DIR>/<Y>/<M>/<D>/`. The
 * rollout's `cwd` decides attribution: a `cwd` matching no config project
 * lands in the §7 `unattributed` bucket.
 */
function writeCodexRollout(cwd: string): void {
  const dir = join(CODEX_DIR, '2026', '05', '18');
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-05-18T10:00:00.000Z',
      payload: { cwd },
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
    join(dir, 'rollout-2026-05-18T10-00-00-abc.jsonl'),
    `${lines.join('\n')}\n`,
    'utf8',
  );
}

/** Build a `Config` from `[name, absolutePath]` pairs. */
function configOf(...projects: ReadonlyArray<readonly [string, string]>): Config {
  return {
    projects: projects.map(([name, path]) => ({
      name,
      path,
      category: 'metaswarm' as const,
    })),
  };
}

/** Build a server whose sessions + cost deps are fully injected. */
async function makeApp(config: Config) {
  return buildServer({
    dataDir: DATALAKE,
    staticRoot: STATIC_ROOT,
    now: () => NOW,
    sessions: {
      config,
      transcriptsDir: TRANSCRIPTS,
      dataDir: DATALAKE,
    },
    cost: {
      codexSessionsDir: CODEX_DIR,
      externalToolsLedger: LEDGER,
    },
  });
}

// --- GET /api/sessions -----------------------------------------------------

describe('GET /api/sessions — cost fields', () => {
  it('adds aiTitle, costUsd and hasUnpriced to each SessionSummary', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', {
      assistantCount: 2,
      aiTitle: 'Refactor the parser',
    });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(1);
    const row = body.sessions[0];
    expect(SessionSummary.safeParse(row).success).toBe(true);
    expect(row.aiTitle).toBe('Refactor the parser');
    // 2 assistant records × $90 = $180.
    expect(row.costUsd).toBeCloseTo(180, 6);
    expect(row.hasUnpriced).toBe(false);
    // `pricingAsOf` rides along on the response.
    expect(body.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it('costUsd is null for a session with no costable assistant records', async () => {
    const alpha = writeNoCostTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    const row = res.json().sessions[0];
    expect(row.costUsd).toBeNull();
    expect(row.hasUnpriced).toBe(false);
    await app.close();
  });

  it('aiTitle is null when the transcript carries no ai-title record', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.json().sessions[0].aiTitle).toBeNull();
    await app.close();
  });

  it('hasUnpriced is true when the session uses an unpriced model', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', {
      assistantCount: 1,
      model: 'some-unknown-model-x',
    });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    const row = res.json().sessions[0];
    expect(row.hasUnpriced).toBe(true);
    // The unpriced model contributes nothing → priced sum is 0 (not null —
    // there IS a costable record).
    expect(row.costUsd).toBe(0);
    await app.close();
  });

  it('a session cost INCLUDES its subagents/agent-*.jsonl records', async () => {
    // 1 main assistant record ($90) + 2 subagent records ($90 each) = $270.
    const alpha = writeUsageTranscript('alpha', 'sess-a1', {
      assistantCount: 1,
      subagentRecords: 2,
    });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.json().sessions[0].costUsd).toBeCloseTo(270, 6);
    await app.close();
  });
});

// --- GET /api/sessions/:project/:sessionId ---------------------------------

describe('GET /api/sessions/:project/:sessionId — cost detail', () => {
  it('adds cost: SessionCost to the detail response', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(SessionCost.safeParse(body.cost).success).toBe(true);
    expect(body.cost.sessionId).toBe('sess-a1');
    expect(body.cost.vendor).toBe('anthropic');
    expect(body.cost.totalCostUsd).toBeCloseTo(90, 6);
    expect(body.cost.byModel).toHaveLength(1);
    expect(body.cost.byModel[0].model).toBe('claude-opus-4-7');
    expect(body.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it('the detail timeline carries aiTitle (v5-6)', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', {
      assistantCount: 1,
      aiTitle: 'Fix the cache bug',
    });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(res.json().timeline.aiTitle).toBe('Fix the cache bug');
    await app.close();
  });

  it('the detail cost merges subagent records', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', {
      assistantCount: 1,
      subagentRecords: 1,
    });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    // main $90 + subagent $90 = $180.
    expect(res.json().cost.totalCostUsd).toBeCloseTo(180, 6);
    await app.close();
  });
});

// --- GET /api/projects (the §7 namespace join) -----------------------------

describe('GET /api/projects — cost fields + namespace join', () => {
  it('adds totalCostUsd, hasUnpriced and pricingAsOf to each project row', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    writeSnapshot('alpha');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The response stays a bare ProjectSummary[] — additive, SPA-compatible.
    expect(Array.isArray(body)).toBe(true);
    const alphaRow = body.find((p: { name: string }) => p.name === 'alpha');
    expect(alphaRow).toBeDefined();
    expect(alphaRow.totalCostUsd).toBeCloseTo(90, 6);
    expect(alphaRow.hasUnpriced).toBe(false);
    expect(alphaRow.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it('a config-only project (cost, no snapshot) STILL renders, as a cost-only row', async () => {
    // `alpha` has a transcript (cost) but no daily snapshot.
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const alphaRow = res
      .json()
      .find((p: { name: string }) => p.name === 'alpha');
    expect(alphaRow).toBeDefined();
    expect(alphaRow.totalCostUsd).toBeCloseTo(90, 6);
    // It is a cost-only row — no snapshot metrics.
    expect(alphaRow.hasMetrics).toBe(false);
    await app.close();
  });

  it('a snapshot-only project (no config, no cost) STILL renders with 0 cost', async () => {
    // `ghost` has a snapshot but is NOT in the config (no cost).
    writeSnapshot('ghost');
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const ghostRow = res
      .json()
      .find((p: { name: string }) => p.name === 'ghost');
    expect(ghostRow).toBeDefined();
    expect(ghostRow.totalCostUsd).toBe(0);
    expect(ghostRow.hasUnpriced).toBe(false);
    await app.close();
  });

  it('a project in BOTH namespaces shows the snapshot row + its cost', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 2 });
    writeSnapshot('alpha');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const alphaRow = res
      .json()
      .find((p: { name: string }) => p.name === 'alpha');
    expect(alphaRow.hasMetrics).toBe(true); // snapshot side
    expect(alphaRow.totalCostUsd).toBeCloseTo(180, 6); // cost side
    await app.close();
  });

  it('does NOT append an unattributed row when there is no unattributed cost', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    writeSnapshot('alpha');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const unattributed = res
      .json()
      .find((p: { name: string }) => p.name === 'unattributed');
    expect(unattributed).toBeUndefined();
    await app.close();
  });

  it('appends an unattributed row for cost resolving to no config project', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    writeSnapshot('alpha');
    // A Codex run whose cwd matches no configured project (§7 — bucketed
    // `unattributed`, surfaced as a synthetic global row on the index).
    writeCodexRollout(join(TMP, 'somewhere', 'else'));
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    const body = res.json();
    const unattributed = body.find(
      (p: { name: string }) => p.name === 'unattributed',
    );
    expect(unattributed).toBeDefined();
    // 1M input @ $1.25/M (gpt-5.5) = $1.25 of unattributed OpenAI cost.
    expect(unattributed.totalCostUsd).toBeCloseTo(1.25, 6);
    await app.close();
  });
});

// --- GET /api/projects/:name -----------------------------------------------

describe('GET /api/projects/:name — cost detail', () => {
  it('adds cost: ProjectCostSummary to the detail response', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    writeSnapshot('alpha');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects/alpha' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ProjectCostSummary.safeParse(body.cost).success).toBe(true);
    expect(body.cost.projectName).toBe('alpha');
    expect(body.cost.byVendor.anthropic.costUsd).toBeCloseTo(90, 6);
    // All three vendors present even with no Codex/Gemini runs.
    expect(body.cost.byVendor.openai.runCount).toBe(0);
    expect(body.cost.byVendor.google.runCount).toBe(0);
    expect(body.cost.pricingAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it('serves a config-only project (no snapshot) with its cost', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects/alpha' });
    expect(res.statusCode).toBe(200);
    expect(res.json().cost.totalCostUsd).toBeCloseTo(90, 6);
    await app.close();
  });

  it('serves a snapshot-only project (no config) with a 0-cost ProjectCostSummary', async () => {
    writeSnapshot('ghost');
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects/ghost' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cost.totalCostUsd).toBe(0);
    expect(body.cost.hasUnpriced).toBe(false);
    await app.close();
  });

  it('returns 404 for a project in neither namespace', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/projects/nope' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// --- the method guard is unchanged -----------------------------------------

describe('v5-7 adds no write surface', () => {
  it('a PUT to /api/projects is still 405 (method guard unchanged)', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'PUT', url: '/api/projects/alpha' });
    expect(res.statusCode).toBe(405);
    expect(res.json().error.code).toBe('method_not_allowed');
    await app.close();
  });

  it('a POST to /api/sessions is still 405', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'POST', url: '/api/sessions' });
    expect(res.statusCode).toBe(405);
    await app.close();
  });

  it('the one allow-listed write (PUT rating) still passes the guard', async () => {
    const alpha = writeUsageTranscript('alpha', 'sess-a1', { assistantCount: 1 });
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      payload: {},
    });
    // Not 405 — the guard let it through (the handler may 400 the body).
    expect(res.statusCode).not.toBe(405);
    await app.close();
  });
});
