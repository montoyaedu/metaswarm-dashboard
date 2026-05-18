// End-to-end integration test for the Sessions feature (sessions-spike WU
// v4-9 / design §9 WU-G, §11). This is the only test that exercises the
// REAL wiring — no stubbed `sessions` deps:
//
//   - a real `config.yaml` on disk, loaded by the real `loadConfig`;
//   - a real transcripts dir holding the real synthetic `.jsonl` fixture;
//   - real `discoverSessions` / `parseTranscript` / `scoreTimeline`;
//   - real `writeSessionRating` / `readSessionRating`;
//   - real `aggregateCalibration`.
//
// The server is built via `resolveSessionsOptions` driven by a real
// `PathsEnv` whose env vars point the config / transcripts / datalake
// resolvers at deterministic temp locations — exactly the path a production
// `serve` run takes, only re-pointed away from `~/.claude/projects/` and the
// real home datalake. Nothing in `process.env` is touched.
//
// The round-trip proven (design §9/§11): save → persist to the datalake →
// reload reflects it.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { encodeTranscriptDirName } from '@metaswarm-dashboard/sessions';
import type { PathsEnv } from '@metaswarm-dashboard/types/paths';
import {
  SessionRating,
  type OperatorVerdict,
} from '@metaswarm-dashboard/types/ratings';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, resolveSessionsOptions } from '../server.js';

/** The SPA build stub the server's static plugin serves. */
const STATIC_ROOT = resolve(import.meta.dirname, 'fixtures/spa-dist');

/** The real synthetic transcript fixture shared with `packages/sessions`. */
const SYNTHETIC_TRANSCRIPT = resolve(
  import.meta.dirname,
  '../../../sessions/src/__tests__/fixtures/synthetic-events.jsonl',
);

/** The `sessionId` recorded inside the synthetic fixture's events. */
const SESSION_ID = 'sess-synth-2026-05-17';

/** The test project's name and a deterministic server clock. */
const PROJECT_NAME = 'sample-widget-service';
const NOW = new Date('2026-05-18T12:00:00.000Z');

/** Headers a same-origin browser PUT carries (design §8.1). */
const SAME_ORIGIN_HEADERS = {
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
};

let TMP: string;
let HOME: string;
let TRANSCRIPTS: string;
let DATALAKE: string;
let CONFIG_PATH: string;
let PROJECT_PATH: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'metaswarm-dashboard-sessions-e2e-'));
  // A self-contained temp tree mirroring a real install layout.
  HOME = join(TMP, 'home');
  TRANSCRIPTS = join(TMP, 'transcripts');
  DATALAKE = join(TMP, 'datalake');
  PROJECT_PATH = join(TMP, 'repos', PROJECT_NAME);
  CONFIG_PATH = join(TMP, 'config.yaml');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(DATALAKE, { recursive: true });
  mkdirSync(PROJECT_PATH, { recursive: true });

  // The transcripts dir holds Claude Code's `<encoded-cwd>/<sessionId>.jsonl`
  // layout. The encoded-cwd subdir name is computed with the REAL
  // `encodeTranscriptDirName` so discovery's encode step is exercised, not
  // hand-faked.
  const encodedDir = join(TRANSCRIPTS, encodeTranscriptDirName(PROJECT_PATH));
  mkdirSync(encodedDir, { recursive: true });
  copyFileSync(SYNTHETIC_TRANSCRIPT, join(encodedDir, `${SESSION_ID}.jsonl`));

  // A real `config.yaml` declaring the one project at the matching path.
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
 * Build a `PathsEnv` whose env vars point the config / transcripts / datalake
 * resolvers at this test's temp tree. This is the exact env shape
 * `resolveSessionsOptions` consumes in a production `serve` run.
 */
function envOf(): PathsEnv {
  return {
    platform: 'linux',
    homeDir: HOME,
    env: {
      METASWARM_DASHBOARD_CONFIG: CONFIG_PATH,
      METASWARM_DASHBOARD_DATA_DIR: DATALAKE,
      METASWARM_DASHBOARD_TRANSCRIPTS_DIR: TRANSCRIPTS,
    },
  };
}

/**
 * Build a server wired the way production wires it: the `sessions` block is
 * the output of the REAL `resolveSessionsOptions` (real `loadConfig`, real
 * path resolution) — not a hand-injected stub.
 */
async function makeRealServer() {
  const sessions = resolveSessionsOptions(envOf());
  return buildServer({
    dataDir: sessions.dataDir,
    staticRoot: STATIC_ROOT,
    now: () => NOW,
    sessions,
  });
}

/** The persisted rating file path in the temp datalake (design §13 layout). */
function ratingFile(): string {
  return join(
    DATALAKE,
    'projects',
    PROJECT_NAME,
    'sessions',
    'ratings',
    `${SESSION_ID}.rating.json`,
  );
}

