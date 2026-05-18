// ESLint 9 flat config (per plan §4.2)
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.beads/**',
      'docs/**',
      'bin/*.sh',
      'scripts/**', // metaswarm setup-time scripts; not in scope for issue #1
      '**/*.config.{ts,js,mjs,cjs}', // root + per-package config files
      'eslint.config.js',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    files: ['packages/web/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      vue: vuePlugin,
    },
    rules: {
      ...vuePlugin.configs['flat/recommended'].at(-1).rules,
    },
  },
  {
    // Web src: forbid write-method literals (per WU-6.4 plan; covers <script> blocks).
    // WU v4-8 (design §3.4): `lib/ratings-api.ts` is the ONE sanctioned write
    // module — the `'PUT'` literal is permitted there and nowhere else. A stray
    // write literal anywhere else in `packages/web/src` still trips this rule.
    files: ['packages/web/src/**/*.{ts,vue}'],
    ignores: [
      'packages/web/src/**/__tests__/**',
      'packages/web/src/lib/ratings-api.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value="POST"]',
          message: 'Write methods (POST/PUT/DELETE/PATCH) are forbidden in the SPA. The dashboard is read-only.',
        },
        {
          selector: 'Literal[value="PUT"]',
          message: 'Write methods (POST/PUT/DELETE/PATCH) are forbidden in the SPA. The dashboard is read-only.',
        },
        {
          selector: 'Literal[value="DELETE"]',
          message: 'Write methods (POST/PUT/DELETE/PATCH) are forbidden in the SPA. The dashboard is read-only.',
        },
        {
          selector: 'Literal[value="PATCH"]',
          message: 'Write methods (POST/PUT/DELETE/PATCH) are forbidden in the SPA. The dashboard is read-only.',
        },
      ],
    },
  },
  {
    // Test files: relax certain rules
    files: ['**/__tests__/**/*.{ts,js,vue}', '**/*.test.{ts,js,vue}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
);
