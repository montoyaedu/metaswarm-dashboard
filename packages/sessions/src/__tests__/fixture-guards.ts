// Fixture-vendoring guards for the sessions package (design §9.1, §9.2).
//
// LOAD-BEARING: the marker-line assertion (`findMarkerViolations` /
// `enforceFixtureMarker`) is the primary privacy guard. It is what actually
// stops a real Claude Code transcript from being committed as a synthetic
// test fixture. Do NOT remove it.
//
// The `.gitignore` rule for `*.real.*` files and the 50 KB size cap
// (`findOversizedFixtures`) are DEFENSE-IN-DEPTH only — they reduce the blast
// radius if the marker assertion is bypassed, but they are not a substitute
// for it (anti-goal §12.13).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The exact first line every synthetic `.jsonl` fixture must begin with.
 * A real transcript will not have this line; the marker is what proves a
 * fixture was hand-authored.
 */
export const FIXTURE_MARKER =
  '{"meta":"synthetic-fixture-do-not-replace-with-real-transcript","schemaVersion":1}';

/** Hard size cap for any `.jsonl` fixture. Real transcripts are ≥500 KB. */
export const FIXTURE_SIZE_CAP_BYTES = 50 * 1024;

/**
 * List the `.jsonl` files directly under `dir`, sorted ascending. Returns an
 * empty array if `dir` does not exist (the fixtures dir lands in WU-3/WU-4).
 */
export function listJsonlFixtures(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Return the paths of every fixture whose first line is not `FIXTURE_MARKER`.
 * The first line is computed via `indexOf('\n')` so a single-line file (the
 * whole content) is handled without an unreachable fallback branch.
 */
export function findMarkerViolations(dir: string): string[] {
  const violations: string[] = [];
  for (const file of listJsonlFixtures(dir)) {
    const content = readFileSync(file, 'utf8');
    const i = content.indexOf('\n');
    const firstLine = i === -1 ? content : content.slice(0, i);
    if (firstLine !== FIXTURE_MARKER) {
      violations.push(file);
    }
  }
  return violations;
}

/**
 * Return the paths of every fixture larger than `capBytes` (default
 * `FIXTURE_SIZE_CAP_BYTES`).
 */
export function findOversizedFixtures(
  dir: string,
  capBytes: number = FIXTURE_SIZE_CAP_BYTES,
): string[] {
  return listJsonlFixtures(dir).filter(
    (file) => statSync(file).size > capBytes,
  );
}

/**
 * Throw if any `.jsonl` fixture under `dir` is missing the marker line.
 * Called from the vitest setup file so a missing marker fails the suite.
 */
export function enforceFixtureMarker(dir: string): void {
  const violations = findMarkerViolations(dir);
  if (violations.length > 0) {
    throw new Error(
      `Fixture marker violation — these .jsonl files do not begin with the ` +
        `synthetic-fixture marker line and may be real transcripts:\n` +
        violations.map((file) => `  ${file}`).join('\n'),
    );
  }
}
