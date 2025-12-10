import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts', 'src/transports.ts', 'src/auth.ts', 'src/worker.ts', 'src/expose.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['capnweb', 'oauth.do', 'cloudflare:workers']
})
