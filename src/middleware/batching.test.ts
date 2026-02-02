/**
 * Batching Middleware Tests
 *
 * Tests for request batching transport wrapper functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  withBatching,
  withDebouncedBatching,
  type BatchedRequest,
  type BatchedResponse,
} from './batching'
import type { Transport } from '../types'

// ============================================================================
// withBatching Tests
// ============================================================================

describe('withBatching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should batch multiple concurrent requests', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy(method, args)
        const requests = args[0] as BatchedRequest[]
        // Return responses for each request
        return requests.map((req) => ({
          id: req.id,
          result: { method: req.method, args: req.args },
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    // Make multiple calls concurrently
    const promise1 = batchedTransport.call('users.list', [])
    const promise2 = batchedTransport.call('posts.recent', [])
    const promise3 = batchedTransport.call('comments.count', [])

    // Advance timer to trigger batch flush
    await vi.advanceTimersByTimeAsync(15)

    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

    // Should have called transport only once with a batch
    expect(callSpy).toHaveBeenCalledTimes(1)
    expect(callSpy).toHaveBeenCalledWith('__batch', [
      expect.arrayContaining([
        expect.objectContaining({ method: 'users.list' }),
        expect.objectContaining({ method: 'posts.recent' }),
        expect.objectContaining({ method: 'comments.count' }),
      ]),
    ])

    // Results should be correctly routed
    expect(result1).toEqual({ method: 'users.list', args: [] })
    expect(result2).toEqual({ method: 'posts.recent', args: [] })
    expect(result3).toEqual({ method: 'comments.count', args: [] })
  })

  it('should flush immediately when maxBatchSize is reached', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy(method, args)
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          result: `result-${req.id}`,
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, {
      windowMs: 1000, // Long window
      maxBatchSize: 3, // Small batch size
    })

    // Make requests up to batch size
    const promises = [
      batchedTransport.call('method1', []),
      batchedTransport.call('method2', []),
      batchedTransport.call('method3', []),
    ]

    // Should flush immediately without waiting for timer
    // Need to let promises resolve
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(promises)

    expect(callSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle transport errors by rejecting all pending requests', async () => {
    const transportError = new Error('Transport failed')

    const mockTransport: Transport = {
      call: async () => {
        throw transportError
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    const promise1 = batchedTransport.call('method1', [])
    const promise2 = batchedTransport.call('method2', [])

    // Attach catch handlers immediately to prevent unhandled rejection warnings
    const catchPromise1 = promise1.catch((e) => e)
    const catchPromise2 = promise2.catch((e) => e)

    await vi.advanceTimersByTimeAsync(15)

    const error1 = await catchPromise1
    const error2 = await catchPromise2

    expect(error1).toBeInstanceOf(Error)
    expect((error1 as Error).message).toBe('Transport failed')
    expect(error2).toBeInstanceOf(Error)
    expect((error2 as Error).message).toBe('Transport failed')
  })

  it('should handle individual request errors in batch response', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => {
          if (req.method === 'error.method') {
            return {
              id: req.id,
              error: { message: 'Method failed', code: 'METHOD_ERROR' },
            }
          }
          return { id: req.id, result: 'success' }
        })
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    const promise1 = batchedTransport.call('success.method', [])
    const promise2 = batchedTransport.call('error.method', [])

    // Attach catch handler to prevent unhandled rejection warning
    const catchPromise2 = promise2.catch((e) => e)

    await vi.advanceTimersByTimeAsync(15)

    const result1 = await promise1
    expect(result1).toBe('success')

    const error2 = await catchPromise2
    expect(error2).toBeInstanceOf(Error)
    expect((error2 as Error).message).toBe('Method failed')
  })

  it('should reject if no response received for request', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        // Return only partial responses (missing some)
        return requests
          .filter((req) => req.method !== 'missing.method')
          .map((req) => ({
            id: req.id,
            result: 'success',
          }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    const promise1 = batchedTransport.call('found.method', [])
    const promise2 = batchedTransport.call('missing.method', [])

    // Attach catch handler to prevent unhandled rejection warning
    const catchPromise2 = promise2.catch((e) => e)

    await vi.advanceTimersByTimeAsync(15)

    const result1 = await promise1
    expect(result1).toBe('success')

    const error2 = await catchPromise2
    expect(error2).toBeInstanceOf(Error)
    expect((error2 as Error).message).toMatch(/No response received/)
  })

  it('should call onBatch callback when batch is sent', async () => {
    const onBatch = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({ id: req.id, result: null }))
      },
    }

    const batchedTransport = withBatching(mockTransport, {
      windowMs: 10,
      onBatch,
    })

    batchedTransport.call('method1', ['arg1'])
    batchedTransport.call('method2', ['arg2'])

    await vi.advanceTimersByTimeAsync(15)

    expect(onBatch).toHaveBeenCalledTimes(1)
    expect(onBatch).toHaveBeenCalledWith([
      expect.objectContaining({ method: 'method1', args: ['arg1'] }),
      expect.objectContaining({ method: 'method2', args: ['arg2'] }),
    ])
  })

  it('should preserve request arguments', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          result: req.args,
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    const promise1 = batchedTransport.call('method1', ['arg1', { nested: true }])
    const promise2 = batchedTransport.call('method2', [123, 'string', null])

    await vi.advanceTimersByTimeAsync(15)

    const result1 = await promise1
    const result2 = await promise2

    expect(result1).toEqual(['arg1', { nested: true }])
    expect(result2).toEqual([123, 'string', null])
  })

  it('should preserve error code and data', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          error: {
            message: 'Error occurred',
            code: 'CUSTOM_ERROR',
            data: { details: 'extra info' },
          },
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    const promise = batchedTransport.call('method', [])

    // Attach catch handler immediately to prevent unhandled rejection warning
    const catchPromise = promise.catch((e) => e)

    await vi.advanceTimersByTimeAsync(15)

    const error = await catchPromise
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Error occurred')
    expect((error as Error & { code: string }).code).toBe('CUSTOM_ERROR')
    expect((error as Error & { data: unknown }).data).toEqual({ details: 'extra info' })
  })

  it('should handle sequential batches correctly', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy()
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          result: `batch-${callSpy.mock.calls.length}`,
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    // First batch
    const promise1 = batchedTransport.call('method1', [])
    await vi.advanceTimersByTimeAsync(15)
    const result1 = await promise1

    // Second batch
    const promise2 = batchedTransport.call('method2', [])
    await vi.advanceTimersByTimeAsync(15)
    const result2 = await promise2

    expect(callSpy).toHaveBeenCalledTimes(2)
    expect(result1).toBe('batch-1')
    expect(result2).toBe('batch-2')
  })

  it('should close underlying transport', () => {
    const closeSpy = vi.fn()

    const mockTransport: Transport = {
      call: async () => [],
      close: closeSpy,
    }

    const batchedTransport = withBatching(mockTransport)

    batchedTransport.close?.()

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('should flush pending requests on close', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy()
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({ id: req.id, result: 'flushed' }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 1000 })

    // Add pending request without waiting for timer
    const promise = batchedTransport.call('pending.method', [])

    // Close should flush
    batchedTransport.close?.()

    // Let the flush complete
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(callSpy).toHaveBeenCalledTimes(1)
    expect(result).toBe('flushed')
  })

  it('should use default options', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy()
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({ id: req.id, result: 'ok' }))
      },
    }

    // Create with no options - should use defaults
    const batchedTransport = withBatching(mockTransport)

    batchedTransport.call('method', [])

    // Default windowMs is 10
    await vi.advanceTimersByTimeAsync(5)
    expect(callSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    expect(callSpy).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// withDebouncedBatching Tests
// ============================================================================

describe('withDebouncedBatching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should debounce - resetting timer on each new request', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy()
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({ id: req.id, result: 'ok' }))
      },
    }

    const batchedTransport = withDebouncedBatching(mockTransport, { windowMs: 20 })

    // First request
    batchedTransport.call('method1', [])

    // Advance 15ms (not enough to trigger)
    await vi.advanceTimersByTimeAsync(15)
    expect(callSpy).not.toHaveBeenCalled()

    // Second request - resets timer
    batchedTransport.call('method2', [])

    // Advance 15ms again (30ms total, but only 15ms since last request)
    await vi.advanceTimersByTimeAsync(15)
    expect(callSpy).not.toHaveBeenCalled()

    // Advance 10ms more (25ms since last request) - should trigger now
    await vi.advanceTimersByTimeAsync(10)
    expect(callSpy).toHaveBeenCalledTimes(1)
  })

  it('should still respect maxBatchSize', async () => {
    const callSpy = vi.fn()

    const mockTransport: Transport = {
      call: async (method, args) => {
        callSpy()
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({ id: req.id, result: 'ok' }))
      },
    }

    const batchedTransport = withDebouncedBatching(mockTransport, {
      windowMs: 1000,
      maxBatchSize: 2,
    })

    // Make 2 requests - should flush immediately at batch size
    const promises = [
      batchedTransport.call('method1', []),
      batchedTransport.call('method2', []),
    ]

    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(promises)

    expect(callSpy).toHaveBeenCalledTimes(1)
  })

  it('should batch all requests made during debounce window', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          result: req.method,
        }))
      },
    }

    const batchedTransport = withDebouncedBatching(mockTransport, { windowMs: 20 })

    const promises: Promise<unknown>[] = []

    // Make requests at different times
    promises.push(batchedTransport.call('method1', []))
    await vi.advanceTimersByTimeAsync(10)

    promises.push(batchedTransport.call('method2', []))
    await vi.advanceTimersByTimeAsync(10)

    promises.push(batchedTransport.call('method3', []))
    await vi.advanceTimersByTimeAsync(10)

    // Add one more, then wait for debounce to complete
    promises.push(batchedTransport.call('method4', []))
    await vi.advanceTimersByTimeAsync(25)

    const results = await Promise.all(promises)

    // All requests should be in the same batch
    expect(results).toEqual(['method1', 'method2', 'method3', 'method4'])
  })
})

// ============================================================================
// Integration with RPC
// ============================================================================

describe('Batching with RPC proxy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should work with nested method paths', async () => {
    const mockTransport: Transport = {
      call: async (method, args) => {
        const requests = args[0] as BatchedRequest[]
        return requests.map((req) => ({
          id: req.id,
          result: { path: req.method },
        }))
      },
    }

    const batchedTransport = withBatching(mockTransport, { windowMs: 10 })

    // Simulate RPC proxy calling with dotted method paths
    const promise1 = batchedTransport.call('api.v1.users.list', [])
    const promise2 = batchedTransport.call('api.v1.posts.create', [{ title: 'Test' }])

    await vi.advanceTimersByTimeAsync(15)

    const [result1, result2] = await Promise.all([promise1, promise2])

    expect(result1).toEqual({ path: 'api.v1.users.list' })
    expect(result2).toEqual({ path: 'api.v1.posts.create' })
  })
})
