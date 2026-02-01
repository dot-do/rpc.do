/**
 * Performance Benchmark Tests for rpc.do
 *
 * Tests RPC call throughput, concurrent operation handling, and memory stability.
 * Uses mock transports to measure framework overhead without network latency.
 *
 * These tests have CI-friendly thresholds that should pass reliably while
 * still catching significant performance regressions.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { RPC } from '../src/index'
import type { Transport } from '../src/index'

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Measure execution time of an async operation
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now()
  const result = await fn()
  const duration = Date.now() - start
  return { result, duration }
}

/**
 * Get memory usage snapshot (Node.js only)
 */
function getMemoryUsage(): number | null {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed
  }
  return null
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(2)} MB`
}

// ============================================================================
// Mock Transport Factories
// ============================================================================

/**
 * Create a fast mock transport with minimal overhead for benchmarking
 */
function createFastMockTransport(): Transport {
  return {
    async call(method: string, args: unknown[]) {
      // Minimal async overhead
      return { method, args, timestamp: Date.now() }
    },
  }
}

/**
 * Create a mock transport with simulated processing delay
 */
function createDelayedMockTransport(delayMs: number = 0): Transport {
  return {
    async call(method: string, args: unknown[]) {
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs))
      }
      return { method, args }
    },
  }
}

/**
 * Create a mock transport that tracks call counts
 */
function createCountingTransport(): Transport & { callCount: number; reset: () => void } {
  let callCount = 0
  return {
    async call(method: string, args: unknown[]) {
      callCount++
      return { method, args, callNum: callCount }
    },
    get callCount() {
      return callCount
    },
    reset() {
      callCount = 0
    },
  }
}

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe('Performance Benchmarks', () => {
  describe('RPC Call Throughput', () => {
    it('should handle 1000 sequential RPC calls under 1s', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const callCount = 1000

      const { duration } = await measureTime(async () => {
        for (let i = 0; i < callCount; i++) {
          await rpc.method({ index: i })
        }
      })

      console.log(`  1000 sequential calls completed in ${duration}ms (${(callCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Should complete in under 1 second (CI-friendly threshold)
      expect(duration).toBeLessThan(1000)
    })

    it('should handle 100 concurrent RPC calls efficiently', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const concurrentCalls = 100

      const { result: results, duration } = await measureTime(async () => {
        const promises = Array.from({ length: concurrentCalls }, (_, i) =>
          rpc[`method${i}`]({ index: i })
        )
        return Promise.all(promises)
      })

      console.log(`  100 concurrent calls completed in ${duration}ms`)

      // All calls should complete
      expect(results).toHaveLength(concurrentCalls)

      // Should be faster than sequential due to parallelization (within reason for mocks)
      // For mocks, expect under 500ms (generous for CI)
      expect(duration).toBeLessThan(500)
    })

    it('should handle 500 concurrent RPC calls without degradation', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const concurrentCalls = 500

      const { result: results, duration } = await measureTime(async () => {
        const promises = Array.from({ length: concurrentCalls }, (_, i) =>
          rpc[`method${i % 10}`]({ index: i })
        )
        return Promise.all(promises)
      })

      console.log(`  500 concurrent calls completed in ${duration}ms`)

      expect(results).toHaveLength(concurrentCalls)
      // Should complete under 1s even with 500 concurrent calls
      expect(duration).toBeLessThan(1000)
    })

    it('should maintain consistent latency under load', async () => {
      const transport = createDelayedMockTransport(1) // 1ms simulated latency
      const rpc = RPC(transport)
      const batchSize = 50
      const batches = 5
      const latencies: number[] = []

      for (let batch = 0; batch < batches; batch++) {
        const { duration } = await measureTime(async () => {
          const promises = Array.from({ length: batchSize }, (_, i) =>
            rpc.method({ batch, index: i })
          )
          await Promise.all(promises)
        })
        latencies.push(duration)
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
      const maxLatency = Math.max(...latencies)
      const minLatency = Math.min(...latencies)
      const variance = maxLatency - minLatency

      console.log(`  Batch latencies: avg=${avgLatency.toFixed(1)}ms, min=${minLatency}ms, max=${maxLatency}ms, variance=${variance}ms`)

      // Variance should be reasonable (under 3x the min)
      expect(variance).toBeLessThan(minLatency * 3 + 50) // +50ms buffer for CI variability
    })
  })

  describe('Path Resolution Performance', () => {
    it('should handle deeply nested paths efficiently', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const callCount = 1000

      const { duration } = await measureTime(async () => {
        for (let i = 0; i < callCount; i++) {
          // Deeply nested path resolution
          await (rpc as any).namespace.subnamespace.module.method({ index: i })
        }
      })

      console.log(`  1000 deep path calls completed in ${duration}ms`)

      // Should still be under 1s even with path resolution overhead
      expect(duration).toBeLessThan(1000)
    })

    it('should handle varied path depths efficiently', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const callCount = 500

      const { duration } = await measureTime(async () => {
        for (let i = 0; i < callCount; i++) {
          const depth = i % 5
          switch (depth) {
            case 0:
              await (rpc as any).method({ i })
              break
            case 1:
              await (rpc as any).ns.method({ i })
              break
            case 2:
              await (rpc as any).ns.sub.method({ i })
              break
            case 3:
              await (rpc as any).ns.sub.deep.method({ i })
              break
            case 4:
              await (rpc as any).ns.sub.deep.very.method({ i })
              break
          }
        }
      })

      console.log(`  500 varied-depth calls completed in ${duration}ms`)

      expect(duration).toBeLessThan(500)
    })
  })

  describe('Memory Stability', () => {
    it('should not significantly increase memory over 1000 operations', async () => {
      // Skip if memory API not available (browser environment)
      const initialMemory = getMemoryUsage()
      if (initialMemory === null) {
        console.log('  Skipping memory test - memory API not available')
        return
      }

      const transport = createFastMockTransport()
      const rpc = RPC(transport)
      const operationCount = 1000

      // Perform many operations
      for (let i = 0; i < operationCount; i++) {
        await rpc.method({ data: 'x'.repeat(100), index: i })
      }

      // Force GC if available
      if (typeof global !== 'undefined' && (global as any).gc) {
        ;(global as any).gc()
      }

      const finalMemory = getMemoryUsage()!
      const memoryIncrease = finalMemory - initialMemory
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024)

      console.log(`  Initial memory: ${formatBytes(initialMemory)}`)
      console.log(`  Final memory: ${formatBytes(finalMemory)}`)
      console.log(`  Memory increase: ${formatBytes(memoryIncrease)}`)

      // Memory increase should be reasonable (under 50MB for 1000 ops)
      expect(memoryIncreaseMB).toBeLessThan(50)
    })

    it('should not leak memory with create/use/close cycles', async () => {
      const initialMemory = getMemoryUsage()
      if (initialMemory === null) {
        console.log('  Skipping memory test - memory API not available')
        return
      }

      const cycles = 100

      for (let i = 0; i < cycles; i++) {
        const transport = createFastMockTransport()
        const rpc = RPC(transport)
        await rpc.method({ cycle: i })
        transport.close?.()
      }

      // Force GC if available
      if (typeof global !== 'undefined' && (global as any).gc) {
        ;(global as any).gc()
      }

      const finalMemory = getMemoryUsage()!
      const memoryIncrease = finalMemory - initialMemory
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024)

      console.log(`  Memory increase after ${cycles} create/close cycles: ${formatBytes(memoryIncrease)}`)

      // Should not leak significantly (under 20MB for 100 cycles)
      expect(memoryIncreaseMB).toBeLessThan(20)
    })
  })

  describe('Mixed Operation Load', () => {
    it('should handle mixed success/error patterns efficiently', async () => {
      let callNum = 0
      const transport: Transport = {
        async call(method: string, args: unknown[]) {
          callNum++
          // Every 5th call fails
          if (callNum % 5 === 0) {
            throw new Error(`Simulated error for call ${callNum}`)
          }
          return { method, args, callNum }
        },
      }

      const rpc = RPC(transport)
      const callCount = 500

      const { duration } = await measureTime(async () => {
        const promises: Promise<any>[] = []
        for (let i = 0; i < callCount; i++) {
          promises.push(
            rpc.method({ index: i })
              .then(r => ({ status: 'success', result: r }))
              .catch(e => ({ status: 'error', error: e.message }))
          )
        }
        return Promise.all(promises)
      })

      console.log(`  500 mixed success/error calls completed in ${duration}ms`)

      // Should complete efficiently even with error handling
      expect(duration).toBeLessThan(500)
    })

    it('should handle rapid sequential operations', async () => {
      const transport = createCountingTransport()
      const rpc = RPC(transport)
      const operationCount = 2000

      const { duration } = await measureTime(async () => {
        for (let i = 0; i < operationCount; i++) {
          await rpc.rapidCall({ i })
        }
      })

      console.log(`  ${operationCount} rapid sequential calls completed in ${duration}ms (${(operationCount / duration * 1000).toFixed(0)} ops/sec)`)

      expect(transport.callCount).toBe(operationCount)
      // 2000 calls should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })
  })

  describe('Stress Testing', () => {
    it('should survive burst traffic patterns', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)

      // Simulate burst traffic: 5 bursts of 100 concurrent calls
      const bursts = 5
      const burstSize = 100
      const totalDuration: number[] = []

      for (let burst = 0; burst < bursts; burst++) {
        const { duration } = await measureTime(async () => {
          const promises = Array.from({ length: burstSize }, (_, i) =>
            rpc.burstCall({ burst, index: i })
          )
          await Promise.all(promises)
        })
        totalDuration.push(duration)

        // Small delay between bursts
        await new Promise(r => setTimeout(r, 10))
      }

      const avgBurstDuration = totalDuration.reduce((a, b) => a + b, 0) / totalDuration.length
      console.log(`  ${bursts} bursts of ${burstSize} calls, avg burst duration: ${avgBurstDuration.toFixed(1)}ms`)

      // Each burst should complete quickly
      expect(Math.max(...totalDuration)).toBeLessThan(200)
    })

    it('should handle sustained high throughput', async () => {
      const transport = createFastMockTransport()
      const rpc = RPC(transport)

      // 10 seconds of sustained operations (or 5000 ops, whichever comes first)
      const maxOps = 5000
      const maxDurationMs = 10000
      let opsCompleted = 0
      const startTime = Date.now()

      while (opsCompleted < maxOps && Date.now() - startTime < maxDurationMs) {
        // Batch of 50 concurrent calls
        const batch = Array.from({ length: 50 }, (_, i) =>
          rpc.sustainedCall({ op: opsCompleted + i })
        )
        await Promise.all(batch)
        opsCompleted += 50
      }

      const duration = Date.now() - startTime
      const throughput = (opsCompleted / duration) * 1000

      console.log(`  Sustained throughput: ${opsCompleted} ops in ${duration}ms (${throughput.toFixed(0)} ops/sec)`)

      // Should maintain at least 1000 ops/sec
      expect(throughput).toBeGreaterThan(1000)
    })
  })
})
