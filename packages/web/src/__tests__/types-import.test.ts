// WU-1 DoD #9: cross-package import sanity for web.

import type { ProjectSummary } from '@metaswarm-dashboard/types/api';
import { Marker } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';

describe('cross-package import @metaswarm-dashboard/types (web)', () => {
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
    expect(sample.hasMetrics).toBe(false);
  });

  it('imports a Zod runtime schema via the snapshots subpath', () => {
    expect(Marker.parse({ schemaVersion: 1 }).schemaVersion).toBe(1);
  });
});
