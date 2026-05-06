import { describe, expect, it } from 'vitest';

import { COLLECTOR_PACKAGE_VERSION } from '../index.js';

describe('@metaswarm-dashboard/collector sanity', () => {
  it('exposes a package version constant', () => {
    expect(COLLECTOR_PACKAGE_VERSION).toBe('0.1.0');
  });
});
