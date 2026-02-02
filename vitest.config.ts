import { defineConfig } from 'vitest/config'

export default defineConfig({
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
  },
})
