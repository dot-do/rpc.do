/**
 * ReconnectingWebSocketTransport Tests
 *
 * Comprehensive tests for the reconnecting WebSocket transport including:
 * - Connection lifecycle (connect, disconnect, close)
 * - Reconnection with exponential backoff
 * - Heartbeat ping/pong
 * - First-message authentication
 * - Message queuing during disconnection
 * - Error handling
 * - Auth provider integration
 * - State transitions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ReconnectingWebSocketTransport,
  reconnectingWs,
  type ConnectionState,
} from '../src/transports/reconnecting-ws'
import { ConnectionError } from '../src/errors'
import {
  MockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket,
  type MockWebSocketGlobal,
} from './fixtures'

// Store mock state
let mockState: MockWebSocketGlobal

// Convenience accessor for last created WebSocket
const getLastWebSocket = () => mockState.lastCreatedWebSocket

beforeEach(() => {
  mockState = installMockWebSocket()
  vi.useFakeTimers()
})

afterEach(() => {
  restoreMockWebSocket(mockState)
  vi.useRealTimers()
})

// ============================================================================
// Connection Lifecycle Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Connection Lifecycle', () => {
  it('should start in disconnected state', () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')
    expect(transport.getState()).toBe('disconnected')
    expect(transport.isConnected()).toBe(false)
  })

  it('should connect when send is called', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    const sendPromise = transport.send('test message')

    // Wait for WebSocket to be created
    await vi.advanceTimersByTimeAsync(0)

    expect(getLastWebSocket()).not.toBeNull()
    expect(transport.getState()).toBe('connecting')

    // Simulate connection open
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
    expect(transport.isConnected()).toBe(true)

    await sendPromise
  })

  it('should convert http:// to ws://', async () => {
    const transport = new ReconnectingWebSocketTransport('http://localhost:8080/rpc')

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    expect(getLastWebSocket()).not.toBeNull()
    expect(getLastWebSocket()!.url).toBe('ws://localhost:8080/rpc')

    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise
  })

  it('should convert https:// to wss://', async () => {
    const transport = new ReconnectingWebSocketTransport('https://secure.example.com/rpc')

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    expect(getLastWebSocket()).not.toBeNull()
    expect(getLastWebSocket()!.url).toBe('wss://secure.example.com/rpc')

    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise
  })

  it('should close the transport', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Close
    transport.close()

    expect(transport.getState()).toBe('closed')
    expect(transport.isConnected()).toBe(false)
  })

  it('should reject receive after close', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    transport.close()

    await expect(transport.receive()).rejects.toThrow(ConnectionError)
    await expect(transport.receive()).rejects.toThrow('Transport is closed')
  })

  it('should reject pending receives on close', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Start a receive that will be pending
    const receivePromise = transport.receive()

    // Close the transport
    transport.close()

    await expect(receivePromise).rejects.toThrow(ConnectionError)
  })

  it('should handle close called multiple times', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Multiple closes should not throw
    transport.close()
    transport.close()
    transport.close()

    expect(transport.getState()).toBe('closed')
  })

  it('should call onConnect callback when connected', async () => {
    const onConnect = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onConnect,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('should call onDisconnect callback when disconnected', async () => {
    const onDisconnect = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onDisconnect,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Simulate close
    getLastWebSocket()!.simulateClose(1000, 'Normal closure')

    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith('Normal closure')
  })

  it('should abort the transport', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Start a pending receive
    const receivePromise = transport.receive()

    // Abort
    transport.abort(new Error('Test abort'))

    expect(transport.getState()).toBe('closed')
    await expect(receivePromise).rejects.toThrow()
  })

  it('should abort with string reason', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    transport.abort('String abort reason')

    expect(transport.getState()).toBe('closed')
  })
})

// ============================================================================
// Reconnection with Exponential Backoff Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Reconnection with Exponential Backoff', () => {
  it('should reconnect automatically on disconnect', async () => {
    const onReconnecting = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
      reconnectBackoff: 100,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    const firstSocket = getLastWebSocket()
    firstSocket!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(transport.getState()).toBe('connected')

    // Simulate unexpected close
    firstSocket!.simulateClose(1006, 'Abnormal closure')

    expect(transport.getState()).toBe('reconnecting')
    expect(onReconnecting).toHaveBeenCalledWith(1, Infinity)

    // Advance past reconnect delay
    await vi.advanceTimersByTimeAsync(100)

    // New socket should be created
    expect(getLastWebSocket()).not.toBe(firstSocket)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
  })

  it('should use exponential backoff for reconnection attempts', async () => {
    const onReconnecting = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
      reconnectBackoff: 100,
      backoffMultiplier: 2,
      maxReconnectBackoff: 1000,
    })

    // Establish and disconnect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    // First attempt at 100ms
    expect(onReconnecting).toHaveBeenCalledWith(1, Infinity)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0) // Allow promise to resolve

    // Fail first reconnect - need to trigger close before expecting second call
    getLastWebSocket()!.simulateClose(1006, 'Failed')
    await vi.advanceTimersByTimeAsync(0) // Allow scheduleReconnect to run

    // Second attempt at 200ms (100 * 2)
    expect(onReconnecting).toHaveBeenCalledWith(2, Infinity)
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(0)

    // Fail second reconnect
    getLastWebSocket()!.simulateClose(1006, 'Failed')
    await vi.advanceTimersByTimeAsync(0)

    // Third attempt at 400ms (200 * 2)
    expect(onReconnecting).toHaveBeenCalledWith(3, Infinity)
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(0)

    // Finally succeed
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
  })

  it('should cap backoff at maxReconnectBackoff', async () => {
    const onReconnecting = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
      reconnectBackoff: 500,
      backoffMultiplier: 10,
      maxReconnectBackoff: 1000,
    })

    // Establish and disconnect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    // First attempt at 500ms
    await vi.advanceTimersByTimeAsync(500)
    getLastWebSocket()!.simulateClose(1006, 'Failed')

    // Second attempt should be capped at 1000ms (not 5000ms = 500 * 10)
    // Need to wait 1000ms, not 5000ms
    await vi.advanceTimersByTimeAsync(1000)

    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
  })

  it('should stop reconnecting after maxReconnectAttempts', async () => {
    const onReconnecting = vi.fn()
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
      onError,
      maxReconnectAttempts: 2,
      reconnectBackoff: 100,
    })

    // Establish and disconnect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Start a pending receive to catch the reconnect failure - add catch to prevent unhandled warning
    const receivePromise = transport.receive().catch((e) => e)

    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    // First attempt
    expect(onReconnecting).toHaveBeenCalledWith(1, 2)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateClose(1006, 'Failed')
    await vi.advanceTimersByTimeAsync(0)

    // Second attempt
    expect(onReconnecting).toHaveBeenCalledWith(2, 2)
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateClose(1006, 'Failed again')
    await vi.advanceTimersByTimeAsync(0)

    // Should stop trying
    expect(onReconnecting).toHaveBeenCalledTimes(2)

    // Pending receives should be rejected
    const error = await receivePromise
    expect(error).toBeInstanceOf(ConnectionError)
    expect(error.message).toContain('Failed to reconnect after 2 attempts')
  })

  it('should reset backoff on successful reconnection', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 100,
      backoffMultiplier: 2,
    })

    // First connection cycle
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Disconnect and fail first reconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')
    await vi.advanceTimersByTimeAsync(100) // First attempt at 100ms
    getLastWebSocket()!.simulateClose(1006, 'Failed')
    await vi.advanceTimersByTimeAsync(200) // Second attempt at 200ms
    getLastWebSocket()!.simulateOpen() // Success
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')

    // Disconnect again - backoff should be reset to 100ms
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')
    await vi.advanceTimersByTimeAsync(100) // Should be back to 100ms, not 400ms
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
  })

  it('should not reconnect when autoReconnect is false', async () => {
    const onReconnecting = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Disconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    expect(transport.getState()).toBe('disconnected')
    expect(onReconnecting).not.toHaveBeenCalled()

    // Advance time - no reconnection should happen
    await vi.advanceTimersByTimeAsync(10000)
    expect(onReconnecting).not.toHaveBeenCalled()
  })

  it('should not reconnect when explicitly closed', async () => {
    const onReconnecting = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onReconnecting,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Explicit close
    transport.close()

    expect(transport.getState()).toBe('closed')
    expect(onReconnecting).not.toHaveBeenCalled()

    // Advance time - no reconnection should happen
    await vi.advanceTimersByTimeAsync(10000)
    expect(onReconnecting).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Heartbeat Ping/Pong Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Heartbeat Ping/Pong', () => {
  it('should send heartbeat ping at configured interval', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 1000,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const initialMessages = socket.sentMessages.length

    // Advance past heartbeat interval
    await vi.advanceTimersByTimeAsync(1000)

    // Should have sent a ping
    expect(socket.sentMessages.length).toBe(initialMessages + 1)
    const pingMessage = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1])
    expect(pingMessage.type).toBe('ping')
    expect(typeof pingMessage.t).toBe('number')
  })

  it('should handle pong response', async () => {
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 1000,
      heartbeatTimeout: 500,
      onError,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Send ping
    await vi.advanceTimersByTimeAsync(1000)

    // Respond with pong
    socket.simulateMessage({ type: 'pong' })

    // Another heartbeat interval
    await vi.advanceTimersByTimeAsync(1000)

    // Should still be connected (no error)
    expect(transport.isConnected()).toBe(true)
    expect(onError).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'HEARTBEAT_TIMEOUT' }))
  })

  it('should close connection on heartbeat timeout', async () => {
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 1000,
      heartbeatTimeout: 500,
      onError,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Send first ping
    await vi.advanceTimersByTimeAsync(1000)
    // Check that at least one sent message is a ping (filter non-JSON messages)
    const pingMessages = socket.sentMessages.filter(m => {
      try {
        return JSON.parse(m).type === 'ping'
      } catch {
        return false
      }
    })
    expect(pingMessages.length).toBeGreaterThan(0)

    // No pong response - advance past timeout + another heartbeat
    await vi.advanceTimersByTimeAsync(1500) // Past timeout

    // Should have triggered heartbeat timeout error
    expect(onError).toHaveBeenCalled()
    const errorCall = onError.mock.calls.find(
      call => call[0] instanceof ConnectionError && call[0].code === 'HEARTBEAT_TIMEOUT'
    )
    expect(errorCall).toBeTruthy()
  })

  it('should stop heartbeat when closed', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 1000,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const initialMessages = socket.sentMessages.length

    // Close transport
    transport.close()

    // Advance past heartbeat interval
    await vi.advanceTimersByTimeAsync(2000)

    // No additional messages should be sent (heartbeat stopped)
    expect(socket.sentMessages.length).toBe(initialMessages)
  })

  it('should disable heartbeat when interval is 0', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 0,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const initialMessages = socket.sentMessages.length

    // Advance significant time
    await vi.advanceTimersByTimeAsync(60000)

    // No heartbeat messages should be sent
    expect(socket.sentMessages.length).toBe(initialMessages)
  })
})

// ============================================================================
// First-Message Authentication Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - First-Message Authentication', () => {
  it('should send auth token as first message when auth provider is configured', async () => {
    const authProvider = vi.fn().mockResolvedValue('test-token-123')
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: authProvider,
    })

    const sendPromise = transport.send('test message')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    expect(authProvider).toHaveBeenCalled()
    expect(socket.sentMessages.length).toBeGreaterThanOrEqual(1)

    // First message should be auth
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.type).toBe('auth')
    expect(authMessage.token).toBe('test-token-123')
  })

  it('should send auth token with sync auth provider', async () => {
    const authProvider = vi.fn().mockReturnValue('sync-token')
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: authProvider,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('sync-token')
  })

  it('should not send auth when provider returns null', async () => {
    const authProvider = vi.fn().mockResolvedValue(null)
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: authProvider,
    })

    const sendPromise = transport.send('test message')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // No auth message should be sent
    const authMessages = socket.sentMessages.filter(m => {
      try {
        return JSON.parse(m).type === 'auth'
      } catch {
        return false
      }
    })
    expect(authMessages.length).toBe(0)
  })

  it('should block auth over insecure ws:// by default', async () => {
    const authProvider = vi.fn().mockResolvedValue('secret-token')
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('ws://insecure.example.com/rpc', {
      auth: authProvider,
      onError,
    })

    // Add catch immediately to handle the rejection
    const sendPromise = transport.send('test').catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)

    // Simulate open - auth should fail
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const error = await sendPromise
    expect(error).toBeInstanceOf(ConnectionError)
    expect((error as ConnectionError).message).toContain('SECURITY ERROR')
  })

  it('should allow auth over ws:// when allowInsecureAuth is true', async () => {
    const authProvider = vi.fn().mockResolvedValue('secret-token')
    const transport = new ReconnectingWebSocketTransport('ws://localhost:8080/rpc', {
      auth: authProvider,
      allowInsecureAuth: true,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('secret-token')
  })

  it('should re-send auth on reconnection', async () => {
    const authProvider = vi.fn().mockResolvedValue('auth-token')
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: authProvider,
      reconnectBackoff: 100,
    })

    // First connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(authProvider).toHaveBeenCalledTimes(1)

    // Disconnect and reconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')
    await vi.advanceTimersByTimeAsync(100)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Auth should be called again
    expect(authProvider).toHaveBeenCalledTimes(2)

    // New socket should have auth message
    const socket = getLastWebSocket()!
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.type).toBe('auth')
  })
})

// ============================================================================
// Message Queuing During Disconnection Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Message Queuing', () => {
  it('should queue messages while connecting and send after connected', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Start sending while still connecting - don't await yet
    const send1Promise = transport.send('message1')
    const send2Promise = transport.send('message2')

    await vi.advanceTimersByTimeAsync(0)

    // WebSocket created but not open yet
    expect(transport.getState()).toBe('connecting')

    // Open connection
    getLastWebSocket()!.simulateOpen()

    // Need to advance timers to allow internal polling to complete
    // The ensureConnected() uses setTimeout for polling
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(50)
    }

    await Promise.all([send1Promise, send2Promise])

    const socket = getLastWebSocket()!
    expect(socket.sentMessages).toContain('message1')
    expect(socket.sentMessages).toContain('message2')
  })

  it('should queue messages during reconnection', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 100,
    })

    // Establish connection
    const initialSend = transport.send('initial')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await initialSend

    // Disconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')
    expect(transport.getState()).toBe('reconnecting')

    // Queue messages while reconnecting - don't await yet
    const queuedSend = transport.send('queued-message')

    // Reconnect
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()

    // Advance timers to allow internal polling
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(50)
    }

    await queuedSend

    // Message should be sent after reconnection
    const socket = getLastWebSocket()!
    expect(socket.sentMessages).toContain('queued-message')
  })

  it('should receive messages in queue order', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Simulate multiple messages arriving
    socket.simulateRawMessage('message1')
    socket.simulateRawMessage('message2')
    socket.simulateRawMessage('message3')

    // Receive should return in order
    const msg1 = await transport.receive()
    const msg2 = await transport.receive()
    const msg3 = await transport.receive()

    expect(msg1).toBe('message1')
    expect(msg2).toBe('message2')
    expect(msg3).toBe('message3')
  })

  it('should resolve pending receive when message arrives', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Start waiting for message before it arrives
    const receivePromise = transport.receive()

    // Message arrives
    socket.simulateRawMessage('delayed-message')

    const msg = await receivePromise
    expect(msg).toBe('delayed-message')
  })

  it('should clear send queue on close', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Close and verify queues are cleared
    transport.close()

    // New send should fail because transport is closed
    await expect(transport.send('after-close')).rejects.toThrow('Transport is closed')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Error Handling', () => {
  it('should call onError on WebSocket error', async () => {
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onError,
      autoReconnect: false,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    // Simulate error before open
    getLastWebSocket()!.simulateError(new Event('error'))

    await expect(sendPromise).rejects.toThrow(ConnectionError)
    expect(onError).toHaveBeenCalled()
  })

  it('should handle connection failure', async () => {
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onError,
      autoReconnect: false,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    // Close before open
    getLastWebSocket()!.simulateClose(1006, 'Connection failed')

    await expect(sendPromise).rejects.toThrow(ConnectionError)
    await expect(sendPromise).rejects.toThrow('WebSocket closed: 1006')
  })

  it('should handle auth provider error', async () => {
    const authProvider = vi.fn().mockRejectedValue(new Error('Auth failed'))
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: authProvider,
    })

    // Add catch immediately to handle the rejection
    const sendPromise = transport.send('test').catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const error = await sendPromise
    expect((error as Error).message).toBe('Auth failed')
  })

  it('should handle connection error during established connection', async () => {
    const onError = vi.fn()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      onError,
      autoReconnect: false,
    })

    // Establish connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Simulate error on established connection
    socket.simulateError(new Event('error'))

    expect(onError).toHaveBeenCalled()
    const error = onError.mock.calls[0][0]
    expect(error).toBeInstanceOf(ConnectionError)
  })

  it('should create reconnect failed error with attempt count', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      maxReconnectAttempts: 1,
      reconnectBackoff: 100,
    })

    // Establish and disconnect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const receivePromise = transport.receive()

    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    // First (and only) attempt
    await vi.advanceTimersByTimeAsync(100)
    getLastWebSocket()!.simulateClose(1006, 'Failed')

    await expect(receivePromise).rejects.toThrow('Failed to reconnect after 1 attempts')
  })

  it('should reject send when transport is closed', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    transport.close()

    await expect(transport.send('test')).rejects.toThrow(ConnectionError)
    await expect(transport.send('test')).rejects.toThrow('Transport is closed')
  })
})

// ============================================================================
// Auth Provider Integration Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Auth Provider Integration', () => {
  it('should work with mock oauthProvider pattern', async () => {
    // Simulate oauth.do style provider
    const mockOAuthProvider = () => {
      let token: string | null = 'initial-token'
      return async () => token
    }

    const auth = mockOAuthProvider()
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('initial-token')
  })

  it('should work with staticAuth pattern', async () => {
    const staticAuth = (token: string) => () => token

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: staticAuth('static-secret-key'),
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!
    const authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('static-secret-key')
  })

  it('should work with environment variable pattern', async () => {
    const envAuth = () => () => process.env.TEST_TOKEN || null
    process.env.TEST_TOKEN = 'env-token'

    try {
      const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
        auth: envAuth(),
      })

      const sendPromise = transport.send('test')
      await vi.advanceTimersByTimeAsync(0)
      getLastWebSocket()!.simulateOpen()
      await vi.advanceTimersByTimeAsync(0)
      await sendPromise

      const socket = getLastWebSocket()!
      const authMessage = JSON.parse(socket.sentMessages[0])
      expect(authMessage.token).toBe('env-token')
    } finally {
      delete process.env.TEST_TOKEN
    }
  })

  it('should work with token refresh pattern', async () => {
    let tokenVersion = 1
    const refreshableAuth = async () => `token-v${tokenVersion++}`

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: refreshableAuth,
      reconnectBackoff: 100,
    })

    // First connection
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    let socket = getLastWebSocket()!
    let authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('token-v1')

    // Reconnection should get new token
    socket.simulateClose(1006, 'Abnormal closure')
    await vi.advanceTimersByTimeAsync(100)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    socket = getLastWebSocket()!
    authMessage = JSON.parse(socket.sentMessages[0])
    expect(authMessage.token).toBe('token-v2')
  })

  it('should handle auth provider that throws', async () => {
    const failingAuth = async () => {
      throw new Error('Token service unavailable')
    }

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: failingAuth,
    })

    // Add catch immediately to handle the rejection
    const sendPromise = transport.send('test').catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const error = await sendPromise
    expect((error as Error).message).toBe('Token service unavailable')
  })

  it('should handle auth provider returning undefined', async () => {
    const undefinedAuth = () => undefined

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      auth: undefinedAuth,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // No auth message should be sent
    const authMessages = socket.sentMessages.filter(m => {
      try {
        return JSON.parse(m).type === 'auth'
      } catch {
        return false
      }
    })
    expect(authMessages.length).toBe(0)
  })
})

// ============================================================================
// State Transition Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - State Transitions', () => {
  it('should transition: disconnected -> connecting -> connected', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    expect(transport.getState()).toBe('disconnected')

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connecting')

    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(transport.getState()).toBe('connected')
  })

  it('should transition: connected -> reconnecting -> connected', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 100,
    })

    // Get to connected
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(transport.getState()).toBe('connected')

    // Disconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    expect(transport.getState()).toBe('reconnecting')

    // Reconnect
    await vi.advanceTimersByTimeAsync(100)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connected')
  })

  it('should transition: connected -> closed (explicit close)', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Get to connected
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(transport.getState()).toBe('connected')

    transport.close()

    expect(transport.getState()).toBe('closed')
  })

  it('should transition: reconnecting -> closed (explicit close)', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 100,
    })

    // Get to connected
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Disconnect
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    expect(transport.getState()).toBe('reconnecting')

    // Close during reconnection
    transport.close()

    expect(transport.getState()).toBe('closed')

    // Advance time - no reconnection should happen
    await vi.advanceTimersByTimeAsync(1000)
    expect(transport.getState()).toBe('closed')
  })

  it('should transition: disconnected -> closed', () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    expect(transport.getState()).toBe('disconnected')

    transport.close()

    expect(transport.getState()).toBe('closed')
  })

  it('should track isConnected() correctly through transitions', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 100,
    })

    expect(transport.isConnected()).toBe(false)

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.isConnected()).toBe(false) // Still connecting

    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(transport.isConnected()).toBe(true)

    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    expect(transport.isConnected()).toBe(false)

    await vi.advanceTimersByTimeAsync(100)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.isConnected()).toBe(true)

    transport.close()

    expect(transport.isConnected()).toBe(false)
  })
})

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('reconnectingWs() Factory Function', () => {
  it('should create a ReconnectingWebSocketTransport', () => {
    const transport = reconnectingWs('wss://test.example.com/rpc')
    expect(transport).toBeInstanceOf(ReconnectingWebSocketTransport)
  })

  it('should pass options correctly', async () => {
    const onConnect = vi.fn()
    const transport = reconnectingWs('wss://test.example.com/rpc', {
      onConnect,
      heartbeatInterval: 5000,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(onConnect).toHaveBeenCalled()
  })
})

// ============================================================================
// Debug Mode Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Debug Mode', () => {
  it('should log when debug is enabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      debug: true,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    expect(consoleSpy).toHaveBeenCalled()
    const logCalls = consoleSpy.mock.calls.filter(call => call[0] === '[ReconnectingWS]')
    expect(logCalls.length).toBeGreaterThan(0)

    consoleSpy.mockRestore()
  })

  it('should not log when debug is disabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      debug: false,
    })

    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const logCalls = consoleSpy.mock.calls.filter(call => call[0] === '[ReconnectingWS]')
    expect(logCalls.length).toBe(0)

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// Edge Cases and Regression Tests
// ============================================================================

describe('ReconnectingWebSocketTransport - Edge Cases', () => {
  it('should handle rapid connect/disconnect cycles', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      reconnectBackoff: 50,
    })

    for (let i = 0; i < 5; i++) {
      const sendPromise = transport.send(`message-${i}`)
      await vi.advanceTimersByTimeAsync(0)

      if (transport.getState() === 'connecting') {
        getLastWebSocket()!.simulateOpen()
        // Advance timers for internal polling
        for (let j = 0; j < 5; j++) {
          await vi.advanceTimersByTimeAsync(50)
        }
      }

      await sendPromise

      if (i < 4) {
        getLastWebSocket()!.simulateClose(1006, 'Rapid cycle')
        await vi.advanceTimersByTimeAsync(50)
        await vi.advanceTimersByTimeAsync(0)
      }
    }

    expect(transport.isConnected()).toBe(true)
  })

  it('should handle multiple pending sends correctly', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Queue up multiple sends
    const sends = [
      transport.send('msg1'),
      transport.send('msg2'),
      transport.send('msg3'),
      transport.send('msg4'),
      transport.send('msg5'),
    ]

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()

    // Advance timers for internal polling
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(50)
    }

    await Promise.all(sends)

    const socket = getLastWebSocket()!
    expect(socket.sentMessages).toContain('msg1')
    expect(socket.sentMessages).toContain('msg2')
    expect(socket.sentMessages).toContain('msg3')
    expect(socket.sentMessages).toContain('msg4')
    expect(socket.sentMessages).toContain('msg5')
  })

  it('should handle multiple pending receives correctly', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Connect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    // Queue up multiple receives
    const receive1 = transport.receive()
    const receive2 = transport.receive()
    const receive3 = transport.receive()

    const socket = getLastWebSocket()!
    socket.simulateRawMessage('response1')
    socket.simulateRawMessage('response2')
    socket.simulateRawMessage('response3')

    const [r1, r2, r3] = await Promise.all([receive1, receive2, receive3])

    expect(r1).toBe('response1')
    expect(r2).toBe('response2')
    expect(r3).toBe('response3')
  })

  it('should handle pong messages not being queued for receive', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc', {
      heartbeatInterval: 1000,
    })

    // Connect
    const sendPromise = transport.send('test')
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)
    await sendPromise

    const socket = getLastWebSocket()!

    // Receive should wait for next message
    const receivePromise = transport.receive()

    // Send a pong (should not resolve the receive)
    socket.simulateMessage({ type: 'pong' })

    // Receive should still be pending - send actual message
    socket.simulateRawMessage('actual-message')

    const msg = await receivePromise
    expect(msg).toBe('actual-message')
  })

  it('should wait for connection when sending during connecting state', async () => {
    const transport = new ReconnectingWebSocketTransport('wss://test.example.com/rpc')

    // Start connecting
    const send1 = transport.send('test1')
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.getState()).toBe('connecting')

    // Start another send while connecting
    const send2 = transport.send('test2')

    // Now open the connection
    getLastWebSocket()!.simulateOpen()

    // Advance timers for internal polling
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(50)
    }

    await Promise.all([send1, send2])

    const socket = getLastWebSocket()!
    expect(socket.sentMessages).toContain('test1')
    expect(socket.sentMessages).toContain('test2')
  })
})
