// Unit tests for the communication scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail / na cells.

import { describe, expect, it } from 'vitest';

import { scoreCommunication } from '../../rubric/communication.js';

import { ev, timeline, tool } from './helpers.js';

/** Pad a timeline to >=10 events with inert assistant-thinking entries. */
function padded(events: ReturnType<typeof tool>[]) {
  const filler = Array.from({ length: 10 }, (_, i) =>
    ev('assistant-thinking', { summary: `t${i}` }),
  );
  return timeline([...events, ...filler]);
}

describe('scoreCommunication', () => {
  it('label and key are stable', () => {
    const item = scoreCommunication(timeline([tool('Bash', 'npm test')]));
    expect(item.key).toBe('communication');
    expect(item.label).toBe('External communication');
  });

  it('returns na for sessions with fewer than 10 events', () => {
    const item = scoreCommunication(
      timeline([tool('Bash', 'bd close abc'), tool('Write', '.agents/notes.md')]),
    );
    expect(item.verdict).toBe('na');
    expect(item.pointer).toBeNull();
  });

  it('passes when a bd close AND an .agents/ write are both present', () => {
    const item = scoreCommunication(
      padded([tool('Bash', 'bd close abc --reason done'), tool('Write', '.agents/notes.md')]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('accepts bd update --notes as a communication-close signal', () => {
    const item = scoreCommunication(
      padded([tool('Bash', 'bd update abc --notes "progress"'), tool('Write', '.agents/x.md')]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('accepts mini yt comment as a communication-close signal', () => {
    const item = scoreCommunication(
      padded([tool('Bash', 'mini yt comment ABC-1 "done"'), tool('Edit', '.agents/x.md')]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('watches when only a bd close is present, no .agents/ write', () => {
    const item = scoreCommunication(padded([tool('Bash', 'bd close abc')]));
    expect(item.verdict).toBe('watch');
  });

  it('watches when only an .agents/ write is present, no bd close', () => {
    const item = scoreCommunication(padded([tool('Write', '.agents/notes.md')]));
    expect(item.verdict).toBe('watch');
  });

  it('fails when neither a bd close nor an .agents/ write is present', () => {
    const item = scoreCommunication(padded([tool('Bash', 'npm test')]));
    expect(item.verdict).toBe('fail');
  });
});
