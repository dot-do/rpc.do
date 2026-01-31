import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'lite': 'src/lite.ts',
    'collections': 'src/collections.ts',
    'do-collections': 'src/do-collections.ts',
    'events-integration': 'src/events-integration.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: true,
  external: ['@dotdo/capnweb', '@dotdo/collections', '@dotdo/do', '@dotdo/events', 'colo.do', '@cloudflare/workers-types', 'cloudflare:workers'],
})
