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

  // Map to store start times by a unique request key
  // We use method + timestamp as key since same method can be called concurrently
  const timings = new Map<string, TimingContext>()

  // Generate a unique key for each request
  let requestId = 0
  const getRequestKey = (method: string): string => {
    return `${method}:${++requestId}`
  }

  // Store the current request key in closure
  let currentRequestKey: string | null = null

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
    const entries = Array.from(timings.entries())
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      const [key, ctx] = entry
      if (ctx.startTime < staleThreshold) {
        timings.delete(key)
      }
    }
  }

  return {
    onRequest(method: string, _args: unknown[]): void {
      // Clean up stale entries on each request to prevent unbounded growth
      cleanupStaleEntries()

      currentRequestKey = getRequestKey(method)
      timings.set(currentRequestKey, {
        method,
        startTime: performance.now(),
      })
    },

    onResponse(method: string, _result: unknown): void {
      const endTime = performance.now()

      // Find the timing for this method (most recent one)
      let timing: TimingContext | undefined
      let keyToDelete: string | undefined

      const entries = Array.from(timings.entries())
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry) continue
        const [key, ctx] = entry
        if (ctx.method === method) {
          timing = ctx
          keyToDelete = key
          break
        }
      }

      if (timing && keyToDelete) {
        const durationMs = endTime - timing.startTime
        timings.delete(keyToDelete)

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

      // Find the timing for this method (most recent one)
      let timing: TimingContext | undefined
      let keyToDelete: string | undefined

      const entries = Array.from(timings.entries())
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry) continue
        const [key, ctx] = entry
        if (ctx.method === method) {
          timing = ctx
          keyToDelete = key
          break
        }
      }

      if (timing && keyToDelete) {
        const durationMs = endTime - timing.startTime
        timings.delete(keyToDelete)

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
