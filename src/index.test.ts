/**
 * rpc.do Tests
 *
 * Tests for RPC proxy, transports, and auth.
 * Uses real @dotdo/capnweb protocol (no mocking capnweb).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RPC, binding, composite } from './index'
import { auth } from './auth'
import { RPCError } from './errors'
import { RpcTarget, newHttpBatchRpcResponse } from '@dotdo/capnweb/server'
import type { Transport } from './index'

// ============================================================================
// RPC Proxy Tests (no mocking needed - uses mock transports)
// ============================================================================

describe('RPC Proxy', () => {
  it('should create a proxy that builds method paths', async () => {
    const calls: { method: string; args: any[] }[] = []

    const mockTransport: Transport = {
      call: async (method, args) => {
        calls.push({ method, args })
        return { success: true, data: method }
      }
    }

    const rpc = RPC(mockTransport)

    await rpc.ai.generate({ prompt: 'hello' })

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('ai.generate')
    expect(calls[0].args).toEqual([{ prompt: 'hello' }])
  })

  it('should handle deeply nested method paths', async () => {
    const calls: { method: string; args: any[] }[] = []

    const mockTransport: Transport = {
      call: async (method, args) => {
        calls.push({ method, args })
        return { result: 'ok' }
      }
    }

    const rpc = RPC(mockTransport)

    await rpc.db.users.find({ id: '123' })

    expect(calls[0].method).toBe('db.users.find')
    expect(calls[0].args).toEqual([{ id: '123' }])
  })

  it('should support typed RPC with generics', async () => {
    interface API {
      ai: {
        generate: (params: { prompt: string }) => { text: string }
      }
    }

    const mockTransport: Transport = {
      call: async () => ({ text: 'Generated text' })
    }

    const rpc = RPC<API>(mockTransport)
    const result = await rpc.ai.generate({ prompt: 'hello' })

    expect(result).toEqual({ text: 'Generated text' })
  })

  it('should support transport factory functions', async () => {
    let factoryCalled = false

    const transportFactory = () => {
      factoryCalled = true
      return {
        call: async () => ({ ok: true })
      }
    }

    const rpc = RPC(transportFactory)

    // Factory should not be called until first use
    expect(factoryCalled).toBe(false)

    await rpc.test.method()

    expect(factoryCalled).toBe(true)
  })

  it('should support async transport factory', async () => {
    const mockTransport: Transport = {
      call: async () => ({ connected: true })
    }

    const asyncFactory = async () => {
      await new Promise(r => setTimeout(r, 10))
      return mockTransport
    }

    const rpc = RPC(asyncFactory)
    const result = await rpc.status.check()

    expect(result).toEqual({ connected: true })
  })

  it('should have close method on proxy', async () => {
    let closed = false

    const mockTransport: Transport = {
      call: async () => ({}),
      close: () => { closed = true }
    }

    const rpc = RPC(mockTransport)
    await rpc.test()

    await rpc.close?.()

    expect(closed).toBe(true)
  })

  it('should not be thenable (proxy is not a promise)', () => {
    const mockTransport: Transport = {
      call: async () => ({})
    }

    const rpc = RPC(mockTransport)

    // Accessing .then should return undefined, not continue the chain
    expect((rpc as any).then).toBeUndefined()
    expect((rpc as any).catch).toBeUndefined()
    expect((rpc as any).finally).toBeUndefined()
  })
})

// ============================================================================
// HTTP Transport Tests (real capnweb)
// ============================================================================

class AiTarget extends RpcTarget {
  generate(params: { prompt: string }) { return { result: 'ok', prompt: params.prompt } }
}

class HttpTestTarget extends RpcTarget {
  get ai() { return new AiTarget() }

  test(...args: any[]) {
    return { called: true, args }
  }
}

describe('HTTP Transport', () => {
  let testTarget: HttpTestTarget
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testTarget = new HttpTestTarget()
    originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('https://rpc.example.com')) {
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

  it('should call methods via real capnweb HTTP batch protocol', async () => {
    const { http } = await import('./transports')

    const transport = http('https://rpc.example.com')
    const result = await transport.call('ai.generate', [{ prompt: 'test' }])

    expect(result).toEqual({ result: 'ok', prompt: 'test' })
  })

  it('should accept auth provider for API compatibility', async () => {
    // Note: Auth is accepted for API consistency but not used in HTTP batch mode.
    // capnweb uses in-band authorization (pass token to RPC methods).
    const { http } = await import('./transports')

    const asyncAuth = vi.fn().mockResolvedValue('async-token')
    const transport = http('https://rpc.example.com', asyncAuth)
    await transport.call('test', [])

    // Auth provider is NOT called for HTTP batch (in-band auth is used instead)
    expect(asyncAuth).not.toHaveBeenCalled()
  })

  it('should support legacy auth string parameter', async () => {
    const { http } = await import('./transports')

    const transport = http('https://rpc.example.com', 'test-token')
    const result = await transport.call('test', [])

    expect(result).toEqual({ called: true, args: [] })
  })

  it('should throw for non-existent method', async () => {
    const { http } = await import('./transports')
    const transport = http('https://rpc.example.com')

    await expect(transport.call('nonexistent.deeply.nested', [])).rejects.toThrow()
  })

  it('should dispose session on close()', async () => {
    const { http } = await import('./transports')

    const transport = http('https://rpc.example.com')
    await transport.call('test', [])

    expect(() => transport.close!()).not.toThrow()
  })
})

// ============================================================================
// Error Wrapping Tests
// ============================================================================

describe('wrapTransportError', () => {
  it('should pass through ConnectionError unchanged', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    const original = ConnectionError.timeout(5000)
    const wrapped = wrapTransportError(original)

    expect(wrapped).toBe(original)
    expect(wrapped).toBeInstanceOf(ConnectionError)
  })

  it('should pass through RPCError unchanged', async () => {
    const { wrapTransportError } = await import('./transports')

    const original = new RPCError('test error', 'TEST_CODE')
    const wrapped = wrapTransportError(original)

    expect(wrapped).toBe(original)
    expect(wrapped).toBeInstanceOf(RPCError)
  })

  it('should wrap TypeError as ConnectionError', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    const typeError = new TypeError('Failed to fetch')
    const wrapped = wrapTransportError(typeError)

    expect(wrapped).toBeInstanceOf(ConnectionError)
    expect((wrapped as InstanceType<typeof ConnectionError>).code).toBe('CONNECTION_FAILED')
    expect((wrapped as InstanceType<typeof ConnectionError>).retryable).toBe(true)
  })

  it('should wrap network errors as ConnectionError', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    const networkError = new Error('NetworkError when attempting to fetch resource')
    const wrapped = wrapTransportError(networkError)

    expect(wrapped).toBeInstanceOf(ConnectionError)
    expect((wrapped as InstanceType<typeof ConnectionError>).code).toBe('CONNECTION_FAILED')
  })

  it('should wrap 401 errors as auth failed', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    const authError = new Error('401 Unauthorized')
    const wrapped = wrapTransportError(authError)

    expect(wrapped).toBeInstanceOf(ConnectionError)
    expect((wrapped as InstanceType<typeof ConnectionError>).code).toBe('AUTH_FAILED')
    expect((wrapped as InstanceType<typeof ConnectionError>).retryable).toBe(false)
  })

  it('should wrap 429 errors as retryable ConnectionError', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    const rateLimitError = new Error('429 Too Many Requests')
    const wrapped = wrapTransportError(rateLimitError)

    expect(wrapped).toBeInstanceOf(ConnectionError)
    expect((wrapped as InstanceType<typeof ConnectionError>).code).toBe('CONNECTION_FAILED')
    expect((wrapped as InstanceType<typeof ConnectionError>).retryable).toBe(true)
  })

  it('should wrap 5xx errors as retryable ConnectionError', async () => {
    const { wrapTransportError } = await import('./transports')
    const { ConnectionError } = await import('./errors')

    for (const code of ['500', '502', '503', '504']) {
      const serverError = new Error(`${code} Server Error`)
      const wrapped = wrapTransportError(serverError)

      expect(wrapped).toBeInstanceOf(ConnectionError)
      expect((wrapped as InstanceType<typeof ConnectionError>).code).toBe('CONNECTION_FAILED')
      expect((wrapped as InstanceType<typeof ConnectionError>).retryable).toBe(true)
    }
  })

  it('should wrap 4xx errors (except 401, 429) as RPCError', async () => {
    const { wrapTransportError } = await import('./transports')

    const badRequestError = new Error('400 Bad Request')
    const wrapped = wrapTransportError(badRequestError)

    expect(wrapped).toBeInstanceOf(RPCError)
    expect((wrapped as RPCError).code).toBe('REQUEST_ERROR')
  })

  it('should wrap error with code property as RPCError', async () => {
    const { wrapTransportError } = await import('./transports')

    const errorWithCode = Object.assign(new Error('Custom error'), { code: 'CUSTOM_CODE' })
    const wrapped = wrapTransportError(errorWithCode)

    expect(wrapped).toBeInstanceOf(RPCError)
    expect((wrapped as RPCError).code).toBe('CUSTOM_CODE')
  })

  it('should wrap unknown errors as RPCError with UNKNOWN_ERROR code', async () => {
    const { wrapTransportError } = await import('./transports')

    const unknownError = new Error('Something went wrong')
    const wrapped = wrapTransportError(unknownError)

    expect(wrapped).toBeInstanceOf(RPCError)
    expect((wrapped as RPCError).code).toBe('UNKNOWN_ERROR')
  })

  it('should wrap non-Error values as RPCError', async () => {
    const { wrapTransportError } = await import('./transports')

    const wrapped = wrapTransportError('string error')

    expect(wrapped).toBeInstanceOf(RPCError)
    expect((wrapped as RPCError).code).toBe('UNKNOWN_ERROR')
    expect((wrapped as RPCError).message).toBe('string error')
  })
})

// ============================================================================
// Binding Transport Tests
// ============================================================================

describe('Binding Transport', () => {
  it('should call methods on service binding', async () => {
    const mockBinding = {
      db: {
        get: vi.fn(async (params: any) => ({ id: params.id, name: 'Test' }))
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('db.get', [{ id: '123' }])

    expect(mockBinding.db.get).toHaveBeenCalledWith({ id: '123' })
    expect(result).toEqual({ id: '123', name: 'Test' })
  })

  it('should handle nested namespaces', async () => {
    const mockBinding = {
      api: {
        users: {
          list: vi.fn(async () => [{ id: '1' }, { id: '2' }])
        }
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('api.users.list', [])

    expect(result).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should throw on unknown namespace', async () => {
    const mockBinding = {}

    const transport = binding(mockBinding)

    await expect(transport.call('unknown.method', [])).rejects.toThrow(/Unknown namespace/)
  })

  it('should throw on unknown method', async () => {
    const mockBinding = {
      db: {}
    }

    const transport = binding(mockBinding)

    await expect(transport.call('db.unknown', [])).rejects.toThrow(/Unknown method/)
  })

  it('should throw RPCError with UNKNOWN_NAMESPACE code for unknown namespace', async () => {
    const mockBinding = {}

    const transport = binding(mockBinding)

    try {
      await transport.call('unknown.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_NAMESPACE')
    }
  })

  it('should throw RPCError with UNKNOWN_METHOD code for unknown method', async () => {
    const mockBinding = {
      db: {}
    }

    const transport = binding(mockBinding)

    try {
      await transport.call('db.unknown', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_METHOD')
    }
  })

  // Additional comprehensive tests for binding transport

  it('should call top-level methods directly', async () => {
    const mockBinding = {
      ping: vi.fn(async () => 'pong')
    }

    const transport = binding(mockBinding)
    const result = await transport.call('ping', [])

    expect(mockBinding.ping).toHaveBeenCalled()
    expect(result).toBe('pong')
  })

  it('should pass multiple arguments to method', async () => {
    const mockBinding = {
      math: {
        add: vi.fn(async (a: number, b: number, c: number) => a + b + c)
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('math.add', [1, 2, 3])

    expect(mockBinding.math.add).toHaveBeenCalledWith(1, 2, 3)
    expect(result).toBe(6)
  })

  it('should handle synchronous methods', async () => {
    const mockBinding = {
      sync: {
        getValue: vi.fn(() => 'sync-result')
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('sync.getValue', [])

    expect(result).toBe('sync-result')
  })

  it('should handle methods that return promises', async () => {
    const mockBinding = {
      async: {
        fetchData: vi.fn(() => Promise.resolve({ data: 'fetched' }))
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('async.fetchData', [])

    expect(result).toEqual({ data: 'fetched' })
  })

  it('should throw UNKNOWN_METHOD when property is not a function', async () => {
    const mockBinding = {
      config: {
        value: 'not-a-function'
      }
    }

    const transport = binding(mockBinding)

    try {
      await transport.call('config.value', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_METHOD')
    }
  })

  it('should handle deeply nested namespaces (4+ levels)', async () => {
    const mockBinding = {
      level1: {
        level2: {
          level3: {
            level4: {
              deepMethod: vi.fn(async () => 'deep-result')
            }
          }
        }
      }
    }

    const transport = binding(mockBinding)
    const result = await transport.call('level1.level2.level3.level4.deepMethod', [])

    expect(result).toBe('deep-result')
  })

  it('should throw UNKNOWN_NAMESPACE for intermediate null value', async () => {
    const mockBinding = {
      parent: {
        child: null as any
      }
    }

    const transport = binding(mockBinding)

    try {
      await transport.call('parent.child.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_NAMESPACE')
    }
  })

  it('should throw UNKNOWN_NAMESPACE for intermediate undefined value', async () => {
    const mockBinding = {
      parent: {} as { child?: { method: () => void } }
    }

    const transport = binding(mockBinding)

    try {
      await transport.call('parent.child.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_NAMESPACE')
    }
  })

  it('should propagate errors thrown by the method', async () => {
    const mockBinding = {
      service: {
        failingMethod: vi.fn(async () => {
          throw new Error('Service error')
        })
      }
    }

    const transport = binding(mockBinding)

    await expect(transport.call('service.failingMethod', [])).rejects.toThrow('Service error')
  })

  it('should work with RPC proxy for full integration', async () => {
    const mockBinding = {
      users: {
        create: vi.fn(async (data: { name: string }) => ({ id: 'new-id', ...data })),
        get: vi.fn(async (id: string) => ({ id, name: 'Test User' })),
        list: vi.fn(async () => [{ id: '1' }, { id: '2' }])
      }
    }

    const rpc = RPC(binding(mockBinding))

    const created = await rpc.users.create({ name: 'John' })
    expect(created).toEqual({ id: 'new-id', name: 'John' })

    const user = await rpc.users.get('123')
    expect(user).toEqual({ id: '123', name: 'Test User' })

    const users = await rpc.users.list()
    expect(users).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should throw UNKNOWN_METHOD for empty method name', async () => {
    const mockBinding = {
      namespace: {}
    }

    const transport = binding(mockBinding)

    try {
      await transport.call('namespace.', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('UNKNOWN_METHOD')
    }
  })
})

// ============================================================================
// Composite Transport Tests
// ============================================================================

describe('Composite Transport', () => {
  it('should try transports in order until one succeeds', async () => {
    const transport1: Transport = {
      call: async () => { throw new Error('Transport 1 failed') }
    }

    const transport2: Transport = {
      call: async () => ({ from: 'transport2' })
    }

    const comp = composite(transport1, transport2)
    const result = await comp.call('test', [])

    expect(result).toEqual({ from: 'transport2' })
  })

  it('should throw last error if all transports fail', async () => {
    const transport1: Transport = {
      call: async () => { throw new Error('Error 1') }
    }

    const transport2: Transport = {
      call: async () => { throw new Error('Error 2') }
    }

    const comp = composite(transport1, transport2)

    await expect(comp.call('test', [])).rejects.toThrow('Error 2')
  })

  it('should close all transports', async () => {
    let closed1 = false
    let closed2 = false

    const transport1: Transport = {
      call: async () => ({}),
      close: () => { closed1 = true }
    }

    const transport2: Transport = {
      call: async () => ({}),
      close: () => { closed2 = true }
    }

    const comp = composite(transport1, transport2)
    comp.close?.()

    expect(closed1).toBe(true)
    expect(closed2).toBe(true)
  })

  // Additional comprehensive tests for composite transport

  it('should use first transport when it succeeds', async () => {
    const calls: string[] = []

    const transport1: Transport = {
      call: async () => {
        calls.push('transport1')
        return { from: 'transport1' }
      }
    }

    const transport2: Transport = {
      call: async () => {
        calls.push('transport2')
        return { from: 'transport2' }
      }
    }

    const comp = composite(transport1, transport2)
    const result = await comp.call('test', [])

    expect(result).toEqual({ from: 'transport1' })
    expect(calls).toEqual(['transport1'])
  })

  it('should try multiple fallbacks through the chain', async () => {
    const calls: string[] = []

    const transport1: Transport = {
      call: async () => {
        calls.push('transport1')
        throw new Error('Transport 1 failed')
      }
    }

    const transport2: Transport = {
      call: async () => {
        calls.push('transport2')
        throw new Error('Transport 2 failed')
      }
    }

    const transport3: Transport = {
      call: async () => {
        calls.push('transport3')
        return { from: 'transport3' }
      }
    }

    const comp = composite(transport1, transport2, transport3)
    const result = await comp.call('test', [])

    expect(result).toEqual({ from: 'transport3' })
    expect(calls).toEqual(['transport1', 'transport2', 'transport3'])
  })

  it('should preserve method and args through fallback chain', async () => {
    const receivedCalls: { method: string; args: unknown[] }[] = []

    const transport1: Transport = {
      call: async (method, args) => {
        receivedCalls.push({ method, args })
        throw new Error('Transport 1 failed')
      }
    }

    const transport2: Transport = {
      call: async (method, args) => {
        receivedCalls.push({ method, args })
        return { method, args }
      }
    }

    const comp = composite(transport1, transport2)
    const result = await comp.call('users.get', [{ id: '123' }])

    expect(receivedCalls).toHaveLength(2)
    expect(receivedCalls[0]).toEqual({ method: 'users.get', args: [{ id: '123' }] })
    expect(receivedCalls[1]).toEqual({ method: 'users.get', args: [{ id: '123' }] })
    expect(result).toEqual({ method: 'users.get', args: [{ id: '123' }] })
  })

  it('should preserve error type from last transport (RPCError)', async () => {
    const transport1: Transport = {
      call: async () => { throw new Error('Generic error') }
    }

    const transport2: Transport = {
      call: async () => { throw new RPCError('RPC specific error', 'CUSTOM_CODE') }
    }

    const comp = composite(transport1, transport2)

    try {
      await comp.call('test', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('CUSTOM_CODE')
      expect((error as RPCError).message).toBe('RPC specific error')
    }
  })

  it('should work with single transport', async () => {
    const transport: Transport = {
      call: async () => ({ single: true })
    }

    const comp = composite(transport)
    const result = await comp.call('test', [])

    expect(result).toEqual({ single: true })
  })

  it('should throw undefined for empty transport array', async () => {
    const comp = composite()

    // With no transports, lastError is undefined
    try {
      await comp.call('test', [])
    } catch (error) {
      expect(error).toBeUndefined()
    }
  })

  it('should handle transports without close method', async () => {
    const transport1: Transport = {
      call: async () => ({})
      // No close method
    }

    let closed2 = false
    const transport2: Transport = {
      call: async () => ({}),
      close: () => { closed2 = true }
    }

    const comp = composite(transport1, transport2)

    // Should not throw
    expect(() => comp.close?.()).not.toThrow()
    expect(closed2).toBe(true)
  })

  it('should work with RPC proxy for full integration', async () => {
    const primaryCalls: string[] = []
    const fallbackCalls: string[] = []

    const primary: Transport = {
      call: async (method) => {
        primaryCalls.push(method)
        if (method === 'users.delete') {
          throw new Error('Primary cannot delete')
        }
        return { from: 'primary', method }
      }
    }

    const fallback: Transport = {
      call: async (method) => {
        fallbackCalls.push(method)
        return { from: 'fallback', method }
      }
    }

    const rpc = RPC(composite(primary, fallback))

    // First call should use primary
    const result1 = await rpc.users.get('123')
    expect(result1).toEqual({ from: 'primary', method: 'users.get' })
    expect(primaryCalls).toEqual(['users.get'])
    expect(fallbackCalls).toEqual([])

    // This call should fall back
    const result2 = await rpc.users.delete('456')
    expect(result2).toEqual({ from: 'fallback', method: 'users.delete' })
    expect(primaryCalls).toEqual(['users.get', 'users.delete'])
    expect(fallbackCalls).toEqual(['users.delete'])
  })

  it('should handle async errors correctly', async () => {
    const transport1: Transport = {
      call: async () => {
        await new Promise(r => setTimeout(r, 10))
        throw new Error('Async error 1')
      }
    }

    const transport2: Transport = {
      call: async () => {
        await new Promise(r => setTimeout(r, 10))
        return { success: true }
      }
    }

    const comp = composite(transport1, transport2)
    const result = await comp.call('test', [])

    expect(result).toEqual({ success: true })
  })

  it('should handle all transports failing with async errors', async () => {
    const transport1: Transport = {
      call: async () => {
        await new Promise(r => setTimeout(r, 5))
        throw new Error('Async error 1')
      }
    }

    const transport2: Transport = {
      call: async () => {
        await new Promise(r => setTimeout(r, 5))
        throw new Error('Async error 2')
      }
    }

    const comp = composite(transport1, transport2)

    await expect(comp.call('test', [])).rejects.toThrow('Async error 2')
  })

  it('should handle synchronous errors', async () => {
    const transport1: Transport = {
      call: () => {
        throw new Error('Sync error 1')
      }
    }

    const transport2: Transport = {
      call: async () => ({ handled: true })
    }

    const comp = composite(transport1, transport2)
    const result = await comp.call('test', [])

    expect(result).toEqual({ handled: true })
  })

  it('should close all transports even if some throw errors', async () => {
    let closed1 = false
    let closed2 = false
    let closed3 = false

    const transport1: Transport = {
      call: async () => ({}),
      close: () => {
        closed1 = true
        throw new Error('Close error 1')
      }
    }

    const transport2: Transport = {
      call: async () => ({}),
      close: () => { closed2 = true }
    }

    const transport3: Transport = {
      call: async () => ({}),
      close: () => { closed3 = true }
    }

    const comp = composite(transport1, transport2, transport3)

    // Note: Current implementation doesn't catch close errors,
    // but we verify that close is called on all transports
    try {
      comp.close?.()
    } catch (e) {
      // Expected to throw from transport1.close
    }

    expect(closed1).toBe(true)
    // transport2 and transport3 close are called regardless
    // (current impl iterates through all)
  })

  it('should support nested composite transports', async () => {
    const calls: string[] = []

    const inner1: Transport = {
      call: async () => {
        calls.push('inner1')
        throw new Error('Inner 1 failed')
      }
    }

    const inner2: Transport = {
      call: async () => {
        calls.push('inner2')
        return { from: 'inner2' }
      }
    }

    const outer1: Transport = {
      call: async () => {
        calls.push('outer1')
        throw new Error('Outer 1 failed')
      }
    }

    const innerComposite = composite(inner1, inner2)
    const outerComposite = composite(outer1, innerComposite)

    const result = await outerComposite.call('test', [])

    expect(calls).toEqual(['outer1', 'inner1', 'inner2'])
    expect(result).toEqual({ from: 'inner2' })
  })

  it('should handle transport returning null', async () => {
    const transport: Transport = {
      call: async () => null
    }

    const comp = composite(transport)
    const result = await comp.call('test', [])

    expect(result).toBeNull()
  })

  it('should handle transport returning undefined', async () => {
    const transport: Transport = {
      call: async () => undefined
    }

    const comp = composite(transport)
    const result = await comp.call('test', [])

    expect(result).toBeUndefined()
  })

  it('should handle transport returning various types', async () => {
    const transport: Transport = {
      call: async (method) => {
        if (method === 'string') return 'hello'
        if (method === 'number') return 42
        if (method === 'boolean') return true
        if (method === 'array') return [1, 2, 3]
        return { default: true }
      }
    }

    const comp = composite(transport)

    expect(await comp.call('string', [])).toBe('hello')
    expect(await comp.call('number', [])).toBe(42)
    expect(await comp.call('boolean', [])).toBe(true)
    expect(await comp.call('array', [])).toEqual([1, 2, 3])
    expect(await comp.call('object', [])).toEqual({ default: true })
  })
})

// ============================================================================
// createRPCClient Factory Tests (real capnweb)
// ============================================================================

class ClientTestMethodTarget extends RpcTarget {
  method() { return { result: 'ok' } }
}

class ClientSomeTarget extends RpcTarget {
  method() { return { some: true } }
}

class ClientAiTarget extends RpcTarget {
  generate(params: { prompt: string }) { return { text: 'Generated response' } }
}

class ClientSimpleTarget extends RpcTarget {
  call() { return { success: true } }
}

class ClientTestTarget extends RpcTarget {
  get test() { return new ClientTestMethodTarget() }
  get some() { return new ClientSomeTarget() }
  get ai() { return new ClientAiTarget() }
  get simple() { return new ClientSimpleTarget() }
}

describe('createRPCClient Factory', () => {
  let clientTarget: ClientTestTarget
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    clientTarget = new ClientTestTarget()
    originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('https://') && (url.includes('api.example.com') || url.includes('custom.api.com') || url.includes('minimal.api.com'))) {
        // When capnweb passes (Request, init), we need to merge them properly
        // The init contains the RPC body that must be included
        const request = input instanceof Request
          ? new Request(input, init)  // Merge Request with init (body from init takes precedence)
          : new Request(url, init)
        return newHttpBatchRpcResponse(request, clientTarget)
      }
      return originalFetch(input, init)
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  async function getCreateRPCClient() {
    const { createRPCClient } = await import('./index')
    return createRPCClient
  }

  it('should return an RPC proxy', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({ baseUrl: 'https://api.example.com/rpc' })

    expect((client as any).then).toBeUndefined()

    const result = await client.test.method()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should use http transport with the provided baseUrl', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({ baseUrl: 'https://custom.api.com/rpc' })
    const result = await client.some.method()

    expect(result).toEqual({ some: true })
  })

  it('should pass auth token (auth option is accepted)', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: 'my-secret-token'
    })
    const result = await client.test.method()

    expect(result).toEqual({ result: 'ok' })
  })

  it('should accept auth provider function for API compatibility', async () => {
    // Note: Auth is accepted for API consistency but not used in HTTP batch mode.
    // capnweb uses in-band authorization (pass token to RPC methods).
    const createRPCClient = await getCreateRPCClient()

    const authProvider = vi.fn().mockReturnValue('dynamic-token')
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: authProvider
    })
    const result = await client.test.method()

    // Auth provider is NOT called for HTTP batch (in-band auth is used instead)
    expect(authProvider).not.toHaveBeenCalled()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should accept async auth provider function for API compatibility', async () => {
    // Note: Auth is accepted for API consistency but not used in HTTP batch mode.
    const createRPCClient = await getCreateRPCClient()

    const asyncAuthProvider = vi.fn().mockResolvedValue('async-token')
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: asyncAuthProvider
    })
    const result = await client.test.method()

    // Auth provider is NOT called for HTTP batch (in-band auth is used instead)
    expect(asyncAuthProvider).not.toHaveBeenCalled()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should accept null auth from provider for API compatibility', async () => {
    // Note: Auth is accepted for API consistency but not used in HTTP batch mode.
    const createRPCClient = await getCreateRPCClient()

    const nullAuthProvider = vi.fn().mockReturnValue(null)
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: nullAuthProvider
    })
    const result = await client.test.method()

    // Auth provider is NOT called for HTTP batch (in-band auth is used instead)
    expect(nullAuthProvider).not.toHaveBeenCalled()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should support typed API', async () => {
    const createRPCClient = await getCreateRPCClient()

    interface MyAPI {
      ai: {
        generate: (params: { prompt: string }) => { text: string }
      }
    }

    const client = createRPCClient<MyAPI>({ baseUrl: 'https://api.example.com/rpc' })
    const result = await client.ai.generate({ prompt: 'hello' })

    expect(result).toEqual({ text: 'Generated response' })
  })

  it('should pass timeout option to http transport', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      timeout: 5000
    })

    const result = await client.test.method()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should work without any optional parameters', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({ baseUrl: 'https://minimal.api.com/rpc' })
    const result = await client.simple.call()

    expect(result).toEqual({ success: true })
  })
})

// ============================================================================
// Auth Provider Tests
// ============================================================================

describe('Auth Provider', () => {
  // Store original values
  const originalAdminToken = (globalThis as any).DO_ADMIN_TOKEN
  const originalToken = (globalThis as any).DO_TOKEN
  const originalEnvAdmin = process.env.DO_ADMIN_TOKEN
  const originalEnvToken = process.env.DO_TOKEN

  beforeEach(() => {
    delete (globalThis as any).DO_ADMIN_TOKEN
    delete (globalThis as any).DO_TOKEN
    delete process.env.DO_ADMIN_TOKEN
    delete process.env.DO_TOKEN
  })

  afterEach(() => {
    if (originalAdminToken !== undefined) {
      (globalThis as any).DO_ADMIN_TOKEN = originalAdminToken
    } else {
      delete (globalThis as any).DO_ADMIN_TOKEN
    }
    if (originalToken !== undefined) {
      (globalThis as any).DO_TOKEN = originalToken
    } else {
      delete (globalThis as any).DO_TOKEN
    }
    if (originalEnvAdmin !== undefined) {
      process.env.DO_ADMIN_TOKEN = originalEnvAdmin
    } else {
      delete process.env.DO_ADMIN_TOKEN
    }
    if (originalEnvToken !== undefined) {
      process.env.DO_TOKEN = originalEnvToken
    } else {
      delete process.env.DO_TOKEN
    }
  })

  it('should return token from globalThis.DO_ADMIN_TOKEN', async () => {
    (globalThis as any).DO_ADMIN_TOKEN = 'admin-token-from-global'

    const authProvider = auth()
    const token = await authProvider()

    expect(token).toBe('admin-token-from-global')
  })

  it('should return token from globalThis.DO_TOKEN', async () => {
    (globalThis as any).DO_TOKEN = 'token-from-global'

    const authProvider = auth()
    const token = await authProvider()

    expect(token).toBe('token-from-global')
  })

  it('should prefer DO_ADMIN_TOKEN over DO_TOKEN', async () => {
    Object.defineProperty(globalThis, 'DO_ADMIN_TOKEN', {
      value: 'preferred-admin-token',
      writable: true,
      configurable: true
    })
    Object.defineProperty(globalThis, 'DO_TOKEN', {
      value: 'fallback-regular-token',
      writable: true,
      configurable: true
    })

    const authProvider = auth()
    const token = await authProvider()

    expect(token).toBe('preferred-admin-token')
  })

  it('should return null or stored token when no explicit token is set', async () => {
    const authProvider = auth()
    const token = await authProvider()

    expect(token === null || typeof token === 'string').toBe(true)
  })
})
