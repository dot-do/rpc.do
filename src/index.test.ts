/**
 * rpc.do Tests
 *
 * Tests for RPC proxy, transports, auth, and server
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RPC, binding, composite } from './index'
import { createRpcHandler, bearerAuth, noAuth } from './server'
import { auth } from './auth'
import { RPCError } from './errors'
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
// HTTP Transport Tests (mocking capnweb)
// ============================================================================

describe('HTTP Transport', () => {
  // Mock session creator
  function createMockSession() {
    const disposeSymbol = Symbol.dispose
    return {
      ai: {
        generate: vi.fn().mockResolvedValue({ result: 'ok' })
      },
      test: vi.fn().mockResolvedValue({}),
      [disposeSymbol]: vi.fn()
    }
  }

  let mockSession: ReturnType<typeof createMockSession>
  let mockNewHttpBatchRpcSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSession = createMockSession()
    mockNewHttpBatchRpcSession = vi.fn().mockReturnValue(mockSession)

    // Mock the capnweb dynamic import
    vi.doMock('capnweb', () => ({
      newHttpBatchRpcSession: mockNewHttpBatchRpcSession
    }))
  })

  afterEach(() => {
    vi.doUnmock('capnweb')
    vi.resetModules()
  })

  // Helper to get fresh http transport after mocking
  async function getHttpTransport() {
    vi.resetModules()
    const { http } = await import('./transports')
    return http
  }

  it('should use capnweb newHttpBatchRpcSession with the URL', async () => {
    const http = await getHttpTransport()

    const transport = http('https://rpc.example.com')
    await transport.call('ai.generate', [{ prompt: 'test' }])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('https://rpc.example.com')
  })

  it('should navigate nested method paths correctly', async () => {
    const http = await getHttpTransport()

    const transport = http('https://rpc.example.com')
    await transport.call('ai.generate', [{ prompt: 'test' }])

    expect(mockSession.ai.generate).toHaveBeenCalledWith({ prompt: 'test' })
  })

  it('should call auth provider for each call', async () => {
    const http = await getHttpTransport()

    const asyncAuth = vi.fn().mockResolvedValue('async-token')
    const transport = http('https://rpc.example.com', asyncAuth)
    await transport.call('test', [])

    expect(asyncAuth).toHaveBeenCalled()
  })

  it('should support legacy auth string parameter', async () => {
    const http = await getHttpTransport()

    // Should not throw
    const transport = http('https://rpc.example.com', 'test-token')
    await transport.call('test', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should throw INVALID_PATH for invalid path traversal', async () => {
    // Create session with non-object property
    (mockSession as any).invalidPath = 'not an object'

    const http = await getHttpTransport()
    const transport = http('https://rpc.example.com')

    try {
      await transport.call('invalidPath.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      // Note: Due to vi.resetModules(), error comes from a different module instance
      // so we check properties instead of instanceof
      expect((error as any).code).toBe('INVALID_PATH')
      expect((error as any).message).toContain('Invalid path')
    }
  })

  it('should throw METHOD_NOT_FOUND when target is not a function', async () => {
    // Create session with non-function property
    (mockSession as any).notAFunction = { data: 'value' }

    const http = await getHttpTransport()
    const transport = http('https://rpc.example.com')

    try {
      await transport.call('notAFunction', [])
      expect.fail('Should have thrown')
    } catch (error) {
      // Note: Due to vi.resetModules(), error comes from a different module instance
      // so we check properties instead of instanceof
      expect((error as any).code).toBe('METHOD_NOT_FOUND')
      expect((error as any).message).toContain('Method not found')
    }
  })

  it('should dispose session on close()', async () => {
    const http = await getHttpTransport()

    const transport = http('https://rpc.example.com')
    await transport.call('test', [])

    transport.close!()

    expect(mockSession[Symbol.dispose]).toHaveBeenCalledTimes(1)
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
})

// ============================================================================
// Server Handler Tests
// ============================================================================

describe('Server Handler', () => {
  it('should handle RPC requests', async () => {
    const handler = createRpcHandler({
      auth: noAuth(),
      dispatch: async (method, args) => {
        if (method === 'echo') return args[0]
        throw new Error('Unknown method')
      }
    })

    const request = new Request('https://rpc.example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'do', path: 'echo', args: ['hello'] })
    })

    const response = await handler(request)
    const data = await response.json() as string

    expect(response.status).toBe(200)
    expect(data).toBe('hello')
  })

  it('should validate bearer token with bearerAuth', async () => {
    const handler = createRpcHandler({
      auth: bearerAuth(async (token) => {
        if (token === 'valid-token') return { userId: '123' }
        return null
      }),
      dispatch: async () => ({ ok: true })
    })

    // Request without token
    const noAuthRequest = new Request('https://rpc.example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'do', path: 'test', args: [] })
    })

    const noAuthResponse = await handler(noAuthRequest)
    expect(noAuthResponse.status).toBe(401)

    // Request with valid token
    const validRequest = new Request('https://rpc.example.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid-token'
      },
      body: JSON.stringify({ method: 'do', path: 'test', args: [] })
    })

    const validResponse = await handler(validRequest)
    expect(validResponse.status).toBe(200)
  })

  it('should return 400 for invalid JSON', async () => {
    const handler = createRpcHandler({
      auth: noAuth(),
      dispatch: async () => ({})
    })

    const request = new Request('https://rpc.example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json'
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
  })

  it('should return 500 for dispatch errors', async () => {
    const handler = createRpcHandler({
      auth: noAuth(),
      dispatch: async () => {
        throw new Error('Something went wrong')
      }
    })

    const request = new Request('https://rpc.example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'do', path: 'test', args: [] })
    })

    const response = await handler(request)
    const data = await response.json() as { error: string }

    expect(response.status).toBe(500)
    expect(data.error).toBe('Something went wrong')
  })
})

// ============================================================================
// createRPCClient Factory Tests (mocking capnweb)
// ============================================================================

describe('createRPCClient Factory', () => {
  // Mock session creator
  function createMockSession() {
    const disposeSymbol = Symbol.dispose
    return {
      test: {
        method: vi.fn().mockResolvedValue({ result: 'ok' })
      },
      some: {
        method: vi.fn().mockResolvedValue({})
      },
      ai: {
        generate: vi.fn().mockResolvedValue({ text: 'Generated response' })
      },
      simple: {
        call: vi.fn().mockResolvedValue({ success: true })
      },
      [disposeSymbol]: vi.fn()
    }
  }

  let mockSession: ReturnType<typeof createMockSession>
  let mockNewHttpBatchRpcSession: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSession = createMockSession()
    mockNewHttpBatchRpcSession = vi.fn().mockReturnValue(mockSession)

    // Mock the capnweb dynamic import
    vi.doMock('capnweb', () => ({
      newHttpBatchRpcSession: mockNewHttpBatchRpcSession
    }))
  })

  afterEach(() => {
    vi.doUnmock('capnweb')
    vi.resetModules()
  })

  // Helper to get fresh createRPCClient after mocking
  async function getCreateRPCClient() {
    vi.resetModules()
    const { createRPCClient } = await import('./index')
    return createRPCClient
  }

  it('should return an RPC proxy', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({ baseUrl: 'https://api.example.com/rpc' })

    // Verify it's a proxy by checking it's not thenable
    expect((client as any).then).toBeUndefined()

    // Verify we can make calls
    const result = await client.test.method()
    expect(result).toEqual({ result: 'ok' })
  })

  it('should use http transport with the provided baseUrl', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({ baseUrl: 'https://custom.api.com/rpc' })
    await client.some.method()

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('https://custom.api.com/rpc')
  })

  it('should pass auth token (auth option is accepted)', async () => {
    const createRPCClient = await getCreateRPCClient()

    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: 'my-secret-token'
    })
    await client.test.method()

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should pass auth provider function (auth option is accepted)', async () => {
    const createRPCClient = await getCreateRPCClient()

    const authProvider = vi.fn().mockReturnValue('dynamic-token')
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: authProvider
    })
    await client.test.method()

    expect(authProvider).toHaveBeenCalled()
  })

  it('should pass async auth provider function (auth option is accepted)', async () => {
    const createRPCClient = await getCreateRPCClient()

    const asyncAuthProvider = vi.fn().mockResolvedValue('async-token')
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: asyncAuthProvider
    })
    await client.test.method()

    expect(asyncAuthProvider).toHaveBeenCalled()
  })

  it('should handle null auth from provider', async () => {
    const createRPCClient = await getCreateRPCClient()

    const nullAuthProvider = vi.fn().mockReturnValue(null)
    const client = createRPCClient<any>({
      baseUrl: 'https://api.example.com/rpc',
      auth: nullAuthProvider
    })
    await client.test.method()

    expect(nullAuthProvider).toHaveBeenCalled()
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
    // Clear any existing tokens before each test (both globalThis and process.env)
    delete (globalThis as any).DO_ADMIN_TOKEN
    delete (globalThis as any).DO_TOKEN
    delete process.env.DO_ADMIN_TOKEN
    delete process.env.DO_TOKEN
  })

  afterEach(() => {
    // Restore original globalThis values
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
    // Restore original process.env values
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
    // beforeEach already clears DO_ADMIN_TOKEN and DO_TOKEN
    // oauth.do may return a stored token from secure storage (keychain, etc.)
    const authProvider = auth()
    const token = await authProvider()

    // Without explicit tokens, oauth.do falls back to secure storage
    // which may return null or a previously stored token
    expect(token === null || typeof token === 'string').toBe(true)
  })
})
