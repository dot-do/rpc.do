import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    setupFiles: ['./src/shim.ts'],
    // Limit concurrency to prevent memory exhaustion
    maxConcurrency: 3,
    testTimeout: 30000,
    hookTimeout: 30000,
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityDate: '2024-12-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
})
