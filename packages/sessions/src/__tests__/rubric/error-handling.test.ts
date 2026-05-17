// Unit tests for the error-handling scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail / na cells.

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
    expect(item.pointer).toBeNull();
  });

  it('passes when every error is followed by a corrective Read within 2 events', () => {
    const item = scoreErrorHandling(
      timeline([
        ev('tool-error', { summary: 'FAIL' }),
        tool('Read', 'src/foo.ts'),
        ev('tool-error', { summary: 'FAIL' }),
        tool('Read', 'src/bar.ts'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('treats an assistant-text immediately after an error as a corrective response', () => {
    const item = scoreErrorHandling(
      timeline([
        ev('tool-error', { summary: 'FAIL' }),
        ev('assistant-text', { summary: 'Diagnosing the failure.' }),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('treats a Grep within 2 events as a corrective response', () => {
    const item = scoreErrorHandling(
      timeline([
        ev('tool-error', { summary: 'FAIL' }),
        ev('assistant-thinking', { summary: 'hmm' }),
        tool('Grep', 'import Buffer'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('watches when half the errors get a corrective response', () => {
    const item = scoreErrorHandling(
      timeline([
        ev('tool-error', { summary: 'FAIL 1' }),
        tool('Read', 'src/foo.ts'),
        ev('tool-error', { summary: 'FAIL 2' }),
        ev('tool-result', { summary: 'nothing useful' }),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('fails when fewer than half the errors get a corrective response', () => {
    const item = scoreErrorHandling(
      timeline([
        ev('tool-error', { summary: 'E1' }),
        ev('tool-result', { summary: 'x' }),
        ev('tool-error', { summary: 'E2' }),
        ev('tool-result', { summary: 'x' }),
        ev('tool-error', { summary: 'E3' }),
        ev('tool-result', { summary: 'x' }),
        ev('tool-error', { summary: 'E4' }),
        tool('Read', 'src/foo.ts'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
  });
});
