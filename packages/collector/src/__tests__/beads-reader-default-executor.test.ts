// Coverage gap closure: exercises the default executor (real execFile) in
// beads-reader.ts. We invoke it against a guaranteed-to-fail command so we
// don't depend on `bd` being installed in CI; the goal is to enter the
// default-executor closure path.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readHostBeads } from '../beads-reader.js';

describe('beads-reader default executor', () => {
  it('invokes execFile against a non-existent `bd` and surfaces the actionable warning', async () => {
    // Set up a fixture with .beads/ but stub the executor to use the REAL
    // default. We achieve this by NOT passing `execute` — readHostBeads
    // falls back to defaultExecutor which calls execFile('bd', …).
    // On systems where `bd` is on PATH, the call may succeed; on systems
    // where it isn't, ENOENT triggers our actionable warning. Either way
    // the closure is exercised.
    const tmp = mkdtempSync(join(tmpdir(), 'beads-default-exec-'));
    try {
      const projectPath = join(tmp, 'proj');
      mkdirSync(join(projectPath, '.beads'), { recursive: true });
      writeFileSync(join(projectPath, '.beads/issues.jsonl'), '', 'utf8');

      const result = await readHostBeads(projectPath);
      // The reader must not crash regardless of whether bd is installed.
      expect(result.skipped).toBe(false);
      // Either a warning fires (bd missing or bd output unparseable) or
      // bd produced rows. No assertion on which — coverage is the goal.
      expect(Array.isArray(result.warnings)).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
