// tdd scorer (sessions-spike WU-4, design §7).
//
// Signal: for each production source file written, was its sibling test
// file written first?
//
// §7-vs-AppendixA conflict resolution (documented per the WU-4 brief):
// design §7's verdict table says "no test files -> na", but Appendix A's
// `fail` cell is "Write foo.ts with no test-write at all". Scoring an
// untested-production session `na` would HIDE a real TDD violation behind
// a non-applicable verdict. We therefore resolve the conflict in favour of
// Appendix A's intent: production writes with zero test writes -> `fail`.
// `na` is reserved for sessions that write neither production nor test code.
//
// Pairing is deliberately simple: each production write is matched to a
// test write that shares its basename "stem" (basename minus `.test`/`.spec`
// and extension). A production write is "test-first" when a sibling test
// write occurs at an earlier event index.

import type {
  RubricItem,
  SessionTimeline,
  ToolUseEvent,
} from '@metaswarm-dashboard/types/sessions';

import { isSrcCode, isTestFile } from './util.js';

/** The basename stem of a path: basename with any `.test`/`.spec` infix and
 *  the trailing extension removed. `src/__tests__/foo.test.ts` -> `foo`. */
function stem(p: string): string {
  // The basename is everything after the last `/`. `lastIndexOf` returns -1
  // when there is no slash, and `slice(-1 + 1)` == `slice(0)` yields the
  // whole string — so this needs no separate no-slash branch.
  const base = p.slice(p.lastIndexOf('/') + 1);
  return base.replace(/\.(test|spec)\.[A-Za-z]+$/, '').replace(/\.[A-Za-z]+$/, '');
}

interface IndexedWrite {
  index: number;
  event: ToolUseEvent;
}

export function scoreTdd(timeline: SessionTimeline): RubricItem {
  const writes: IndexedWrite[] = [];
  timeline.events.forEach((event, index) => {
    if (event.kind === 'tool-use' && (event.toolName === 'Write' || event.toolName === 'Edit')) {
      writes.push({ index, event });
    }
  });

  const testWrites = writes.filter((w) => isTestFile(w.event.summary));
  const prodWrites = writes.filter(
    (w) => isSrcCode(w.event.summary) && !isTestFile(w.event.summary),
  );

  if (testWrites.length === 0 && prodWrites.length === 0) {
    return {
      key: 'tdd',
      label: 'TDD discipline',
      verdict: 'na',
      evidence: 'no source or test files written',
      pointer: null,
    };
  }

  if (prodWrites.length > 0 && testWrites.length === 0) {
    return {
      key: 'tdd',
      label: 'TDD discipline',
      verdict: 'fail',
      evidence: `${prodWrites.length} production write${
        prodWrites.length === 1 ? '' : 's'
      } with zero test files`,
      pointer: { kind: 'index', value: prodWrites[0]!.index },
    };
  }

  // Pair each production write with the earliest test write sharing its stem.
  let testFirstCount = 0;
  let productionFirstCount = 0;
  let orphanIndex: number | undefined;
  let productionFirstIndex: number | undefined;

  for (const prod of prodWrites) {
    const prodStem = stem(prod.event.summary);
    const siblingTest = testWrites.find((t) => stem(t.event.summary) === prodStem);
    if (siblingTest === undefined) {
      // No sibling test at all for this production file.
      orphanIndex ??= prod.index;
      continue;
    }
    if (siblingTest.index < prod.index) {
      testFirstCount += 1;
    } else {
      productionFirstCount += 1;
      productionFirstIndex ??= prod.index;
    }
  }

  // All production writes are test-first (or there are no production writes).
  if (productionFirstCount === 0 && orphanIndex === undefined) {
    return {
      key: 'tdd',
      label: 'TDD discipline',
      verdict: 'pass',
      evidence:
        prodWrites.length === 0
          ? 'only test files written'
          : `${testFirstCount} production write${
              testFirstCount === 1 ? '' : 's'
            } each followed its sibling test`,
      pointer: null,
    };
  }

  // Production-first with no test-first pair anywhere -> fail.
  if (testFirstCount === 0 && productionFirstCount > 0) {
    return {
      key: 'tdd',
      label: 'TDD discipline',
      verdict: 'fail',
      evidence: `${productionFirstCount} production write${
        productionFirstCount === 1 ? '' : 's'
      } preceded the sibling test`,
      pointer: { kind: 'index', value: productionFirstIndex! },
    };
  }

  // Mixed: some test-first, some production-first or orphaned -> watch.
  // Reaching here means at least one of `productionFirstIndex` /
  // `orphanIndex` is defined (otherwise the pass branch above would have
  // returned). Prefer the production-first index as the decisive pointer.
  if (productionFirstIndex !== undefined) {
    return {
      key: 'tdd',
      label: 'TDD discipline',
      verdict: 'watch',
      evidence: 'mixed: some writes test-first, some production-first',
      pointer: { kind: 'index', value: productionFirstIndex },
    };
  }
  // Only orphaned production writes remain (no sibling test) — `orphanIndex`
  // is defined here.
  return {
    key: 'tdd',
    label: 'TDD discipline',
    verdict: 'watch',
    evidence: 'mixed: a production write has no sibling test',
    pointer:
      orphanIndex === undefined
        ? /* v8 ignore next -- unreachable: watch with neither index set */ null
        : { kind: 'index', value: orphanIndex },
  };
}
