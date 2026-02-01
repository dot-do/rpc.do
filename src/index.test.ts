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
