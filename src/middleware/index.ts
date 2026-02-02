/**
 * RPC Client Middleware
 *
 * Middleware hooks for request/response interception.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { loggingMiddleware, timingMiddleware, retryMiddleware } from 'rpc.do/middleware'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [
 *     loggingMiddleware(),
 *     timingMiddleware({ threshold: 100 }),
 *     retryMiddleware({ maxAttempts: 3 })
 *   ]
 * })
 * ```
 */

export { loggingMiddleware, type LoggingOptions } from './logging'
export { timingMiddleware, type TimingOptions } from './timing'
export { retryObserver, retryMiddleware, withRetry, type RetryOptions } from './retry'
export {
  withBatching,
  withDebouncedBatching,
  type BatchingOptions,
  type BatchedRequest,
  type BatchedResponse,
} from './batching'

// Re-export shared base types for ecosystem compatibility
export type {
  BaseLoggingOptions,
  BaseTimingOptions,
  MiddlewareHookResult,
} from './types'

// ============================================================================
// Transport Wrappers
// ============================================================================

import type { RpcClientMiddleware } from '../types'

/**
 * Wrap a transport with middleware support
 *
 * This is a convenience function to apply middleware to any transport.
 * It's similar to what happens internally when you pass middleware to RPC(),
 * but allows you to create a reusable wrapped transport.
 *
 * @param transport - The transport to wrap
 * @param middleware - Array of middleware to apply
 * @returns A new transport with middleware applied
 *
 * @example
 * ```typescript
 * import { http } from 'rpc.do/transports'
 * import { withMiddleware, loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'
 *
 * // Create a transport with middleware
 * const transport = withMiddleware(
 *   http('https://api.example.com'),
 *   [loggingMiddleware(), timingMiddleware()]
 * )
 *
 * // Use with RPC
 * const $ = RPC(transport)
 *
 * // Or reuse across multiple clients
 * const api1 = RPC(transport)
 * const api2 = RPC(transport)
 * ```
 *
 * @example
 * ```typescript
 * // Chain multiple wrappers
 * import { withMiddleware, withRetry } from 'rpc.do/middleware'
 *
 * const transport = withMiddleware(
 *   withRetry(http('https://api.example.com'), { maxAttempts: 3 }),
 *   [loggingMiddleware()]
 * )
 * ```
 */
export function withMiddleware(
  transport: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void },
  middleware: RpcClientMiddleware[]
): { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } {
  if (!middleware.length) {
    return transport
  }

  const wrapped: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } = {
    async call(method: string, args: unknown[]): Promise<unknown> {
      // Execute onRequest hooks
      for (const mw of middleware) {
        if (mw.onRequest) {
          await mw.onRequest(method, args)
        }
      }

      try {
        // Make the actual call
        const result = await transport.call(method, args)

        // Execute onResponse hooks
        for (const mw of middleware) {
          if (mw.onResponse) {
            await mw.onResponse(method, result)
          }
        }

        return result
      } catch (error) {
        // Execute onError hooks
        for (const mw of middleware) {
          if (mw.onError) {
            await mw.onError(method, error)
          }
        }

        // Re-throw the error
        throw error
      }
    },
  }

  // Only set close if it exists
  if (transport.close) {
    wrapped.close = transport.close
  }

  return wrapped
}
