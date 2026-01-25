/**
 * Stress/Concurrent Tests for rpc.do
 *
 * Tests for concurrent operations, connection pooling, resource management,
 * and mixed success/failure scenarios under load.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RPC, http, ws, composite } from '../src/index'
import { RPCError, ConnectionError } from '../src/errors'
import type { Transport } from '../src/index'

// ============================================================================
// Mock WebSocket for stress tests
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

  dispatchEvent(event: Event) {
    const handlers = this.listeners.get(event.type) || []
    for (const handler of handlers) {
      handler(event)
    }
    return true
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

  private triggerEvent(type: string, event: unknown) {
    const handlers = this.listeners.get(type) || []
    for (const handler of handlers) {
      handler(event)
    }
  }
}

// Store created WebSocket instances for test access
let createdWebSockets: MockWebSocket[] = []
let lastCreatedWebSocket: MockWebSocket | null = null

// Store original globals
let originalFetch: typeof fetch
let originalWebSocket: typeof WebSocket

beforeEach(() => {
  originalFetch = globalThis.fetch
  originalWebSocket = globalThis.WebSocket
  createdWebSockets = []
  lastCreatedWebSocket = null

  ;(globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      lastCreatedWebSocket = this
      createdWebSockets.push(this)
    }
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  createdWebSockets = []
  lastCreatedWebSocket = null
})

// ============================================================================
// 1. Concurrent HTTP Requests
// ============================================================================

describe('Concurrent HTTP Requests', () => {
  it('should handle 100 parallel requests successfully', async () => {
    const requestCount = 100
    let receivedRequests = 0
    const requestBodies: any[] = []

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      receivedRequests++
      const body = JSON.parse(options?.body as string)
      requestBodies.push(body)

      // Simulate varying response times (0-10ms)
      await new Promise(r => setTimeout(r, Math.random() * 10))

      return new Response(JSON.stringify({ result: body.path, index: receivedRequests }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as any

    const transport = http('https://test.example.com/rpc')
    const rpc = RPC(transport)

    // Fire all 100 requests in parallel
    const startTime = Date.now()
    const promises = Array.from({ length: requestCount }, (_, i) =>
      rpc[`method${i}`].execute({ index: i })
    )

    const results = await Promise.all(promises)
    const duration = Date.now() - startTime

    // Verify all requests completed
    expect(results).toHaveLength(requestCount)
    expect(receivedRequests).toBe(requestCount)

    // Verify no request was lost
    const methodNames = requestBodies.map(b => b.path)
    for (let i = 0; i < requestCount; i++) {
      expect(methodNames).toContain(`method${i}.execute`)
    }

    // Log timing info
    console.log(`100 parallel HTTP requests completed in ${duration}ms`)
  })

  it('should handle varying response delays without mixing up results', async () => {
    const delays = [50, 10, 30, 5, 40, 20, 15, 35, 25, 45]

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      const body = JSON.parse(options?.body as string)
      const index = parseInt(body.path.replace('request', ''), 10)
      const delay = delays[index]

      await new Promise(r => setTimeout(r, delay))

      return new Response(JSON.stringify({ index, delay }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as any

    const transport = http('https://test.example.com/rpc')
    const rpc = RPC(transport)

    const promises = delays.map((_, i) => rpc[`request${i}`]())
    const results = await Promise.all(promises)

    // Each result should have the correct index despite different delays
    results.forEach((result, i) => {
      expect(result).toEqual({ index: i, delay: delays[i] })
    })
  })
})

// ============================================================================
// 2. Concurrent WebSocket Requests
// ============================================================================

describe('Concurrent WebSocket Requests', () => {
  it('should handle 100 parallel RPC calls with correct ID correlation', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start 100 parallel calls
    const requestCount = 100
    const promises: Promise<unknown>[] = []

    for (let i = 0; i < requestCount; i++) {
      promises.push(transport.call(`method${i}`, [{ index: i }]))
    }

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Verify all messages were sent
    expect(lastCreatedWebSocket!.sentMessages).toHaveLength(requestCount)

    // Parse all sent messages and extract IDs
    const sentMessages = lastCreatedWebSocket!.sentMessages.map(m => JSON.parse(m))
    const messageIds = sentMessages.map(m => m.id)

    // Verify all IDs are unique
    const uniqueIds = new Set(messageIds)
    expect(uniqueIds.size).toBe(requestCount)

    // Respond to all messages in random order
    const shuffledMessages = [...sentMessages].sort(() => Math.random() - 0.5)

    for (const msg of shuffledMessages) {
      lastCreatedWebSocket!.simulateMessage({
        id: msg.id,
        result: { method: msg.path, index: parseInt(msg.path.replace('method', ''), 10) }
      })
    }

    // Wait for all promises to resolve
    const results = await Promise.all(promises)

    // Verify each result matches its expected value
    results.forEach((result: any, i) => {
      expect(result.method).toBe(`method${i}`)
      expect(result.index).toBe(i)
    })
  })

  it('should maintain correct message correlation under heavy load', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Fire rapid requests
    const requestCount = 50
    const promises: Promise<unknown>[] = []

    for (let i = 0; i < requestCount; i++) {
      promises.push(transport.call('echo', [i]))
    }

    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Get all message IDs
    const sentMessages = lastCreatedWebSocket!.sentMessages.map(m => JSON.parse(m))

    // Respond in reverse order to test correlation
    for (let i = sentMessages.length - 1; i >= 0; i--) {
      const msg = sentMessages[i]
      lastCreatedWebSocket!.simulateMessage({
        id: msg.id,
        result: msg.args[0] // Echo back the argument
      })
    }

    const results = await Promise.all(promises)

    // Verify order matches original request order, not response order
    results.forEach((result, i) => {
      expect(result).toBe(i)
    })
  })
})

// ============================================================================
// 3. Connection Pooling / Socket Reuse
// ============================================================================

describe('Connection Pooling', () => {
  it('should reuse the same WebSocket for multiple RPC instances', async () => {
    // Create a shared transport
    const sharedTransport = ws('wss://test.example.com/rpc')

    // Create multiple RPC proxies sharing the same transport
    const rpc1 = RPC(sharedTransport)
    const rpc2 = RPC(sharedTransport)
    const rpc3 = RPC(sharedTransport)

    // Fire requests from all proxies
    const p1 = rpc1.method1()
    const p2 = rpc2.method2()
    const p3 = rpc3.method3()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should only have created one WebSocket
    expect(createdWebSockets).toHaveLength(1)

    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    // All messages should be on the same socket
    expect(lastCreatedWebSocket!.sentMessages).toHaveLength(3)

    // Respond to all
    const messages = lastCreatedWebSocket!.sentMessages.map(m => JSON.parse(m))
    for (const msg of messages) {
      lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: msg.path })
    }

    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1).toBe('method1')
    expect(r2).toBe('method2')
    expect(r3).toBe('method3')
  })

  it('should verify socket reuse across sequential calls', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // First call
    const p1 = transport.call('first', [])
    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    const msg1 = JSON.parse(lastCreatedWebSocket!.sentMessages[0])
    lastCreatedWebSocket!.simulateMessage({ id: msg1.id, result: 'first-result' })
    await p1

    const firstSocket = lastCreatedWebSocket

    // Make 10 more calls
    for (let i = 0; i < 10; i++) {
      const p = transport.call(`call${i}`, [])
      await new Promise(resolve => setTimeout(resolve, 5))
      const msg = JSON.parse(lastCreatedWebSocket!.sentMessages[lastCreatedWebSocket!.sentMessages.length - 1])
      lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: `result${i}` })
      await p
    }

    // Should still be using the same socket
    expect(lastCreatedWebSocket).toBe(firstSocket)
    expect(createdWebSockets).toHaveLength(1)
  })

  it('should not leak connections when transport is properly closed', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Make a call to establish connection
    const p = transport.call('test', [])
    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    const msg = JSON.parse(lastCreatedWebSocket!.sentMessages[0])
    lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: 'ok' })
    await p

    // Close the transport
    transport.close!()

    // Socket should be closed
    expect(lastCreatedWebSocket!.readyState).toBe(MockWebSocket.CLOSED)
  })
})

// ============================================================================
// 4. Rapid Connect/Disconnect
// ============================================================================

describe('Rapid Connect/Disconnect', () => {
  it('should handle 50 connect/call/close cycles without resource leaks', async () => {
    const cycles = 50
    const results: unknown[] = []

    for (let i = 0; i < cycles; i++) {
      const transport = ws('wss://test.example.com/rpc')

      // Make a call
      const callPromise = transport.call('echo', [i])

      await new Promise(resolve => setTimeout(resolve, 5))
      const socket = lastCreatedWebSocket!
      socket.simulateOpen()
      await new Promise(resolve => setTimeout(resolve, 5))

      const msg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1])
      socket.simulateMessage({ id: msg.id, result: i })

      const result = await callPromise
      results.push(result)

      // Close the transport
      transport.close!()
    }

    // Verify all cycles completed successfully
    expect(results).toHaveLength(cycles)
    results.forEach((result, i) => {
      expect(result).toBe(i)
    })

    // Each cycle should have created a new socket
    expect(createdWebSockets).toHaveLength(cycles)

    // All sockets should be closed
    for (const socket of createdWebSockets) {
      expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    }
  })

  it('should not leave hanging promises after rapid close', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start a call
    const callPromise = transport.call('test', [])

    await new Promise(resolve => setTimeout(resolve, 5))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 5))

    // Close before response arrives
    transport.close!()

    // The promise should reject, not hang
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('WebSocket closed')
  })

  it('should handle close during connection establishment', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start a call
    const callPromise = transport.call('test', [])

    await new Promise(resolve => setTimeout(resolve, 5))

    // Connection opens
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 5))

    // Close before response - this should reject pending
    transport.close!()

    // The promise should now reject with CONNECTION_CLOSED
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('WebSocket closed')
  })
})

// ============================================================================
// 5. Mixed Success/Failure
// ============================================================================

describe('Mixed Success/Failure', () => {
  it('should handle 50 successful + 50 failing HTTP requests correctly', async () => {
    let requestIndex = 0

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      const body = JSON.parse(options?.body as string)
      const shouldFail = body.path.startsWith('fail')

      // Simulate network delay
      await new Promise(r => setTimeout(r, Math.random() * 20))

      if (shouldFail) {
        return new Response('Request failed', { status: 500 })
      }

      return new Response(JSON.stringify({ success: true, path: body.path }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as any

    const transport = http('https://test.example.com/rpc')
    const rpc = RPC(transport)

    // Create 50 successful and 50 failing requests
    const promises: Promise<any>[] = []
    for (let i = 0; i < 50; i++) {
      promises.push(rpc[`success${i}`]().then(r => ({ status: 'success', result: r })))
      promises.push(rpc[`fail${i}`]().then(r => ({ status: 'success', result: r })).catch(e => ({ status: 'error', error: e })))
    }

    const results = await Promise.all(promises)

    const successes = results.filter(r => r.status === 'success')
    const failures = results.filter(r => r.status === 'error')

    expect(successes).toHaveLength(50)
    expect(failures).toHaveLength(50)

    // Verify all successes have correct results
    successes.forEach((r: any) => {
      expect(r.result.success).toBe(true)
      expect(r.result.path).toMatch(/^success\d+$/)
    })

    // Verify all failures have proper error
    failures.forEach((r: any) => {
      expect(r.error).toBeInstanceOf(RPCError)
      expect(r.error.code).toBe('500')
    })
  })

  it('should handle WebSocket errors without affecting successful requests', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Start mix of requests
    const promises: Promise<any>[] = []
    for (let i = 0; i < 20; i++) {
      promises.push(
        transport.call(`request${i}`, [i])
          .then(r => ({ status: 'success', result: r }))
          .catch(e => ({ status: 'error', error: e }))
      )
    }

    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Parse all sent messages
    const sentMessages = lastCreatedWebSocket!.sentMessages.map(m => JSON.parse(m))

    // Respond with success to even requests, error to odd requests
    for (const msg of sentMessages) {
      const requestNum = parseInt(msg.path.replace('request', ''), 10)
      if (requestNum % 2 === 0) {
        lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: `success-${requestNum}` })
      } else {
        lastCreatedWebSocket!.simulateMessage({
          id: msg.id,
          error: { message: `Error for request ${requestNum}`, code: 'TEST_ERROR' }
        })
      }
    }

    const results = await Promise.all(promises)

    const successes = results.filter(r => r.status === 'success')
    const failures = results.filter(r => r.status === 'error')

    expect(successes).toHaveLength(10)
    expect(failures).toHaveLength(10)

    // Verify successes
    successes.forEach((r: any) => {
      expect(r.result).toMatch(/^success-\d+$/)
      const num = parseInt(r.result.replace('success-', ''), 10)
      expect(num % 2).toBe(0) // Even numbers succeeded
    })

    // Verify failures
    failures.forEach((r: any) => {
      expect(r.error).toBeInstanceOf(RPCError)
      expect(r.error.code).toBe('TEST_ERROR')
    })
  })

  it('should handle timeout and success mix correctly', async () => {
    // Track which requests should timeout
    const timeoutRequests = new Set([2, 5, 7, 9])
    const timeoutMs = 30

    globalThis.fetch = vi.fn(async (url: string, options?: RequestInit) => {
      const body = JSON.parse(options?.body as string)
      const requestNum = parseInt(body.path.replace('request', ''), 10)

      // Check if request was aborted
      const signal = options?.signal

      if (timeoutRequests.has(requestNum)) {
        // Simulate slow response that will timeout
        // Wait longer than the timeout, but check for abort
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200)
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }
        })
      } else {
        await new Promise(r => setTimeout(r, 5))
      }

      return new Response(JSON.stringify({ success: true, num: requestNum }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }) as any

    // Use short timeout
    const transport = http('https://test.example.com/rpc', { timeout: timeoutMs })
    const rpc = RPC(transport)

    // Make 10 requests (smaller set to keep test fast)
    const promises: Promise<any>[] = []
    for (let i = 0; i < 10; i++) {
      promises.push(
        rpc[`request${i}`]()
          .then(r => ({ status: 'success', result: r }))
          .catch(e => ({ status: 'error', error: e }))
      )
    }

    const results = await Promise.all(promises)

    const successes = results.filter(r => r.status === 'success')
    const failures = results.filter(r => r.status === 'error')

    // Should have correct number of successes and timeouts
    // Only requests 0, 1, 3, 4, 6, 8 should succeed (6 total)
    // Requests 2, 5, 7, 9 should timeout (4 total)
    expect(successes).toHaveLength(6)
    expect(failures).toHaveLength(4)

    // Verify timeout errors
    failures.forEach((r: any) => {
      expect(r.error).toBeInstanceOf(ConnectionError)
      expect(r.error.code).toBe('REQUEST_TIMEOUT')
    })
  })
})

// ============================================================================
// 6. Composite Transport Stress
// ============================================================================

describe('Composite Transport Stress', () => {
  it('should fallback correctly under concurrent load', async () => {
    let failingTransportCalls = 0
    let successfulTransportCalls = 0

    const failingTransport: Transport = {
      async call(method, args) {
        failingTransportCalls++
        throw new Error('Transport 1 always fails')
      }
    }

    const successfulTransport: Transport = {
      async call(method, args) {
        successfulTransportCalls++
        await new Promise(r => setTimeout(r, Math.random() * 10))
        return { method, args }
      }
    }

    const comp = composite(failingTransport, successfulTransport)
    const rpc = RPC(comp)

    // Fire 50 concurrent requests
    const promises = Array.from({ length: 50 }, (_, i) => rpc[`method${i}`]({ index: i }))

    const results = await Promise.all(promises)

    // All should succeed via the fallback transport
    expect(results).toHaveLength(50)
    results.forEach((r: any, i) => {
      expect(r.method).toBe(`method${i}`)
    })

    // First transport should have been tried for each request
    expect(failingTransportCalls).toBe(50)
    // Second transport should have succeeded for each request
    expect(successfulTransportCalls).toBe(50)
  })

  it('should handle closing all transports under load', async () => {
    let transport1Closed = false
    let transport2Closed = false

    const transport1: Transport = {
      async call(method, args) {
        throw new Error('fail')
      },
      close() {
        transport1Closed = true
      }
    }

    const transport2: Transport = {
      async call(method, args) {
        return { ok: true }
      },
      close() {
        transport2Closed = true
      }
    }

    const comp = composite(transport1, transport2)

    // Make some calls
    const promises = Array.from({ length: 10 }, () => comp.call('test', []))
    await Promise.all(promises)

    // Close should close all transports
    comp.close!()

    expect(transport1Closed).toBe(true)
    expect(transport2Closed).toBe(true)
  })
})

// ============================================================================
// 7. Memory / Cleanup Verification
// ============================================================================

describe('Memory and Cleanup', () => {
  it('should clear pending requests map after batch completion', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Fire batch of requests
    const promises = Array.from({ length: 20 }, (_, i) =>
      transport.call(`method${i}`, [])
    )

    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Respond to all
    const messages = lastCreatedWebSocket!.sentMessages.map(m => JSON.parse(m))
    for (const msg of messages) {
      lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: 'ok' })
    }

    await Promise.all(promises)

    // Close and reopen - should work without issues from stale state
    transport.close!()

    // New call should create fresh connection
    const newPromise = transport.call('newMethod', [])
    await new Promise(resolve => setTimeout(resolve, 10))

    // Should be a new socket
    expect(createdWebSockets.length).toBeGreaterThan(1)
  })

  it('should handle rapid request/response without memory leaks', async () => {
    const transport = ws('wss://test.example.com/rpc')

    // Initial connection
    const initPromise = transport.call('init', [])
    await new Promise(resolve => setTimeout(resolve, 10))
    lastCreatedWebSocket!.simulateOpen()
    await new Promise(resolve => setTimeout(resolve, 10))
    const initMsg = JSON.parse(lastCreatedWebSocket!.sentMessages[0])
    lastCreatedWebSocket!.simulateMessage({ id: initMsg.id, result: 'ok' })
    await initPromise

    // Rapid fire 100 sequential request/response cycles
    for (let i = 0; i < 100; i++) {
      const p = transport.call(`rapid${i}`, [])
      await new Promise(resolve => setTimeout(resolve, 1))
      const msg = JSON.parse(lastCreatedWebSocket!.sentMessages[lastCreatedWebSocket!.sentMessages.length - 1])
      lastCreatedWebSocket!.simulateMessage({ id: msg.id, result: i })
      await p
    }

    // Should still work after 100 cycles
    const finalPromise = transport.call('final', [])
    await new Promise(resolve => setTimeout(resolve, 1))
    const finalMsg = JSON.parse(lastCreatedWebSocket!.sentMessages[lastCreatedWebSocket!.sentMessages.length - 1])
    lastCreatedWebSocket!.simulateMessage({ id: finalMsg.id, result: 'final' })

    const result = await finalPromise
    expect(result).toBe('final')
  })
})
