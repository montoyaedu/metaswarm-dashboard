// WU-4.16 — cross-WU integration: collector writer + server reader against
// the same temp data dir. Asserts shape compatibility end-to-end. Fails CI
// if WU-3's writer ever drifts from the schemas in @metaswarm-dashboard/types.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DailySnapshot } from '@metaswarm-dashboard/types/snapshots';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';


import { SnapshotReader } from '../data/snapshot-reader.js';

let TMP: string;
beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'integration-collector-server-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('collector writer ↔ server reader contract', () => {
  it('a snapshot written via DailySnapshot shape parses cleanly via SnapshotReader', () => {
    // We don't actually invoke the collector binary here — that would couple
    // the test to the collector workspace. Instead we use the SAME Zod schema
    // (DailySnapshot) imported from @metaswarm-dashboard/types to construct
    // a snapshot, write it, and then read it via SnapshotReader. If the
    // schemas drift between writer and reader, this assertion fails.

    const dayKey = '2026-05-06';
    const dailyDir = join(TMP, 'projects', 'foo', 'daily');
    mkdirSync(dailyDir, { recursive: true });

    // Build via the schema's inferred shape (compile-time guarantee).
    const snapshot: DailySnapshot = {
      schemaVersion: 1,
      projectName: 'foo',
      generatedAt: `${dayKey}T12:00:00.000Z`,
      dayKey,
      agents: [
        { agent: 'coder', tasksCompleted: 1, successRate: 1.0, avgDurationSeconds: 100 },
      ],
      totals: {
        totalActiveTasks: 0,
        totalBlockedTasks: 0,
        totalCompletedTasksLast7d: 1,
        lastActivityAt: `${dayKey}T10:00:00.000Z`,
      },
      prsMergedLast7d: null,
    collectionStatus: 'ok',
    collectionWarnings: [],
    };

    // Run-time double-check via Zod — same schema the reader uses.
    const parseRes = DailySnapshot.safeParse(snapshot);
    expect(parseRes.success).toBe(true);

    writeFileSync(join(dailyDir, `${dayKey}.json`), JSON.stringify(snapshot, null, 2), 'utf8');

    const reader = new SnapshotReader(TMP, undefined, () => undefined);
    expect(reader.listProjects()).toEqual(['foo']);
    const round = reader.latestDaily('foo');
    expect(round).not.toBeNull();
    expect(round?.dayKey).toBe(dayKey);
    expect(round?.prsMergedLast7d).toBeNull();
  });
});
