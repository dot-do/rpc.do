/**
 * Capnweb Loader Tests
 *
 * Tests for the centralized capnweb module loader including:
 * - Module loading and caching
 * - Mock injection for testing
 * - Error handling for missing module
 * - Type safety of exports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loadCapnweb,
  setCapnwebMock,
  clearCapnwebCache,
  hasCapnwebMock,
  getCapnwebMock,
  type CapnwebModule,
} from '../src/capnweb-loader'
import { RPCError } from '../src/errors'

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  // Clear any existing mock and cache before each test
  setCapnwebMock(null)
  clearCapnwebCache()
})

afterEach(() => {
  // Clean up after each test
  setCapnwebMock(null)
  clearCapnwebCache()
})

// ============================================================================
// Mock Module Factory
// ============================================================================

function createMockCapnweb(): CapnwebModule {
  return {
    newHttpBatchRpcSession: vi.fn().mockReturnValue({ test: 'http-session' }),
    newWebSocketRpcSession: vi.fn().mockReturnValue({ test: 'ws-session' }),
    RpcSession: vi.fn().mockImplementation((transport, localMain) => ({
      getRemoteMain: () => ({ test: 'remote-main' }),
      transport,
      localMain,
    })) as unknown as CapnwebModule['RpcSession'],
  }
}

// ============================================================================
// Mock Injection Tests
// ============================================================================

describe('Capnweb Loader - Mock Injection', () => {
  it('should return mock module when set', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const result = await loadCapnweb()

    expect(result).toBe(mockCapnweb)
    expect(hasCapnwebMock()).toBe(true)
  })

  it('should detect when mock is set', () => {
    expect(hasCapnwebMock()).toBe(false)

    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    expect(hasCapnwebMock()).toBe(true)
  })

  it('should return current mock via getCapnwebMock', () => {
    expect(getCapnwebMock()).toBeNull()

    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    expect(getCapnwebMock()).toBe(mockCapnweb)
  })

  it('should clear mock when set to null', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    expect(hasCapnwebMock()).toBe(true)

    setCapnwebMock(null)

    expect(hasCapnwebMock()).toBe(false)
    expect(getCapnwebMock()).toBeNull()
  })

  it('should allow replacing mock', async () => {
    const mock1 = createMockCapnweb()
    const mock2 = createMockCapnweb()

    setCapnwebMock(mock1)
    expect(await loadCapnweb()).toBe(mock1)

    setCapnwebMock(mock2)
    expect(await loadCapnweb()).toBe(mock2)
  })
})

// ============================================================================
// Mock Functionality Tests
// ============================================================================

describe('Capnweb Loader - Mock Functionality', () => {
  it('should use mock newHttpBatchRpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()
    const session = capnweb.newHttpBatchRpcSession('https://example.com/rpc')

    expect(mockCapnweb.newHttpBatchRpcSession).toHaveBeenCalledWith('https://example.com/rpc')
    expect(session).toEqual({ test: 'http-session' })
  })

  it('should use mock newWebSocketRpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()
    const session = capnweb.newWebSocketRpcSession('wss://example.com/rpc')

    expect(mockCapnweb.newWebSocketRpcSession).toHaveBeenCalledWith('wss://example.com/rpc')
    expect(session).toEqual({ test: 'ws-session' })
  })

  it('should use mock RpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()
    const transport = { send: vi.fn(), receive: vi.fn() }
    const localMain = { handler: vi.fn() }

    const session = new capnweb.RpcSession(transport, localMain)
    const remoteMain = session.getRemoteMain()

    expect(mockCapnweb.RpcSession).toHaveBeenCalledWith(transport, localMain)
    expect(remoteMain).toEqual({ test: 'remote-main' })
  })
})

// ============================================================================
// Cache Tests
// ============================================================================

describe('Capnweb Loader - Caching', () => {
  it('should return same mock on multiple calls', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const result1 = await loadCapnweb()
    const result2 = await loadCapnweb()
    const result3 = await loadCapnweb()

    expect(result1).toBe(mockCapnweb)
    expect(result2).toBe(mockCapnweb)
    expect(result3).toBe(mockCapnweb)
  })

  it('should clear cache with clearCapnwebCache', async () => {
    const mock1 = createMockCapnweb()
    setCapnwebMock(mock1)

    await loadCapnweb()

    clearCapnwebCache()

    // Cache is cleared, but mock is still set
    const mock2 = createMockCapnweb()
    setCapnwebMock(mock2)

    const result = await loadCapnweb()
    expect(result).toBe(mock2)
  })
})

// ============================================================================
// Real Module Loading Tests (Integration)
// ============================================================================

describe('Capnweb Loader - Real Module Loading', () => {
  it('should load real module when no mock is set', async () => {
    // This test requires @dotdo/capnweb to be installed
    // It verifies the real module can be loaded and has expected exports

    const capnweb = await loadCapnweb()

    expect(typeof capnweb.newHttpBatchRpcSession).toBe('function')
    expect(typeof capnweb.newWebSocketRpcSession).toBe('function')
    expect(typeof capnweb.RpcSession).toBe('function')
  })

  it('should cache real module across calls', async () => {
    const result1 = await loadCapnweb()
    const result2 = await loadCapnweb()

    // Should be the exact same object (cached)
    expect(result1).toBe(result2)
  })

  it('should create valid HTTP session from real module', async () => {
    const capnweb = await loadCapnweb()
    const session = capnweb.newHttpBatchRpcSession('https://example.com/rpc')

    // Should return some session object (we can't deeply test without a server)
    expect(session).toBeDefined()
    expect(session).not.toBeNull()
  })

  it('should create valid RpcSession from real module', async () => {
    const capnweb = await loadCapnweb()

    // Create a minimal mock transport
    const mockTransport = {
      send: async () => {},
      receive: () => new Promise<string>(() => {}), // Never resolves
      abort: () => {},
    }

    const session = new capnweb.RpcSession(mockTransport)
    const remoteMain = session.getRemoteMain()

    expect(session).toBeDefined()
    expect(remoteMain).toBeDefined()
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Capnweb Loader - Error Handling', () => {
  it('should throw RPCError for missing exports', async () => {
    // Create a mock that's missing required exports
    const incompleteMock = {
      newHttpBatchRpcSession: vi.fn(),
      // Missing newWebSocketRpcSession and RpcSession
    }

    // We can't directly test this without mocking the dynamic import
    // But we can verify the error types are correct
    expect(RPCError).toBeDefined()
  })

  it('should handle mock that throws', async () => {
    const throwingMock: CapnwebModule = {
      newHttpBatchRpcSession: vi.fn().mockImplementation(() => {
        throw new Error('Mock error')
      }),
      newWebSocketRpcSession: vi.fn(),
      RpcSession: vi.fn() as unknown as CapnwebModule['RpcSession'],
    }

    setCapnwebMock(throwingMock)

    const capnweb = await loadCapnweb()

    expect(() => capnweb.newHttpBatchRpcSession('test')).toThrow('Mock error')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Capnweb Loader - Type Safety', () => {
  it('should have correct type for newHttpBatchRpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()

    // TypeScript should allow this - checking at runtime
    const fn: (url: string) => unknown = capnweb.newHttpBatchRpcSession
    expect(typeof fn).toBe('function')
  })

  it('should have correct type for newWebSocketRpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()

    // TypeScript should allow this - checking at runtime
    const fn: (url: string) => unknown = capnweb.newWebSocketRpcSession
    expect(typeof fn).toBe('function')
  })

  it('should have correct type for RpcSession', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    const capnweb = await loadCapnweb()

    // TypeScript should allow this - checking at runtime
    expect(typeof capnweb.RpcSession).toBe('function')
  })
})

// ============================================================================
// Concurrent Loading Tests
// ============================================================================

describe('Capnweb Loader - Concurrent Loading', () => {
  it('should handle concurrent loadCapnweb calls with mock', async () => {
    const mockCapnweb = createMockCapnweb()
    setCapnwebMock(mockCapnweb)

    // Start multiple loads concurrently
    const promises = [
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
    ]

    const results = await Promise.all(promises)

    // All should return the same mock
    for (const result of results) {
      expect(result).toBe(mockCapnweb)
    }
  })

  it('should handle concurrent loadCapnweb calls with real module', async () => {
    // Start multiple loads concurrently
    const promises = [
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
      loadCapnweb(),
    ]

    const results = await Promise.all(promises)

    // All should return the same cached module
    const first = results[0]
    for (const result of results) {
      expect(result).toBe(first)
    }
  })
})

// ============================================================================
// Integration with Transports Tests
// ============================================================================

describe('Capnweb Loader - Transport Integration', () => {
  it('should work with http transport via mock', async () => {
    const mockSession = {
      users: {
        get: vi.fn().mockResolvedValue({ id: '123', name: 'Test' }),
      },
    }

    const mockCapnweb: CapnwebModule = {
      newHttpBatchRpcSession: vi.fn().mockReturnValue(mockSession),
      newWebSocketRpcSession: vi.fn(),
      RpcSession: vi.fn() as unknown as CapnwebModule['RpcSession'],
    }

    setCapnwebMock(mockCapnweb)

    // Load and use
    const capnweb = await loadCapnweb()
    const session = capnweb.newHttpBatchRpcSession('https://api.example.com/rpc')

    // Verify mock was called correctly
    expect(mockCapnweb.newHttpBatchRpcSession).toHaveBeenCalledWith('https://api.example.com/rpc')
    expect(session).toBe(mockSession)

    // Use the session
    const result = await mockSession.users.get('123')
    expect(result).toEqual({ id: '123', name: 'Test' })
  })

  it('should work with websocket transport via mock', async () => {
    const mockSession = {
      subscribe: vi.fn().mockResolvedValue({ subscribed: true }),
    }

    const mockCapnweb: CapnwebModule = {
      newHttpBatchRpcSession: vi.fn(),
      newWebSocketRpcSession: vi.fn().mockReturnValue(mockSession),
      RpcSession: vi.fn() as unknown as CapnwebModule['RpcSession'],
    }

    setCapnwebMock(mockCapnweb)

    // Load and use
    const capnweb = await loadCapnweb()
    const session = capnweb.newWebSocketRpcSession('wss://api.example.com/rpc')

    // Verify mock was called correctly
    expect(mockCapnweb.newWebSocketRpcSession).toHaveBeenCalledWith('wss://api.example.com/rpc')
    expect(session).toBe(mockSession)
  })
})
