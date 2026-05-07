import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { describe, expect, it } from 'vitest';

import { groupByParent } from '../lib/group-by-parent.js';

function p(name: string, path: string, category: 'metaswarm' | 'git-only' = 'metaswarm', status: 'ok' | 'degraded' | 'failed' = 'ok'): ProjectSummary {
  return {
    name,
    path,
    category,
    activeTasks: 0,
    blockedTasks: 0,
    prsMergedLast7d: null,
    lastActivityAt: null,
    hasMetrics: category === 'metaswarm' && status !== 'failed',
    collectionStatus: status,
    collectionWarnings: [],
  };
}

describe('groupByParent', () => {
  it('groups projects by their parent directory', () => {
    const groups = groupByParent([
      p('alpha', '/Users/me/code/alpha'),
      p('beta', '/Users/me/code/beta'),
      p('gamma', '/Users/me/work/gamma'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.parentPath).toBe('/Users/me/code');
    expect(groups[0]?.label).toBe('code');
    expect(groups[0]?.projects.map((x) => x.name)).toEqual(['alpha', 'beta']);
    expect(groups[1]?.parentPath).toBe('/Users/me/work');
    expect(groups[1]?.projects.map((x) => x.name)).toEqual(['gamma']);
  });

  it('sorts groups by parent path and projects within a group by name', () => {
    const groups = groupByParent([
      p('z', '/a/sub'),
      p('a', '/a/sub'),
      p('m', '/a/sub'),
    ]);
    expect(groups[0]?.projects.map((x) => x.name)).toEqual(['a', 'm', 'z']);
  });

  it('counts metaswarm vs git-only and statuses per group', () => {
    const groups = groupByParent([
      p('one', '/a/sub', 'metaswarm', 'ok'),
      p('two', '/a/sub', 'metaswarm', 'degraded'),
      p('three', '/a/sub', 'metaswarm', 'failed'),
      p('four', '/a/sub', 'git-only'),
    ]);
    expect(groups[0]?.counts).toEqual({
      total: 4,
      metaswarm: 3,
      gitOnly: 1,
      ok: 1,
      degraded: 1,
      failed: 1,
    });
  });

  it('handles empty path (orphan project)', () => {
    const groups = groupByParent([p('orphan', '')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parentPath).toBe('');
    expect(groups[0]?.label).toBe('(root)');
  });

  it('returns empty array when no projects', () => {
    expect(groupByParent([])).toEqual([]);
  });
});
