// Unit tests for the thrashing scorer (sessions-spike WU-4, design §5 — v4
// rewrite). Covers every verdict branch with hand-crafted timelines.
//
// v4 rule: a thrash run is a maximal run of ≥3 `Edit` tool-use events to the
// SAME file path, each <5000ms after the previous Edit of the run, with no
// `Read` tool-use of that same path between two consecutive edits. Verdict
// on the run count: 0 pass · 1 watch · ≥2 fail. No `na` branch.
//
// "Consecutive" is within the Edit subsequence — the interleaved
// `tool-result` that always follows a real tool-use must NOT break a run.

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

  it('passes a session with no Edit events at all', () => {
    const item = scoreThrashing(
      timeline([at('Read', 'src/a.ts', '2026-05-17T10:00:00.000Z')]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('passes a session with a single Edit', () => {
    const item = scoreThrashing(
      timeline([at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z')]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('passes when only two consecutive same-file Edits occur (below the ≥3 bar)', () => {
    // v3 fired `watch` on a single same-file <5s Edit pair; v4 requires a run
    // of ≥3, so the normal "edit section A, then edit section B" passes.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('watches a run of exactly 3 same-file Edits <5s apart', () => {
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
      '1 thrash run (≥3 Edits on src/a.ts <5s apart, no intervening read)',
    );
    // Pointer at the run's SECOND edit (index 2).
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('counts a run even when tool-result and assistant-text sit between Edits', () => {
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        ev('assistant-text', { at: '2026-05-17T10:00:00.500Z' }),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toEqual({ kind: 'index', value: 3 });
  });

  it('fails a single run of 5 same-file Edits <5s apart split into two runs by a gap', () => {
    // Edits 1-2-3 are <5s apart (run of 3 → 1 run); a >5s gap breaks the run;
    // edits 4-5-6 are <5s apart (run of 3 → another run). 2 runs → fail.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
        result('2026-05-17T10:00:02.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:30.000Z'),
        result('2026-05-17T10:00:30.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:31.000Z'),
        result('2026-05-17T10:00:31.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:32.000Z'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toBe(
      '2 thrash runs (≥3 Edits on src/a.ts <5s apart, no intervening read)',
    );
    // Pointer at the SECOND edit of the FIRST run (index 2).
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('watches a single uninterrupted run of 5 same-file Edits <5s apart', () => {
    // One long run of 5 edits, all <5s apart — that is a single run, so
    // `watch`, not `fail` (run COUNT, not edit count, drives the verdict).
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
    expect(item.verdict).toBe('watch');
    expect(item.evidence).toBe(
      '1 thrash run (≥3 Edits on src/a.ts <5s apart, no intervening read)',
    );
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('breaks a run when a >5s gap separates two consecutive Edits', () => {
    // Edits 1-2 are <5s apart, edit 3 is >5s after edit 2: the run is split
    // into [1,2] (length 2) and [3] (length 1) — neither reaches 3 → pass.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:10.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('breaks a run when a same-file Read sits between two of the Edits', () => {
    // Edits 1-2-3 of src/a.ts <5s apart, but a Read of src/a.ts sits between
    // edits 2 and 3 — the agent investigated, so the run splits into [1,2]
    // and [3] and neither reaches 3 → pass.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Read', 'src/a.ts', '2026-05-17T10:00:01.500Z'),
        result('2026-05-17T10:00:01.600Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('does NOT break a run for a Read of a DIFFERENT file', () => {
    // A Read of src/other.ts between same-file Edits does not break the run.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Read', 'src/other.ts', '2026-05-17T10:00:01.500Z'),
        result('2026-05-17T10:00:01.600Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:02.000Z'),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });

  it('breaks a run when consecutive Edits target different files', () => {
    // A-A-B-A: the A-B transition breaks the first run ([A,A] = length 2),
    // B starts a run of its own ([B] = length 1), then the B-A transition
    // breaks that and A starts a run ([A] = length 1). No run reaches 3.
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/a.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/b.ts', '2026-05-17T10:00:02.000Z'),
        result('2026-05-17T10:00:02.100Z'),
        at('Edit', 'src/a.ts', '2026-05-17T10:00:03.000Z'),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toBe('0 thrash runs');
    expect(item.pointer).toBeNull();
  });

  it('reports the path of the first run when runs span multiple files', () => {
    // Run 1 on src/b.ts (3 edits), a >5s gap, run 2 on src/c.ts (3 edits).
    const item = scoreThrashing(
      timeline([
        at('Edit', 'src/b.ts', '2026-05-17T10:00:00.000Z'),
        result('2026-05-17T10:00:00.100Z'),
        at('Edit', 'src/b.ts', '2026-05-17T10:00:01.000Z'),
        result('2026-05-17T10:00:01.100Z'),
        at('Edit', 'src/b.ts', '2026-05-17T10:00:02.000Z'),
        result('2026-05-17T10:00:02.100Z'),
        at('Edit', 'src/c.ts', '2026-05-17T10:00:30.000Z'),
        result('2026-05-17T10:00:30.100Z'),
        at('Edit', 'src/c.ts', '2026-05-17T10:00:31.000Z'),
        result('2026-05-17T10:00:31.100Z'),
        at('Edit', 'src/c.ts', '2026-05-17T10:00:32.000Z'),
      ]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.evidence).toBe(
      '2 thrash runs (≥3 Edits on src/b.ts <5s apart, no intervening read)',
    );
    expect(item.pointer).toEqual({ kind: 'index', value: 2 });
  });
});
