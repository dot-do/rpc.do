import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Mock optional peer dependency for testing
      'colo.do/tiny': '/Users/nathanclevenger/projects/rpc.do/tests/__mocks__/colo.do-tiny.ts',
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**', // E2E tests run separately with vitest-pool-workers
    ],
    // Limit concurrency to prevent memory exhaustion
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    maxConcurrency: 5,
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/e2e/**',
        '**/*.d.ts',
        '**/types/**',
        'vitest.config.ts',
        'tsup.config.ts',
        '**/benchmarks/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
