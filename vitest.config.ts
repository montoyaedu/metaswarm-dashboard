import { defineConfig } from 'vitest/config';

import thresholdsConfig from './.coverage-thresholds.json' with { type: 'json' };

// Plan §2.10: thresholds wired from JSON; the global gate runs only at the root
// `npm run test:coverage` invocation (gated to WU-7). Per-package
// `npm run test --workspace X` does NOT load this config and therefore does
// NOT enforce thresholds — by design.
export default defineConfig({
  test: {
    projects: [
      'packages/types',
      'packages/collector',
      'packages/sessions',
      'packages/server',
      'packages/web',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: thresholdsConfig.thresholds.lines,
        branches: thresholdsConfig.thresholds.branches,
        functions: thresholdsConfig.thresholds.functions,
        statements: thresholdsConfig.thresholds.statements,
      },
      exclude: [
        'bin/**',
        '**/dist/**',
        '**/__tests__/fixtures/**',
        '**/coverage/**',
        '**/*.config.{ts,js,mjs,cjs}',
        '**/node_modules/**',
        'eslint.config.js',
        // Glue-only entry points that mount/instantiate at import time.
        // Their behavior is exercised by E2E tests (back-nav-e2e for the
        // Vue scaffold; cli-dispatcher-smoke for the bin script).
        'packages/web/src/main.ts',
        'packages/web/src/App.vue',
        'packages/web/src/router.ts',
        'packages/web/src/version.ts',
        // Placeholder index files re-exporting workspace public surface.
        'packages/types/src/index.ts',
        'packages/collector/src/index.ts',
        'packages/sessions/src/index.ts',
        'packages/server/src/index.ts',
        // Screenshot capture script (Playwright; runs out-of-band only).
        'scripts/**',
      ],
    },
  },
});
