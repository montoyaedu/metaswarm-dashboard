import { defineConfig } from 'vitest/config';

// Per-package vitest config (mirrors collector/types). The root config carries
// the 100%-line coverage gate; this one just runs the package's own tests.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/fixture-marker.setup.ts'],
  },
});
