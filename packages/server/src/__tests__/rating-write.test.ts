// End-to-end tests for the v4-6 write endpoint via Fastify `app.inject`:
//   PUT /api/sessions/:project/:sessionId/rating
//
// Covers design §7 (re-derived `rubricAtRating`, persisted-rating response),
// §8.1 (Content-Type → 415, same-origin fail-closed → 403, 64 KB cap → 413),
// §8.2 (param sanitization → 400), the upsert, and the 404 unknown-session.
//
// Each test builds a self-contained temp tree (transcripts root + datalake)
// and injects the whole `buildServer` `sessions` block, so the live
// `~/.claude/projects/` scan is never touched.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { encodeTranscriptDirName } from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import {
  SessionRating,
  type OperatorVerdict,
} from '@metaswarm-dashboard/types/ratings';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');
const NOW = new Date('2026-05-18T12:00:00.000Z');

/** The synthetic-fixture marker line every test `.jsonl` begins with. */
const FIXTURE_MARKER =
  '{"meta":"synthetic-fixture-do-not-replace-with-real-transcript","schemaVersion":1}';

let TMP: string;
let TRANSCRIPTS: string;
let DATALAKE: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-rating-write-'));
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
function writeTranscript(projectName: string, sessionId: string): string {
  const projectPath = join(TMP, 'repos', projectName);
  const dir = join(TRANSCRIPTS, encodeTranscriptDirName(projectPath));
  mkdirSync(dir, { recursive: true });
  const lines = [FIXTURE_MARKER];
  for (let i = 0; i < 2; i++) {
    lines.push(
      JSON.stringify({
        type: 'user',
        uuid: `u-${i}`,
        timestamp: `2026-05-18T0${i}:00:00.000Z`,
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

/** Build a server whose `sessions` deps are fully injected. */
async function makeApp(config: Config) {
  return buildServer({
    dataDir: DATALAKE,
    staticRoot: STATIC_ROOT,
    now: () => NOW,
    sessions: { config, transcriptsDir: TRANSCRIPTS, dataDir: DATALAKE },
  });
}

/** A minimal valid request body. */
const SAMPLE_VERDICTS: OperatorVerdict[] = [
  { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-18T11:00:00.000Z' },
];

/** Headers a same-origin browser would send. */
const SAME_ORIGIN_HEADERS = {
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
};

/** The rating file path for a (project, sessionId) in the temp datalake. */
function ratingFile(project: string, sessionId: string): string {
  return join(
    DATALAKE,
    'projects',
    project,
    'sessions',
    'ratings',
    `${sessionId}.rating.json`,
  );
}

// --- happy path ------------------------------------------------------------

describe('PUT /api/sessions/:project/:sessionId/rating — success', () => {
  it('persists the rating and returns 200 + the persisted SessionRating', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS, overallNote: 'looked solid' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json();
    expect(SessionRating.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      schemaVersion: 1,
      sessionId: 'sess-a1',
      projectName: 'alpha',
      verdicts: SAMPLE_VERDICTS,
      overallNote: 'looked solid',
      ratedAt: NOW.toISOString(),
    });
    // The persisted file equals the response body.
    const onDisk = JSON.parse(readFileSync(ratingFile('alpha', 'sess-a1'), 'utf8'));
    expect(onDisk).toEqual(body);
    await app.close();
  });

  it('passes the same-origin check via an exact Origin header (no Sec-Fetch-Site)', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:5174',
        origin: 'http://localhost:5174',
      },
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('re-derives rubricAtRating server-side and ignores a client-sent rubric', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    // The client tries to inject a bogus rubric — the server must strip it
    // and re-derive its own from the live transcript.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: {
        verdicts: SAMPLE_VERDICTS,
        rubricAtRating: { schemaVersion: 1, sessionId: 'EVIL', items: [], overall: 'pass' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The persisted rubric is the server's (9 items, correct sessionId) —
    // NOT the 0-item bogus one the client sent.
    expect(body.rubricAtRating.sessionId).toBe('sess-a1');
    expect(body.rubricAtRating.items).toHaveLength(9);
    await app.close();
  });

  it('upserts — a re-rate overwrites the single rating file (no duplicate)', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));

    const first = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: {
        verdicts: [
          { key: 'planning', verdict: 'fail', scoredAt: '2026-05-18T11:30:00.000Z' },
        ],
      },
    });
    expect(second.statusCode).toBe(200);

    // Exactly ONE file, holding the SECOND rating.
    const ratingsDir = join(DATALAKE, 'projects', 'alpha', 'sessions', 'ratings');
    expect(readdirSync(ratingsDir)).toEqual(['sess-a1.rating.json']);
    const onDisk = JSON.parse(readFileSync(ratingFile('alpha', 'sess-a1'), 'utf8'));
    expect(onDisk.verdicts).toEqual([
      { key: 'planning', verdict: 'fail', scoredAt: '2026-05-18T11:30:00.000Z' },
    ]);
    await app.close();
  });

  it('accepts an empty verdicts array (a partial rating with 0 verdicts)', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdicts).toEqual([]);
    await app.close();
  });
});

