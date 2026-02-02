/**
 * Timing middleware for RPC client
 *
 * Tracks execution time for all RPC calls.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { timingMiddleware } from 'rpc.do/middleware/timing'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [timingMiddleware()]
 * })
 *
 * // All calls will have timing logged:
 * // [RPC Timing] users.list took 45.23ms
 * await $.users.list()
 * ```
 */

import type { RpcClientMiddleware } from '../index'
import type { BaseTimingOptions } from './types'

/**
 * Options for the timing middleware.
 *
 * Extends {@link BaseTimingOptions} which is shared with server-side middleware,
 * and adds client-specific options for memory management.
 *
 * @see BaseTimingOptions for shared options
 */
export interface TimingOptions extends BaseTimingOptions {
  /** TTL in ms for timing entries - entries older than this are automatically cleaned up (default: 60000) */
  ttl?: number
  /** Interval in ms for cleanup check (default: 10000) */
  cleanupInterval?: number
}

/**
 * Timing context stored per request
 */
interface TimingContext {
  method: string
  startTime: number
}

/**
 * Create a timing middleware
 *
 * @param options - Timing options
 * @returns RpcClientMiddleware that tracks execution time
 *
 * @example
 * ```typescript
 * // Default timing
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [timingMiddleware()]
 * })
 *
 * // Only log slow calls (>100ms)
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [timingMiddleware({
 *     threshold: 100
 *   })]
 * })
 *
 * // Collect metrics
 * const metrics: { method: string; durationMs: number }[] = []
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [timingMiddleware({
 *     onTiming: (method, durationMs) => {
 *       metrics.push({ method, durationMs })
 *     }
 *   })]
 * })
 * ```
 */
export function timingMiddleware(options: TimingOptions = {}): RpcClientMiddleware {
  const {
    log = console.log.bind(console),
    prefix = '[RPC Timing]',
    threshold = 0,
    onTiming,
    ttl = 60000,
    cleanupInterval = 10000,
  } = options

  // Map keyed by auto-incrementing request ID to avoid race conditions.
  // When concurrent calls to the same method are in-flight, we find the
  // OLDEST entry (lowest ID) matching the method name (FIFO ordering).
  const timings = new Map<number, TimingContext>()
  let nextRequestId = 0

  // TTL-based cleanup to prevent memory leaks from dropped requests
  let lastCleanup = performance.now()
  const cleanupStaleEntries = (): void => {
    const now = performance.now()
    // Only run cleanup at the configured interval to avoid overhead
    if (now - lastCleanup < cleanupInterval) {
      return
    }
    lastCleanup = now

    const staleThreshold = now - ttl
    for (const [id, ctx] of timings) {
      if (ctx.startTime < staleThreshold) {
        timings.delete(id)
      }
    }
  }

  // Find and remove the oldest timing entry for a given method (FIFO).
  // Map iteration order is insertion order, so the first match is the oldest.
  const findAndRemoveTiming = (method: string): TimingContext | undefined => {
    for (const [id, ctx] of timings) {
      if (ctx.method === method) {
        timings.delete(id)
        return ctx
      }
    }
    return undefined
  }

  return {
    onRequest(method: string, _args: unknown[]): void {
      // Clean up stale entries on each request to prevent unbounded growth
      cleanupStaleEntries()

      const id = nextRequestId++
      timings.set(id, {
        method,
        startTime: performance.now(),
      })
    },

    onResponse(method: string, _result: unknown): void {
      const endTime = performance.now()

      // Find the oldest timing entry for this method (FIFO)
      const timing = findAndRemoveTiming(method)

      if (timing) {
        const durationMs = endTime - timing.startTime

        // Call the callback if provided
        if (onTiming) {
          onTiming(method, durationMs)
        }

        // Log if above threshold
        if (durationMs >= threshold) {
          log(`${prefix} ${method} took ${durationMs.toFixed(2)}ms`)
        }
      }
    },

    onError(method: string, _error: unknown): void {
      const endTime = performance.now()

      // Find the oldest timing entry for this method (FIFO)
      const timing = findAndRemoveTiming(method)

      if (timing) {
        const durationMs = endTime - timing.startTime

        // Call the callback if provided
        if (onTiming) {
          onTiming(method, durationMs)
        }

        // Log if above threshold
        if (durationMs >= threshold) {
          log(`${prefix} ${method} failed after ${durationMs.toFixed(2)}ms`)
        }
      }
    },
  }
}

export default timingMiddleware
