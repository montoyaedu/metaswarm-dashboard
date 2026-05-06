import { describe, expect, it } from 'vitest';

import { Marker } from '../snapshots.js';

describe('@metaswarm-dashboard/types sanity', () => {
  it('Marker schema parses a valid marker', () => {
    const parsed = Marker.parse({ schemaVersion: 1 });
    expect(parsed.schemaVersion).toBe(1);
  });
});
