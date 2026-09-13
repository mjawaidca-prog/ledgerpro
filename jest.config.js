/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    // jose ships as ESM (js/mjs) — include those extensions so it compiles.
    '^.+\\.(tsx?|mjs|js)$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(jose)/)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};
