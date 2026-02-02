import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'node:path'

export default defineWorkersConfig({
  resolve: {
    alias: {
      // Resolve colo.do/tiny subpath export for vitest-pool-workers
      // This is needed because file: linked packages with subpath exports
      // don't resolve correctly in vitest-pool-workers
      'colo.do/tiny': resolve(__dirname, 'node_modules/colo.do/dist/tiny.js'),
    },
  },
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
