/**
 * HTTP Transport Timeout Tests
 *
 * Tests for the timeout functionality in the http() transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http } from '../src/transports'
import { ConnectionError } from '../src/errors'

// ============================================================================
// Mock fetch
// ============================================================================

let mockFetch: ReturnType<typeof vi.fn>
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ============================================================================
// HTTP Timeout Tests
// ============================================================================

describe('http() Transport - Timeout', () => {
  it('should complete request normally when within timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Verify signal was passed
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('should timeout and throw ConnectionError when request takes too long', async () => {
    vi.useFakeTimers()

    // Mock fetch that never resolves
    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      return new Promise((resolve, reject) => {
        // Listen for abort
        options.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })

    const transport = http('https://api.example.com/rpc', { timeout: 1000 })
    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning by adding catch handler
    callPromise.catch(() => {})

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(1001)

    await expect(callPromise).rejects.toThrow(ConnectionError)
    await expect(callPromise).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timeout after 1000ms'
    })

    vi.useRealTimers()
  })

  it('should not timeout when no timeout is specified', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })

    // Verify no signal was passed (or signal is undefined)
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].signal).toBeUndefined()
  })

  it('should support legacy auth signature with no timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', 'my-token')
    await transport.call('test.method', [])

    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer my-token')
    expect(fetchCall[1].signal).toBeUndefined()
  })

  it('should support options object with auth and timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', {
      auth: 'my-token',
      timeout: 5000
    })
    await transport.call('test.method', [])

    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer my-token')
    expect(fetchCall[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('should support auth provider function with timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const authProvider = vi.fn().mockResolvedValue('dynamic-token')

    const transport = http('https://api.example.com/rpc', {
      auth: authProvider,
      timeout: 5000
    })
    await transport.call('test.method', [])

    expect(authProvider).toHaveBeenCalled()
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].headers['Authorization']).toBe('Bearer dynamic-token')
  })

  it('should clear timeout when request completes successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    await transport.call('test.method', [])

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('should clear timeout when request fails with non-timeout error', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    mockFetch.mockRejectedValue(new Error('Network error'))

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })

    await expect(transport.call('test.method', [])).rejects.toThrow('Network error')

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('should handle timeout of 0 as no timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', { timeout: 0 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })

    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].signal).toBeUndefined()
  })

  it('should handle negative timeout as no timeout', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'success' })
    })

    const transport = http('https://api.example.com/rpc', { timeout: -1 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })

    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall[1].signal).toBeUndefined()
  })

  it('should preserve ConnectionError properties', async () => {
    vi.useFakeTimers()

    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    })

    const transport = http('https://api.example.com/rpc', { timeout: 2000 })
    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning by adding catch handler
    callPromise.catch(() => {})

    await vi.advanceTimersByTimeAsync(2001)

    try {
      await callPromise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connError = error as ConnectionError
      expect(connError.code).toBe('REQUEST_TIMEOUT')
      expect(connError.retryable).toBe(true)
      expect(connError.message).toBe('Request timeout after 2000ms')
    }

    vi.useRealTimers()
  })
})
