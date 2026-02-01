/**
 * Tests for rpc.do Testing Utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mockRPC,
  mockTransport,
  TestServer,
  waitFor,
  deferred,
  createSpy,
  type MockTransportExtras,
} from './testing'
import { RPC, type Transport } from './index'
import { RPCError } from './errors'

// ============================================================================
// mockRPC Tests
// ============================================================================

describe('mockRPC', () => {
  it('should create a mock RPC proxy with simple handlers', async () => {
    interface API {
      users: {
        get: (id: string) => { id: string; name: string }
      }
    }

    const mock = mockRPC<API>({
      users: {
        get: (id) => ({ id, name: 'Test User' })
      }
    })

    const result = await mock.users.get('123')
    expect(result).toEqual({ id: '123', name: 'Test User' })
  })

  it('should support async handlers', async () => {
    interface API {
      data: {
        fetch: () => { items: number[] }
      }
    }

    const mock = mockRPC<API>({
      data: {
        fetch: async () => {
          await new Promise(r => setTimeout(r, 10))
          return { items: [1, 2, 3] }
        }
      }
    })

    const result = await mock.data.fetch()
    expect(result).toEqual({ items: [1, 2, 3] })
  })

  it('should support deeply nested handlers', async () => {
    interface API {
      api: {
        v1: {
          users: {
            list: () => { users: string[] }
          }
        }
      }
    }

    const mock = mockRPC<API>({
      api: {
        v1: {
          users: {
            list: () => ({ users: ['alice', 'bob'] })
          }
        }
      }
    })

    const result = await mock.api.v1.users.list()
    expect(result).toEqual({ users: ['alice', 'bob'] })
  })

  it('should throw RPCError for undefined handlers', async () => {
    interface API {
      missing: {
        method: () => void
      }
    }

    const mock = mockRPC<API>({})

    try {
      await mock.missing.method()
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).message).toMatch(/No mock handler defined/)
      expect((error as RPCError).code).toBe('MOCK_NOT_FOUND')
    }
  })

  it('should have close method that resolves', async () => {
    const mock = mockRPC({})
    await expect(mock.close?.()).resolves.toBeUndefined()
  })

  it('should not be thenable (not a promise)', () => {
    const mock = mockRPC({})
    expect((mock as any).then).toBeUndefined()
    expect((mock as any).catch).toBeUndefined()
    expect((mock as any).finally).toBeUndefined()
  })

  it('should handle handlers with multiple arguments', async () => {
    interface API {
      math: {
        add: (a: number, b: number) => number
      }
    }

    const mock = mockRPC<API>({
      math: {
        add: (a, b) => a + b
      }
    })

    const result = await mock.math.add(2, 3)
    expect(result).toBe(5)
  })

  it('should handle handlers that throw errors', async () => {
    interface API {
      fail: {
        always: () => never
      }
    }

    const mock = mockRPC<API>({
      fail: {
        always: () => {
          throw new Error('Intentional failure')
        }
      }
    })

    await expect(mock.fail.always()).rejects.toThrow('Intentional failure')
  })
})

// ============================================================================
// mockTransport Tests
// ============================================================================

describe('mockTransport', () => {
  it('should return static responses', async () => {
    const transport = mockTransport({
      'users.get': { id: '123', name: 'Test User' },
      'users.list': [{ id: '1' }, { id: '2' }],
    })

    expect(await transport.call('users.get', ['123'])).toEqual({
      id: '123',
      name: 'Test User'
    })

    expect(await transport.call('users.list', [])).toEqual([
      { id: '1' },
      { id: '2' }
    ])
  })

  it('should call function responses with arguments', async () => {
    const transport = mockTransport({
      'users.get': (id: string) => ({ id, name: `User ${id}` }),
      'math.add': (a: number, b: number) => a + b,
    })

    expect(await transport.call('users.get', ['456'])).toEqual({
      id: '456',
      name: 'User 456'
    })

    expect(await transport.call('math.add', [2, 3])).toBe(5)
  })

  it('should handle async function responses', async () => {
    const transport = mockTransport({
      'async.method': async (value: string) => {
        await new Promise(r => setTimeout(r, 10))
        return { result: value }
      }
    })

    const result = await transport.call('async.method', ['test'])
    expect(result).toEqual({ result: 'test' })
  })

  it('should throw for string error responses', async () => {
    const transport = mockTransport({
      'users.get': { error: 'User not found' }
    })

    await expect(transport.call('users.get', ['123'])).rejects.toThrow(RPCError)
    await expect(transport.call('users.get', ['123'])).rejects.toThrow('User not found')
  })

  it('should throw for object error responses with code', async () => {
    const transport = mockTransport({
      'auth.login': {
        error: { message: 'Invalid credentials', code: 'AUTH_FAILED', data: { attempts: 3 } }
      }
    })

    try {
      await transport.call('auth.login', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).message).toBe('Invalid credentials')
      expect((error as RPCError).code).toBe('AUTH_FAILED')
      expect((error as RPCError).data).toEqual({ attempts: 3 })
    }
  })

  it('should throw for undefined methods by default', async () => {
    const transport = mockTransport({})

    await expect(transport.call('undefined.method', [])).rejects.toThrow(RPCError)
    await expect(transport.call('undefined.method', [])).rejects.toThrow(/No mock response defined/)
  })

  it('should return undefined for missing methods when throwOnMissing is false', async () => {
    const transport = mockTransport({}, { throwOnMissing: false })

    const result = await transport.call('undefined.method', [])
    expect(result).toBeUndefined()
  })

  it('should track calls with getCalls()', async () => {
    const transport = mockTransport({
      'test.method': 'result'
    }) as Transport & MockTransportExtras

    await transport.call('test.method', [1, 2])
    await transport.call('test.method', [3, 4])

    const calls = transport.getCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].method).toBe('test.method')
    expect(calls[0].args).toEqual([1, 2])
    expect(calls[1].args).toEqual([3, 4])
    expect(typeof calls[0].timestamp).toBe('number')
  })

  it('should filter calls with getCallsFor()', async () => {
    const transport = mockTransport({
      'users.get': 'user',
      'users.list': 'users',
      'posts.get': 'post',
    }) as Transport & MockTransportExtras

    await transport.call('users.get', ['1'])
    await transport.call('posts.get', ['1'])
    await transport.call('users.list', [])

    const userCalls = transport.getCallsFor('users.get')
    expect(userCalls).toHaveLength(1)
    expect(userCalls[0].method).toBe('users.get')
  })

  it('should count calls with getCallCount()', async () => {
    const transport = mockTransport({
      'a': 1,
      'b': 2,
    }) as Transport & MockTransportExtras

    await transport.call('a', [])
    await transport.call('a', [])
    await transport.call('b', [])

    expect(transport.getCallCount()).toBe(3)
    expect(transport.getCallCount('a')).toBe(2)
    expect(transport.getCallCount('b')).toBe(1)
    expect(transport.getCallCount('c')).toBe(0)
  })

  it('should reset call history with reset()', async () => {
    const transport = mockTransport({
      'test': 'result'
    }) as Transport & MockTransportExtras

    await transport.call('test', [])
    await transport.call('test', [])
    expect(transport.getCallCount()).toBe(2)

    transport.reset()
    expect(transport.getCallCount()).toBe(0)
    expect(transport.getCalls()).toEqual([])
  })

  it('should work with RPC factory', async () => {
    const transport = mockTransport({
      'users.get': { id: '123', name: 'Test' }
    })

    const rpc = RPC(transport)
    const result = await rpc.users.get('123')
    expect(result).toEqual({ id: '123', name: 'Test' })
  })

  it('should have close method', () => {
    const transport = mockTransport({})
    expect(transport.close).toBeDefined()
    expect(() => transport.close?.()).not.toThrow()
  })
})

// ============================================================================
// TestServer Tests
// ============================================================================

describe('TestServer', () => {
  let server: TestServer

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
  })

  it('should start and stop server', async () => {
    server = new TestServer((req) => {
      return new Response('OK')
    })

    expect(server.isRunning).toBe(false)

    await server.start()
    expect(server.isRunning).toBe(true)
    expect(server.port).toBeGreaterThan(0)

    await server.stop()
    expect(server.isRunning).toBe(false)
  })

  it('should provide url property', async () => {
    server = new TestServer((req) => new Response('OK'))

    await server.start()
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('should throw when accessing url before start', () => {
    server = new TestServer((req) => new Response('OK'))
    expect(() => server.url).toThrow('Server not started')
  })

  it('should handle GET requests', async () => {
    server = new TestServer((req) => {
      return new Response(JSON.stringify({
        method: req.method,
        url: req.url
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    })

    await server.start()

    const response = await fetch(server.url)
    const data = await response.json()

    expect(data.method).toBe('GET')
    expect(data.url).toBe(server.url + '/')
  })

  it('should handle POST requests with body', async () => {
    server = new TestServer(async (req) => {
      const body = await req.json()
      return Response.json({ echo: body })
    })

    await server.start()

    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    })
    const data = await response.json()

    expect(data.echo).toEqual({ hello: 'world' })
  })

  it('should handle async handlers', async () => {
    server = new TestServer(async (req) => {
      await new Promise(r => setTimeout(r, 10))
      return Response.json({ async: true })
    })

    await server.start()

    const response = await fetch(server.url)
    const data = await response.json()

    expect(data.async).toBe(true)
  })

  it('should handle errors in handler', async () => {
    server = new TestServer((req) => {
      throw new Error('Handler error')
    })

    await server.start()

    const response = await fetch(server.url)
    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data.error).toBe('Handler error')
  })

  it('should preserve response headers', async () => {
    server = new TestServer((req) => {
      return new Response('OK', {
        headers: {
          'X-Custom-Header': 'custom-value',
          'Content-Type': 'text/plain'
        }
      })
    })

    await server.start()

    const response = await fetch(server.url)
    expect(response.headers.get('X-Custom-Header')).toBe('custom-value')
  })

  it('should preserve response status code', async () => {
    server = new TestServer((req) => {
      return new Response('Created', { status: 201 })
    })

    await server.start()

    const response = await fetch(server.url)
    expect(response.status).toBe(201)
  })

  it('should handle request headers', async () => {
    server = new TestServer((req) => {
      const auth = req.headers.get('Authorization')
      return Response.json({ auth })
    })

    await server.start()

    const response = await fetch(server.url, {
      headers: { 'Authorization': 'Bearer token123' }
    })
    const data = await response.json()

    expect(data.auth).toBe('Bearer token123')
  })

  it('should allow specifying port', async () => {
    server = new TestServer((req) => new Response('OK'))

    // Use a high port that's likely available
    const testPort = 49152 + Math.floor(Math.random() * 1000)

    await server.start(testPort)
    expect(server.port).toBe(testPort)
    expect(server.url).toBe(`http://127.0.0.1:${testPort}`)
  })

  it('should handle stop when not started', async () => {
    server = new TestServer((req) => new Response('OK'))

    // Should not throw
    await server.stop()
  })
})

// ============================================================================
// waitFor Tests
// ============================================================================

describe('waitFor', () => {
  it('should resolve when condition becomes true', async () => {
    let flag = false
    setTimeout(() => { flag = true }, 50)

    await waitFor(() => flag, { timeout: 1000 })
    expect(flag).toBe(true)
  })

  it('should support async conditions', async () => {
    let value = 0
    const increment = setInterval(() => { value++ }, 10)

    try {
      await waitFor(async () => value >= 5, { timeout: 1000 })
      expect(value).toBeGreaterThanOrEqual(5)
    } finally {
      clearInterval(increment)
    }
  })

  it('should throw on timeout', async () => {
    await expect(
      waitFor(() => false, { timeout: 100, interval: 10 })
    ).rejects.toThrow('waitFor timeout after 100ms')
  })

  it('should use custom interval', async () => {
    const checkTimes: number[] = []
    const start = Date.now()

    try {
      await waitFor(() => {
        checkTimes.push(Date.now() - start)
        return false
      }, { timeout: 100, interval: 25 })
    } catch {
      // Expected to timeout
    }

    // Should have checked approximately every 25ms
    // Allow some tolerance for timing
    expect(checkTimes.length).toBeLessThanOrEqual(6)
  })
})

// ============================================================================
// deferred Tests
// ============================================================================

describe('deferred', () => {
  it('should create a promise that can be resolved externally', async () => {
    const { promise, resolve } = deferred<string>()

    setTimeout(() => resolve('hello'), 10)

    const result = await promise
    expect(result).toBe('hello')
  })

  it('should create a promise that can be rejected externally', async () => {
    const { promise, reject } = deferred<string>()

    setTimeout(() => reject(new Error('failed')), 10)

    await expect(promise).rejects.toThrow('failed')
  })

  it('should work with mockTransport for async testing', async () => {
    const { promise, resolve } = deferred<{ data: string }>()

    const transport = mockTransport({
      'async.method': () => promise
    })

    const resultPromise = transport.call('async.method', [])

    // Resolve after a delay
    setTimeout(() => resolve({ data: 'async result' }), 10)

    const result = await resultPromise
    expect(result).toEqual({ data: 'async result' })
  })
})

// ============================================================================
// createSpy Tests
// ============================================================================

describe('createSpy', () => {
  it('should track calls and arguments', () => {
    const spy = createSpy((x: number) => x * 2)

    spy(5)
    spy(10)
    spy(15)

    expect(spy.calls).toEqual([[5], [10], [15]])
  })

  it('should track results', () => {
    const spy = createSpy((x: number) => x * 2)

    spy(5)
    spy(10)

    expect(spy.results).toEqual([10, 20])
  })

  it('should work without implementation', () => {
    const spy = createSpy()

    spy('a', 'b')
    spy('c')

    expect(spy.calls).toEqual([['a', 'b'], ['c']])
    expect(spy.results).toEqual([undefined, undefined])
  })

  it('should reset calls and results', () => {
    const spy = createSpy((x: number) => x)

    spy(1)
    spy(2)

    expect(spy.calls).toHaveLength(2)

    spy.reset()

    expect(spy.calls).toHaveLength(0)
    expect(spy.results).toHaveLength(0)
  })

  it('should work with mockRPC handlers', async () => {
    const getSpy = createSpy((id: string) => ({ id, name: 'User' }))

    interface API {
      users: { get: (id: string) => { id: string; name: string } }
    }

    const mock = mockRPC<API>({
      users: { get: getSpy }
    })

    await mock.users.get('123')
    await mock.users.get('456')

    expect(getSpy.calls).toEqual([['123'], ['456']])
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Testing Utilities Integration', () => {
  it('should work together for comprehensive testing', async () => {
    // Create spies for tracking
    const getUserSpy = createSpy((id: string) => ({
      id,
      name: `User ${id}`
    }))

    // Create mock transport with spy
    const transport = mockTransport({
      'users.get': getUserSpy
    }) as Transport & MockTransportExtras

    // Create RPC client
    const rpc = RPC(transport)

    // Make calls
    await rpc.users.get('alice')
    await rpc.users.get('bob')

    // Assert with spy
    expect(getUserSpy.calls).toEqual([['alice'], ['bob']])
    expect(getUserSpy.results).toEqual([
      { id: 'alice', name: 'User alice' },
      { id: 'bob', name: 'User bob' }
    ])

    // Assert with transport tracker
    expect(transport.getCallCount('users.get')).toBe(2)
    expect(transport.getCallsFor('users.get')[0].args).toEqual(['alice'])
  })

  it('should support async flow testing with deferred', async () => {
    const { promise, resolve } = deferred<{ ready: boolean }>()

    const transport = mockTransport({
      'status.check': () => promise
    }) as Transport & MockTransportExtras

    const rpc = RPC(transport)

    // Start the call (won't resolve yet)
    const statusPromise = rpc.status.check()

    // Use waitFor to check the call was made
    await waitFor(() => transport.getCallCount('status.check') > 0)

    // Now resolve it
    resolve({ ready: true })

    const result = await statusPromise
    expect(result).toEqual({ ready: true })
  })
})
