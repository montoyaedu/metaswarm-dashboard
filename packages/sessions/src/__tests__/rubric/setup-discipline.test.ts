// Unit tests for the setup-discipline scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail cells. setup-discipline has no
// `na` branch — it is always scored.

import { describe, expect, it } from 'vitest';

import { scoreSetupDiscipline } from '../../rubric/setup-discipline.js';

import { timeline, tool } from './helpers.js';

describe('scoreSetupDiscipline', () => {
  it('label and key are stable', () => {
    const item = scoreSetupDiscipline(timeline([tool('Write', 'src/a.ts')]));
    expect(item.key).toBe('setup-discipline');
    expect(item.label).toBe('Setup discipline');
  });

  it('passes when >=3 convention docs are read before the first write', () => {
    const item = scoreSetupDiscipline(
      timeline([
        tool('Read', 'AGENTS.md'),
        tool('Read', 'CLAUDE.md'),
        tool('Read', '.agents/index.md'),
        tool('Write', 'src/foo.ts'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
    expect(item.evidence).toContain('3');
  });

  it('watches when 1-2 convention docs are read before the first write', () => {
    const item = scoreSetupDiscipline(
      timeline([
        tool('Read', 'AGENTS.md'),
        tool('Read', 'src/other.ts'),
        tool('Write', 'src/foo.ts'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
  });

  it('fails when no convention docs are read before the first write', () => {
    const item = scoreSetupDiscipline(
      timeline([tool('Read', 'src/other.ts'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toBeNull();
  });

  it('ignores convention reads that happen after the first write', () => {
    const item = scoreSetupDiscipline(
      timeline([
        tool('Read', 'AGENTS.md'),
        tool('Write', 'src/foo.ts'),
        tool('Read', 'CLAUDE.md'),
        tool('Read', '.agents/index.md'),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('fails a session that never reads conventions even with no writes', () => {
    const item = scoreSetupDiscipline(timeline([tool('Bash', 'npm test')]));
    expect(item.verdict).toBe('fail');
  });
});
