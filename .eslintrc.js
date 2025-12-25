module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // TypeScript handles these
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Allow explicit any in some cases (SDK wrappers)
    '@typescript-eslint/no-explicit-any': 'warn',

    // Consistent style
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'comma-dangle': ['error', 'always-multiline'],

    // Best practices
    'eqeqeq': ['error', 'always'],
    'no-console': 'off', // CLI needs console
    'prefer-const': 'error',

    // TypeScript specific
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '*.js',
    '!.eslintrc.js',
  ],
};
