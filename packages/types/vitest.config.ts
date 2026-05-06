import { defineConfig } from 'vitest/config';

// Per-package vitest config: per-package `npm run test --workspace X` uses
// this minimal config (no global thresholds). The root config (which IS
// gated to 100% per `.coverage-thresholds.json`) is loaded only when
// `npm run test:coverage` runs at the workspace root — that's the WU-7 gate.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
