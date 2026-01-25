/**
 * WebSocket Transport Timeout Tests
 *
 * Tests for the timeout functionality in the ws() transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ws } from '../src/transports'
import { ConnectionError, RPCError } from '../src/errors'
import {
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
  vi.useRealTimers()
})

// ============================================================================
// WebSocket Timeout Tests
// ============================================================================

describe('ws() Transport - Timeout', () => {
  it('should complete request normally when within timeout', async () => {
    const transport = ws('wss://test.example.com/rpc', { timeout: 5000 })

    const callPromise = transport.call('test.method', ['arg1'])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    // Get the message ID from the sent message
    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Respond before timeout
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: { success: true }
    })

    const result = await callPromise
    expect(result).toEqual({ success: true })
  })

  it('should timeout and throw ConnectionError when request takes too long', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: 1000 })

    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning
    callPromise.catch(() => {})

    // Simulate connection
    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Advance time past timeout without sending response
    await vi.advanceTimersByTimeAsync(1001)

    await expect(callPromise).rejects.toThrow(ConnectionError)
    await expect(callPromise).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      message: 'Request timeout after 1000ms'
    })
  })

  it('should not timeout when no timeout is specified', async () => {
    const transport = ws('wss://test.example.com/rpc')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))
    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Respond after some delay (would timeout if timeout was set)
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: 'delayed-result'
    })

    const result = await callPromise
    expect(result).toBe('delayed-result')
  })

  it('should support legacy auth signature with no timeout', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const transport = ws('wss://test.example.com/rpc', 'my-token')

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    // Verify token in URL
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('my-token')

    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })

  it('should support options object with auth and timeout', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const transport = ws('wss://test.example.com/rpc', {
      auth: 'my-token',
      timeout: 5000
    })

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 0))

    // Verify token in URL
    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('my-token')

    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })

  it('should clear timeout when response is received', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const transport = ws('wss://test.example.com/rpc', { timeout: 5000 })

    const callPromise = transport.call('test.method', [])

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Respond before timeout
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: 'success'
    })

    await callPromise

    // clearTimeout should have been called (for the request timeout)
    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })

  it('should handle multiple concurrent requests with different timeouts', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: 2000 })

    // Start three calls
    const call1Promise = transport.call('method1', [])
    const call2Promise = transport.call('method2', [])
    const call3Promise = transport.call('method3', [])

    // Prevent unhandled rejection warning for the one that will timeout
    call3Promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Get message IDs
    const msg1 = JSON.parse(getLastWebSocket()!.sentMessages[0])
    const msg2 = JSON.parse(getLastWebSocket()!.sentMessages[1])
    const msg3 = JSON.parse(getLastWebSocket()!.sentMessages[2])

    // Respond to first request immediately
    getLastWebSocket()!.simulateMessage({ id: msg1.id, result: 'result1' })

    // Advance time - but not past timeout
    await vi.advanceTimersByTimeAsync(1000)

    // Respond to second request
    getLastWebSocket()!.simulateMessage({ id: msg2.id, result: 'result2' })

    // Advance past timeout for third request
    await vi.advanceTimersByTimeAsync(1500)

    // First two should succeed
    await expect(call1Promise).resolves.toBe('result1')
    await expect(call2Promise).resolves.toBe('result2')

    // Third should timeout
    await expect(call3Promise).rejects.toThrow(ConnectionError)
    await expect(call3Promise).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('should clear timeouts when connection closes', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const transport = ws('wss://test.example.com/rpc', { timeout: 5000 })

    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning
    callPromise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Close connection before timeout
    getLastWebSocket()!.simulateClose(1006, 'Connection lost')

    // Request should reject with connection closed error
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })

    // Timeout should have been cleared
    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })

  it('should clear timeouts when close() is called', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    const transport = ws('wss://test.example.com/rpc', { timeout: 5000 })

    // Start a call and prevent unhandled rejection warning
    const callPromise = transport.call('test.method', [])
    callPromise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Close transport explicitly
    transport.close!()

    // Timeout should have been cleared
    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })

  it('should handle timeout of 0 as no timeout', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: 0 })

    const callPromise = transport.call('test.method', [])

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Advance time significantly - should not timeout
    await vi.advanceTimersByTimeAsync(100000)

    // Now respond
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: 'delayed-result'
    })

    const result = await callPromise
    expect(result).toBe('delayed-result')
  })

  it('should handle negative timeout as no timeout', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: -1 })

    const callPromise = transport.call('test.method', [])

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Advance time significantly - should not timeout
    await vi.advanceTimersByTimeAsync(100000)

    // Now respond
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: 'delayed-result'
    })

    const result = await callPromise
    expect(result).toBe('delayed-result')
  })

  it('should preserve ConnectionError properties on timeout', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: 3000 })

    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning
    callPromise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(3001)

    try {
      await callPromise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectionError)
      const connError = error as ConnectionError
      expect(connError.code).toBe('REQUEST_TIMEOUT')
      expect(connError.retryable).toBe(true)
      expect(connError.message).toBe('Request timeout after 3000ms')
    }
  })

  it('should remove timed out request from pending map', async () => {
    vi.useFakeTimers()

    const transport = ws('wss://test.example.com/rpc', { timeout: 1000 })

    const callPromise = transport.call('test.method', [])

    // Prevent unhandled rejection warning
    callPromise.catch(() => {})

    await vi.advanceTimersByTimeAsync(0)
    getLastWebSocket()!.simulateOpen()
    await vi.advanceTimersByTimeAsync(0)

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1001)

    // Wait for timeout to be processed
    await expect(callPromise).rejects.toThrow(ConnectionError)

    // Now if a late response arrives, it should be ignored (no double rejection)
    // This should not throw or cause issues
    getLastWebSocket()!.simulateMessage({
      id: sentMessage.id,
      result: 'late-response'
    })

    // No errors should occur
  })

  it('should support async auth provider with timeout', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const asyncAuthProvider = vi.fn().mockResolvedValue('async-token')

    const transport = ws('wss://test.example.com/rpc', {
      auth: asyncAuthProvider,
      timeout: 5000
    })

    const callPromise = transport.call('test.method', [])

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(asyncAuthProvider).toHaveBeenCalled()

    const url = new URL(getLastWebSocket()!.url)
    expect(url.searchParams.get('token')).toBe('async-token')

    getLastWebSocket()!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 0))

    const sentMessage = JSON.parse(getLastWebSocket()!.sentMessages[0])
    getLastWebSocket()!.simulateMessage({ id: sentMessage.id, result: 'ok' })

    await callPromise

    warnSpy.mockRestore()
  })
})
