/** @type {import('ts-jest').JestConfigWithTsJest}  */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only *.test.ts files are suites. Jest's default pattern also treats every
  // file under __tests__/ as a suite, which makes shared helpers such as
  // __tests__/testUtils.ts fail with "must contain at least one test".
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  // buildEnv.ts reads import.meta.env, which is a SYNTAX error under ts-jest's
  // CommonJS transform, so any suite reaching it transitively fails to parse.
  // The stub reads process.env instead; the real module stays untouched for Vite.
  // Matches every relative spelling in use: './buildEnv', '../buildEnv' and
  // '../net/buildEnv'. The stub itself must not match, hence the negative
  // lookahead on the .jest suffix.
  moduleNameMapper: {
    '(^|/)buildEnv$': '<rootDir>/src/platform/core/net/buildEnv.jest.ts'
  },
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json'
      }
    ]
  }
};

export default config;
