import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Module dependency table — mirrors docs/ARCHITECTURE.md "Module boundaries".
 * Key = module folder under src/, value = modules it may import (always via index.ts).
 * A module may always import its own files. Change this table only through an
 * architecture-change session, and update the doc in the same commit.
 */
export const MODULE_DEPENDENCIES = {
  core: [],
  registry: ['core'],
  store: ['core', 'registry'],
  canvas: ['store', 'registry'],
  inspector: ['store', 'registry', 'network'],
  engine: ['core', 'registry', 'network'],
  network: ['core', 'registry'],
  security: ['core', 'registry'],
  'metrics-ui': ['store'],
  modes: ['store', 'registry', 'engine'],
  problems: ['registry', 'store'],
  estimator: ['core'],
  persistence: ['core', 'store'],
  // app = composition root (layout, routing, theme, shortcuts): may wire any module.
  app: [
    'core',
    'registry',
    'store',
    'canvas',
    'inspector',
    'engine',
    'network',
    'security',
    'metrics-ui',
    'modes',
    'problems',
    'estimator',
    'persistence',
  ],
};

const MODULES = Object.keys(MODULE_DEPENDENCIES);

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'tests/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // ---------- Module boundaries ----------
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.app.json' } },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'test-support', pattern: 'src/test' },
        ...MODULES.map((m) => ({ type: m, pattern: `src/${m}` })),
      ],
    },
    rules: {
      // 1. Which module may depend on which (the table above).
      // 2. Another module is reachable only through its public API (index.ts).
      // Later policies win, so the entry-point policy is last. Imports inside one
      // module are not checked.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '"{{from.type}}" may not import "{{to.type}}" (see MODULE_DEPENDENCIES in eslint.config.js / docs/ARCHITECTURE.md)',
          policies: [
            ...MODULES.filter((m) => MODULE_DEPENDENCIES[m].length > 0).map((m) => ({
              from: { element: { type: m } },
              allow: { to: { element: { types: { anyOf: MODULE_DEPENDENCIES[m] } } } },
            })),
            {
              disallow: {
                to: { element: { types: { anyOf: MODULES }, fileInternalPath: '!index.{ts,tsx}' } },
              },
              message: 'Import "{{to.type}}" through its index.ts public API only',
            },
          ],
        },
      ],
      // Every file under src/ must belong to a known module.
      'boundaries/no-unknown-files': 'error',
    },
  },

  // The engine and core are pure TS: no React, no DOM UI libraries.
  {
    files: ['src/engine/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@xyflow/*'],
              message: 'engine/core must stay React-free (pure TS).',
            },
          ],
        },
      ],
    },
  },

  // Node-side config and test files.
  {
    files: ['*.config.{js,ts}', 'e2e/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
