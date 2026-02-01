/**
 * Middleware Tests
 *
 * Tests for RPC client middleware functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RPC, type Transport, type RPCClientMiddleware } from '../index'
import { loggingMiddleware } from './logging'
import { timingMiddleware } from './timing'

// ============================================================================
// Basic Middleware Tests
// ============================================================================

describe('Middleware', () => {
  it('should call onRequest before the RPC call', async () => {
    const onRequest = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => ({ method, args }),
    }

    const middleware: RPCClientMiddleware = { onRequest }

    const rpc = RPC(mockTransport, { middleware: [middleware] })
    await rpc.users.list({ active: true })

    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest).toHaveBeenCalledWith('users.list', [{ active: true }])
  })

  it('should call onResponse after successful RPC call', async () => {
    const onResponse = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ users: ['john', 'jane'] }),
    }

    const middleware: RPCClientMiddleware = { onResponse }

    const rpc = RPC(mockTransport, { middleware: [middleware] })
    await rpc.users.list()

    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledWith('users.list', { users: ['john', 'jane'] })
  })

  it('should call onError when RPC call fails', async () => {
    const onError = vi.fn()

    const testError = new Error('Connection failed')
    const mockTransport: Transport = {
      call: async () => {
        throw testError
      },
    }

    const middleware: RPCClientMiddleware = { onError }

    const rpc = RPC(mockTransport, { middleware: [middleware] })

    await expect(rpc.users.list()).rejects.toThrow('Connection failed')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('users.list', testError)
  })

  it('should execute multiple middleware in order', async () => {
    const order: string[] = []

    const middleware1: RPCClientMiddleware = {
      onRequest: () => {
        order.push('mw1-request')
      },
      onResponse: () => {
        order.push('mw1-response')
      },
    }

    const middleware2: RPCClientMiddleware = {
      onRequest: () => {
        order.push('mw2-request')
      },
      onResponse: () => {
        order.push('mw2-response')
      },
    }

    const mockTransport: Transport = {
      call: async () => ({ ok: true }),
    }

    const rpc = RPC(mockTransport, { middleware: [middleware1, middleware2] })
    await rpc.test()

    expect(order).toEqual(['mw1-request', 'mw2-request', 'mw1-response', 'mw2-response'])
  })

  it('should support async middleware hooks', async () => {
    const events: string[] = []

    const asyncMiddleware: RPCClientMiddleware = {
      onRequest: async () => {
        await new Promise((r) => setTimeout(r, 10))
        events.push('async-request')
      },
      onResponse: async () => {
        await new Promise((r) => setTimeout(r, 10))
        events.push('async-response')
      },
    }

    const mockTransport: Transport = {
      call: async () => {
        events.push('call')
        return { ok: true }
      },
    }

    const rpc = RPC(mockTransport, { middleware: [asyncMiddleware] })
    await rpc.test()

    expect(events).toEqual(['async-request', 'call', 'async-response'])
  })

  it('should work with no middleware', async () => {
    const mockTransport: Transport = {
      call: async () => ({ success: true }),
    }

    const rpc = RPC(mockTransport)
    const result = await rpc.test()

    expect(result).toEqual({ success: true })
  })

  it('should work with empty middleware array', async () => {
    const mockTransport: Transport = {
      call: async () => ({ success: true }),
    }

    const rpc = RPC(mockTransport, { middleware: [] })
    const result = await rpc.test()

    expect(result).toEqual({ success: true })
  })

  it('should work with deeply nested method calls', async () => {
    const onRequest = vi.fn()

    const mockTransport: Transport = {
      call: async (method) => ({ method }),
    }

    const rpc = RPC(mockTransport, { middleware: [{ onRequest }] })
    await rpc.api.v1.users.list()

    expect(onRequest).toHaveBeenCalledWith('api.v1.users.list', [])
  })
})

// ============================================================================
// Logging Middleware Tests
// ============================================================================

describe('loggingMiddleware', () => {
  it('should log request and response', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ id: '123' }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware({ log })],
    })

    await rpc.users.get('123')

    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('[RPC] Calling users.get with args:', ['123'])
    expect(log).toHaveBeenCalledWith('[RPC] users.get returned:', { id: '123' })
  })

  it('should log errors', async () => {
    const log = vi.fn()
    const error = vi.fn()

    const testError = new Error('Not found')
    const mockTransport: Transport = {
      call: async () => {
        throw testError
      },
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware({ log, error })],
    })

    await expect(rpc.users.get('999')).rejects.toThrow('Not found')

    expect(log).toHaveBeenCalledTimes(1) // Only request logged
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('[RPC] users.get failed:', testError)
  })

  it('should support custom prefix', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({}),
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware({ log, prefix: '[API]' })],
    })

    await rpc.test()

    expect(log).toHaveBeenCalledWith('[API] Calling test with args:', [])
  })

  it('should support disabling args logging', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({}),
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware({ log, logArgs: false })],
    })

    await rpc.users.create({ name: 'secret', password: 'secret123' })

    expect(log).toHaveBeenCalledWith('[RPC] Calling users.create')
  })

  it('should support disabling result logging', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ token: 'secret-token' }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware({ log, logResult: false })],
    })

    await rpc.auth.login()

    expect(log).toHaveBeenNthCalledWith(2, '[RPC] auth.login completed')
  })
})

// ============================================================================
// Timing Middleware Tests
// ============================================================================

describe('timingMiddleware', () => {
  it('should log timing for calls', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => {
        await new Promise((r) => setTimeout(r, 10))
        return { ok: true }
      },
    }

    const rpc = RPC(mockTransport, {
      middleware: [timingMiddleware({ log })],
    })

    await rpc.test()

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/\[RPC Timing\] test took \d+\.\d+ms/)
  })

  it('should respect threshold option', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ ok: true }), // Very fast call
    }

    const rpc = RPC(mockTransport, {
      middleware: [timingMiddleware({ log, threshold: 1000 })],
    })

    await rpc.test()

    // Should not log because call is under 1000ms threshold
    expect(log).not.toHaveBeenCalled()
  })

  it('should call onTiming callback', async () => {
    const onTiming = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ ok: true }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [timingMiddleware({ onTiming })],
    })

    await rpc.users.list()

    expect(onTiming).toHaveBeenCalledTimes(1)
    expect(onTiming.mock.calls[0][0]).toBe('users.list')
    expect(typeof onTiming.mock.calls[0][1]).toBe('number')
  })

  it('should track timing for failed calls', async () => {
    const onTiming = vi.fn()
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => {
        throw new Error('Failed')
      },
    }

    const rpc = RPC(mockTransport, {
      middleware: [timingMiddleware({ onTiming, log })],
    })

    await expect(rpc.test()).rejects.toThrow('Failed')

    expect(onTiming).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/\[RPC Timing\] test failed after \d+\.\d+ms/)
  })

  it('should support custom prefix', async () => {
    const log = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ ok: true }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [timingMiddleware({ log, prefix: '[PERF]' })],
    })

    await rpc.test()

    expect(log.mock.calls[0][0]).toMatch(/\[PERF\] test took \d+\.\d+ms/)
  })

  it('should support custom ttl and cleanupInterval options', async () => {
    const log = vi.fn()
    const onTiming = vi.fn()

    const mockTransport: Transport = {
      call: async () => ({ ok: true }),
    }

    // Create middleware with custom TTL options - just verify it works
    const rpc = RPC(mockTransport, {
      middleware: [
        timingMiddleware({
          log,
          onTiming,
          ttl: 1000, // 1 second TTL
          cleanupInterval: 100, // 100ms cleanup interval
        }),
      ],
    })

    await rpc.test()

    expect(onTiming).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('should cleanup stale entries during subsequent requests', async () => {
    const log = vi.fn()
    const onTiming = vi.fn()

    // Create middleware instance directly to test internal cleanup behavior
    const middleware = timingMiddleware({
      log,
      onTiming,
      ttl: 50, // Very short TTL for testing
      cleanupInterval: 0, // Always run cleanup
    })

    // Call onRequest to add an entry
    middleware.onRequest!('test.method', [])

    // Wait for the entry to become stale
    await new Promise((r) => setTimeout(r, 60))

    // Make another request - this should trigger cleanup of the stale entry
    middleware.onRequest!('test.another', [])

    // Now call onResponse for the first method - should not find it
    middleware.onResponse!('test.method', {})

    // The onTiming should not be called for the stale entry
    expect(onTiming).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Combined Middleware Tests
// ============================================================================

describe('Combined Middleware', () => {
  it('should work with multiple middleware types', async () => {
    const logs: string[] = []
    const timings: { method: string; durationMs: number }[] = []

    const mockTransport: Transport = {
      call: async () => ({ ok: true }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [
        loggingMiddleware({
          log: (msg) => logs.push(msg),
          logResult: false,
        }),
        timingMiddleware({
          log: (msg) => logs.push(msg),
          onTiming: (method, durationMs) => timings.push({ method, durationMs }),
        }),
      ],
    })

    await rpc.users.list()

    expect(logs.length).toBe(3) // Request log, completion log, timing log
    expect(timings.length).toBe(1)
    expect(timings[0].method).toBe('users.list')
  })
})
