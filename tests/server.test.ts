/**
 * Server Tests
 *
 * Tests for rpc.do/server: createTarget, createHandler
 * Uses real @dotdo/capnweb protocol end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTarget, createHandler, RpcTarget, newHttpBatchRpcResponse } from '../src/server'

// ============================================================================
// Test with plain objects (the main use case)
// ============================================================================

describe('createTarget() - wrapping plain objects', () => {
  let originalFetch: typeof globalThis.fetch
  let currentTarget: RpcTarget

  beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('https://test.example.com/')) {
        const request = input instanceof Request ? input : new Request(url, init)
        return newHttpBatchRpcResponse(request, currentTarget)
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

  it('should wrap a simple object with methods', async () => {
    const sdk = {
      greet(name: string) { return `Hello, ${name}!` },
      add(a: number, b: number) { return a + b },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()
    const transport = http('https://test.example.com/rpc')

    const greeting = await transport.call('greet', ['World'])
    expect(greeting).toBe('Hello, World!')

    transport.close!()
    const transport2 = http('https://test.example.com/rpc')
    const sum = await transport2.call('add', [2, 3])
    expect(sum).toBe(5)
  })

  it('should wrap objects with nested namespaces', async () => {
    const sdk = {
      math: {
        add(a: number, b: number) { return a + b },
        multiply(a: number, b: number) { return a * b },
      },
      strings: {
        upper(s: string) { return s.toUpperCase() },
        lower(s: string) { return s.toLowerCase() },
      },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()

    const transport1 = http('https://test.example.com/rpc')
    const sum = await transport1.call('math.add', [5, 7])
    expect(sum).toBe(12)

    transport1.close!()
    const transport2 = http('https://test.example.com/rpc')
    const product = await transport2.call('math.multiply', [4, 3])
    expect(product).toBe(12)

    transport2.close!()
    const transport3 = http('https://test.example.com/rpc')
    const upper = await transport3.call('strings.upper', ['hello'])
    expect(upper).toBe('HELLO')
  })

  it('should wrap deeply nested namespaces', async () => {
    const sdk = {
      api: {
        v1: {
          users: {
            get(id: string) { return { id, name: 'User ' + id } },
            list() { return [{ id: '1' }, { id: '2' }] },
          },
        },
      },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()

    const transport1 = http('https://test.example.com/rpc')
    const user = await transport1.call('api.v1.users.get', ['123'])
    expect(user).toEqual({ id: '123', name: 'User 123' })

    transport1.close!()
    const transport2 = http('https://test.example.com/rpc')
    const users = await transport2.call('api.v1.users.list', [])
    expect(users).toEqual([{ id: '1' }, { id: '2' }])
  })

  it('should skip private properties (starting with _)', async () => {
    const sdk = {
      publicMethod() { return 'public' },
      _privateMethod() { return 'private' },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()

    const transport1 = http('https://test.example.com/rpc')
    const result = await transport1.call('publicMethod', [])
    expect(result).toBe('public')

    transport1.close!()
    const transport2 = http('https://test.example.com/rpc')
    await expect(transport2.call('_privateMethod', [])).rejects.toThrow()
  })

  it('should handle async methods', async () => {
    const sdk = {
      async fetchData(id: string) {
        await new Promise(r => setTimeout(r, 10))
        return { id, data: 'fetched' }
      },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()
    const transport = http('https://test.example.com/rpc')

    const result = await transport.call('fetchData', ['abc'])
    expect(result).toEqual({ id: 'abc', data: 'fetched' })
  })

  it('should preserve this binding in methods', async () => {
    const sdk = {
      value: 42,
      getValue() { return this.value },
      setValue(v: number) { this.value = v; return this.value },
    }

    currentTarget = createTarget(sdk)
    const http = await getHttpTransport()

    const transport1 = http('https://test.example.com/rpc')
    const v1 = await transport1.call('getValue', [])
    expect(v1).toBe(42)

    transport1.close!()
    const transport2 = http('https://test.example.com/rpc')
    const v2 = await transport2.call('setValue', [100])
    expect(v2).toBe(100)

    transport2.close!()
    const transport3 = http('https://test.example.com/rpc')
    const v3 = await transport3.call('getValue', [])
    expect(v3).toBe(100)
  })
})

// ============================================================================
// createHandler tests
// ============================================================================

describe('createHandler()', () => {
  it('should create a fetch handler from an RpcTarget', async () => {
    const sdk = {
      ping() { return 'pong' },
    }

    const target = createTarget(sdk)
    const handler = createHandler(target)

    // Simulate a capnweb HTTP batch request
    const { newHttpBatchRpcSession } = await import('@dotdo/capnweb')

    // We can't easily test the handler directly without a full capnweb client,
    // but we can verify it returns a function
    expect(typeof handler).toBe('function')
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('createTarget() - edge cases', () => {
  it('should handle empty object', () => {
    const target = createTarget({})
    expect(target).toBeInstanceOf(RpcTarget)
  })

  it('should handle object with no methods (only data)', () => {
    const target = createTarget({ data: 'value', count: 42 })
    expect(target).toBeInstanceOf(RpcTarget)
  })

  it('should return RpcTarget instance', () => {
    const target = createTarget({ test() { return 1 } })
    expect(target).toBeInstanceOf(RpcTarget)
  })

  it('should handle circular references without infinite loop', () => {
    const sdk: any = { name: 'test' }
    sdk.self = sdk
    sdk.method = () => 'ok'

    // Should not hang or throw
    const target = createTarget(sdk)
    expect(target).toBeInstanceOf(RpcTarget)
  })
})
