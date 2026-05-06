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
      ],
    },
  },
});
