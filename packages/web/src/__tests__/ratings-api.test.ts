// WU v4-7 — typed GET-only read client for the v4-5 session endpoints.
// Each method: success parse (envelope unwrapped) + non-2xx → thrown error.

import type { CalibrationSummary } from '@metaswarm-dashboard/types/ratings';
import type {
  ProcessRubricScore,
  SessionSummary,
  SessionTimeline,
} from '@metaswarm-dashboard/types/sessions';
import { describe, expect, it, vi } from 'vitest';

import { createRatingsApi, RatingsApiError } from '../lib/ratings-api.js';

const RUBRIC_KEYS = [
  'setup-discipline',
  'planning',
  'tdd',
  'error-handling',
  'thrashing',
  'cross-reference',
  'communication',
  'prompt-coherence',
  'workflow-touchpoints',
] as const;

const SUMMARY: SessionSummary = {
  projectName: 'alpha',
  sessionId: 'sess-a1',
  startedAt: '2026-05-17T06:00:00.000Z',
  lastEventAt: '2026-05-17T06:30:00.000Z',
  eventCount: 12,
  rated: false,
};

const TIMELINE: SessionTimeline = {
  schemaVersion: 1,
  transcriptPath: '/transcripts/alpha/sess-a1.jsonl',
  sessionId: 'sess-a1',
  projectCwd: '/repos/alpha',
  startedAt: '2026-05-17T06:00:00.000Z',
  lastEventAt: '2026-05-17T06:30:00.000Z',
  eventCount: 1,
  skippedLineCount: 0,
  events: [
    {
      at: '2026-05-17T06:00:00.000Z',
      kind: 'user-prompt',
      toolName: null,
      summary: 'first prompt',
      redactionApplied: [],
      uuid: 'u-0',
    },
  ],
};

const RUBRIC: ProcessRubricScore = {
  schemaVersion: 1,
  sessionId: 'sess-a1',
  scoredAt: '2026-05-17T08:00:00.000Z',
  items: RUBRIC_KEYS.map((key) => ({
    key,
    label: key,
    verdict: 'pass' as const,
    evidence: 'ok',
    pointer: null,
  })),
  overall: 'pass',
};

const CALIBRATION: CalibrationSummary = {
  schemaVersion: 1,
  generatedAt: '2026-05-17T12:00:00.000Z',
  ratedSessionCount: 0,
  perKpi: RUBRIC_KEYS.map((key) => ({
    key,
    agree: 0,
    disagree: 0,
    naOrUnsure: 0,
    total: 0,
    agreementRatio: null,
  })),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ratings-api — getSessions', () => {
  it('GETs /api/sessions and unwraps the { sessions } envelope', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({ sessions: [SUMMARY] }));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    const out = await api.getSessions();
    expect(calls[0]).toBe('/api/sessions');
    expect(out).toEqual([SUMMARY]);
  });

  it('appends an encoded ?project query when a project is supplied', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({ sessions: [] }));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('http://server', fetchImpl);
    await api.getSessions('weird name');
    expect(calls[0]).toBe('http://server/api/sessions?project=weird%20name');
  });

  it('throws RatingsApiError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    ) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    await expect(api.getSessions()).rejects.toThrow(RatingsApiError);
  });
});

describe('ratings-api — getSession', () => {
  it('GETs /api/sessions/:project/:sessionId and returns the triple', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({ timeline: TIMELINE, rubric: RUBRIC, rating: null }));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    const out = await api.getSession('alpha', 'sess-a1');
    expect(calls[0]).toBe('/api/sessions/alpha/sess-a1');
    expect(out.timeline).toEqual(TIMELINE);
    expect(out.rubric).toEqual(RUBRIC);
    expect(out.rating).toBeNull();
  });

  it('encodes both path segments', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({ timeline: TIMELINE, rubric: RUBRIC, rating: null }));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    await api.getSession('weird proj', 'weird id');
    expect(calls[0]).toBe('/api/sessions/weird%20proj/weird%20id');
  });

  it('exposes the HTTP status on the thrown error (404)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('not found', { status: 404 })),
    ) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    try {
      await api.getSession('alpha', 'nope');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RatingsApiError);
      expect((err as RatingsApiError).status).toBe(404);
    }
  });
});

describe('ratings-api — getCalibration', () => {
  it('GETs /api/calibration and unwraps the { summary } envelope', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({ summary: CALIBRATION }));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    const out = await api.getCalibration();
    expect(calls[0]).toBe('/api/calibration');
    expect(out).toEqual(CALIBRATION);
  });

  it('throws RatingsApiError on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('err', { status: 503 })),
    ) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    await expect(api.getCalibration()).rejects.toThrow(RatingsApiError);
  });
});
