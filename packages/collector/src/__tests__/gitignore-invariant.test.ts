// WU-1 DoD #10: lock down the .beads/ portability invariant.
// If a future commit re-tightens the root .gitignore (or .beads/.gitignore),
// the metaswarm dogfooding promise breaks silently for new clones.
// This test catches that regression.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');

// One representative path per protected directory + the export.
const PROTECTED_PATHS = [
  '.beads/plans/active-plan.md',
  '.beads/context/.keep',
  '.beads/knowledge/patterns.jsonl',
  '.beads/knowledge/decisions.jsonl',
  '.beads/knowledge/anti-patterns.jsonl',
  '.beads/issues.jsonl',
];

function isIgnoredByGit(path: string): boolean {
  // `git check-ignore --quiet -- <path>` exits 0 if path is ignored, 1 if not.
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', path], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    return true; // exit 0 → ignored
  } catch (err) {
    const error = err as { status?: number };
    if (error.status === 1) return false; // exit 1 → not ignored
    throw err; // any other status → real error
  }
}

describe('.gitignore invariant for metaswarm dogfooding', () => {
  for (const path of PROTECTED_PATHS) {
    it(`'${path}' is NOT git-ignored`, () => {
      expect(isIgnoredByGit(path)).toBe(false);
    });
  }

  it('.beads/.gitignore does not match any protected path', () => {
    const beadsGitignore = readFileSync(
      resolve(REPO_ROOT, '.beads/.gitignore'),
      'utf8',
    );
    const lines = beadsGitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const protectedSubpaths = PROTECTED_PATHS.map((p) =>
      p.replace(/^\.beads\//, ''),
    );

    for (const pattern of lines) {
      // Negation patterns are NOT used in metaswarm setup; if a user adds one
      // that re-includes runtime stuff, that's its own problem. We focus on
      // ignore patterns matching our protected paths.
      if (pattern.startsWith('!')) continue;
      for (const protectedSubpath of protectedSubpaths) {
        // Loose check: the pattern must not be a literal prefix of a protected
        // subpath, nor an exact match.
        const literal = pattern.replace(/\*/g, '');
        if (literal.length > 0 && protectedSubpath.startsWith(literal) && !literal.includes('.')) {
          throw new Error(
            `.beads/.gitignore pattern '${pattern}' would match protected path '${protectedSubpath}'`,
          );
        }
      }
    }
    expect(true).toBe(true); // assertion proxy; the throw above is the real gate.
  });
});
