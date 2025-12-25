/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'packages/*/src/**/*.ts',
    '!packages/*/src/**/*.d.ts',
    '!packages/*/dist/**',
    '!packages/anthropic/**',
    '!packages/langchain/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^agentledger-core$': '<rootDir>/packages/core/src',
    '^agentledger-openai$': '<rootDir>/packages/openai/src',
    '^agentledger-cli$': '<rootDir>/packages/cli/src',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};
