// Unit tests for the tdd scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail / na cells plus the documented
// §7-vs-AppendixA conflict resolution (prod code, zero tests -> fail).

import { describe, expect, it } from 'vitest';

import { scoreTdd } from '../../rubric/tdd.js';

import { timeline, tool } from './helpers.js';

describe('scoreTdd', () => {
  it('label and key are stable', () => {
    const item = scoreTdd(timeline([tool('Bash', 'npm test')]));
    expect(item.key).toBe('tdd');
    expect(item.label).toBe('TDD discipline');
  });

  it('returns na when neither test nor production files are written', () => {
    const item = scoreTdd(timeline([tool('Read', 'AGENTS.md'), tool('Bash', 'npm test')]));
    expect(item.verdict).toBe('na');
    expect(item.pointer).toBeNull();
  });

  it('passes when every production write follows its sibling test write', () => {
    const item = scoreTdd(
      timeline([
        tool('Write', 'src/__tests__/foo.test.ts'),
        tool('Write', 'src/foo.ts'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('watches when one pair is test-first and another is production-first', () => {
    const item = scoreTdd(
      timeline([
        tool('Write', 'src/foo.test.ts'),
        tool('Write', 'src/foo.ts'),
        tool('Write', 'src/bar.ts'),
        tool('Write', 'src/bar.test.ts'),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('fails when production code is written with zero test files (§7-vs-AppendixA)', () => {
    const item = scoreTdd(timeline([tool('Write', 'src/foo.ts')]));
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
    expect(item.evidence).toContain('1 production write ');
  });

  it('fails with a plural evidence when multiple prod files have zero tests', () => {
    const item = scoreTdd(
      timeline([tool('Write', 'src/foo.ts'), tool('Write', 'src/bar.ts')]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toContain('2 production writes ');
  });

  it('fails when a production write is written before its sibling test', () => {
    const item = scoreTdd(
      timeline([tool('Write', 'src/foo.ts'), tool('Write', 'src/foo.test.ts')]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toContain('1 production write ');
  });

  it('fails with a plural evidence when multiple prod writes precede their tests', () => {
    const item = scoreTdd(
      timeline([
        tool('Write', 'src/foo.ts'),
        tool('Write', 'src/foo.test.ts'),
        tool('Write', 'src/bar.ts'),
        tool('Write', 'src/bar.test.ts'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toContain('2 production writes ');
  });

  it('watches when a production write has no sibling test but others are test-first', () => {
    const item = scoreTdd(
      timeline([
        tool('Write', 'src/foo.test.ts'),
        tool('Write', 'src/foo.ts'),
        tool('Write', 'src/orphan.ts'),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('passes when only test files are written, no production', () => {
    const item = scoreTdd(timeline([tool('Write', 'src/foo.test.ts')]));
    expect(item.verdict).toBe('pass');
  });
});
