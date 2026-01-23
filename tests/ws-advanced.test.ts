/**
 * Advanced WebSocket Transport Tests
 *
 * Tests for WebSocketAdvancedTransport including:
 * - Connection state machine
 * - Automatic reconnection with exponential backoff
 * - Heartbeat ping-pong
 * - First-message authentication
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WebSocketAdvancedTransport,
  wsAdvanced,
  ConnectionState,
  PROTOCOL_VERSION,
} from '../src/transports/ws-advanced'
import { ConnectionError, ProtocolVersionError, RPCError } from '../src/errors'

// ============================================================================
// Mock WebSocket
// ============================================================================

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

  private triggerEvent(type: string, event: unknown) {
    const handlers = this.listeners.get(type) || []
    for (const handler of handlers) {
      handler(event)
    }
  }
}

// Store original WebSocket
let originalWebSocket: typeof WebSocket

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  ;(globalThis as any).WebSocket = MockWebSocket
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  vi.useRealTimers()
})

// ============================================================================
// Error Classes Tests
// ============================================================================

describe('ConnectionError', () => {
  it('should create error with code and retryable flag', () => {
    const error = new ConnectionError('Test error', 'CONNECTION_FAILED', true)

    expect(error.name).toBe('ConnectionError')
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('CONNECTION_FAILED')
    expect(error.retryable).toBe(true)
  })

  it('should have static factory methods', () => {
    const timeout = ConnectionError.timeout(5000)
    expect(timeout.code).toBe('CONNECTION_TIMEOUT')
    expect(timeout.retryable).toBe(true)

    const authFailed = ConnectionError.authFailed('Invalid token')
    expect(authFailed.code).toBe('AUTH_FAILED')
    expect(authFailed.retryable).toBe(false)

    const connectionLost = ConnectionError.connectionLost('Server went away')
    expect(connectionLost.code).toBe('CONNECTION_LOST')
    expect(connectionLost.retryable).toBe(true)

    const reconnectFailed = ConnectionError.reconnectFailed(5)
    expect(reconnectFailed.code).toBe('RECONNECT_FAILED')
    expect(reconnectFailed.retryable).toBe(false)

    const heartbeatTimeout = ConnectionError.heartbeatTimeout()
    expect(heartbeatTimeout.code).toBe('HEARTBEAT_TIMEOUT')
    expect(heartbeatTimeout.retryable).toBe(true)

    const insecure = ConnectionError.insecureConnection()
    expect(insecure.code).toBe('INSECURE_CONNECTION')
    expect(insecure.retryable).toBe(false)
  })
})

describe('ProtocolVersionError', () => {
  it('should detect major version mismatch', () => {
    const error = new ProtocolVersionError('1.0.0', '2.0.0')

    expect(error.name).toBe('ProtocolVersionError')
    expect(error.clientVersion).toBe('1.0.0')
    expect(error.serverVersion).toBe('2.0.0')
    expect(error.isMajorMismatch).toBe(true)
    expect(error.message).toContain('incompatible')
  })

  it('should detect minor version difference', () => {
    const error = new ProtocolVersionError('1.0.0', '1.2.0')

    expect(error.isMajorMismatch).toBe(false)
    expect(error.message).toContain('Minor version')
  })

  it('should check version compatibility', () => {
    expect(ProtocolVersionError.areCompatible('1.0.0', '1.5.0')).toBe(true)
    expect(ProtocolVersionError.areCompatible('1.0.0', '2.0.0')).toBe(false)
  })
})

describe('RPCError', () => {
  it('should create error with code and data', () => {
    const error = new RPCError('Method not found', 'METHOD_NOT_FOUND', { method: 'test' })

    expect(error.name).toBe('RPCError')
    expect(error.message).toBe('Method not found')
    expect(error.code).toBe('METHOD_NOT_FOUND')
    expect(error.data).toEqual({ method: 'test' })
  })
})

// ============================================================================
// WebSocket Transport Tests
// ============================================================================

describe('WebSocketAdvancedTransport', () => {
  describe('Connection State Machine', () => {
    it('should start in disconnected state', () => {
      const transport = wsAdvanced('wss://test.example.com')

      expect(transport.state).toBe('disconnected')
      expect(transport.isConnected()).toBe(false)
    })

    it('should transition: disconnected -> connecting -> connected', async () => {
      const states: ConnectionState[] = []
      const transport = wsAdvanced('wss://test.example.com', {
        onConnect: () => states.push('connected'),
      })

      const connectPromise = transport.connect()
      states.push(transport.state) // 'connecting'

      // Simulate WebSocket open
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await connectPromise

      expect(states).toEqual(['connecting', 'connected'])
      expect(transport.state).toBe('connected')
      expect(transport.isConnected()).toBe(true)
    })

    it('should transition to closed on explicit close', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      transport.close()

      expect(transport.state).toBe('closed')
      expect(transport.isConnected()).toBe(false)
    })

    it('should convert http(s) to ws(s)', () => {
      const transport1 = wsAdvanced('https://test.example.com')
      expect((transport1 as any).url).toBe('wss://test.example.com')

      const transport2 = wsAdvanced('http://localhost:8080')
      expect((transport2 as any).url).toBe('ws://localhost:8080')
    })
  })

  describe('First-Message Authentication', () => {
    it('should send auth message after connection when token provided', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        token: 'test-token',
        allowInsecureAuth: true, // Allow for testing
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      // Wait for auth message to be sent
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(ws.sentMessages.length).toBeGreaterThan(0)
      const authMessage = JSON.parse(ws.sentMessages[0])
      expect(authMessage.type).toBe('auth')
      expect(authMessage.token).toBe('test-token')

      // Simulate auth success
      ws.simulateMessage({ type: 'auth_result', success: true })

      await connectPromise
      expect(transport.state).toBe('connected')
    })

    it('should support async token provider', async () => {
      const tokenProvider = vi.fn(async () => 'async-token')

      const transport = wsAdvanced('wss://test.example.com', {
        token: tokenProvider,
        allowInsecureAuth: true,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(tokenProvider).toHaveBeenCalled()

      const authMessage = JSON.parse(ws.sentMessages[0])
      expect(authMessage.token).toBe('async-token')

      ws.simulateMessage({ type: 'auth_result', success: true })
      await connectPromise
    })

    it('should reject on auth failure', async () => {
      const transport = wsAdvanced('wss://test.example.com', {
        token: 'bad-token',
        allowInsecureAuth: true,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await new Promise(resolve => setTimeout(resolve, 0))

      ws.simulateMessage({
        type: 'auth_result',
        success: false,
        error: { message: 'Invalid token' },
      })

      await expect(connectPromise).rejects.toThrow('Invalid token')
    })

    it('should block insecure auth by default', async () => {
      const transport = wsAdvanced('ws://insecure.example.com', {
        token: 'my-token',
        // allowInsecureAuth: false (default)
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await expect(connectPromise).rejects.toThrow('SECURITY ERROR')
    })

    it('should warn but allow insecure auth when explicitly enabled', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const transport = wsAdvanced('ws://localhost:8080', {
        token: 'test-token',
        allowInsecureAuth: true,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await new Promise(resolve => setTimeout(resolve, 0))

      ws.simulateMessage({ type: 'auth_result', success: true })
      await connectPromise

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('insecure ws://')
      )

      warnSpy.mockRestore()
    })
  })

  describe('RPC Calls', () => {
    it('should send RPC call and receive response', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const callPromise = transport.call('test.method', [{ arg: 'value' }])

      // Check sent message
      const sentMessage = JSON.parse(ws.sentMessages[0])
      expect(sentMessage.method).toBe('do')
      expect(sentMessage.path).toBe('test.method')
      expect(sentMessage.args).toEqual([{ arg: 'value' }])

      // Simulate response
      ws.simulateMessage({
        id: sentMessage.id,
        result: { success: true },
      })

      const result = await callPromise
      expect(result).toEqual({ success: true })
    })

    it('should handle RPC error response', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const callPromise = transport.call('test.method', [])

      const sentMessage = JSON.parse(ws.sentMessages[0])
      ws.simulateMessage({
        id: sentMessage.id,
        error: {
          code: 'METHOD_NOT_FOUND',
          message: 'Method does not exist',
        },
      })

      await expect(callPromise).rejects.toThrow('Method does not exist')
    })

    it('should auto-connect when calling if disconnected', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      expect(transport.state).toBe('disconnected')

      // Start call (should trigger connect)
      const callPromise = transport.call('test.method', [])

      // Simulate connection
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      // Wait for connection to complete
      await new Promise(resolve => setTimeout(resolve, 0))

      // Simulate response
      const sentMessage = JSON.parse(ws.sentMessages[0])
      ws.simulateMessage({
        id: sentMessage.id,
        result: 'ok',
      })

      await callPromise
      expect(transport.state).toBe('connected')
    })

    it('should reject pending requests on disconnect', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      const callPromise = transport.call('test.method', [])

      // Disconnect before response
      ws.simulateClose(1006, 'Connection lost')

      await expect(callPromise).rejects.toThrow('Connection lost')
    })
  })

  describe('Automatic Reconnection', () => {
    it('should attempt reconnection on unexpected disconnect', async () => {
      vi.useFakeTimers()

      const onReconnecting = vi.fn()
      const onConnect = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 3,
        reconnectBackoff: 1000,
        onReconnecting,
        onConnect,
      })

      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      expect(onConnect).toHaveBeenCalledTimes(1)

      // Simulate unexpected disconnect
      ws.simulateClose(1006, 'Abnormal closure')

      expect(transport.state).toBe('reconnecting')
      expect(onReconnecting).toHaveBeenCalledWith(1, 3)

      // Advance timer for first reconnect attempt
      await vi.advanceTimersByTimeAsync(1000)

      // Get new WebSocket instance and simulate success
      ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      // Allow for state transitions
      await vi.advanceTimersByTimeAsync(0)

      expect(transport.state).toBe('connected')
      expect(onConnect).toHaveBeenCalledTimes(2)
    })

    it('should use exponential backoff', async () => {
      vi.useFakeTimers()

      const reconnectCalls: number[] = []
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 5,
        reconnectBackoff: 1000,
        backoffMultiplier: 2,
        maxReconnectBackoff: 30000,
        onReconnecting: (attempt) => reconnectCalls.push(attempt),
      })

      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // First disconnect - triggers first reconnect attempt
      ws.simulateClose(1006, 'Disconnect')
      expect(reconnectCalls).toContain(1)

      // First reconnect attempt after 1000ms (1000 * 2^0)
      await vi.advanceTimersByTimeAsync(1000)
      ws = (transport as any).ws as MockWebSocket
      ws.simulateClose(1006, 'Failed again')

      // Wait for state transition
      await vi.advanceTimersByTimeAsync(0)
      expect(reconnectCalls).toContain(2)

      // Second attempt at 2000ms (1000 * 2^1)
      await vi.advanceTimersByTimeAsync(2000)
      ws = (transport as any).ws as MockWebSocket
      ws.simulateClose(1006, 'Failed again')

      await vi.advanceTimersByTimeAsync(0)
      expect(reconnectCalls).toContain(3)

      // Third attempt at 4000ms (1000 * 2^2)
      await vi.advanceTimersByTimeAsync(4000)
      ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()

      await vi.advanceTimersByTimeAsync(0)
      expect(transport.state).toBe('connected')

      // Verify exponential backoff was used (we made it through 3 attempts)
      expect(reconnectCalls.length).toBeGreaterThanOrEqual(3)
    })

    it('should not exceed maxReconnectBackoff', async () => {
      vi.useFakeTimers()

      const onReconnecting = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 10,
        reconnectBackoff: 1000,
        backoffMultiplier: 2,
        maxReconnectBackoff: 5000, // Max 5 seconds
        onReconnecting,
      })

      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Disconnect
      ws.simulateClose(1006, 'Disconnect')

      // Simulate several reconnect attempts
      // Backoffs: 1000, 2000, 4000, 5000 (capped), 5000 (capped)
      const expectedBackoffs = [1000, 2000, 4000, 5000, 5000]

      for (let i = 0; i < expectedBackoffs.length; i++) {
        await vi.advanceTimersByTimeAsync(expectedBackoffs[i])
        ws = (transport as any).ws as MockWebSocket
        if (i < expectedBackoffs.length - 1) {
          ws.simulateClose(1006, 'Disconnect')
        }
      }

      ws.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(transport.state).toBe('connected')
    })

    it('should stop reconnecting after max attempts', async () => {
      vi.useFakeTimers()

      const onError = vi.fn()
      const reconnectCalls: number[] = []
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectBackoff: 1000,
        onError,
        onReconnecting: (attempt) => reconnectCalls.push(attempt),
      })

      const connectPromise = transport.connect()
      let ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // First disconnect - triggers attempt 1
      ws.simulateClose(1006, 'Disconnect')
      expect(reconnectCalls).toContain(1)

      // First reconnect attempt
      await vi.advanceTimersByTimeAsync(1000)
      ws = (transport as any).ws as MockWebSocket
      ws.simulateClose(1006, 'Failed')

      // Wait for second attempt to be scheduled
      await vi.advanceTimersByTimeAsync(0)
      expect(reconnectCalls).toContain(2)

      // Second reconnect attempt
      await vi.advanceTimersByTimeAsync(2000)
      ws = (transport as any).ws as MockWebSocket
      ws.simulateClose(1006, 'Failed again')

      // Allow error handler to be called
      await vi.advanceTimersByTimeAsync(0)

      // Should be closed now
      expect(transport.state).toBe('closed')
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'RECONNECT_FAILED' })
      )
    })

    it('should not reconnect when explicitly closed', async () => {
      const onReconnecting = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: true,
        onReconnecting,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      transport.close()

      expect(transport.state).toBe('closed')
      expect(onReconnecting).not.toHaveBeenCalled()
    })

    it('should not reconnect when autoReconnect is disabled', async () => {
      const onReconnecting = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        autoReconnect: false,
        onReconnecting,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      ws.simulateClose(1006, 'Disconnect')

      expect(transport.state).toBe('disconnected')
      expect(onReconnecting).not.toHaveBeenCalled()
    })
  })

  describe('Heartbeat', () => {
    it('should send ping messages at configured interval', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        heartbeatInterval: 30000,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // No pings yet
      expect(ws.sentMessages.length).toBe(0)

      // Advance time to first heartbeat
      await vi.advanceTimersByTimeAsync(30000)

      expect(ws.sentMessages.length).toBe(1)
      const pingMessage = JSON.parse(ws.sentMessages[0])
      expect(pingMessage.type).toBe('ping')

      // Simulate pong response
      ws.simulateMessage({ type: 'pong' })

      // Advance to next heartbeat
      await vi.advanceTimersByTimeAsync(30000)

      expect(ws.sentMessages.length).toBe(2)
    })

    it('should close connection on heartbeat timeout', async () => {
      vi.useFakeTimers()

      const onError = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        heartbeatInterval: 30000,
        heartbeatTimeout: 5000,
        onError,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Advance to first heartbeat
      await vi.advanceTimersByTimeAsync(30000)

      // Don't respond with pong - advance past timeout
      await vi.advanceTimersByTimeAsync(5000)

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'HEARTBEAT_TIMEOUT' })
      )
    })

    it('should clear heartbeat timeout on pong', async () => {
      vi.useFakeTimers()

      const onError = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        heartbeatInterval: 30000,
        heartbeatTimeout: 5000,
        onError,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Advance to first heartbeat
      await vi.advanceTimersByTimeAsync(30000)

      // Respond with pong before timeout
      await vi.advanceTimersByTimeAsync(2000)
      ws.simulateMessage({ type: 'pong' })

      // Advance past what would have been timeout
      await vi.advanceTimersByTimeAsync(5000)

      // Should not have errored
      expect(onError).not.toHaveBeenCalled()
    })

    it('should stop heartbeat on disconnect', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        heartbeatInterval: 30000,
        autoReconnect: false,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      transport.close()

      // Advance time - no pings should be sent
      await vi.advanceTimersByTimeAsync(60000)

      expect(ws.sentMessages.length).toBe(0)
    })

    it('should disable heartbeat when interval is 0', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        heartbeatInterval: 0,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Advance time
      await vi.advanceTimersByTimeAsync(60000)

      // No heartbeat messages
      expect(ws.sentMessages.length).toBe(0)
    })
  })

  describe('Event Handlers', () => {
    it('should call onConnect when connected', async () => {
      const onConnect = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', { onConnect })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      expect(onConnect).toHaveBeenCalled()
    })

    it('should call onDisconnect when disconnected', async () => {
      const onDisconnect = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        onDisconnect,
        autoReconnect: false,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      ws.simulateClose(1006, 'Test disconnect')

      expect(onDisconnect).toHaveBeenCalledWith('Test disconnect', 1006)
    })

    it('should call onError for parse errors', async () => {
      const onError = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', { onError })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Directly trigger message event with invalid JSON
      const event = { data: 'not valid json {' }
      const listeners = (ws as any).listeners.get('message') || []
      for (const handler of listeners) {
        handler(event)
      }

      expect(onError).toHaveBeenCalled()
    })

    it('should call onMessage for received messages', async () => {
      const onMessage = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', { onMessage })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      ws.simulateMessage({ type: 'custom', data: 'test' })

      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'custom', data: 'test' })
      )
    })
  })

  describe('Protocol Version', () => {
    it('should expose client and server versions', async () => {
      const transport = wsAdvanced('wss://test.example.com')

      expect(transport.clientVersion).toBe(PROTOCOL_VERSION)
      expect(transport.serverVersion).toBeNull()

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Send message with version
      ws.simulateMessage({ type: 'info', version: '1.2.3' })

      expect(transport.serverVersion).toBe('1.2.3')
    })

    it('should warn on version mismatch by default', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const transport = wsAdvanced('wss://test.example.com', {
        versionMismatchBehavior: 'warn',
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Send message with incompatible version
      ws.simulateMessage({ type: 'info', version: '2.0.0' })

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Protocol version mismatch')
      )

      warnSpy.mockRestore()
    })

    it('should close on version mismatch when behavior is error', async () => {
      const onError = vi.fn()
      const transport = wsAdvanced('wss://test.example.com', {
        versionMismatchBehavior: 'error',
        onError,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Send message with incompatible version
      ws.simulateMessage({ type: 'info', version: '2.0.0' })

      expect(onError).toHaveBeenCalledWith(
        expect.any(ProtocolVersionError)
      )
      expect(transport.state).toBe('closed')
    })

    it('should ignore version mismatch when behavior is ignore', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const onError = vi.fn()

      const transport = wsAdvanced('wss://test.example.com', {
        versionMismatchBehavior: 'ignore',
        onError,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Send message with incompatible version
      ws.simulateMessage({ type: 'info', version: '2.0.0' })

      expect(warnSpy).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(transport.state).toBe('connected')

      warnSpy.mockRestore()
    })
  })

  describe('Connection Timeout', () => {
    it('should timeout connection if WebSocket does not open', async () => {
      vi.useFakeTimers()

      const transport = wsAdvanced('wss://test.example.com', {
        connectTimeout: 5000,
      })

      // Catch the promise to prevent unhandled rejection warnings
      let caughtError: Error | null = null
      const connectPromise = transport.connect().catch(err => {
        caughtError = err
      })

      // Advance past timeout - the timeout handler will close the websocket
      await vi.advanceTimersByTimeAsync(5001)

      // Wait for the promise to settle
      await connectPromise

      // Should have caught a connection error
      expect(caughtError).toBeInstanceOf(ConnectionError)
    })
  })

  describe('Factory Function', () => {
    it('should create transport with wsAdvanced function', () => {
      const transport = wsAdvanced('wss://test.example.com', {
        token: 'test-token',
        autoReconnect: false,
      })

      expect(transport).toBeInstanceOf(WebSocketAdvancedTransport)
      expect(transport.state).toBe('disconnected')
    })
  })

  describe('Debug Logging', () => {
    it('should log when debug is enabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const transport = wsAdvanced('wss://test.example.com', {
        debug: true,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Check that at least one log call contains our prefix
      expect(logSpy).toHaveBeenCalled()
      const calls = logSpy.mock.calls
      const hasOurLog = calls.some(
        call => call[0] === '[WebSocketAdvancedTransport]'
      )
      expect(hasOurLog).toBe(true)

      logSpy.mockRestore()
    })

    it('should not log when debug is disabled', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const transport = wsAdvanced('wss://test.example.com', {
        debug: false,
      })

      const connectPromise = transport.connect()
      const ws = (transport as any).ws as MockWebSocket
      ws.simulateOpen()
      await connectPromise

      // Check that no log calls contain our prefix
      const calls = logSpy.mock.calls
      const hasOurLog = calls.some(
        call => call[0] === '[WebSocketAdvancedTransport]'
      )
      expect(hasOurLog).toBe(false)

      logSpy.mockRestore()
    })
  })
})
