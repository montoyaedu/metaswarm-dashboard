import { describe, expect, it } from 'vitest';

import { WEB_PACKAGE_VERSION } from '../main.js';

describe('@metaswarm-dashboard/web sanity', () => {
  it('exposes a package version constant', () => {
    expect(WEB_PACKAGE_VERSION).toBe('0.1.0');
  });
});
