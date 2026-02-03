import { defineConfig } from 'tsup'

export default defineConfig([
  // Client library (browser-safe)
  {
    entry: [
      'src/index.ts',
      'src/transports.ts',
      'src/auth.ts',
      'src/errors.ts',
      'src/server.ts',
      'src/expose.ts',
      'src/react.ts',
      'src/middleware/index.ts',
      'src/middleware/logging.ts',
      'src/middleware/timing.ts',
      'src/adapters/nextjs.ts',
      'src/adapters/sveltekit.ts',
    ],
    format: ['esm'],
    dts: true,
    external: ['capnweb', '@dotdo/capnweb', '@dotdo/capnweb/server', 'oauth.do', 'cloudflare:workers', 'react'],
  },
  // Type extraction utilities (Node.js only, uses ts-morph)
  {
    entry: ['src/extract.ts'],
    format: ['esm'],
    dts: true,
    external: ['capnweb', 'oauth.do', 'cloudflare:workers', 'ts-morph', 'glob'],
  },
  // OpenAPI export utilities (can be used in Node.js or browser)
  {
    entry: ['src/openapi.ts'],
    format: ['esm'],
    dts: true,
    external: ['capnweb', 'oauth.do', 'cloudflare:workers', 'ts-morph', 'glob'],
  },
  // Testing utilities (Node.js only, uses node:http for TestServer)
  {
    entry: ['src/testing.ts'],
    format: ['esm'],
    dts: true,
    external: ['capnweb', '@dotdo/capnweb', '@dotdo/capnweb/server', 'oauth.do', 'cloudflare:workers', 'node:http'],
  },
  // CLI (Node.js only, uses ts-morph and glob via extract/detect)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    banner: { js: '#!/usr/bin/env node' },
    external: ['capnweb', 'oauth.do', 'cloudflare:workers', 'ts-morph', 'glob'],
  },
])
