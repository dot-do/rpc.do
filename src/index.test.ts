/**
 * rpc.do Tests
 *
 * Tests for RPC proxy, transports, auth, and server
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RPC, http, ws, binding, composite } from './index'
import { createRpcHandler, bearerAuth, noAuth } from './server'
import { auth } from './auth'
import type { Transport } from './index'

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

describe('HTTP Transport', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should make POST requests with correct body', async () => {
    let capturedRequest: { url: string; options: RequestInit } | null = null

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      capturedRequest = { url: url.toString(), options: options! }
      return new Response(JSON.stringify({ result: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as any

    const transport = http('https://rpc.example.com')
    await transport.call('ai.generate', [{ prompt: 'test' }])

    expect(capturedRequest).not.toBeNull()
    expect(capturedRequest!.url).toBe('https://rpc.example.com')
    expect(capturedRequest!.options.method).toBe('POST')

    const body = JSON.parse(capturedRequest!.options.body as string)
    expect(body.method).toBe('do')
    expect(body.path).toBe('ai.generate')
    expect(body.args).toEqual([{ prompt: 'test' }])
  })

  it('should include Authorization header when auth provided', async () => {
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      capturedHeaders = new Headers(options?.headers)
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    const transport = http('https://rpc.example.com', 'test-token')
    await transport.call('test', [])

    expect(capturedHeaders!.get('Authorization')).toBe('Bearer test-token')
  })

  it('should support async auth provider', async () => {
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      capturedHeaders = new Headers(options?.headers)
      return new Response(JSON.stringify({}), { status: 200 })
    }) as any

    const asyncAuth = async () => 'async-token'
    const transport = http('https://rpc.example.com', asyncAuth)
    await transport.call('test', [])

    expect(capturedHeaders!.get('Authorization')).toBe('Bearer async-token')
  })

  it('should throw on non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Internal Server Error', { status: 500 })
    }) as any

    const transport = http('https://rpc.example.com')

    await expect(transport.call('test', [])).rejects.toThrow('RPC error 500')
  })
})

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
})

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

describe('Auth Provider', () => {
  // Store original values
  const originalAdminToken = (globalThis as any).DO_ADMIN_TOKEN
  const originalToken = (globalThis as any).DO_TOKEN

  beforeEach(() => {
    // Clear any existing tokens before each test
    delete (globalThis as any).DO_ADMIN_TOKEN
    delete (globalThis as any).DO_TOKEN
  })

  afterEach(() => {
    // Restore original values
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

  it('should return null when no token is available', async () => {
    // Ensure no tokens are set
    delete (globalThis as any).DO_ADMIN_TOKEN
    delete (globalThis as any).DO_TOKEN

    // Temporarily clear process.env tokens
    const originalEnvAdmin = process.env.DO_ADMIN_TOKEN
    const originalEnvToken = process.env.DO_TOKEN
    delete process.env.DO_ADMIN_TOKEN
    delete process.env.DO_TOKEN

    try {
      const authProvider = auth()
      const token = await authProvider()

      // Will return null since oauth.do import will fail
      expect(token).toBeNull()
    } finally {
      // Restore process.env
      if (originalEnvAdmin) process.env.DO_ADMIN_TOKEN = originalEnvAdmin
      if (originalEnvToken) process.env.DO_TOKEN = originalEnvToken
    }
  })
})
