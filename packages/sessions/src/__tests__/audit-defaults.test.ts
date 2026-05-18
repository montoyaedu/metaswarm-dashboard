// Asserts the `sessions audit --persist` flag default stays off
// (sessions-spike design §15.1 DoD, anti-goal §12.11). A persisted snapshot
// may contain operator secrets; flipping this default to `true` is a privacy
// regression. WU-6 wires its commander option default from this constant.

import { describe, expect, it } from 'vitest';

import { AUDIT_PERSIST_DEFAULT } from '../cli/audit-defaults.js';

describe('AUDIT_PERSIST_DEFAULT', () => {
  it('is false — audit --persist must default off', () => {
    expect(AUDIT_PERSIST_DEFAULT).toBe(false);
  });
});
