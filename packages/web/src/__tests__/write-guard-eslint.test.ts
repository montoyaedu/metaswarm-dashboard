// WU v4-8 (design §3.4) — proves the SPA write-guard re-scope is correct:
//
//  1. a stray write-method literal (`'PUT'`, `'POST'`, …) anywhere in
//     `packages/web/src` OTHER than `lib/ratings-api.ts` still trips the
//     `no-restricted-syntax` rule;
//  2. `lib/ratings-api.ts` — the one sanctioned write module — is exempt, so
//     its real `'PUT'` literal does NOT trip the rule.
//
// The rule is exercised by running the real ESLint flat config (root
// `eslint.config.js`) programmatically against fixture files. Fixtures are
// written as REAL files under `packages/web/src` (so the flat config's path
// patterns + the tsconfig project resolution apply exactly as in CI) and
// removed in `afterEach`.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadESLint, type Linter } from 'eslint';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/** Walk up from `process.cwd()` to the dir holding `eslint.config.js`. */
function findRepoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'eslint.config.js'))) {
    const parent = dirname(dir);
    /* v8 ignore next — the repo root is always found from a test's cwd. */
    if (parent === dir) throw new Error('repo root (eslint.config.js) not found');
    dir = parent;
  }
  return dir;
}

const repoRoot = findRepoRoot();
const webSrc = join(repoRoot, 'packages', 'web', 'src');

const STRAY_TS = `export const httpMethod = 'PUT';\n`;
const STRAY_POST_TS = `export const httpMethod = 'POST';\n`;

let ESLintCtor: Awaited<ReturnType<typeof loadESLint>>;
const written: string[] = [];

beforeAll(async () => {
  ESLintCtor = await loadESLint({ useFlatConfig: true });
});

afterEach(() => {
  for (const f of written.splice(0)) rmSync(f, { force: true });
});

afterAll(() => {
  for (const f of written.splice(0)) rmSync(f, { force: true });
});

/** Lint one absolute file path; return its `no-restricted-syntax` messages. */
async function lintWriteGuard(absPath: string): Promise<Linter.LintMessage[]> {
  const eslint = new ESLintCtor({ cwd: repoRoot });
  const results = await eslint.lintFiles([absPath]);
  const first = results[0];
  /* v8 ignore next — lintFiles always returns one result per input path. */
  if (first === undefined) throw new Error(`no lint result for ${absPath}`);
  return first.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
}

/** Write a fixture under web/src, lint it, return its `no-restricted-syntax` hit count. */
async function lintFixture(relPath: string, contents: string): Promise<number> {
  const abs = join(webSrc, relPath);
  writeFileSync(abs, contents);
  written.push(abs);
  return (await lintWriteGuard(abs)).length;
}

// ESLint with `projectService` is slow to warm up; give the suite headroom.
describe('SPA write-guard eslint rule (design §3.4)', { timeout: 60_000 }, () => {
  it('trips on a stray write literal in an ordinary web/src lib file', async () => {
    const offenders = await lintFixture('lib/wu48-stray-fixture.ts', STRAY_TS);
    expect(offenders).toBeGreaterThan(0);
  });

  it('also trips inside a component <script> block', async () => {
    const offenders = await lintFixture(
      'components/Wu48StrayFixture.vue',
      `<script setup lang="ts">\nexport const httpMethod = 'POST';\n</script>\n<template><div /></template>\n`,
    );
    expect(offenders).toBeGreaterThan(0);
  });

  it('a sibling file in lib/ still trips — the re-scope is file-narrow', async () => {
    // Proves the `ignores` entry is exactly `lib/ratings-api.ts`, not all of
    // `lib/`: a different lib file with a write literal must still trip.
    const offenders = await lintFixture('lib/wu48-ratings-sibling.ts', STRAY_POST_TS);
    expect(offenders).toBeGreaterThan(0);
  });

  it('does NOT trip in the sanctioned lib/ratings-api.ts (overwriting it temporarily)', async () => {
    // The `ignores` entry exempts exactly this path. Confirm a write literal
    // at this path is permitted — by linting a fixture written AT that path.
    // (We overwrite then restore the real file.)
    const target = join(webSrc, 'lib', 'ratings-api.ts');
    const original = readFileSync(target, 'utf8');
    try {
      writeFileSync(target, `${original}\nexport const wu48Probe = 'PUT';\n`);
      expect(await lintWriteGuard(target)).toEqual([]);
    } finally {
      writeFileSync(target, original);
    }
  });

  it('the real shipped lib/ratings-api.ts is clean of this rule', async () => {
    // Regression guard: the actual file (with its real `'PUT'` literal) must
    // lint clean for `no-restricted-syntax`.
    const offenders = await lintWriteGuard(join(webSrc, 'lib', 'ratings-api.ts'));
    expect(offenders).toEqual([]);
  });
});
