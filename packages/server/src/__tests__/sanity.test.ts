import { describe, expect, it } from 'vitest';

import { SERVER_PACKAGE_VERSION } from '../index.js';

describe('@metaswarm-dashboard/server sanity', () => {
  it('exposes a package version constant', () => {
    expect(SERVER_PACKAGE_VERSION).toBe('0.1.0');
  });
});
