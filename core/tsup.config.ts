import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'lite': 'src/lite.ts',
    'collections': 'src/collections.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: true,
  external: ['capnweb', 'colo.do', '@cloudflare/workers-types', 'cloudflare:workers'],
})
