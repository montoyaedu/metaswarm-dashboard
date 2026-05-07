// WU-1 DoD #9: prove the workspace dep + build pipeline + exports map are
// healthy by importing both a TS type and a Zod runtime schema from
// `@metaswarm-dashboard/types`.


import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { Marker } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';

describe('cross-package import @metaswarm-dashboard/types', () => {
  it('imports a TS type via the api subpath', () => {
    const sample: ProjectSummary = {
      name: 'demo',
      activeTasks: 0,
      blockedTasks: 0,
      prsMergedLast7d: null,
      lastActivityAt: null,
      hasMetrics: false,
      collectionStatus: 'ok',
      collectionWarnings: [],    };
    expect(sample.name).toBe('demo');
  });

  it('imports a Zod runtime schema via the snapshots subpath', () => {
    const parsed = Marker.parse({ schemaVersion: 1 });
    expect(parsed.schemaVersion).toBe(1);
  });
});
