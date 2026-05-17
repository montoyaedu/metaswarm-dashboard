// Coverage gap closure: collection-help.ts is a pure help-text module
// (helpForWarning + buildCollectionAdvice). Every PATTERN, the FALLBACK,
// and all buildCollectionAdvice status/warning combinations are exercised.

import { describe, expect, it } from 'vitest';

import { buildCollectionAdvice, helpForWarning } from '../lib/collection-help.js';

describe('helpForWarning — the 9 warning patterns', () => {
  it('matches "no beads database found" → No BEADS database', () => {
    const help = helpForWarning('mixed: no beads database found at /tmp/p');
    expect(help.label).toBe('No BEADS database');
    expect(help.fixNow).toContain('bd init --server');
    expect(help.preventNextTime).toContain('bd init --server');
  });

  it('matches "Dolt server unreachable" → Dolt server not running', () => {
    const help = helpForWarning('alpha: Dolt server unreachable on port 9001');
    expect(help.label).toBe('Dolt server not running');
    expect(help.fixNow).toContain('bd dolt start');
    expect(help.preventNextTime).toContain('dolt.auto-start');
  });

  it('matches "embedded Dolt requires CGO" → CGO not available', () => {
    const help = helpForWarning('beta: embedded Dolt requires CGO; rebuild bd');
    expect(help.label).toBe('CGO not available for embedded Dolt');
    expect(help.fixNow).toContain('bd init --server');
    expect(help.preventNextTime).toContain('Apple Silicon');
  });

  it('matches "not found on PATH" → bd binary missing', () => {
    const help = helpForWarning('`bd` binary not found on PATH. See README');
    expect(help.label).toBe('`bd` binary missing');
    expect(help.fixNow).toContain('Install the `bd` CLI');
    expect(help.preventNextTime).toContain('bd list --json');
  });

  it('matches "not valid JSON" → bd list --json produced unexpected output', () => {
    const help = helpForWarning('bd list --json: stdout is not valid JSON');
    expect(help.label).toBe('`bd list --json` produced unexpected output');
    expect(help.fixNow).toContain('bd list --json');
    expect(help.preventNextTime).toContain('Pin a bd version');
  });

  it('matches "expected an array" → same bd list --json help (alternate trigger)', () => {
    const help = helpForWarning('bd list --json: expected an array, got something else');
    expect(help.label).toBe('`bd list --json` produced unexpected output');
  });

  it('matches "malformed JSONL row" → Malformed row in .beads/issues.jsonl', () => {
    // Uses the "missing id or status" variant so the message does NOT also
    // contain "not valid JSON" (which would match an earlier pattern).
    const help = helpForWarning('malformed JSONL row at issues.jsonl:4 — missing id or status');
    expect(help.label).toBe('Malformed row in `.beads/issues.jsonl`');
    expect(help.fixNow).toContain('delete the bad line');
    expect(help.preventNextTime).toContain('bd export');
  });

  it('matches "malformed row" → same malformed-row help (alternate trigger)', () => {
    const help = helpForWarning('bd list --json: malformed row skipped');
    expect(help.label).toBe('Malformed row in `.beads/issues.jsonl`');
  });

  it('matches "no .beads/" → No .beads/ directory', () => {
    const help = helpForWarning('skip: no .beads/ directory at /tmp/p');
    expect(help.label).toBe('No `.beads/` directory');
    expect(help.fixNow).toContain('bd init --server');
    expect(help.preventNextTime).toContain('discover-projects.sh');
  });

  it('matches "project path does not exist" → Project path missing on disk', () => {
    const help = helpForWarning('project path does not exist: /gone');
    expect(help.label).toBe('Project path missing on disk');
    expect(help.fixNow).toContain('config.yaml');
    expect(help.preventNextTime).toContain('absolute paths');
  });

  it('matches "failed to read" → Filesystem read error', () => {
    const help = helpForWarning('failed to read /tmp/p/.beads/issues.jsonl: EACCES');
    expect(help.label).toBe('Filesystem read error');
    expect(help.fixNow).toContain('permissions');
    expect(help.preventNextTime).toContain('sudo');
  });

  it('returns the same pattern for the FIRST matching pattern when several could apply', () => {
    // "no beads database found" precedes "no .beads/" in PATTERNS; a message
    // containing only the first substring resolves to the first pattern.
    const help = helpForWarning('no beads database found');
    expect(help.label).toBe('No BEADS database');
  });
});

describe('helpForWarning — FALLBACK for unrecognized warnings', () => {
  it('returns the generic catch-all when no pattern matches', () => {
    const help = helpForWarning('some entirely novel warning text');
    expect(help.label).toBe('Collection warning');
    expect(help.fixNow).toContain('literal message');
    expect(help.preventNextTime).toContain('file an issue');
  });

  it('returns FALLBACK for an empty string (no substring matches)', () => {
    const help = helpForWarning('');
    expect(help.label).toBe('Collection warning');
  });
});

describe('buildCollectionAdvice', () => {
  it('status "ok" → success summary with no warnings, even if warnings array is non-empty', () => {
    const advice = buildCollectionAdvice('ok', ['Dolt server unreachable']);
    expect(advice.summary).toBe('Collection succeeded with no warnings.');
    expect(advice.warnings).toEqual([]);
  });

  it('status "degraded" with no warnings → success summary, empty warnings', () => {
    const advice = buildCollectionAdvice('degraded', []);
    expect(advice.summary).toBe('Collection succeeded with no warnings.');
    expect(advice.warnings).toEqual([]);
  });

  it('status "failed" with no warnings → success summary, empty warnings', () => {
    // warnings.length === 0 short-circuits regardless of status.
    const advice = buildCollectionAdvice('failed', []);
    expect(advice.summary).toBe('Collection succeeded with no warnings.');
    expect(advice.warnings).toEqual([]);
  });

  it('status "degraded" with warnings → degraded summary + per-warning help', () => {
    const advice = buildCollectionAdvice('degraded', [
      'Dolt server unreachable',
      'malformed JSONL row at issues.jsonl:2',
    ]);
    expect(advice.summary).toBe(
      'Collection succeeded with warnings; some data may be incomplete.',
    );
    expect(advice.warnings).toHaveLength(2);
    expect(advice.warnings[0]?.message).toBe('Dolt server unreachable');
    expect(advice.warnings[0]?.help.label).toBe('Dolt server not running');
    expect(advice.warnings[1]?.help.label).toBe('Malformed row in `.beads/issues.jsonl`');
  });

  it('status "failed" with warnings → FAILED summary + per-warning help', () => {
    const advice = buildCollectionAdvice('failed', [
      'no .beads/ directory at /tmp/p',
    ]);
    expect(advice.summary).toBe('Collection FAILED — the project was skipped entirely.');
    expect(advice.warnings).toHaveLength(1);
    expect(advice.warnings[0]?.help.label).toBe('No `.beads/` directory');
  });

  it('status "failed" with an unrecognized warning → FAILED summary + FALLBACK help', () => {
    const advice = buildCollectionAdvice('failed', ['mystery failure']);
    expect(advice.summary).toBe('Collection FAILED — the project was skipped entirely.');
    expect(advice.warnings[0]?.message).toBe('mystery failure');
    expect(advice.warnings[0]?.help.label).toBe('Collection warning');
  });
});
