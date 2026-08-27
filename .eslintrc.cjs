/* ESLint config for the VSDD Sprint Tracker Phase A frontend. */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-refresh', 'jsx-a11y'],
  settings: {
    react: { version: '18' },
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    'reference/**',
    'playwright-report',
    'test-results',
    '.eslintrc.cjs',
    'coverage',
  ],
  rules: {
    // Context/provider files intentionally co-locate a hook with the provider.
    'react-refresh/only-export-components': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
  overrides: [
    {
      files: ['**/*.test.{ts,tsx}', 'src/test/**', 'tests/**'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // Ambient module augmentation uses interface merging (empty extends).
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/no-empty-object-type': 'off',
      },
    },
  ],
};
