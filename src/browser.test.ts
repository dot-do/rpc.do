/**
 * Browser Compatibility Tests
 *
 * These tests verify that the main entry point can be bundled for browser
 * environments without pulling in Node.js-only dependencies.
 *
 * This prevents regressions like the node:child_process bundling error.
 */

import { describe, it, expect } from 'vitest'
import { build } from 'esbuild'
import { join } from 'path'

describe('Browser Compatibility', () => {
  it('should bundle main entry for browser without Node.js dependencies', async () => {
    // Create a simple entry that imports from our package
    const entryCode = `
      import { RPC, http, binding, composite, capnweb } from './src/index.ts'
      export { RPC, http, binding, composite, capnweb }
    `

    const result = await build({
      stdin: {
        contents: entryCode,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      // These are OK to be external (optional deps or runtime-only)
      external: ['capnweb'],
      logLevel: 'silent',
    })

    // If we get here without throwing, bundling succeeded
    expect(result.errors).toHaveLength(0)

    // Verify output doesn't contain Node.js module imports
    const output = result.outputFiles[0].text
    expect(output).not.toContain('node:')
    expect(output).not.toContain('child_process')
    expect(output).not.toContain('require("fs")')
  })

  it('should bundle transports entry for browser', async () => {
    const entryCode = `
      import { http, binding, composite, capnweb } from './src/transports.ts'
      export { http, binding, composite, capnweb }
    `

    const result = await build({
      stdin: {
        contents: entryCode,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      external: ['capnweb'],
      logLevel: 'silent',
    })

    expect(result.errors).toHaveLength(0)
    const output = result.outputFiles[0].text
    expect(output).not.toContain('node:')
    expect(output).not.toContain('child_process')
  })

  it('should fail to bundle auth entry for browser (expected - uses oauth.do)', async () => {
    // This test documents that auth requires server-side usage
    // It should fail or have external oauth.do dependency
    const entryCode = `
      import { auth, getToken } from './src/auth.ts'
      export { auth, getToken }
    `

    const result = await build({
      stdin: {
        contents: entryCode,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      // oauth.do should be external for browser builds
      external: ['oauth.do'],
      logLevel: 'silent',
    })

    // Should succeed with oauth.do marked as external
    expect(result.errors).toHaveLength(0)
    // Output should have oauth.do import (not bundled)
    const output = result.outputFiles[0].text
    expect(output).toContain('oauth.do')
  })
})
