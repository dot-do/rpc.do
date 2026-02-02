/**
 * Transport Factory Pattern Tests
 *
 * Tests for the unified Transports factory API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Transports, http, capnweb, binding, composite } from './transports'
import type { Transport } from './types'
import { RPCError } from './errors'
import { RpcTarget, newHttpBatchRpcResponse } from '@dotdo/capnweb/server'

// ============================================================================
// Test Target for HTTP Transport
// ============================================================================

class TestTarget extends RpcTarget {
  greet(name: string) {
    return { message: `Hello, ${name}!` }
  }
}

// ============================================================================
// Transports.create() Tests
// ============================================================================

describe('Transports.create()', () => {
  let testTarget: TestTarget
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testTarget = new TestTarget()
    originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('https://factory-test.example.com')) {
        const request = input instanceof Request
          ? new Request(input, init)
          : new Request(url, init)
        return newHttpBatchRpcResponse(request, testTarget)
      }
      return originalFetch(input, init)
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('HTTP transport config', () => {
    it('should create an HTTP transport with minimal config', async () => {
      const transport = Transports.create({
        type: 'http',
        url: 'https://factory-test.example.com/rpc',
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')

      const result = await transport.call('greet', ['World'])
      expect(result).toEqual({ message: 'Hello, World!' })
    })

    it('should create an HTTP transport with auth option', () => {
      const transport = Transports.create({
        type: 'http',
        url: 'https://factory-test.example.com/rpc',
        auth: 'test-token',
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })

    it('should create an HTTP transport with timeout option', () => {
      const transport = Transports.create({
        type: 'http',
        url: 'https://factory-test.example.com/rpc',
        timeout: 5000,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })

    it('should create an HTTP transport with all options', () => {
      const transport = Transports.create({
        type: 'http',
        url: 'https://factory-test.example.com/rpc',
        auth: () => 'dynamic-token',
        timeout: 10000,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })
  })

  describe('Capnweb transport config', () => {
    it('should create a capnweb transport with minimal config', () => {
      const transport = Transports.create({
        type: 'capnweb',
        url: 'wss://factory-test.example.com/rpc',
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })

    it('should create a capnweb transport with websocket: false (HTTP batch)', () => {
      const transport = Transports.create({
        type: 'capnweb',
        url: 'https://factory-test.example.com/rpc',
        websocket: false,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })

    it('should create a capnweb transport with reconnect options', () => {
      const transport = Transports.create({
        type: 'capnweb',
        url: 'wss://factory-test.example.com/rpc',
        reconnect: true,
        reconnectOptions: {
          maxReconnectAttempts: 5,
          reconnectBackoff: 1000,
        },
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })

    it('should create a capnweb transport with auth', () => {
      const transport = Transports.create({
        type: 'capnweb',
        url: 'wss://factory-test.example.com/rpc',
        auth: 'ws-token',
        reconnect: true,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')
    })
  })

  describe('Binding transport config', () => {
    it('should create a binding transport', async () => {
      const mockBinding = {
        users: {
          get: vi.fn(async (id: string) => ({ id, name: 'Test User' })),
        },
      }

      const transport = Transports.create({
        type: 'binding',
        binding: mockBinding,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')

      const result = await transport.call('users.get', ['123'])
      expect(result).toEqual({ id: '123', name: 'Test User' })
      expect(mockBinding.users.get).toHaveBeenCalledWith('123')
    })
  })

  describe('Composite transport config', () => {
    it('should create a composite transport', async () => {
      const transport1: Transport = {
        call: vi.fn(async () => { throw new Error('Transport 1 failed') }),
      }

      const transport2: Transport = {
        call: vi.fn(async () => ({ from: 'transport2' })),
      }

      const transport = Transports.create({
        type: 'composite',
        transports: [transport1, transport2],
      })

      expect(transport).toBeDefined()
      expect(typeof transport.call).toBe('function')

      const result = await transport.call('test', [])
      expect(result).toEqual({ from: 'transport2' })
      expect(transport1.call).toHaveBeenCalled()
      expect(transport2.call).toHaveBeenCalled()
    })

    it('should close all transports in composite', () => {
      let closed1 = false
      let closed2 = false

      const transport1: Transport = {
        call: async () => ({}),
        close: () => { closed1 = true },
      }

      const transport2: Transport = {
        call: async () => ({}),
        close: () => { closed2 = true },
      }

      const transport = Transports.create({
        type: 'composite',
        transports: [transport1, transport2],
      })

      transport.close?.()

      expect(closed1).toBe(true)
      expect(closed2).toBe(true)
    })
  })
})

// ============================================================================
// Transports Shorthand Methods Tests
// ============================================================================

describe('Transports shorthand methods', () => {
  let testTarget: TestTarget
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testTarget = new TestTarget()
    originalFetch = globalThis.fetch

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.startsWith('https://shorthand-test.example.com')) {
        const request = input instanceof Request
          ? new Request(input, init)
          : new Request(url, init)
        return newHttpBatchRpcResponse(request, testTarget)
      }
      return originalFetch(input, init)
    }
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('Transports.http() should be equivalent to http()', async () => {
    const factoryTransport = Transports.http('https://shorthand-test.example.com/rpc', { timeout: 5000 })
    const directTransport = http('https://shorthand-test.example.com/rpc', { timeout: 5000 })

    expect(typeof factoryTransport.call).toBe('function')
    expect(typeof directTransport.call).toBe('function')

    // Both should work the same
    const result1 = await factoryTransport.call('greet', ['Factory'])
    const result2 = await directTransport.call('greet', ['Direct'])

    expect(result1).toEqual({ message: 'Hello, Factory!' })
    expect(result2).toEqual({ message: 'Hello, Direct!' })
  })

  it('Transports.capnweb() should be equivalent to capnweb()', () => {
    const factoryTransport = Transports.capnweb('wss://example.com/rpc', { reconnect: true })
    const directTransport = capnweb('wss://example.com/rpc', { reconnect: true })

    expect(typeof factoryTransport.call).toBe('function')
    expect(typeof directTransport.call).toBe('function')
  })

  it('Transports.binding() should be equivalent to binding()', async () => {
    const mockBinding = {
      test: vi.fn(async () => 'result'),
    }

    const factoryTransport = Transports.binding(mockBinding)
    const directTransport = binding(mockBinding)

    const result1 = await factoryTransport.call('test', [])
    const result2 = await directTransport.call('test', [])

    expect(result1).toBe('result')
    expect(result2).toBe('result')
  })

  it('Transports.composite() should be equivalent to composite()', async () => {
    const t1: Transport = {
      call: async () => { throw new Error('fail') },
    }
    const t2: Transport = {
      call: async () => 'success',
    }

    const factoryTransport = Transports.composite(t1, t2)
    const directTransport = composite(t1, t2)

    // Both have same interface
    expect(typeof factoryTransport.call).toBe('function')
    expect(typeof directTransport.call).toBe('function')
    expect(typeof factoryTransport.close).toBe('function')
    expect(typeof directTransport.close).toBe('function')
  })
})

// ============================================================================
// Transports.isTransport() Tests
// ============================================================================

describe('Transports.isTransport()', () => {
  it('should return true for valid transport objects', () => {
    const validTransport: Transport = {
      call: async () => ({}),
    }

    expect(Transports.isTransport(validTransport)).toBe(true)
  })

  it('should return true for transport with close method', () => {
    const transportWithClose: Transport = {
      call: async () => ({}),
      close: () => {},
    }

    expect(Transports.isTransport(transportWithClose)).toBe(true)
  })

  it('should return false for null', () => {
    expect(Transports.isTransport(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(Transports.isTransport(undefined)).toBe(false)
  })

  it('should return false for primitives', () => {
    expect(Transports.isTransport('string')).toBe(false)
    expect(Transports.isTransport(123)).toBe(false)
    expect(Transports.isTransport(true)).toBe(false)
  })

  it('should return false for objects without call method', () => {
    expect(Transports.isTransport({})).toBe(false)
    expect(Transports.isTransport({ close: () => {} })).toBe(false)
  })

  it('should return false for objects with non-function call', () => {
    expect(Transports.isTransport({ call: 'not a function' })).toBe(false)
  })

  it('should work as type guard', () => {
    const unknown: unknown = { call: async () => ({}) }

    if (Transports.isTransport(unknown)) {
      // TypeScript should know this is a Transport
      expect(typeof unknown.call).toBe('function')
    } else {
      expect.fail('Should have been a transport')
    }
  })
})

// ============================================================================
// Backward Compatibility Tests
// ============================================================================

describe('Backward compatibility', () => {
  it('existing http() function should still work', () => {
    const transport = http('https://example.com/rpc')
    expect(typeof transport.call).toBe('function')
  })

  it('existing capnweb() function should still work', () => {
    const transport = capnweb('wss://example.com/rpc')
    expect(typeof transport.call).toBe('function')
  })

  it('existing binding() function should still work', () => {
    const mockBinding = { test: async () => 'ok' }
    const transport = binding(mockBinding)
    expect(typeof transport.call).toBe('function')
  })

  it('existing composite() function should still work', () => {
    const t1: Transport = { call: async () => ({}) }
    const t2: Transport = { call: async () => ({}) }
    const transport = composite(t1, t2)
    expect(typeof transport.call).toBe('function')
  })
})
