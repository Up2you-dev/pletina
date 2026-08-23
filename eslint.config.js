import js from '@eslint/js';
import globals from 'globals';

/** Reglas del reproductor. El monorepo lo ignora: esta app tiene su propio ciclo. */
export default [
  { ignores: ['node_modules/**', 'release/**', 'coverage/**', 'src/renderer/assets/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['src/renderer/**/*.js', 'src/preload/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
];
