/**
 * Memory Leak Tests for rpc.do
 *
 * Tests to verify proper cleanup of resources to prevent memory leaks:
 * - pendingRequests Map cleanup
 * - Timeout cleanup
 * - Event listener cleanup
 * - Transport close cleanup
 * - Stress tests for memory growth patterns
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { http, ws as wsTransport } from '../src/transports'
import { wsAdvanced, WebSocketAdvancedTransport } from '../src/transports/ws-advanced'
import { ConnectionError, RPCError } from '../src/errors'
import type { Transport } from '../src/index'

// ============================================================================
// Mock WebSocket (shared with ws-advanced.test.ts pattern)
// ============================================================================

// Track created sockets for tests that need to access them
let createdSockets: MockWebSocket[] = []

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState: number = MockWebSocket.CONNECTING
  private listeners: Map<string, Function[]> = new Map()

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    createdSockets.push(this)
  }

  addEventListener(type: string, handler: Function) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)!.push(handler)
  }

  removeEventListener(type: string, handler: Function) {
    const handlers = this.listeners.get(type)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index !== -1) handlers.splice(index, 1)
    }
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    const event = { code: code ?? 1000, reason: reason ?? '' }
    this.triggerEvent('close', event)
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.triggerEvent('open', undefined)
  }

  simulateMessage(data: unknown) {
    this.triggerEvent('message', { data: JSON.stringify(data) })
  }

  simulateClose(code: number = 1000, reason: string = '') {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.triggerEvent('close', { code, reason })
  }

  simulateError(error: Event = new Event('error')) {
    this.triggerEvent('error', error)
  }

  getListenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0
  }

  getAllListenerCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const [type, handlers] of this.listeners) {
      counts[type] = handlers.length
    }
    return counts
  }

  private triggerEvent(type: string, event: unknown) {
    const handlers = this.listeners.get(type) || []
    for (const handler of handlers) {
      handler(event)
    }
  }
}

// Store original WebSocket
let originalWebSocket: typeof WebSocket
let mockFetch: ReturnType<typeof vi.fn>
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  ;(globalThis as any).WebSocket = MockWebSocket

  originalFetch = globalThis.fetch
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch

  // Reset socket tracking
  createdSockets = []
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  vi.useRealTimers()
  createdSockets = []
})

// Helper to get the last created socket
function getLastSocket(): MockWebSocket | undefined {
  return createdSockets[createdSockets.length - 1]
}

// ============================================================================
// 1. pendingRequests Map Cleanup Tests
// ============================================================================

describe('pendingRequests Map Cleanup', () => {
  describe('ws() transport', () => {
    // Note: The basic ws() transport uses closure-scoped variables for `pending` Map
    // so we can't directly inspect Map.size. We verify cleanup through:
    // 1. No dangling promises after successful/error responses
    // 2. clearTimeout being called for timeout cleanup
    // 3. Proper rejection on connection close

    it('should resolve successfully and not leak on successful response', async () => {
      const transport = wsTransport('wss://test.example.com')
      const callPromise = transport.call('test.method', [{ arg: 'value' }])

      // Wait for WebSocket to be created
      await new Promise(resolve => setTimeout(resolve, 10))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()

      // Wait for message to be sent
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockWs!.sentMessages.length).toBe(1)
      const sentMsg = JSON.parse(mockWs!.sentMessages[0])

      // Simulate successful response
      mockWs!.simulateMessage({ id: sentMsg.id, result: { success: true } })

      // Promise should resolve without error
      const result = await callPromise
      expect(result).toEqual({ success: true })

      // Clean up
      transport.close?.()
    })

    it('should reject and not leak on error response', async () => {
      const transport = wsTransport('wss://test.example.com')
      const callPromise = transport.call('test.method', [])

      await new Promise(resolve => setTimeout(resolve, 10))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()

      await new Promise(resolve => setTimeout(resolve, 0))

      const sentMsg = JSON.parse(mockWs!.sentMessages[0])

      // Simulate error response
      mockWs!.simulateMessage({
        id: sentMsg.id,
        error: { code: 'TEST_ERROR', message: 'Test error occurred' }
      })

      // Promise should reject with the error
      await expect(callPromise).rejects.toThrow('Test error occurred')

      transport.close?.()
    })

    it('should timeout and reject without leaking', async () => {
      vi.useFakeTimers()

      const transport = wsTransport('wss://test.example.com', { timeout: 1000 })

      const callPromise = transport.call('test.method', [])
      callPromise.catch(() => {}) // Prevent unhandled rejection

      // Wait for WebSocket creation
      await vi.advanceTimersByTimeAsync(10)

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Advance past timeout without sending response
      await vi.advanceTimersByTimeAsync(1001)

      // Promise should reject with timeout error
      await expect(callPromise).rejects.toThrow('timeout')

      transport.close?.()
      vi.useRealTimers()
    })

    it('should reject all pending requests on connection close', async () => {
      const transport = wsTransport('wss://test.example.com')

      // Start multiple calls
      const errors: Error[] = []
      const call1 = transport.call('method1', []).catch(e => { errors.push(e) })
      const call2 = transport.call('method2', []).catch(e => { errors.push(e) })
      const call3 = transport.call('method3', []).catch(e => { errors.push(e) })

      await new Promise(resolve => setTimeout(resolve, 20))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()
      await new Promise(resolve => setTimeout(resolve, 0))

      // Verify messages were sent
      expect(mockWs!.sentMessages.length).toBe(3)

      // Close connection unexpectedly
      mockWs!.simulateClose(1006, 'Connection lost')

      // Wait for all promises to settle
      await Promise.all([call1, call2, call3])

      // All requests should have been rejected
      expect(errors.length).toBe(3)
      errors.forEach(error => {
        expect(error.message).toContain('closed')
      })
    })
  })

  describe('wsAdvanced() transport', () => {
    it('should clear pending request after successful response', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Access internal pendingRequests map
      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>

      const callPromise = transport.call('test.method', [])

      // Verify pending request exists
      expect(pendingRequests.size).toBe(1)

      // Get the message ID from sent message
      const sentMsg = JSON.parse(ws.sentMessages[0])

      // Simulate response
      ws.simulateMessage({ id: sentMsg.id, result: 'success' })

      await callPromise

      // Verify pending request cleared
      expect(pendingRequests.size).toBe(0)
    })

    it('should clear pending request after error response', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>

      const callPromise = transport.call('test.method', [])
      callPromise.catch(() => {})

      expect(pendingRequests.size).toBe(1)

      const sentMsg = JSON.parse(ws.sentMessages[0])
      ws.simulateMessage({
        id: sentMsg.id,
        error: { code: 'ERROR', message: 'Test error' },
      })

      await callPromise.catch(() => {})

      expect(pendingRequests.size).toBe(0)
    })

    it('should clear all pending requests on close()', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
        requestTimeout: 60000, // Long timeout so we can test close cleanup
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>

      // Start multiple calls
      const call1 = transport.call('method1', [])
      const call2 = transport.call('method2', [])
      const call3 = transport.call('method3', [])

      // Prevent unhandled rejections
      call1.catch(() => {})
      call2.catch(() => {})
      call3.catch(() => {})

      expect(pendingRequests.size).toBe(3)

      // Close transport
      transport.close()

      // Verify all pending requests cleared
      expect(pendingRequests.size).toBe(0)
    })
  })
})

// ============================================================================
// 2. Timeout Cleanup Tests
// ============================================================================

describe('Timeout Cleanup', () => {
  describe('http() transport', () => {
    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'success' }),
      })

      const transport = http('https://api.example.com/rpc', { timeout: 5000 })
      await transport.call('test.method', [])

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('should clear timeout on error response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      mockFetch.mockRejectedValue(new Error('Network error'))

      const transport = http('https://api.example.com/rpc', { timeout: 5000 })

      await transport.call('test.method', []).catch(() => {})

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('should not leave dangling timers after multiple calls', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'success' }),
      })

      const transport = http('https://api.example.com/rpc', { timeout: 5000 })

      // Make multiple calls
      await Promise.all([
        transport.call('method1', []),
        transport.call('method2', []),
        transport.call('method3', []),
      ])

      // Each call should have cleared its timeout
      const timeoutCalls = setTimeoutSpy.mock.calls.filter(
        call => typeof call[1] === 'number' && call[1] === 5000
      )
      const clearCalls = clearTimeoutSpy.mock.calls.length

      // Should have cleared at least as many as we set for the timeout
      expect(clearCalls).toBeGreaterThanOrEqual(timeoutCalls.length)

      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('ws() transport', () => {
    it('should clear request timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      const transport = wsTransport('wss://test.example.com', { timeout: 5000 })
      const callPromise = transport.call('test.method', [])

      await new Promise(resolve => setTimeout(resolve, 20))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()
      await new Promise(resolve => setTimeout(resolve, 0))

      const msg = JSON.parse(mockWs!.sentMessages[0])
      mockWs!.simulateMessage({ id: msg.id, result: 'success' })

      await callPromise

      // Verify clearTimeout was called
      expect(clearTimeoutSpy).toHaveBeenCalled()

      transport.close?.()
      clearTimeoutSpy.mockRestore()
    })

    it('should clear all timeouts on transport close', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      const transport = wsTransport('wss://test.example.com', { timeout: 30000 })

      // Start calls
      const call1 = transport.call('method1', [])
      const call2 = transport.call('method2', [])

      call1.catch(() => {})
      call2.catch(() => {})

      await new Promise(resolve => setTimeout(resolve, 20))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()
      await new Promise(resolve => setTimeout(resolve, 0))

      const callsBefore = clearTimeoutSpy.mock.calls.length

      // Close transport
      transport.close?.()

      // Should have cleared timeouts
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBefore)

      clearTimeoutSpy.mockRestore()
    })
  })

  describe('wsAdvanced() transport', () => {
    it('should clear request timeout on response', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
        requestTimeout: 5000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const callPromise = transport.call('test.method', [])

      const sentMsg = JSON.parse(ws.sentMessages[0])
      ws.simulateMessage({ id: sentMsg.id, result: 'success' })

      await callPromise

      // Verify timeout was cleared
      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('should clear heartbeat and reconnect timers on close', async () => {
      vi.useFakeTimers()
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        heartbeatInterval: 30000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Let heartbeat timer start
      await vi.advanceTimersByTimeAsync(0)

      // Close transport
      transport.close()

      // Verify timers were cleared
      expect(clearIntervalSpy).toHaveBeenCalled() // heartbeat interval
      expect(clearTimeoutSpy).toHaveBeenCalled() // any pending timeouts

      clearTimeoutSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      vi.useRealTimers()
    })

    it('should clear reconnect timer on explicit close', async () => {
      vi.useFakeTimers()
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBackoff: 1000,
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Trigger disconnect to start reconnection
      ws.simulateClose(1006, 'Connection lost')

      // State should be reconnecting
      expect(transport.state).toBe('reconnecting')

      const clearCallsBefore = clearTimeoutSpy.mock.calls.length

      // Now explicitly close before reconnect happens
      transport.close()

      // Should have cleared reconnect timer
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(clearCallsBefore)
      expect(transport.state).toBe('closed')

      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    })
  })
})

// ============================================================================
// 3. Event Listener Cleanup Tests
// ============================================================================

describe('Event Listener Cleanup', () => {
  describe('wsAdvanced() transport', () => {
    it('should not accumulate event listeners on reconnect', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectBackoff: 100,
        heartbeatInterval: 0,
      })

      // First connection
      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      const initialListenerCounts = ws.getAllListenerCounts()
      ws.simulateOpen()
      await connectPromise

      // Disconnect to trigger reconnect
      ws.simulateClose(1006, 'Connection lost')

      // Wait for reconnect
      await vi.advanceTimersByTimeAsync(100)

      // Get new WebSocket
      ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)

      const newListenerCounts = ws.getAllListenerCounts()

      // Listener counts should be the same as initial connection
      // (not accumulated from previous connections)
      expect(newListenerCounts.open).toBe(initialListenerCounts.open)
      expect(newListenerCounts.close).toBe(initialListenerCounts.close)
      expect(newListenerCounts.message).toBe(initialListenerCounts.message)
      expect(newListenerCounts.error).toBe(initialListenerCounts.error)

      transport.close()
      vi.useRealTimers()
    })

    it('should have listeners on WebSocket during connection', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket

      // Should have listeners set up
      expect(ws.getListenerCount('open')).toBeGreaterThan(0)
      expect(ws.getListenerCount('close')).toBeGreaterThan(0)
      expect(ws.getListenerCount('message')).toBeGreaterThan(0)
      expect(ws.getListenerCount('error')).toBeGreaterThan(0)

      ws.simulateOpen()
      await connectPromise

      transport.close()
    })
  })
})

// ============================================================================
// 4. Transport Close Cleanup Tests
// ============================================================================

describe('Transport Close Cleanup', () => {
  describe('http() transport - AbortController cleanup', () => {
    it('should abort in-flight request on timeout', async () => {
      vi.useFakeTimers()

      let abortSignal: AbortSignal | undefined

      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        abortSignal = options.signal
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
      })

      const transport = http('https://api.example.com/rpc', { timeout: 1000 })
      const callPromise = transport.call('test.method', [])
      callPromise.catch(() => {})

      // Allow the fetch call to be made
      await vi.advanceTimersByTimeAsync(0)

      expect(abortSignal).toBeDefined()
      expect(abortSignal!.aborted).toBe(false)

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(1001)

      expect(abortSignal!.aborted).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('ws() transport', () => {
    it('should close WebSocket and reject pending requests on close()', async () => {
      const transport = wsTransport('wss://test.example.com')

      // Trigger connection
      const errors: Error[] = []
      const callPromise = transport.call('test.method', []).catch(e => { errors.push(e) })

      await new Promise(resolve => setTimeout(resolve, 20))

      const mockWs = getLastSocket()
      expect(mockWs).toBeDefined()
      mockWs!.simulateOpen()
      await new Promise(resolve => setTimeout(resolve, 0))

      // Close transport before response
      transport.close?.()

      await callPromise

      // Socket should be closed (readyState === CLOSED)
      expect(mockWs!.readyState).toBe(MockWebSocket.CLOSED)

      // Pending request should have been rejected
      expect(errors.length).toBe(1)
      expect(errors[0].message).toContain('closed')
    })
  })

  describe('wsAdvanced() transport - Full cleanup on close()', () => {
    it('should perform full cleanup on close()', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        heartbeatInterval: 30000,
        requestTimeout: 60000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Start some requests
      const call1 = transport.call('method1', [])
      const call2 = transport.call('method2', [])
      call1.catch(() => {})
      call2.catch(() => {})

      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>
      expect(pendingRequests.size).toBe(2)

      // Close transport
      transport.close()

      // Verify cleanup
      expect((transport as any).ws).toBeNull()
      expect(pendingRequests.size).toBe(0)
      // Timer should be null or undefined (undefined if never set, null if cleared)
      expect((transport as any).heartbeatTimer ?? null).toBeNull()
      expect((transport as any).heartbeatTimeoutTimer ?? null).toBeNull()
      expect((transport as any).reconnectTimer ?? null).toBeNull()
      expect(transport.state).toBe('closed')

      vi.useRealTimers()
    })

    it('should reject all pending requests with appropriate error on close', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
        requestTimeout: 60000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Start requests
      const errors: Error[] = []
      const call1 = transport.call('method1', []).catch(e => { errors.push(e) })
      const call2 = transport.call('method2', []).catch(e => { errors.push(e) })

      // Close transport
      transport.close()

      await Promise.all([call1, call2])

      // All pending requests should have been rejected
      expect(errors.length).toBe(2)
      errors.forEach(error => {
        expect(error.message).toContain('closed')
      })
    })
  })
})

// ============================================================================
// 5. Stress Tests
// ============================================================================

describe('Memory Stress Tests', () => {
  describe('wsAdvanced() transport', () => {
    it('should handle 100 requests with half cancelled/timed out without memory growth', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
        requestTimeout: 1000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>
      const NUM_REQUESTS = 100

      // Start all requests
      const promises: Promise<unknown>[] = []
      for (let i = 0; i < NUM_REQUESTS; i++) {
        const p = transport.call(`method${i}`, [])
        p.catch(() => {}) // Prevent unhandled rejections
        promises.push(p)
      }

      expect(pendingRequests.size).toBe(NUM_REQUESTS)

      // Respond to half the requests
      const sentMessages = ws.sentMessages
      for (let i = 0; i < NUM_REQUESTS / 2; i++) {
        const msg = JSON.parse(sentMessages[i])
        ws.simulateMessage({ id: msg.id, result: `result${i}` })
      }

      // Let responses be processed
      await vi.advanceTimersByTimeAsync(0)

      // Half should be cleared now
      expect(pendingRequests.size).toBe(NUM_REQUESTS / 2)

      // Let the other half timeout
      await vi.advanceTimersByTimeAsync(1001)

      // All should be cleared
      expect(pendingRequests.size).toBe(0)

      // Wait for all promises to settle
      await Promise.allSettled(promises)

      // Final verification - no memory leak
      expect(pendingRequests.size).toBe(0)

      transport.close()
      vi.useRealTimers()
    })

    it('should handle rapid connect/disconnect cycles without leaking', async () => {
      vi.useFakeTimers()

      const NUM_CYCLES = 10

      for (let i = 0; i < NUM_CYCLES; i++) {
        const transport = wsAdvanced('wss://test.example.com', {
          autoReconnect: false,
          heartbeatInterval: 0,
        })

        const connectPromise = transport.connect()
        const ws = (transport as any).ws as MockWebSocket
        ws.simulateOpen()
        await connectPromise

        // Make some calls
        const call1 = transport.call('method', [])
        const call2 = transport.call('method', [])
        call1.catch(() => {})
        call2.catch(() => {})

        // Close immediately
        transport.close()

        const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>
        expect(pendingRequests.size).toBe(0)

        await vi.advanceTimersByTimeAsync(0)
      }

      vi.useRealTimers()
    })

    it('should handle reconnection attempts without accumulating resources', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBackoff: 100,
        heartbeatInterval: 0,
      })

      // Initial connection
      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Simulate multiple disconnects and reconnects
      for (let i = 0; i < 3; i++) {
        // Disconnect
        ws.simulateClose(1006, 'Connection lost')

        // Wait for reconnect
        await vi.advanceTimersByTimeAsync(100 * Math.pow(2, i))

        // Get new WebSocket and open it
        ws = (transport as any).ws as MockWebSocket
        if (ws) {
          ws.simulateOpen()
          await vi.advanceTimersByTimeAsync(0)
        }
      }

      // Verify state is clean
      expect(transport.state).toBe('connected')
      const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>
      expect(pendingRequests.size).toBe(0)

      transport.close()
      vi.useRealTimers()
    })
  })

  describe('WeakRef GC eligibility', () => {
    it('should make closed transport eligible for garbage collection', async () => {
      // Note: This test demonstrates the pattern but can't actually verify GC
      // in a unit test context. It verifies that references are cleared.

      let transport: WebSocketAdvancedTransport | null = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Start a request
      const call = transport.call('method', [])
      call.catch(() => {})

      // Close transport
      transport.close()

      // Verify internal references are cleared
      expect((transport as any).ws).toBeNull()
      expect((transport as any).pendingRequests.size).toBe(0)
      // Timer should be null or undefined (undefined if never set, null if cleared)
      expect((transport as any).heartbeatTimer ?? null).toBeNull()
      expect((transport as any).reconnectTimer ?? null).toBeNull()

      // Clear our reference
      transport = null

      // If we had WeakRef support and could force GC, we'd verify here
      // For now, we just verify the internal cleanup was done
    })
  })
})

// ============================================================================
// 6. Map.size Verification Tests
// ============================================================================

describe('Map.size Verification', () => {
  it('wsAdvanced: pendingRequests.size should be 0 after all operations complete', async () => {
    const transport = wsAdvanced('wss://test.example.com', {
      autoReconnect: false,
      heartbeatInterval: 0,
      requestTimeout: 5000,
    })

    const connectPromise = transport.connect()
    const ws = (transport as any).ws as MockWebSocket
    ws.simulateOpen()
    await connectPromise

    const pendingRequests = (transport as any).pendingRequests as Map<string | number, unknown>

    // Initial state
    expect(pendingRequests.size).toBe(0)

    // Make successful calls
    const call1 = transport.call('method1', [])
    const call2 = transport.call('method2', [])

    expect(pendingRequests.size).toBe(2)

    // Respond to both
    const msg1 = JSON.parse(ws.sentMessages[0])
    const msg2 = JSON.parse(ws.sentMessages[1])
    ws.simulateMessage({ id: msg1.id, result: 'result1' })
    ws.simulateMessage({ id: msg2.id, result: 'result2' })

    await Promise.all([call1, call2])

    expect(pendingRequests.size).toBe(0)

    // Make calls that error
    const call3 = transport.call('method3', [])
    call3.catch(() => {})

    expect(pendingRequests.size).toBe(1)

    const msg3 = JSON.parse(ws.sentMessages[2])
    ws.simulateMessage({ id: msg3.id, error: { code: 'ERROR', message: 'Test error' } })

    await call3.catch(() => {})

    expect(pendingRequests.size).toBe(0)

    transport.close()
    expect(pendingRequests.size).toBe(0)
  })

  it('ws: all requests should complete without leaking (verified via behavior)', async () => {
    // Note: The basic ws() transport uses closure-scoped variables so we can't
    // directly inspect pending.size. We verify cleanup through observable behavior.

    const transport = wsTransport('wss://test.example.com')

    // Start call to trigger connection
    const call = transport.call('method', [])

    await new Promise(resolve => setTimeout(resolve, 50))

    const mockWs = getLastSocket()
    expect(mockWs).toBeDefined()
    mockWs!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    // Respond
    const msg = JSON.parse(mockWs!.sentMessages[0])
    mockWs!.simulateMessage({ id: msg.id, result: 'success' })

    // Promise should resolve
    const result = await call
    expect(result).toBe('success')

    // Making another call after close should work (proves no lingering state issues)
    transport.close?.()
  })
})
