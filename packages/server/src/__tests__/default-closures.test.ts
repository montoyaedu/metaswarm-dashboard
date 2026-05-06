// Coverage gap closure: SnapshotReader's default fs hook closure +
// projects-by-name route 404 envelope.

import { describe, expect, it } from 'vitest';

import { SnapshotReader } from '../data/snapshot-reader.js';

describe('SnapshotReader with default fs hooks', () => {
  it('returns [] when listing a nonexistent dataDir on the real fs', () => {
    const r = new SnapshotReader('/__metaswarm_dashboard_no_such_dir__');
    expect(r.listProjects()).toEqual([]);
    expect(r.latestDaily('whatever')).toBeNull();
    expect(r.recentDaily('whatever', 7)).toEqual([]);
  });
});