describe('Sessions feature — end-to-end (real wiring, no stubbed deps)', () => {
  it('round-trips: list → rate → persist → reload reflects it → calibration moves', async () => {
    // --- precondition: resolveSessionsOptions loaded the real config -------
    const sessions = resolveSessionsOptions(envOf());
    expect(sessions.config.projects).toHaveLength(1);
    expect(sessions.config.projects[0]).toMatchObject({
      name: PROJECT_NAME,
      path: PROJECT_PATH,
    });
    expect(sessions.transcriptsDir).toBe(TRANSCRIPTS);
    expect(sessions.dataDir).toBe(DATALAKE);

    const app = await makeRealServer();

    // === (1) GET /api/sessions — the session is listed, rated: false ======
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/sessions',
    });
    expect(listBefore.statusCode).toBe(200);
    const sessionsBefore = listBefore.json().sessions;
    expect(sessionsBefore).toHaveLength(1);
    expect(sessionsBefore[0]).toMatchObject({
      projectName: PROJECT_NAME,
      sessionId: SESSION_ID,
      rated: false,
    });
    // The summary's event counts came from a real `parseTranscript`.
    expect(sessionsBefore[0].eventCount).toBeGreaterThan(0);

    // === (2) PUT .../rating — a valid same-origin write returns 200 =======
    // `tdd: pass` AGREES with the synthetic rubric (it scores `tdd: pass`);
    // `thrashing: fail` DISAGREES (the rubric scores `thrashing: pass`).
    // Picking one of each proves the calibration counts actually move.
    const verdicts: OperatorVerdict[] = [
      { key: 'tdd', verdict: 'pass', scoredAt: '2026-05-18T11:00:00.000Z' },
      { key: 'thrashing', verdict: 'fail', scoredAt: '2026-05-18T11:01:00.000Z' },
    ];
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/sessions/${PROJECT_NAME}/${SESSION_ID}/rating`,
      headers: SAME_ORIGIN_HEADERS,
      payload: { verdicts, overallNote: 'solid TDD, but one thrash loop' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.headers['content-type']).toContain('application/json');
    const persisted = putRes.json();
    // The response is a schema-valid `SessionRating`.
    expect(SessionRating.safeParse(persisted).success).toBe(true);
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      sessionId: SESSION_ID,
      projectName: PROJECT_NAME,
      verdicts,
      overallNote: 'solid TDD, but one thrash loop',
      ratedAt: NOW.toISOString(),
    });
    // `rubricAtRating` was re-derived server-side from the real transcript.
    expect(persisted.rubricAtRating.sessionId).toBe(SESSION_ID);
    expect(persisted.rubricAtRating.items).toHaveLength(9);

    // === (3) the rating file now exists in the temp datalake ==============
    expect(existsSync(ratingFile())).toBe(true);
    const onDisk = JSON.parse(readFileSync(ratingFile(), 'utf8'));
    expect(onDisk).toEqual(persisted);

    // === (4) GET .../:sessionId — a FRESH inject (simulates a reload) =====
    // A brand-new server, built from the same temp paths, must read the
    // rating back off disk — proving persistence survives a page reload.
    const reloaded = await makeRealServer();
    const detailRes = await reloaded.inject({
      method: 'GET',
      url: `/api/sessions/${PROJECT_NAME}/${SESSION_ID}`,
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.rating).not.toBeNull();
    expect(detail.rating).toEqual(persisted);
    // The detail also carries the live timeline + advisory rubric.
    expect(detail.timeline.eventCount).toBeGreaterThan(0);
    expect(detail.rubric.items).toHaveLength(9);

    // === (5) GET /api/sessions — that session is now rated: true ==========
    const listAfter = await reloaded.inject({
      method: 'GET',
      url: '/api/sessions',
    });
    expect(listAfter.statusCode).toBe(200);
    const sessionsAfter = listAfter.json().sessions;
    expect(sessionsAfter).toHaveLength(1);
    expect(sessionsAfter[0]).toMatchObject({
      projectName: PROJECT_NAME,
      sessionId: SESSION_ID,
      rated: true,
    });

    // === (6) GET /api/calibration — the summary reflects the rating =======
    const calibRes = await reloaded.inject({
      method: 'GET',
      url: '/api/calibration',
    });
    expect(calibRes.statusCode).toBe(200);
    const summary = calibRes.json().summary;
    // One session has now been rated.
    expect(summary.ratedSessionCount).toBe(1);
    // `tdd` agreed with the rubric → one `agree`, no `disagree`.
    const tdd = summary.perKpi.find(
      (k: { key: string }) => k.key === 'tdd',
    );
    expect(tdd).toMatchObject({ agree: 1, disagree: 0, naOrUnsure: 0 });
    expect(tdd.agreementRatio).toBe(1);
    // `thrashing` disagreed with the rubric → one `disagree`, no `agree`.
    const thrashing = summary.perKpi.find(
      (k: { key: string }) => k.key === 'thrashing',
    );
    expect(thrashing).toMatchObject({ agree: 0, disagree: 1, naOrUnsure: 0 });
    expect(thrashing.agreementRatio).toBe(0);
    // An un-rated KPI stays all-zero — the counts moved ONLY where rated.
    const planning = summary.perKpi.find(
      (k: { key: string }) => k.key === 'planning',
    );
    expect(planning).toMatchObject({ agree: 0, disagree: 0, naOrUnsure: 0 });

    await app.close();
    await reloaded.close();
  });
});
