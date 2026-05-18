// WU v4-7 — typed GET-only read client for the v4-5 session endpoints.
// WU v4-8 — adds `putRating` (the one sanctioned write call).
// Each method: success parse (envelope unwrapped) + non-2xx → thrown error.

import type {
  CalibrationSummary,
  OperatorVerdict,
  SessionRating,
} from '@metaswarm-dashboard/types/ratings';
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

describe('ratings-api — putRating', () => {
  const VERDICTS: OperatorVerdict[] = [
    {
      key: 'planning',
      verdict: 'pass',
      scoredAt: '2026-05-17T09:00:00.000Z',
    },
  ];

  const PERSISTED: SessionRating = {
    schemaVersion: 1,
    sessionId: 'sess-a1',
    projectName: 'alpha',
    verdicts: VERDICTS,
    overallNote: 'looked good',
    ratedAt: '2026-05-17T09:00:01.000Z',
    rubricAtRating: RUBRIC,
  };

  it('PUTs /api/sessions/:project/:sessionId/rating with a JSON body', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(jsonResponse(PERSISTED));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);

    const out = await api.putRating('alpha', 'sess-a1', {
      verdicts: VERDICTS,
      overallNote: 'looked good',
    });

    expect(seenUrl).toBe('/api/sessions/alpha/sess-a1/rating');
    expect(seenInit?.method).toBe('PUT');
    expect((seenInit?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(JSON.parse(seenInit?.body as string)).toEqual({
      verdicts: VERDICTS,
      overallNote: 'looked good',
    });
    expect(out).toEqual(PERSISTED);
  });

  it('encodes both path segments', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse(PERSISTED));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('http://server', fetchImpl);
    await api.putRating('weird proj', 'weird id', { verdicts: VERDICTS });
    expect(calls[0]).toBe('http://server/api/sessions/weird%20proj/weird%20id/rating');
  });

  it('omits overallNote from the body when it is not supplied', async () => {
    let sentBody = '';
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      sentBody = init?.body as string;
      return Promise.resolve(jsonResponse(PERSISTED));
    }) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    await api.putRating('alpha', 'sess-a1', { verdicts: VERDICTS });
    expect(JSON.parse(sentBody)).toEqual({ verdicts: VERDICTS });
  });

  it('returns the persisted SessionRating from the response body', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(PERSISTED)),
    ) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    const out = await api.putRating('alpha', 'sess-a1', { verdicts: VERDICTS });
    expect(out.verdicts).toEqual(VERDICTS);
    expect(out.rubricAtRating).toEqual(RUBRIC);
  });

  it('throws RatingsApiError carrying the status on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('too large', { status: 413 })),
    ) as unknown as typeof fetch;
    const api = createRatingsApi('', fetchImpl);
    try {
      await api.putRating('alpha', 'sess-a1', { verdicts: VERDICTS });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RatingsApiError);
      expect((err as RatingsApiError).status).toBe(413);
    }
  });
});
