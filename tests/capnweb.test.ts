/**
 * Capnweb Transport Tests
 *
 * End-to-end tests using real @dotdo/capnweb.
 * Creates a real RpcTarget server and intercepts fetch to route requests to it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RpcTarget, newHttpBatchRpcResponse } from '@dotdo/capnweb/server'

// ============================================================================
// Test RpcTarget - real capnweb server
// Capnweb only exposes class methods/getters, not instance properties.
// ============================================================================

class UsersTarget extends RpcTarget {
  get(id: string) { return { id, name: 'Test User' } }
  list() { return [{ id: '1' }, { id: '2' }] }
}

class PostsTarget extends RpcTarget {
  create(...args: any[]) { return { id: 'new-post', args } }
}

class TestTarget extends RpcTarget {
  get users() { return new UsersTarget() }
  get posts() { return new PostsTarget() }

  simpleMethod(...args: any[]) {
    return args.length > 0 ? { args } : 'simple result'
  }
}

let testTarget: TestTarget
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  testTarget = new TestTarget()
  originalFetch = globalThis.fetch

  // Intercept fetch and route to the real capnweb server handler
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.startsWith('https://api.example.com/')) {
      // When capnweb passes (Request, init), we need to merge them properly
      // The init contains the RPC body that must be included
      const request = input instanceof Request
        ? new Request(input, init)  // Merge Request with init (body from init takes precedence)
        : new Request(url, init)
      return newHttpBatchRpcResponse(request, testTarget)
    }
    return originalFetch(input, init)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// Helper to get fresh capnweb transport
async function getCapnwebTransport() {
  const { capnweb } = await import('../src/transports')
  return capnweb
}

// Helper to get fresh http transport
async function getHttpTransport() {
  const { http } = await import('../src/transports')
  return http
}

// ============================================================================
// capnweb() Transport - HTTP Batch Session Tests
// ============================================================================

describe('capnweb() Transport - HTTP Batch Session', () => {
  it('should call simple methods via real capnweb protocol', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    const result = await transport.call('simpleMethod', [])

    expect(result).toBe('simple result')
  })

  it('should navigate to sub-target methods', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    const result = await transport.call('users.get', ['123'])

    expect(result).toEqual({ id: '123', name: 'Test User' })
  })

  it('should pass multiple arguments correctly', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    const result = await transport.call('posts.create', [{ title: 'Test' }, { author: 'user1' }]) as any

    expect(result.id).toBe('new-post')
    expect(result.args).toEqual([{ title: 'Test' }, { author: 'user1' }])
  })

  it('should pass no arguments correctly', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    const result = await transport.call('users.list', [])

    expect(result).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should throw for non-existent path', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    await expect(transport.call('nonexistent.method', [])).rejects.toThrow()
  })

  it('should dispose session on close()', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    await transport.call('simpleMethod', [])

    expect(() => transport.close!()).not.toThrow()
  })

  it('should handle close() when session is not initialized', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    expect(() => transport.close!()).not.toThrow()
  })

  it('should handle close() called multiple times', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    await transport.call('simpleMethod', [])

    transport.close!()
    transport.close!()
    transport.close!()
  })

  it('should create new session after close()', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    const result1 = await transport.call('simpleMethod', [])
    expect(result1).toBe('simple result')

    transport.close!()

    const result2 = await transport.call('simpleMethod', [])
    expect(result2).toBe('simple result')
  })

  it('should accept auth option as string', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', {
      websocket: false,
      auth: 'my-token',
    })

    const result = await transport.call('simpleMethod', [])
    expect(result).toBe('simple result')
  })

  it('should accept auth option as function', async () => {
    const authProvider = vi.fn().mockReturnValue('dynamic-token')
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', {
      websocket: false,
      auth: authProvider,
    })

    const result = await transport.call('simpleMethod', [])
    expect(result).toBe('simple result')
  })
})

// ============================================================================
// http() Transport - Real capnweb protocol
// ============================================================================

describe('http() Transport - Real capnweb protocol', () => {
  it('should call methods via real capnweb HTTP batch protocol', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc')

    const result = await transport.call('simpleMethod', [])

    expect(result).toBe('simple result')
  })

  it('should navigate to sub-target methods', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc')

    const result = await transport.call('users.get', ['456'])

    expect(result).toEqual({ id: '456', name: 'Test User' })
  })

  it('should call with auth token', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc', 'my-token')

    const result = await transport.call('users.list', [])

    expect(result).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should accept auth provider function for API compatibility', async () => {
    // Note: Auth is accepted for API consistency but not used in HTTP batch mode.
    // capnweb uses in-band authorization (pass token to RPC methods).
    const asyncAuth = vi.fn().mockResolvedValue('async-token')
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc', asyncAuth)

    const result = await transport.call('simpleMethod', [])

    // Auth provider is NOT called for HTTP batch (in-band auth is used instead)
    expect(asyncAuth).not.toHaveBeenCalled()
    expect(result).toBe('simple result')
  })

  it('should call with options object', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc', {
      auth: 'my-token',
      timeout: 5000,
    })

    const result = await transport.call('simpleMethod', [])

    expect(result).toBe('simple result')
  })

  it('should dispose session on close()', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc')

    await transport.call('simpleMethod', [])
    expect(() => transport.close!()).not.toThrow()
  })

  it('should create new session after close()', async () => {
    const http = await getHttpTransport()
    const transport = http('https://api.example.com/rpc')

    const r1 = await transport.call('simpleMethod', [])
    expect(r1).toBe('simple result')

    transport.close!()

    const r2 = await transport.call('simpleMethod', [])
    expect(r2).toBe('simple result')
  })
})
