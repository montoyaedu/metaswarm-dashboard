// End-to-end tests for the three v4-5 GET endpoints via Fastify `app.inject`:
//   - GET /api/sessions[?project=]
//   - GET /api/sessions/:project/:sessionId
//   - GET /api/calibration
//
// Each test builds a self-contained temp tree:
//   - a transcripts root holding `<encoded-cwd>/<sessionId>.jsonl` files,
//   - a datalake holding `projects/<p>/sessions/ratings/*.rating.json`,
//   - a `Config` mapping project names to their absolute paths.
// The whole `buildServer` `sessions` dependency is injected, so the live
// `~/.claude/projects/` scan is never touched.

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
import {
  CalibrationSummary,
  type OperatorVerdict,
  type SessionRating,
} from '@metaswarm-dashboard/types/ratings';
import {
  ProcessRubricScore,
  SessionSummary,
  SessionTimeline,
  type ProcessRubricScore as ProcessRubricScoreT,
  type RubricKey,
} from '@metaswarm-dashboard/types/sessions';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');
const NOW = new Date('2026-05-17T12:00:00.000Z');

const RUBRIC_KEYS: readonly RubricKey[] = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
];

/** The synthetic-fixture marker line every test `.jsonl` begins with. */
const FIXTURE_MARKER =
  '{"meta":"synthetic-fixture-do-not-replace-with-real-transcript","schemaVersion":1}';

let TMP: string;
let TRANSCRIPTS: string;
let DATALAKE: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-sessions-routes-'));
  TRANSCRIPTS = join(TMP, 'transcripts');
  DATALAKE = join(TMP, 'datalake');
  mkdirSync(TRANSCRIPTS, { recursive: true });
  mkdirSync(DATALAKE, { recursive: true });
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * Write a minimal valid Claude Code JSONL transcript for a project. Returns
 * the absolute project path used to encode the transcript dir name.
 */
function writeTranscript(
  projectName: string,
  sessionId: string,
  opts: { events?: number } = {},
): string {
  const projectPath = join(TMP, 'repos', projectName);
  const dir = join(TRANSCRIPTS, encodeTranscriptDirName(projectPath));
  mkdirSync(dir, { recursive: true });
  const lines = [FIXTURE_MARKER];
  const count = opts.events ?? 2;
  for (let i = 0; i < count; i++) {
    lines.push(
      JSON.stringify({
        type: 'user',
        uuid: `u-${i}`,
        timestamp: `2026-05-17T0${i}:00:00.000Z`,
        sessionId,
        cwd: projectPath,
        message: { role: 'user', content: `prompt ${i}` },
      }),
    );
  }
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
  return projectPath;
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

/** A valid `ProcessRubricScore` whose every item carries `verdict`. */
function rubricAll(sessionId: string, verdict: 'pass' | 'fail'): ProcessRubricScoreT {
  return {
    schemaVersion: 1,
    sessionId,
    scoredAt: '2026-05-17T08:00:00.000Z',
    items: RUBRIC_KEYS.map((key) => ({
      key,
      label: key,
      verdict,
      evidence: 'ok',
      pointer: null,
    })),
    overall: verdict,
  };
}

/** Write a `*.rating.json` into the datalake. */
function writeRating(
  projectName: string,
  sessionId: string,
  verdicts: OperatorVerdict[],
  rubricVerdict: 'pass' | 'fail' = 'pass',
): void {
  const rating: SessionRating = {
    schemaVersion: 1,
    sessionId,
    projectName,
    verdicts,
    ratedAt: '2026-05-17T09:00:00.000Z',
    rubricAtRating: rubricAll(sessionId, rubricVerdict),
  };
  const dir = join(DATALAKE, 'projects', projectName, 'sessions', 'ratings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.rating.json`), JSON.stringify(rating), 'utf8');
}

/** Build a server whose `sessions` deps are fully injected. */
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
  });
}

// --- GET /api/sessions -----------------------------------------------------