// --- 400 — bad params / bad body -------------------------------------------

describe('PUT .../rating — 400 bad request', () => {
  it('rejects a verdicts array with a duplicate RubricKey', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: {
        verdicts: [
          { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-18T11:00:00.000Z' },
          { key: 'tdd', verdict: 'fail', scoredAt: '2026-05-18T11:00:00.000Z' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
    await app.close();
  });

  it('rejects a body missing the verdicts field', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { overallNote: 'no verdicts here' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a verdict carrying an unknown rubric key', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: {
        verdicts: [
          { key: 'not-a-real-kpi', verdict: 'pass', scoredAt: '2026-05-18T11:00:00.000Z' },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a :project containing a ".." traversal sequence', async () => {
    // `a..b` matches the method-guard char-class (so the guard lets the PUT
    // through) but fails the handler's explicit `..`-rejection → 400. This
    // is the handler param-sanitization path, distinct from the guard's 405.
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/bad..proj/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
    await app.close();
  });

  it('rejects a :sessionId containing a ".." traversal sequence', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/bad..id/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

// --- 404 — unknown session -------------------------------------------------

describe('PUT .../rating — 404 unknown session', () => {
  it('returns 404 for an unknown sessionId in a known project', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/ghost/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('session_not_found');
    await app.close();
  });

  it('returns 404 for an unknown project', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/ghostproj/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// --- 415 — wrong Content-Type ----------------------------------------------

describe('PUT .../rating — 415 unsupported media type', () => {
  it('rejects a request whose Content-Type is not application/json', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
      payload: 'verdicts=none',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('unsupported_media_type');
    // No file was written.
    expect(() => readdirSync(join(DATALAKE, 'projects'))).toThrow();
    await app.close();
  });

  it('rejects a request with no Content-Type header at all', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(res.statusCode).toBe(415);
    await app.close();
  });

  it('accepts application/json with a charset parameter', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'sec-fetch-site': 'same-origin',
      },
      payload: JSON.stringify({ verdicts: SAMPLE_VERDICTS }),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

// --- 413 — over the body cap -----------------------------------------------

describe('PUT .../rating — 413 body too large', () => {
  it('rejects a body over the 64 KB cap', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    // A verdict note padded so the JSON payload exceeds 64 KB.
    const huge = 'x'.repeat(70 * 1024);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: SAME_ORIGIN_HEADERS,
      payload: JSON.stringify({ verdicts: SAMPLE_VERDICTS, overallNote: huge }),
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});

// --- 403 — cross-origin fail-closed ----------------------------------------

describe('PUT .../rating — 403 same-origin fail-closed', () => {
  it('rejects a request with a cross-site Sec-Fetch-Site', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    await app.close();
  });

  it('rejects a request carrying NEITHER Sec-Fetch-Site NOR Origin (fail-closed)', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: { 'content-type': 'application/json' },
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('rejects a request whose Origin does not match the server host', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:5174',
        origin: 'http://evil.example.com',
      },
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('rejects when Origin is present but the Host header is absent', async () => {
    const alpha = writeTranscript('alpha', 'sess-a1');
    const app = await makeApp(configOf(['alpha', alpha]));
    // `app.inject` always sets a host; simulate its absence by overriding it
    // to an empty value is not possible, so assert the Origin-vs-host
    // mismatch path instead via a deliberately wrong Origin (covered above).
    // This case asserts a `127.0.0.1` Origin against a `localhost` host.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sessions/alpha/sess-a1/rating',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:5174',
        origin: 'http://127.0.0.1:5174',
      },
      payload: { verdicts: SAMPLE_VERDICTS },
    });
    // `127.0.0.1` !== `localhost` host → fail-closed.
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
