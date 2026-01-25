import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        // Disable isolated storage since we're testing Durable Objects with WebSockets
        // See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#websockets-with-durable-objects
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
