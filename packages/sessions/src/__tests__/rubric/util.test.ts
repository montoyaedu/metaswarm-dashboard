// Unit tests for the shared rubric detection helpers (sessions-spike WU-4).

import { describe, expect, it } from 'vitest';

import {
  bashMatches,
  firstWriteIndex,
  isAgentsPath,
  isConventionDoc,
  isSrcCode,
  isTestFile,
  isToolUse,
  packagePrefix,
  writeEvents,
} from '../../rubric/util.js';

import { ev, timeline, tool } from './helpers.js';

describe('isToolUse', () => {
  it('is true for a tool-use event with the matching toolName', () => {
    expect(isToolUse(tool('Read', 'AGENTS.md'), 'Read')).toBe(true);
  });

  it('is false for a tool-use event with a different toolName', () => {
    expect(isToolUse(tool('Read', 'AGENTS.md'), 'Write')).toBe(false);
  });

  it('is false for a non tool-use event', () => {
    expect(isToolUse(ev('assistant-text', { summary: 'hi' }), 'Read')).toBe(false);
  });
});

describe('writeEvents', () => {
  it('returns only Write and Edit tool-use events', () => {
    const tl = timeline([
      tool('Read', 'AGENTS.md'),
      tool('Write', 'src/a.ts'),
      tool('Edit', 'src/b.ts'),
      tool('Bash', 'npm test'),
      ev('assistant-text', { summary: 'x' }),
    ]);
    const writes = writeEvents(tl);
    expect(writes.map((w) => w.summary)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns an empty array when there are no writes', () => {
    expect(writeEvents(timeline([tool('Read', 'AGENTS.md')]))).toEqual([]);
  });
});

describe('firstWriteIndex', () => {
  it('returns the index of the first Write/Edit event', () => {
    const tl = timeline([
      tool('Read', 'AGENTS.md'),
      tool('Bash', 'bd create'),
      tool('Edit', 'src/a.ts'),
    ]);
    expect(firstWriteIndex(tl)).toBe(2);
  });

  it('returns events.length when there are no writes', () => {
    const tl = timeline([tool('Read', 'AGENTS.md'), tool('Bash', 'npm test')]);
    expect(firstWriteIndex(tl)).toBe(2);
  });
});

describe('isSrcCode', () => {
  it('is true for a path with a src/ segment', () => {
    expect(isSrcCode('packages/sessions/src/rubric/tdd.ts')).toBe(true);
    expect(isSrcCode('src/index.ts')).toBe(true);
  });

  it('is false for a path with no src/ segment', () => {
    expect(isSrcCode('docs/design.md')).toBe(false);
    expect(isSrcCode('AGENTS.md')).toBe(false);
  });

  it('does not match a substring that is not a path segment', () => {
    expect(isSrcCode('mysrc/foo.ts')).toBe(false);
    expect(isSrcCode('asrc.ts')).toBe(false);
  });
});

describe('isTestFile', () => {
  it('is true for a path under __tests__/', () => {
    expect(isTestFile('src/__tests__/parser.ts')).toBe(true);
  });

  it('is true for a *.test.* file', () => {
    expect(isTestFile('src/parser.test.ts')).toBe(true);
  });

  it('is true for a *.spec.* file', () => {
    expect(isTestFile('src/parser.spec.tsx')).toBe(true);
  });

  it('is false for a plain production file', () => {
    expect(isTestFile('src/parser.ts')).toBe(false);
  });
});

describe('isAgentsPath', () => {
  it('is true for a path with a .agents/ segment', () => {
    expect(isAgentsPath('.agents/notes.md')).toBe(true);
    expect(isAgentsPath('repo/.agents/index.md')).toBe(true);
  });

  it('is false for a path with no .agents/ segment', () => {
    expect(isAgentsPath('src/index.ts')).toBe(false);
  });
});

describe('isConventionDoc', () => {
  it('is true for AGENTS.md / CLAUDE.md / .coverage-thresholds.json by basename', () => {
    expect(isConventionDoc('AGENTS.md')).toBe(true);
    expect(isConventionDoc('repo/CLAUDE.md')).toBe(true);
    expect(isConventionDoc('.coverage-thresholds.json')).toBe(true);
  });

  it('is true for any .agents/ path', () => {
    expect(isConventionDoc('.agents/index.md')).toBe(true);
  });

  it('is false for an unrelated file', () => {
    expect(isConventionDoc('src/index.ts')).toBe(false);
    expect(isConventionDoc('README.md')).toBe(false);
  });
});

describe('bashMatches', () => {
  it('is true when a Bash tool-use summary matches the regex', () => {
    expect(bashMatches(tool('Bash', 'bd create "WU-4"'), /\bbd\s+create\b/)).toBe(true);
  });

  it('is false when the Bash summary does not match', () => {
    expect(bashMatches(tool('Bash', 'npm test'), /\bbd\s+create\b/)).toBe(false);
  });

  it('is false for a non-Bash tool-use event', () => {
    expect(bashMatches(tool('Read', 'bd create'), /\bbd\s+create\b/)).toBe(false);
  });

  it('is false for a non tool-use event', () => {
    expect(bashMatches(ev('assistant-text', { summary: 'bd create' }), /bd/)).toBe(false);
  });
});

describe('packagePrefix', () => {
  it('returns the packages/<name> prefix of a path', () => {
    expect(packagePrefix('packages/sessions/src/a.ts')).toBe('packages/sessions');
  });

  it('returns null for a path with no packages/ segment', () => {
    expect(packagePrefix('src/a.ts')).toBeNull();
    expect(packagePrefix('docs/x.md')).toBeNull();
  });

  it('returns null for a packages path with no name after it', () => {
    expect(packagePrefix('packages/')).toBeNull();
  });
});
