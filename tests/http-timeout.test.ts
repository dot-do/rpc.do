/**
 * HTTP Transport Timeout Tests
 *
 * Tests timeout functionality using real @dotdo/capnweb protocol.
 * Intercepts fetch to route to a real RpcTarget server with simulated delays.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RpcTarget, newHttpBatchRpcResponse } from '@dotdo/capnweb/server'

// ============================================================================
// Test RpcTarget - methods must be class methods, not instance properties
// ============================================================================

class TestMethodTarget extends RpcTarget {
  method() { return { result: 'success' } }
  slowMethod() { return new Promise(resolve => setTimeout(() => resolve('slow'), 200)) }
}

class TimeoutTestTarget extends RpcTarget {
  get test() { return new TestMethodTarget() }

  simpleMethod() {
    return { result: 'success' }
  }
}

let testTarget: TimeoutTestTarget
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  testTarget = new TimeoutTestTarget()
  originalFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.startsWith('https://api.example.com/')) {
      const request = input instanceof Request ? input : new Request(url, init)
      return newHttpBatchRpcResponse(request, testTarget)
    }
    return originalFetch(input, init)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function getHttpTransport() {
  const { http } = await import('../src/transports')
  return http
}

// ============================================================================
// HTTP Timeout Tests
// ============================================================================

describe('http() Transport - Timeout', () => {
  it('should complete request normally when within timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should timeout and throw when request takes too long', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 50 })

    await expect(transport.call('test.slowMethod', [])).rejects.toThrow()
  }, 10000)

  it('should not timeout when no timeout is specified', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should support legacy auth string parameter with no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', 'my-token')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should support options object with auth and timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', {
      auth: 'my-token',
      timeout: 5000,
    })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should support auth provider function with timeout', async () => {
    const authProvider = vi.fn().mockResolvedValue('dynamic-token')
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', {
      auth: authProvider,
      timeout: 5000,
    })
    const result = await transport.call('test.method', [])

    expect(authProvider).toHaveBeenCalled()
    expect(result).toEqual({ result: 'success' })
  })

  it('should handle timeout of 0 as no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 0 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should handle negative timeout as no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: -1 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should clear timeout when request completes successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    await transport.call('test.method', [])

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})

// ============================================================================
// HTTP Transport - Capnweb Protocol Tests
// ============================================================================

describe('http() Transport - Capnweb Protocol', () => {
  it('should call methods via real capnweb HTTP batch protocol', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should make sequential calls successfully', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    const r1 = await transport.call('test.method', [])
    expect(r1).toEqual({ result: 'success' })

    // Close and recreate for next call (HTTP batch sessions are per-request)
    transport.close!()

    const transport2 = http('https://api.example.com/rpc')
    const r2 = await transport2.call('simpleMethod', [])
    expect(r2).toEqual({ result: 'success' })
  })

  it('should navigate nested method paths', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should dispose session on close()', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('test.method', [])

    expect(() => transport.close!()).not.toThrow()
  })

  it('should handle close() when session is not initialized', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')

    expect(() => transport.close!()).not.toThrow()
  })

  it('should create new session after close()', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')

    const r1 = await transport.call('test.method', [])
    expect(r1).toEqual({ result: 'success' })

    transport.close!()

    const r2 = await transport.call('test.method', [])
    expect(r2).toEqual({ result: 'success' })
  })
})