describe('GET /api/sessions', () => {
  it('returns 200 + a SessionSummary[] for the discovered transcripts', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(1);
    for (const summary of body.sessions) {
      expect(SessionSummary.safeParse(summary).success).toBe(true);
    }
    expect(body.sessions[0]).toMatchObject({
      projectName: 'alpha',
      sessionId: 'sess-a1',
      eventCount: 2,
      rated: false,
    });
    await app.close();
  });

  it('reports rated=true when a rating file exists for the session', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    writeRating('alpha', 'sess-a1', [
      { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
    ]);
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions' });
    expect(res.json().sessions[0].rated).toBe(true);
    await app.close();
  });

  it('filters by ?project when supplied', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const beta = writeTranscript('beta', 'sess-b1');
    const app = await makeApp(configOf(['alpha', alpha], ['beta', beta]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions?project=beta' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].projectName).toBe('beta');
    await app.close();
  });

  it('returns an empty list for a known project with no transcripts', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    // `beta` is configured but never had a Claude Code session.
    const app = await makeApp(
      configOf(['alpha', alpha], ['beta', join(TMP, 'repos', 'beta')]),
    );
    const res = await app.inject({ method: 'GET', url: '/api/sessions?project=beta' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessions).toEqual([]);
    await app.close();
  });

  it('returns 400 when ?project fails the allow-list', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions?project=bad%2Fname' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
    await app.close();
  });

  it('returns 400 when ?project contains a traversal sequence', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions?project=..' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// --- GET /api/sessions/:project/:sessionId ---------------------------------

describe('GET /api/sessions/:project/:sessionId', () => {
  it('returns 200 + { timeline, rubric, rating } for a known session', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(SessionTimeline.safeParse(body.timeline).success).toBe(true);
    expect(ProcessRubricScore.safeParse(body.rubric).success).toBe(true);
    expect(body.timeline.sessionId).toBe('sess-a1');
    expect(body.rating).toBeNull();
    await app.close();
  });

  it('returns the persisted rating when one exists', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    writeRating('alpha', 'sess-a1', [
      { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
    ]);
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().rating.verdicts).toHaveLength(1);
    await app.close();
  });

  it('returns 404 for an unknown sessionId in a known project', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/alpha/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('session_not_found');
    await app.close();
  });

  it('returns 404 for an unknown project', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/ghost/sess-a1' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 400 when :project fails the allow-list', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/bad%20name/sess-a1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
    await app.close();
  });

  it('returns 400 when :sessionId fails the allow-list', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/alpha/bad%20id',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when :sessionId is a traversal sequence', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/alpha/..%2F..%2Fetc',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 when :project is a literal ".." segment', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/sessions/../sess-a1' });
    // `..` collapses in the URL — assert it never resolves to a transcript.
    expect([400, 404]).toContain(res.statusCode);
    await app.close();
  });

  it('serves repeated reads of the same session from the cache', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const first = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    const second = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(first.json()).toEqual(second.json());
    await app.close();
  });

  it('reflects a transcript change across requests (cache invalidation)', async () => {
    const projectPath = writeTranscript('alpha', 'sess-a1', { events: 2 });
    const app = await makeApp(configOf(['alpha', projectPath]));
    const before = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(before.json().timeline.eventCount).toBe(2);

    // The session grows — rewrite the same transcript with more events.
    writeTranscript('alpha', 'sess-a1', { events: 5 });
    const after = await app.inject({ method: 'GET', url: '/api/sessions/alpha/sess-a1' });
    expect(after.json().timeline.eventCount).toBe(5);
    await app.close();
  });
});

// --- GET /api/calibration --------------------------------------------------

describe('GET /api/calibration', () => {
  it('returns 200 + a valid empty CalibrationSummary when no ratings exist', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/calibration' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(CalibrationSummary.safeParse(body.summary).success).toBe(true);
    expect(body.summary.ratedSessionCount).toBe(0);
    expect(body.summary.perKpi).toHaveLength(9);
    for (const kpi of body.summary.perKpi) {
      expect(kpi.agreementRatio).toBeNull();
    }
    await app.close();
  });

  it('aggregates agree / disagree / na+unsure across persisted ratings', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    // rubric=pass everywhere; tdd agree, planning disagree, thrashing na.
    writeRating(
      'alpha',
      'sess-a1',
      [
        { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-17T09:00:00.000Z' },
        { key: 'planning', verdict: 'fail', scoredAt: '2026-05-17T09:00:00.000Z' },
        { key: 'thrashing', verdict: 'na', scoredAt: '2026-05-17T09:00:00.000Z' },
      ],
      'pass',
    );
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({ method: 'GET', url: '/api/calibration' });
    const summary = res.json().summary;
    expect(summary.ratedSessionCount).toBe(1);
    const tdd = summary.perKpi.find((k: { key: string }) => k.key === 'tdd');
    expect(tdd).toMatchObject({ agree: 1, disagree: 0, naOrUnsure: 0 });
    const planning = summary.perKpi.find((k: { key: string }) => k.key === 'planning');
    expect(planning).toMatchObject({ agree: 0, disagree: 1 });
    const thrashing = summary.perKpi.find(
      (k: { key: string }) => k.key === 'thrashing',
    );
    expect(thrashing).toMatchObject({ agree: 0, disagree: 0, naOrUnsure: 1 });
    expect(thrashing.agreementRatio).toBeNull();
    await app.close();
  });
});
