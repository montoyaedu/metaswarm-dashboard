// Vitest setup file — LOAD-BEARING privacy guard. Do NOT remove.
//
// Before any test in this package runs, this asserts that every `.jsonl`
// file under __tests__/fixtures/ begins with the synthetic-fixture marker
// line. This is the mechanical guard (sessions-spike design §9.1, anti-goal
// §12.13) that stops a real Claude Code transcript from being vendored as a
// test fixture. The `.gitignore` `*.real.*` rule and the 50 KB size cap are
// only defense-in-depth — they do NOT replace this assertion.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enforceFixtureMarker } from './fixture-guards.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

enforceFixtureMarker(fixturesDir);
