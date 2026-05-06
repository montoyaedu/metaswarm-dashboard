// WU-1 DoD #9: cross-package import sanity for server.


import type { GetProjectsResponse } from '@metaswarm-dashboard/types/api';
import { Marker } from '@metaswarm-dashboard/types/snapshots';
import { describe, expect, it } from 'vitest';

describe('cross-package import @metaswarm-dashboard/types (server)', () => {
  it('imports a TS type via the api subpath', () => {
    const empty: GetProjectsResponse = [];
    expect(empty).toHaveLength(0);
  });

  it('imports a Zod runtime schema via the snapshots subpath', () => {
    expect(Marker.parse({ schemaVersion: 1 }).schemaVersion).toBe(1);
  });
});
