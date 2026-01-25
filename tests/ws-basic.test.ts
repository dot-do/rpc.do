/**
 * Basic WebSocket Transport Tests
 *
 * Tests for the basic ws() transport including:
 * - Connection (URL, protocol conversion, token in query params)
 * - Message handling (JSON-RPC format, correlation, promise resolution)
 * - Error handling (parse errors, connection close)
 * - Close method
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ws } from '../src/transports'
import { RPCError } from '../src/errors'
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
})

afterEach(() => {
  restoreMockWebSocket(mockState)
})

// ============================================================================
// Connection Tests
// ============================================================================

describe('ws() Transport - Connection', () => {
  it('should connect to WebSocket URL', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    // Wait for WebSocket to be created
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBeNull()
    expect(getLastWebSocket()!.url).toBe('wss://test.example.com/rpc')

    // Simulate connection and response
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise
  })

  it('should convert http:// to ws://', async () => {
    const transport = ws('http://localhost:8080/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBeNull()
    expect(getLastWebSocket()!.url).toBe('ws://localhost:8080/rpc')

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise
  })

  it('should convert https:// to wss://', async () => {
    const transport = ws('https://secure.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBeNull()
    expect(getLastWebSocket()!.url).toBe('wss://secure.example.com/rpc')

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise
  })

  it('should include token in URL query params when provided as string', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const transport = ws('wss://test.example.com/rpc', 'my-secret-token')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBeNull()
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('my-secret-token')

    // Should warn about security
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Basic WebSocket transport sends auth token in URL')
    )

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })

  it('should include token in URL query params when provided as function', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const tokenProvider = vi.fn(() => 'dynamic-token')
    const transport = ws('wss://test.example.com/rpc', tokenProvider)

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(tokenProvider).toHaveBeenCalled()
    expect(getLastWebSocket()).not.toBeNull()
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('dynamic-token')

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })

  it('should include token in URL query params when provided as async function', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const asyncTokenProvider = vi.fn(async () => 'async-token')
    const transport = ws('wss://test.example.com/rpc', asyncTokenProvider)

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(asyncTokenProvider).toHaveBeenCalled()
    expect(getLastWebSocket()).not.toBeNull()
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('async-token')

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })

  it('should not include token in URL when auth returns null', async () => {
    const tokenProvider = vi.fn(() => null)
    const transport = ws('wss://test.example.com/rpc', tokenProvider)

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBeNull()
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.has('token')).toBe(false)

    // Complete the call
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise
  })

  it('should reuse existing open connection', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // First call
    const call1Promise = transport.call('method1', [])
    await new Promise(resolve => setTimeout(resolve, 0))

    const firstSocket = getLastWebSocket()
    firstSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const msg1 = JSON.parse(firstSocket!.sentMessages[0])
    firstSocket!.simulateMessage({ id: msg1.id, result: 'result1' })
    await call1Promise

    // Second call should reuse same socket
    const call2Promise = transport.call('method2', [])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).toBe(firstSocket)
    expect(firstSocket!.sentMessages.length).toBe(2)

    const msg2 = JSON.parse(firstSocket!.sentMessages[1])
    firstSocket!.simulateMessage({ id: msg2.id, result: 'result2' })

    const result2 = await call2Promise
    expect(result2).toBe('result2')
  })
})

// ============================================================================
// Message Handling Tests
// ============================================================================

describe('ws() Transport - Message Handling', () => {
  it('should send JSON-RPC formatted messages', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('users.find', [{ id: '123' }, { fields: ['name', 'email'] }])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()!.sentMessages.length).toBe(1)
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    expect(sentMessage).toMatchObject({
      method: 'do',
      path: 'users.find',
      args: [{ id: '123' }, { fields: ['name', 'email'] }]
    })
    expect(typeof sentMessage.id).toBe('number')

    // Complete the call
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: { name: 'Test' } })
    await callPromise
  })

  it('should correlate responses by id', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start multiple concurrent calls
    const call1Promise = transport.call('method1', [])
    const call2Promise = transport.call('method2', [])
    const call3Promise = transport.call('method3', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    // Extract message IDs
    const msg1 = JSON.parse(getLastWebSocket()!.sentMessages[0])
    const msg2 = JSON.parse(getLastWebSocket()!.sentMessages[1])
    const msg3 = JSON.parse(getLastWebSocket()!.sentMessages[2])

    // Respond out of order
    getLastWebSocket()!.simulateMessage({ id: msg3.id, result: 'result3' })
    getLastWebSocket()!.simulateMessage({ id: msg1.id, result: 'result1' })
    getLastWebSocket()!.simulateMessage({ id: msg2.id, result: 'result2' })

    // Each promise should resolve with the correct result
    const [result1, result2, result3] = await Promise.all([call1Promise, call2Promise, call3Promise])

    expect(result1).toBe('result1')
    expect(result2).toBe('result2')
    expect(result3).toBe('result3')
  })

  it('should resolve pending promises on successful response', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', ['arg1'])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: { success: true, data: [1, 2, 3] }
    })

    const result = await callPromise

    expect(result).toEqual({ success: true, data: [1, 2, 3] })
  })

  it('should reject pending promises on error response', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      error: { message: 'Method not found', code: 'METHOD_NOT_FOUND' }
    })

    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('Method not found')
  })

  it('should handle responses with unknown ids gracefully', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Send a response with an unknown id (should be ignored)
    getLastWebSocket()!.simulateMessage({ id: 99999, result: 'unknown' })

    // Original call should still be pending
    // Now send the correct response
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'correct' })

    const result = await callPromise
    expect(result).toBe('correct')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('ws() Transport - Error Handling', () => {
  it('should reject pending requests on JSON parse errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    // Track rpc-error events
    let rpcErrorEvent: CustomEvent | null = null
    getLastWebSocket()!.addEventListener('rpc-error', (e: any) => {
      rpcErrorEvent = e
    })

    // Send invalid JSON
    getLastWebSocket()!.simulateRawMessage('this is not valid json {{{')

    // Should log the error
    expect(errorSpy).toHaveBeenCalledWith(
      '[rpc.do] WebSocket message parse error:',
      expect.any(Error)
    )
    expect(errorSpy).toHaveBeenCalledWith(
      '[rpc.do] Raw message data:',
      'this is not valid json {{{'
    )

    // Should emit rpc-error event
    expect(rpcErrorEvent).not.toBeNull()
    expect(rpcErrorEvent!.detail).toBeInstanceOf(RPCError)
    expect(rpcErrorEvent!.detail.code).toBe('PARSE_ERROR')

    // Parse errors should now reject all pending requests to prevent memory leaks
    // and hanging promises (this was a bug fix - previously requests would hang forever)
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('Failed to parse WebSocket message')

    errorSpy.mockRestore()
  })

  it('should include raw data in parse error (truncated if long)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    let rpcErrorEvent: CustomEvent | null = null
    getLastWebSocket()!.addEventListener('rpc-error', (e: any) => {
      rpcErrorEvent = e
    })

    // Send long invalid message
    const longMessage = 'x'.repeat(300)
    getLastWebSocket()!.simulateRawMessage(longMessage)

    expect(rpcErrorEvent).not.toBeNull()
    // Should truncate to 200 chars
    expect(rpcErrorEvent!.detail.data.rawData.length).toBe(200)

    // Parse errors should reject all pending requests
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('Failed to parse WebSocket message')

    errorSpy.mockRestore()
  })

  it('should reject all pending promises on connection close', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start multiple calls
    const call1Promise = transport.call('method1', [])
    const call2Promise = transport.call('method2', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    // Close the connection unexpectedly
    getLastWebSocket()!.simulateClose(1006, 'Abnormal closure')

    // All pending promises should reject
    await expect(call1Promise).rejects.toThrow(RPCError)
    await expect(call1Promise).rejects.toThrow('WebSocket closed')

    await expect(call2Promise).rejects.toThrow(RPCError)
    await expect(call2Promise).rejects.toThrow('WebSocket closed')
  })

  it('should reject pending with CONNECTION_CLOSED code', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    getLastWebSocket()!.simulateClose()

    try {
      await callPromise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe('CONNECTION_CLOSED')
    }
  })

  it('should reject connection promise on WebSocket error during connect', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    // Simulate error before connection is established
    getLastWebSocket()!.simulateError(new Event('error'))

    await expect(callPromise).rejects.toBeTruthy()
  })
})

// ============================================================================
// Close Method Tests
// ============================================================================

describe('ws() Transport - Close', () => {
  it('should close WebSocket when close() is called', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Establish connection
    const callPromise = transport.call('test.method', [])
    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })
    await callPromise

    // Now close
    expect(getLastWebSocket()!.readyState).toBe(MockWebSocket.OPEN)

    transport.close!()

    expect(getLastWebSocket()!.readyState).toBe(MockWebSocket.CLOSED)
  })

  it('should handle close() when not connected', () => {
    const transport = ws('wss://test.example.com/rpc')

    // Should not throw when closing without connection
    expect(() => transport.close!()).not.toThrow()
  })

  it('should handle close() called multiple times', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Establish connection
    const callPromise = transport.call('test.method', [])
    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })
    await callPromise

    // Close multiple times should not throw
    transport.close!()
    transport.close!()
    transport.close!()
  })

  it('should create new connection after close()', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // First connection
    const call1Promise = transport.call('method1', [])
    await new Promise(resolve => setTimeout(resolve, 0))

    const firstSocket = getLastWebSocket()
    firstSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const msg1 = JSON.parse(firstSocket!.sentMessages[0])
    firstSocket!.simulateMessage({ id: msg1.id, result: 'result1' })
    await call1Promise

    // Close connection
    transport.close!()

    // New call should create new connection
    const call2Promise = transport.call('method2', [])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(getLastWebSocket()).not.toBe(firstSocket)

    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const msg2 = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: msg2.id, result: 'result2' })

    const result2 = await call2Promise
    expect(result2).toBe('result2')
  })
})
