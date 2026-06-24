/** Unit tests (*.spec.ts under src). Integration/e2e (Testcontainers PG) use test/jest-e2e.json. */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!main.ts', '!worker.ts', '!seed.ts'],
  coverageDirectory: '../coverage',
  // Coverage gate. Phase 0 is platform-only (most lib code is wired, not unit-tested), so the
  // GLOBAL floor is just a regression ratchet — it must never drop. Per the DoD, each DOMAIN
  // module added in Phase 2 must reach >=90%; enforce that with a per-path threshold block here
  // (e.g. './src/modules/animals/': { lines: 90, ... }) as the domain lands, and ratchet global up.
  coverageThreshold: {
    global: { statements: 4, branches: 6, functions: 6, lines: 5 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
