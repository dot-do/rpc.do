/**
 * Capnweb Transport Tests
 *
 * Tests for the capnweb() transport including:
 * - Module lazy loading (dynamic import, caching)
 * - WebSocket session (default mode)
 * - HTTP batch session
 * - Method navigation through proxy
 * - Resource disposal
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock capnweb module
// ============================================================================

// Mock session with spy methods
function createMockSession() {
  const disposeSymbol = Symbol.dispose
  return {
    users: {
      get: vi.fn().mockResolvedValue({ id: '123', name: 'Test User' }),
      list: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
      nested: {
        deep: {
          method: vi.fn().mockResolvedValue('deep result')
        }
      }
    },
    posts: {
      create: vi.fn().mockResolvedValue({ id: 'new-post' })
    },
    simpleMethod: vi.fn().mockResolvedValue('simple result'),
    [disposeSymbol]: vi.fn()
  }
}

let mockSession: ReturnType<typeof createMockSession>
let mockNewWebSocketRpcSession: ReturnType<typeof vi.fn>
let mockNewHttpBatchRpcSession: ReturnType<typeof vi.fn>
let capnwebImportCount: number

// Reset mocks before each test
beforeEach(() => {
  mockSession = createMockSession()
  mockNewWebSocketRpcSession = vi.fn().mockReturnValue(mockSession)
  mockNewHttpBatchRpcSession = vi.fn().mockReturnValue(mockSession)
  capnwebImportCount = 0

  // Mock the capnweb dynamic import
  vi.doMock('capnweb', () => {
    capnwebImportCount++
    return {
      newWebSocketRpcSession: mockNewWebSocketRpcSession,
      newHttpBatchRpcSession: mockNewHttpBatchRpcSession
    }
  })
})

afterEach(() => {
  vi.doUnmock('capnweb')
  vi.resetModules()
})

// Helper to get fresh capnweb transport after mocking
async function getCapnwebTransport() {
  // Clear module cache and re-import
  vi.resetModules()
  const { capnweb } = await import('../src/transports')
  return capnweb
}

// Helper to get RPCError from same module context
async function getRPCError() {
  const { RPCError } = await import('../src/errors')
  return RPCError
}

// ============================================================================
// Module Lazy Loading Tests
// ============================================================================

describe('capnweb() Transport - Module Loading', () => {
  it('should dynamically import capnweb module on first call', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // No import yet - just created the transport
    expect(capnwebImportCount).toBe(0)

    // First call triggers import
    await transport.call('simpleMethod', [])

    expect(capnwebImportCount).toBe(1)
    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(1)
  })

  it('should cache the import and not re-import on subsequent calls', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // Multiple calls
    await transport.call('simpleMethod', [])
    await transport.call('users.get', ['123'])
    await transport.call('posts.create', [{ title: 'Test' }])

    // Should only import once
    expect(capnwebImportCount).toBe(1)
    // Session should only be created once
    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(1)
  })

  it('should handle missing capnweb dependency gracefully', async () => {
    // For this test, we need to ensure capnweb is not mocked
    vi.doUnmock('capnweb')
    vi.resetModules()

    const { capnweb } = await import('../src/transports')
    const transport = capnweb('https://api.example.com/rpc')

    // Since capnweb is not installed, this should throw an import error
    // The exact error message depends on the environment
    await expect(transport.call('test.method', [])).rejects.toThrow()
  })
})

// ============================================================================
// WebSocket Session Tests (Default Mode)
// ============================================================================

describe('capnweb() Transport - WebSocket Session', () => {
  it('should create WebSocket session by default', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(1)
    expect(mockNewHttpBatchRpcSession).not.toHaveBeenCalled()
  })

  it('should create WebSocket session when websocket: true', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: true })

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(1)
    expect(mockNewHttpBatchRpcSession).not.toHaveBeenCalled()
  })

  it('should convert http:// to ws:// for WebSocket session', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('http://localhost:8080/rpc')

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledWith('ws://localhost:8080/rpc')
  })

  it('should convert https:// to wss:// for WebSocket session', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledWith('wss://api.example.com/rpc')
  })

  it('should pass ws:// URL as-is', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('ws://localhost:8080/rpc')

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledWith('ws://localhost:8080/rpc')
  })

  it('should pass wss:// URL as-is', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('wss://secure.example.com/rpc')

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalledWith('wss://secure.example.com/rpc')
  })
})

// ============================================================================
// HTTP Batch Session Tests
// ============================================================================

describe('capnweb() Transport - HTTP Batch Session', () => {
  it('should create HTTP batch session when websocket: false', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    await transport.call('simpleMethod', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledTimes(1)
    expect(mockNewWebSocketRpcSession).not.toHaveBeenCalled()
  })

  it('should pass URL directly for HTTP batch session (no protocol conversion)', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    await transport.call('simpleMethod', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('https://api.example.com/rpc')
  })

  it('should pass http:// URL as-is for HTTP batch session', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('http://localhost:8080/rpc', { websocket: false })

    await transport.call('simpleMethod', [])

    expect(mockNewHttpBatchRpcSession).toHaveBeenCalledWith('http://localhost:8080/rpc')
  })
})

// ============================================================================
// Method Navigation Tests
// ============================================================================

describe('capnweb() Transport - Method Navigation', () => {
  it('should call simple method directly', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    const result = await transport.call('simpleMethod', ['arg1', 'arg2'])

    expect(mockSession.simpleMethod).toHaveBeenCalledWith('arg1', 'arg2')
    expect(result).toBe('simple result')
  })

  it('should navigate through one level of nesting', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    const result = await transport.call('users.get', ['123'])

    expect(mockSession.users.get).toHaveBeenCalledWith('123')
    expect(result).toEqual({ id: '123', name: 'Test User' })
  })

  it('should handle nested paths (e.g., rpc.users.nested.deep.method)', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    const result = await transport.call('users.nested.deep.method', ['arg'])

    expect(mockSession.users.nested.deep.method).toHaveBeenCalledWith('arg')
    expect(result).toBe('deep result')
  })

  it('should pass multiple arguments correctly', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await transport.call('posts.create', [{ title: 'Test' }, { author: 'user1' }, true])

    expect(mockSession.posts.create).toHaveBeenCalledWith(
      { title: 'Test' },
      { author: 'user1' },
      true
    )
  })

  it('should pass no arguments correctly', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await transport.call('users.list', [])

    expect(mockSession.users.list).toHaveBeenCalledWith()
  })

  it('should throw INVALID_PATH for invalid path traversal', async () => {
    // Create session with non-object property
    mockSession.invalidPath = 'not an object' as any

    const capnweb = await getCapnwebTransport()
    const RPCError = await getRPCError()
    const transport = capnweb('https://api.example.com/rpc')

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
    mockSession.notAFunction = { data: 'value' } as any

    const capnweb = await getCapnwebTransport()
    const RPCError = await getRPCError()
    const transport = capnweb('https://api.example.com/rpc')

    try {
      await transport.call('notAFunction', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('METHOD_NOT_FOUND')
    }
  })
})

// ============================================================================
// Resource Disposal Tests
// ============================================================================

describe('capnweb() Transport - Resource Disposal', () => {
  it('should dispose session on close()', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // Initialize session
    await transport.call('simpleMethod', [])

    // Close transport
    transport.close!()

    expect(mockSession[Symbol.dispose]).toHaveBeenCalledTimes(1)
  })

  it('should handle close() when session is not initialized', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // Close without any calls - should not throw
    expect(() => transport.close!()).not.toThrow()
  })

  it('should handle close() called multiple times', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // Initialize session
    await transport.call('simpleMethod', [])

    // Close multiple times
    transport.close!()
    transport.close!()
    transport.close!()

    // Should only be called once since session is set to null after first close
    expect(mockSession[Symbol.dispose]).toHaveBeenCalledTimes(1)
  })

  it('should create new session after close()', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    // First session
    await transport.call('simpleMethod', [])
    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(1)

    // Close
    transport.close!()

    // New call should create new session
    await transport.call('simpleMethod', [])
    expect(mockNewWebSocketRpcSession).toHaveBeenCalledTimes(2)
  })

  it('should handle session without Symbol.dispose gracefully', async () => {
    // Create session without Symbol.dispose
    const sessionWithoutDispose = {
      simpleMethod: vi.fn().mockResolvedValue('result')
    }
    mockNewWebSocketRpcSession.mockReturnValue(sessionWithoutDispose)

    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await transport.call('simpleMethod', [])

    // Close should not throw even without Symbol.dispose
    expect(() => transport.close!()).not.toThrow()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('capnweb() Transport - Error Handling', () => {
  it('should handle capnweb import failure', async () => {
    // Unmock capnweb so it fails to import (since it's not installed)
    vi.doUnmock('capnweb')
    vi.resetModules()

    const { capnweb } = await import('../src/transports')
    const transport = capnweb('https://api.example.com/rpc')

    // This should throw because capnweb is not actually installed
    await expect(transport.call('test.method', [])).rejects.toThrow()
  })

  it('should throw MODULE_ERROR when newWebSocketRpcSession is not found', async () => {
    // Mock capnweb module with newWebSocketRpcSession returning undefined
    vi.doMock('capnweb', () => ({
      newWebSocketRpcSession: undefined,
      newHttpBatchRpcSession: mockNewHttpBatchRpcSession
    }))
    vi.resetModules()

    const { capnweb } = await import('../src/transports')
    const RPCError = await getRPCError()
    const transport = capnweb('https://api.example.com/rpc', { websocket: true })

    try {
      await transport.call('test.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('MODULE_ERROR')
      expect((error as InstanceType<typeof RPCError>).message).toBe('capnweb.newWebSocketRpcSession not found')
    }
  })

  it('should throw MODULE_ERROR when newHttpBatchRpcSession is not found', async () => {
    // Mock capnweb module with newHttpBatchRpcSession returning undefined
    vi.doMock('capnweb', () => ({
      newWebSocketRpcSession: mockNewWebSocketRpcSession,
      newHttpBatchRpcSession: undefined
    }))
    vi.resetModules()

    const { capnweb } = await import('../src/transports')
    const RPCError = await getRPCError()
    const transport = capnweb('https://api.example.com/rpc', { websocket: false })

    try {
      await transport.call('test.method', [])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as InstanceType<typeof RPCError>).code).toBe('MODULE_ERROR')
      expect((error as InstanceType<typeof RPCError>).message).toBe('capnweb.newHttpBatchRpcSession not found')
    }
  })

  it('should handle session creation failure', async () => {
    mockNewWebSocketRpcSession.mockImplementation(() => {
      throw new Error('Failed to create WebSocket session')
    })

    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await expect(transport.call('test.method', [])).rejects.toThrow('Failed to create WebSocket session')
  })

  it('should propagate errors from method calls', async () => {
    const methodError = new Error('Method execution failed')
    mockSession.simpleMethod.mockRejectedValue(methodError)

    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc')

    await expect(transport.call('simpleMethod', [])).rejects.toThrow('Method execution failed')
  })
})

// ============================================================================
// Auth Option Tests
// ============================================================================

describe('capnweb() Transport - Auth Options', () => {
  it('should accept auth option as string', async () => {
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { auth: 'my-token' })

    // Auth is accepted but not directly used by session creation in this mock
    // The auth provider is stored internally for potential use
    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalled()
  })

  it('should accept auth option as function', async () => {
    const authProvider = vi.fn().mockReturnValue('dynamic-token')
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { auth: authProvider })

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalled()
  })

  it('should accept auth option as async function', async () => {
    const asyncAuthProvider = vi.fn().mockResolvedValue('async-token')
    const capnweb = await getCapnwebTransport()
    const transport = capnweb('https://api.example.com/rpc', { auth: asyncAuthProvider })

    await transport.call('simpleMethod', [])

    expect(mockNewWebSocketRpcSession).toHaveBeenCalled()
  })
})
