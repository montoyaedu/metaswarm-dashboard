// Unit tests for the error-handling scorer (sessions-spike WU-4, design §5
// — v4 rewrite). Covers every verdict branch with hand-crafted timelines.
//
// v4 rule: a `tool-error` at index i is UNHANDLED iff `events[i+1]` is a
// `tool-use` whose `(toolName, summary)` equals the errored call's (the
// nearest preceding `tool-use`) — a blind identical retry — OR no event
// follows i (session ended on the error). HANDLED is the exact complement.
// Verdict on handled/total ratio: ≥0.8 pass · 0.5–0.8 watch · <0.5 fail ·
// 0 errors na.

import { describe, expect, it } from 'vitest';

import { scoreErrorHandling } from '../../rubric/error-handling.js';

import { ev, timeline, tool } from './helpers.js';

describe('scoreErrorHandling', () => {
  it('label and key are stable', () => {
    const item = scoreErrorHandling(timeline([tool('Bash', 'npm test')]));
    expect(item.key).toBe('error-handling');
    expect(item.label).toBe('Error handling');
  });

  it('returns na when the session has zero tool errors', () => {
    const item = scoreErrorHandling(timeline([tool('Bash', 'npm test')]));
    expect(item.verdict).toBe('na');
    expect(item.evidence).toBe('no tool errors in session');
    expect(item.pointer).toBeNull();
  });

  it('treats a blind identical retry of the errored call as unhandled', () => {
    // The errored call is the Bash before the error; the very next event
    // repeats it verbatim — a blind retry, so the error is unhandled.
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Bash', 'npm test'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toBe('0/1 tool errors got a corrective response');
    expect(item.pointer).toEqual({ kind: 'index', value: 1 });
  });

  it('treats a session that ends on the error as unhandled', () => {
    const item = scoreErrorHandling(
      timeline([tool('Bash', 'npm test'), ev('tool-error', { summary: 'FAIL' })]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 1 });
  });

  it('treats a diagnostic Bash after the error as handled', () => {
    // The next event is a tool-use but NOT the errored call — the agent ran
    // a diagnostic shell command (`git status`), so the error is handled.
    // v3 wrongly scored this as unhandled (only Read/Grep counted).
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Bash', 'git status'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('1/1 tool errors got a corrective response');
    expect(item.pointer).toBeNull();
  });

  it('treats an assistant-text after the error as handled', () => {
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        ev('assistant-text', { summary: 'Diagnosing the failure.' }),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('treats an assistant-thinking after the error as handled', () => {
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        ev('assistant-thinking', { summary: 'hmm, why did that fail' }),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('treats a different-tool retry as handled (only an identical retry is unhandled)', () => {
    // The next event is a tool-use with a DIFFERENT toolName than the
    // errored call — not a blind identical retry, so handled.
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Read', 'npm test'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('treats a same-tool different-summary call as handled', () => {
    // Same toolName but a different summary — the agent changed the call, so
    // it is not a blind retry: handled.
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Bash', 'npm test -- --reporter verbose'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('treats an error with no preceding tool-use as handled when a tool-use follows', () => {
    // No `tool-use` precedes the error → there is no errored call to compare
    // against, so the next tool-use can never be a blind identical retry:
    // the error is handled.
    const item = scoreErrorHandling(
      timeline([ev('tool-error', { summary: 'FAIL' }), tool('Bash', 'npm test')]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('skips non-tool-use events when finding the errored call', () => {
    // The event right before the error is assistant-thinking, not a
    // tool-use; the scorer walks back to the Bash. The next event repeats
    // that Bash verbatim → unhandled.
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'npm test'),
        ev('assistant-thinking', { summary: 'running tests' }),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Bash', 'npm test'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('passes at the ≥0.8 boundary (4 of 5 handled = 0.8)', () => {
    // 5 errors: 4 handled (assistant-text follows), 1 unhandled (blind
    // retry). ratio = 0.8 → pass.
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'cmd-a'),
        ev('tool-error', { summary: 'E1' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-b'),
        ev('tool-error', { summary: 'E2' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-c'),
        ev('tool-error', { summary: 'E3' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-d'),
        ev('tool-error', { summary: 'E4' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-e'),
        ev('tool-error', { summary: 'E5' }),
        tool('Bash', 'cmd-e'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('4/5 tool errors got a corrective response');
    expect(item.pointer).toBeNull();
  });

  it('watches at the 0.5 boundary (1 of 2 handled = 0.5)', () => {
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'cmd-a'),
        ev('tool-error', { summary: 'E1' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-b'),
        ev('tool-error', { summary: 'E2' }),
        tool('Bash', 'cmd-b'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe('1/2 tool errors got a corrective response');
    // Pointer is the first unhandled error (the second tool-error).
    expect(item.pointer).toEqual({ kind: 'index', value: 4 });
  });

  it('watches just below 0.8 (3 of 4 handled = 0.75)', () => {
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'cmd-a'),
        ev('tool-error', { summary: 'E1' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-b'),
        ev('tool-error', { summary: 'E2' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-c'),
        ev('tool-error', { summary: 'E3' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-d'),
        ev('tool-error', { summary: 'E4' }),
        tool('Bash', 'cmd-d'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe('3/4 tool errors got a corrective response');
  });

  it('fails just below 0.5 (1 of 3 handled = 0.33)', () => {
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', 'cmd-a'),
        ev('tool-error', { summary: 'E1' }),
        ev('assistant-text', { summary: 'looking' }),
        tool('Bash', 'cmd-b'),
        ev('tool-error', { summary: 'E2' }),
        tool('Bash', 'cmd-b'),
        ev('tool-error', { summary: 'E3' }),
        tool('Bash', 'cmd-b'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toBe('1/3 tool errors got a corrective response');
    expect(item.pointer).toEqual({ kind: 'index', value: 4 });
  });

  it('treats two distinct calls with an identical truncated summary as equal (limitation)', () => {
    // EDGE CASE — summary is truncated to ≤200 chars. Two genuinely
    // DISTINCT Bash calls whose first 200 chars coincide are indistinguish-
    // able to the scorer: the post-error call compares equal to the errored
    // call, so a real "changed the command" is misread as a blind retry and
    // the error is scored unhandled. Documented limitation: the rubric is an
    // advisory hint, not an oracle (design §5).
    const prefix = 'x'.repeat(200);
    const item = scoreErrorHandling(
      timeline([
        tool('Bash', prefix),
        ev('tool-error', { summary: 'FAIL' }),
        // A distinct command in reality, but its first 200 chars equal the
        // errored call's truncated summary, so it compares as identical.
        tool('Bash', prefix),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 1 });
  });
});
