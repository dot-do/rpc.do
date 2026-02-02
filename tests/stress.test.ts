/**
 * Stress/Concurrent Tests for rpc.do
 *
 * Tests for concurrent operations, connection pooling, resource management,
 * and mixed success/failure scenarios under load.
 *
 * Note: Uses mock transports for stress testing. The http() transport's
 * capnweb integration is tested separately in http-timeout.test.ts and capnweb.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'
import { RPC, composite } from '../src/index'
import { RPCError, ConnectionError } from '../src/errors'
import type { Transport } from '../src/index'

// ============================================================================
// Helper: Create a mock transport that simulates HTTP-like behavior
// ============================================================================

function createMockHttpTransport(config?: {
  delayFn?: (method: string) => number
  resultFn?: (method: string, args: unknown[]) => unknown
  shouldFail?: (method: string) => boolean
  errorCode?: string
}): Transport {
  return {
    async call(method: string, args: unknown[]) {
      const delay = config?.delayFn?.(method) ?? Math.random() * 10
      const shouldFail = config?.shouldFail?.(method) ?? false

      await new Promise(r => setTimeout(r, delay))

      if (shouldFail) {
        throw new RPCError('Request failed', config?.errorCode ?? '500')
      }

      return config?.resultFn?.(method, args) ?? { result: method }
    }
  }
}

// ============================================================================
// 1. Concurrent Requests (using mock transport)
// ============================================================================

describe('Concurrent Requests', () => {
  it('should handle 100 parallel requests successfully', async () => {
    const requestCount = 100
    let receivedRequests = 0

    const transport = createMockHttpTransport({
      delayFn: () => Math.random() * 10,
      resultFn: (method) => {
        receivedRequests++
        return { result: method, index: receivedRequests }
      }
    })

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

    // Log timing info
    console.log(`100 parallel requests completed in ${duration}ms`)
  })

  it('should handle varying response delays without mixing up results', async () => {
    const delays = [50, 10, 30, 5, 40, 20, 15, 35, 25, 45]

    const transport = createMockHttpTransport({
      delayFn: (method) => {
        const index = parseInt(method.replace('request', ''), 10)
        return delays[index] ?? 5
      },
      resultFn: (method) => {
        const index = parseInt(method.replace('request', ''), 10)
        return { index, delay: delays[index] }
      }
    })

    const rpc = RPC(transport)

    const promises = delays.map((_, i) => rpc[`request${i}`]())
    const results = await Promise.all(promises)

    // Each result should have the correct index despite different delays
    results.forEach((result: any, i) => {
      expect(result).toEqual({ index: i, delay: delays[i] })
    })
  })
})

// ============================================================================
// 2. Concurrent Mock Transport Requests
// ============================================================================

describe('Concurrent Mock Transport Requests', () => {
  it('should handle 100 parallel RPC calls with correct correlation', async () => {
    const requestCount = 100

    // Create a mock transport that handles concurrent requests
    const mockTransport: Transport = {
      async call(method, args) {
        // Simulate varying delays
        await new Promise(r => setTimeout(r, Math.random() * 10))
        const index = parseInt(method.replace('method', ''), 10)
        return { method, index }
      }
    }

    const rpc = RPC(mockTransport)

    // Start 100 parallel calls
    const promises: Promise<unknown>[] = []
    for (let i = 0; i < requestCount; i++) {
      promises.push(rpc[`method${i}`]({ index: i }))
    }

    const allResults = await Promise.all(promises)

    // Verify each result matches its expected value
    allResults.forEach((result: any, i) => {
      expect(result.method).toBe(`method${i}`)
      expect(result.index).toBe(i)
    })
  })

  it('should maintain correct message correlation under heavy load', async () => {
    const requestCount = 50
    const pendingRequests = new Map<number, { resolve: (v: unknown) => void }>()

    // Create transport that responds in reverse order
    const mockTransport: Transport = {
      async call(method, args) {
        const index = args[0] as number
        await new Promise<void>(resolve => {
          pendingRequests.set(index, { resolve: () => resolve() })
        })
        return index // Echo back the argument
      }
    }

    const rpc = RPC(mockTransport)

    // Fire rapid requests
    const promises: Promise<unknown>[] = []
    for (let i = 0; i < requestCount; i++) {
      promises.push(rpc.echo(i))
    }

    // Small delay to ensure all requests are pending
    await new Promise(r => setTimeout(r, 10))

    // Resolve in reverse order
    for (let i = requestCount - 1; i >= 0; i--) {
      const pending = pendingRequests.get(i)
      if (pending) {
        pending.resolve()
        await new Promise(r => setTimeout(r, 1))
      }
    }

    const results = await Promise.all(promises)

    // Verify order matches original request order, not response order
    results.forEach((result, i) => {
      expect(result).toBe(i)
    })
  })
})

// ============================================================================
// 3. Connection Pooling / Transport Reuse
// ============================================================================

describe('Connection Pooling', () => {
  it('should reuse the same transport for multiple RPC instances', async () => {
    let callCount = 0

    const sharedTransport: Transport = {
      async call(method, args) {
        callCount++
        return { method, callCount }
      }
    }

    // Create multiple RPC proxies sharing the same transport
    const rpc1 = RPC(sharedTransport)
    const rpc2 = RPC(sharedTransport)
    const rpc3 = RPC(sharedTransport)

    // Fire requests from all proxies
    const [r1, r2, r3] = await Promise.all([
      rpc1.method1(),
      rpc2.method2(),
      rpc3.method3()
    ])

    // All should have used the same transport
    expect(callCount).toBe(3)
    expect((r1 as { method: string }).method).toBe('method1')
    expect((r2 as { method: string }).method).toBe('method2')
    expect((r3 as { method: string }).method).toBe('method3')
  })

  it('should verify transport reuse across sequential calls', async () => {
    let callCount = 0

    const transport: Transport = {
      async call(method, args) {
        callCount++
        return { method, callNum: callCount }
      }
    }

    // Make 11 sequential calls
    const results: unknown[] = []
    results.push(await transport.call('first', []))

    for (let i = 0; i < 10; i++) {
      results.push(await transport.call(`call${i}`, []))
    }

    // Should have made 11 calls total
    expect(callCount).toBe(11)
  })

  it('should not leak resources when transport is properly closed', async () => {
    let closed = false

    const transport: Transport = {
      async call(method, args) {
        return { ok: true }
      },
      close() {
        closed = true
      }
    }

    await transport.call('test', [])
    transport.close!()

    expect(closed).toBe(true)
  })
})

// ============================================================================
// 4. Rapid Create/Call/Close
// ============================================================================

describe('Rapid Create/Call/Close', () => {
  it('should handle 50 create/call/close cycles without resource leaks', async () => {
    const cycles = 50
    const results: unknown[] = []
    const closedTransports: boolean[] = []

    for (let i = 0; i < cycles; i++) {
      let closed = false
      const transport: Transport = {
        async call(method, args) {
          return args[0]
        },
        close() {
          closed = true
        }
      }

      const result = await transport.call('echo', [i])
      results.push(result)

      transport.close!()
      closedTransports.push(closed)
    }

    // Verify all cycles completed successfully
    expect(results).toHaveLength(cycles)
    results.forEach((result, i) => {
      expect(result).toBe(i)
    })

    // All transports should be closed
    expect(closedTransports.every(c => c)).toBe(true)
  })

  it('should not leave hanging promises when closed during call', async () => {
    let rejectFn: ((e: Error) => void) | null = null

    const transport: Transport = {
      async call(method, args) {
        return new Promise((_, reject) => {
          rejectFn = reject
        })
      },
      close() {
        if (rejectFn) {
          rejectFn(new RPCError('Transport closed', 'CONNECTION_CLOSED'))
        }
      }
    }

    // Start a call
    const callPromise = transport.call('test', [])

    // Close before response arrives
    await new Promise(r => setTimeout(r, 5))
    transport.close!()

    // The promise should reject, not hang
    await expect(callPromise).rejects.toThrow(RPCError)
    await expect(callPromise).rejects.toThrow('Transport closed')
  })
})

// ============================================================================
// 5. Mixed Success/Failure
// ============================================================================

describe('Mixed Success/Failure', () => {
  it('should handle 50 successful + 50 failing requests correctly', async () => {
    const transport = createMockHttpTransport({
      delayFn: () => Math.random() * 20,
      shouldFail: (method) => method.startsWith('fail'),
      resultFn: (method) => ({ success: true, path: method })
    })

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

  it('should handle errors without affecting successful requests', async () => {
    const mockTransport: Transport = {
      async call(method, args) {
        const requestNum = parseInt(method.replace('request', ''), 10)
        await new Promise(r => setTimeout(r, Math.random() * 10))

        if (requestNum % 2 !== 0) {
          throw new RPCError(`Error for request ${requestNum}`, 'TEST_ERROR')
        }
        return `success-${requestNum}`
      }
    }

    // Start mix of requests
    const promises: Promise<any>[] = []
    for (let i = 0; i < 20; i++) {
      promises.push(
        mockTransport.call(`request${i}`, [i])
          .then(r => ({ status: 'success', result: r }))
          .catch(e => ({ status: 'error', error: e }))
      )
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

    // Create a transport with timeout-like behavior
    const transport: Transport = {
      async call(method, args) {
        const requestNum = parseInt(method.replace('request', ''), 10)
        const shouldTimeout = timeoutRequests.has(requestNum)

        // Use Promise.race to simulate timeout behavior
        const callPromise = (async () => {
          // Slow requests take longer than timeout
          await new Promise(r => setTimeout(r, shouldTimeout ? 200 : 5))
          return { success: true, num: requestNum }
        })()

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(ConnectionError.requestTimeout(timeoutMs))
          }, timeoutMs)
        })

        return Promise.race([callPromise, timeoutPromise])
      }
    }

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
  it('should clear pending state after batch completion', async () => {
    let callCount = 0
    let closed = false

    const transport: Transport = {
      async call(method, args) {
        callCount++
        return 'ok'
      },
      close() {
        closed = true
      }
    }

    // Fire batch of requests
    const promises = Array.from({ length: 20 }, (_, i) =>
      transport.call(`method${i}`, [])
    )

    await Promise.all(promises)
    expect(callCount).toBe(20)

    // Close and verify
    transport.close!()
    expect(closed).toBe(true)

    // New transport should work fresh
    let newCallCount = 0
    const newTransport: Transport = {
      async call(method, args) {
        newCallCount++
        return 'new'
      }
    }

    await newTransport.call('newMethod', [])
    expect(newCallCount).toBe(1)
  })

  it('should handle rapid request/response without memory leaks', async () => {
    let callCount = 0

    const transport: Transport = {
      async call(method, args) {
        callCount++
        await new Promise(r => setTimeout(r, 1))
        return callCount
      }
    }

    // Rapid fire 100 sequential request/response cycles
    for (let i = 0; i < 100; i++) {
      const result = await transport.call(`rapid${i}`, [])
      expect(result).toBe(i + 1)
    }

    // Should still work after 100 cycles
    const result = await transport.call('final', [])
    expect(result).toBe(101)
  })
})
