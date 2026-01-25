/**
 * HTTP Transport Timeout Tests
 *
 * Tests for the timeout functionality in the http() transport
 * Now using capnweb's HTTP batch protocol
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConnectionError, RPCError } from '../src/errors'

// ============================================================================
// Mock capnweb module
// ============================================================================

// Mock session with spy methods
function createMockSession() {
  const disposeSymbol = Symbol.dispose
  return {
    test: {
      method: vi.fn().mockResolvedValue({ result: 'success' }),
      slowMethod: vi.fn(),
    },
    simpleMethod: vi.fn().mockResolvedValue({ result: 'success' }),
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
  const { http } = await import('../src/transports')
  return http
}

// Helper to get RPCError from same module context
async function getRPCError() {
  const { RPCError } = await import('../src/errors')
  return RPCError
}

// ============================================================================
// HTTP Timeout Tests
// ============================================================================

describe('http() Transport - Timeout', () => {
  it('should complete request normally when within timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('https://api.example.com/rpc')
    expect(mockSession.test.method).toHaveBeenCalled()
  })

  it('should timeout and throw ConnectionError when request takes too long', async () => {
    // Use a very short timeout with real timers for a more reliable test
    mockSession.test.slowMethod.mockImplementation(() => {
      // Return a promise that takes longer than the timeout
      return new Promise(resolve => setTimeout(resolve, 200))
    })

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 50 })

    try {
      await transport.call('test.slowMethod', [])
      expect.fail('Should have thrown')
    } catch (error) {
      // Check error properties instead of instanceof due to vi.resetModules()
      expect((error as any).code).toBe('REQUEST_TIMEOUT')
      expect((error as any).message).toBe('Request timeout after 50ms')
    }
  }, 10000) // 10 second test timeout

  it('should not timeout when no timeout is specified', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should support legacy auth signature with no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', 'my-token')
    await transport.call('test.method', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should support options object with auth and timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', {
      auth: 'my-token',
      timeout: 5000
    })
    await transport.call('test.method', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should support auth provider function with timeout', async () => {
    const authProvider = vi.fn().mockResolvedValue('dynamic-token')

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', {
      auth: authProvider,
      timeout: 5000
    })
    await transport.call('test.method', [])

    expect(authProvider).toHaveBeenCalled()
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalled()
  })

  it('should clear timeout when request completes successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })
    await transport.call('test.method', [])

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('should clear timeout when request fails with non-timeout error', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    mockSession.test.method.mockRejectedValue(new Error('Network error'))

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 5000 })

    await expect(transport.call('test.method', [])).rejects.toThrow('Network error')

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('should handle timeout of 0 as no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 0 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should handle negative timeout as no timeout', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: -1 })
    const result = await transport.call('test.method', [])

    expect(result).toEqual({ result: 'success' })
  })

  it('should preserve ConnectionError properties', async () => {
    // Use real timers with a short timeout
    mockSession.test.slowMethod.mockImplementation(() => {
      return new Promise(resolve => setTimeout(resolve, 200))
    })

    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc', { timeout: 50 })

    try {
      await transport.call('test.slowMethod', [])
      expect.fail('Should have thrown')
    } catch (error) {
      // Check error properties instead of instanceof due to vi.resetModules()
      expect((error as any).code).toBe('REQUEST_TIMEOUT')
      expect((error as any).retryable).toBe(true)
      expect((error as any).message).toBe('Request timeout after 50ms')
    }
  }, 10000) // 10 second test timeout
})

// ============================================================================
// HTTP Transport - Capnweb Protocol Tests
// ============================================================================

describe('http() Transport - Capnweb Protocol', () => {
  it('should use capnweb newHttpBatchRpcSession', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('test.method', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('https://api.example.com/rpc')
  })

  it('should cache the session across multiple calls', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('test.method', [])
    await transport.call('simpleMethod', [])
    await transport.call('test.method', ['arg1'])

    // Session should only be created once
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledTimes(1)
  })

  it('should navigate nested method paths', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('test.method', ['arg1', 'arg2'])

    expect(mockSession.test.method).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('should call simple methods directly', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('simpleMethod', [])

    expect(mockSession.simpleMethod).toHaveBeenCalled()
  })

  it('should throw INVALID_PATH for invalid path traversal', async () => {
    // Create session with non-object property
    (mockSession as any).invalidPath = 'not an object'

    const http = await getHttpTransport()
    const RPCError = await getRPCError()
    const transport = http('https://api.example.com/rpc')

    try {
      await transport.call('invalidPath.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('INVALID_PATH')
    }
  })

  it('should throw METHOD_NOT_FOUND when target is not a function', async () => {
    // Create session with non-function property
    (mockSession as any).notAFunction = { data: 'value' }

    const http = await getHttpTransport()
    const RPCError = await getRPCError()
    const transport = http('https://api.example.com/rpc')

    try {
      await transport.call('notAFunction', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('METHOD_NOT_FOUND')
    }
  })

  it('should throw MODULE_ERROR when newHttpBatchRpcSession is not found', async () => {
    // Mock capnweb module without newHttpBatchRpcSession
    vi.doMock('capnweb', () => ({
      newHttpBatchRpcSession: undefined
    }))
    vi.resetModules()

    const { http } = await import('../src/transports')
    const RPCError = await getRPCError()
    const transport = http('https://api.example.com/rpc')

    try {
      await transport.call('test.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('MODULE_ERROR')
      expect((error as InstanceType<typeof RPCError>).message).toBe('capnweb.newHttpBatchRpcSession not found')
    }
  })

  it('should dispose session on close()', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')
    await transport.call('test.method', [])

    // Close transport
    transport.close!()

    expect(mockSession[Symbol.dispose]).toHaveBeenCalledTimes(1)
  })

  it('should handle close() when session is not initialized', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')

    // Close without any calls - should not throw
    expect(() => transport.close!()).not.toThrow()
  })

  it('should create new session after close()', async () => {
    const http = await getHttpTransport()

    const transport = http('https://api.example.com/rpc')

    // First session
    await transport.call('test.method', [])
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledTimes(1)

    // Close
    transport.close!()

    // New call should create new session
    await transport.call('test.method', [])
    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledTimes(2)
  })
})
