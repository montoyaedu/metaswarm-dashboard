// Unit tests for the planning scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail cells plus the documented
// no-source-write edge.

import { describe, expect, it } from 'vitest';

import { scorePlanning } from '../../rubric/planning.js';

import { timeline, tool } from './helpers.js';

describe('scorePlanning', () => {
  it('label and key are stable', () => {
    const item = scorePlanning(timeline([tool('Write', 'src/a.ts')]));
    expect(item.key).toBe('planning');
    expect(item.label).toBe('Planning vs cowboy');
  });

  it('passes when a bd create precedes the first src write', () => {
    const item = scorePlanning(
      timeline([tool('Bash', "bd create 'WU-4'"), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
  });

  it('passes when a bd update --claim precedes the first src write', () => {
    const item = scorePlanning(
      timeline([tool('Bash', 'bd update abc --claim'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('watches when only an .agents/ write precedes the first src write', () => {
    const item = scorePlanning(
      timeline([tool('Write', '.agents/notes.md'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
  });

  it('fails when a src write has no prior bd or .agents activity', () => {
    const item = scorePlanning(
      timeline([tool('Read', 'README.md'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 1 });
  });

  it('ignores bd create that happens after the first src write', () => {
    const item = scorePlanning(
      timeline([tool('Write', 'src/foo.ts'), tool('Bash', "bd create 'late'")]),
    );
    expect(item.verdict).toBe('fail');
  });

  it('ignores a bd update without --claim', () => {
    const item = scorePlanning(
      timeline([tool('Bash', 'bd update abc --status open'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('fail');
  });

  it('passes with a no-source-write evidence when the session writes no src code', () => {
    const item = scorePlanning(
      timeline([tool('Read', 'AGENTS.md'), tool('Write', 'docs/notes.md')]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('no source files written');
    expect(item.pointer).toBeNull();
  });
});
