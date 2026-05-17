// Unit tests for the thrashing scorer (sessions-spike WU-4, design §7).
// Covers Appendix A's pass / watch / fail cells. thrashing has no na branch.
//
// A thrash "episode" is a pair of consecutive `Edit` tool-use events WITHIN
// the Edit subsequence (i.e. the next Edit after a given Edit, regardless of
// how many tool-result/text/thinking/other events sit between them) that
// target the same file path, are <5s apart, and have NO same-file `Read`
// tool-use between them. The interleaved `tool-result` that always follows a
// real tool-use must therefore NOT break an episode — these tests pin that.

import { describe, expect, it } from 'vitest';

import { scoreThrashing } from '../../rubric/thrashing.js';

import { ev, timeline, tool } from './helpers.js';

/** Build a tool-use with an explicit absolute timestamp. */
function at(toolName: string, summary: string, iso: string) {
  return tool(toolName, summary, iso);
}

/** A `tool-result` event with an explicit timestamp (the event that always
 *  sits between a real tool-use and the next one in a transcript). */
function result(iso: string) {
  return ev('tool-result', { at: iso });
}

describe('scoreThrashing', () => {
  it('label and key are stable', () => {
    const item = scoreThrashing(timeline([tool('Read', 'src/a.ts')]));
    expect(item.key).toBe('thrashing');
    expect(item.label).toBe('No thrashing');
  });

  it('passes with no episodes when there are fewer than two Edits', () => {
    const item = scoreThrashing(
      timeline([
        at('Read', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash episodes');
    expect(item.pointer).toBeNull();
  });

  it('passes when two consecutive same-file Edits are 5s or more apart', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:05.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('passes when consecutive Edits are on different files', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/b.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('counts an episode even when a tool-result and text sit between the Edits', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        ev('assistant-text', { at: '2026-05-17T10:00:00.500Z' }),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe(
      '1 thrash episode (consecutive Edit on src/a.ts <5s, no intervening read)',
    );
    // Pointer at the SECOND Edit of the first episode (index 3 here).
    expect(item.pointer).toEqual({ kind: 'index', value: 3 });
  });

  it('breaks an episode when a same-file Read sits between the two Edits', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Read', 'src/a.ts', '2026-05-17T10:00:00.500Z'),
        result('2026-05-17T10:00:00.600Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.pointer).toBeNull();
  });

  it('does NOT break an episode for a Read of a DIFFERENT file', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Read', 'src/other.ts', '2026-05-17T10:00:00.500Z'),
        result('2026-05-17T10:00:00.600Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toEqual({ kind: 'index', value: 4 });
  });

  it('watches when 1-3 thrash episodes occur', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe(
      '1 thrash episode (consecutive Edit on src/a.ts <5s, no intervening read)',
    );
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('pluralises the evidence for more than one episode', () => {
    // 3 consecutive same-file Edits within 5s → 2 episodes → still watch.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe(
      '2 thrash episodes (consecutive Edit on src/a.ts <5s, no intervening read)',
    );
    // Pointer at the second Edit of the FIRST episode (index 2).
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('fails when >=4 thrash episodes occur', () => {
    // 5 consecutive same-file Edits within 5s → 4 episodes → fail.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
        result('2026-05-17T10:00:02.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:03.000Z'),
        result('2026-05-17T10:00:03.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:04.000Z'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toBe(
      '4 thrash episodes (consecutive Edit on src/a.ts <5s, no intervening read)',
    );
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('reports the path of the first episode when episodes span multiple files', () => {
    // First episode on src/b.ts, then a non-thrashing gap, no other episodes.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/b.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/b.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.evidence).toBe(
      '1 thrash episode (consecutive Edit on src/b.ts <5s, no intervening read)',
    );
  });
});
