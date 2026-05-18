// Unit tests for the cross-reference scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / na cells. No `fail` branch.

import { describe, expect, it } from 'vitest';

import { scoreCrossReference } from '../../rubric/cross-reference.js';

import { timeline, tool } from './helpers.js';

describe('scoreCrossReference', () => {
  it('label and key are stable', () => {
    const item = scoreCrossReference(timeline([tool('Write', 'packages/a/src/x.ts')]));
    expect(item.key).toBe('cross-reference');
    expect(item.label).toBe('Cross-ref to context');
  });

  it('returns na for single-package work', () => {
    const item = scoreCrossReference(
      timeline([
        tool('Write', 'packages/a/src/x.ts'),
        tool('Write', 'packages/a/src/y.ts'),
      ]),
    );
    expect(item.verdict).toBe('na');
    expect(item.pointer).toBeNull();
  });

  it('returns na when there are no writes at all', () => {
    const item = scoreCrossReference(timeline([tool('Read', 'AGENTS.md')]));
    expect(item.verdict).toBe('na');
  });

  it('passes for multi-package work with >=1 cross-ref doc read', () => {
    const item = scoreCrossReference(
      timeline([
        tool('Read', '.agents/notes.md'),
        tool('Write', 'packages/a/src/x.ts'),
        tool('Write', 'packages/b/src/y.ts'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toEqual({ kind: 'index', value: 0 });
  });

  it('watches multi-package work with zero cross-ref doc reads', () => {
    const item = scoreCrossReference(
      timeline([
        tool('Write', 'packages/a/src/x.ts'),
        tool('Write', 'packages/b/src/y.ts'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toBeNull();
  });

  it('does not count a Read of a src/ file as a cross-ref read', () => {
    const item = scoreCrossReference(
      timeline([
        tool('Read', 'packages/c/src/z.ts'),
        tool('Write', 'packages/a/src/x.ts'),
        tool('Write', 'packages/b/src/y.ts'),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });
});
