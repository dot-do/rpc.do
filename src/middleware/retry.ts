/**
 * Retry observer middleware and retry transport wrapper for RPC client.
 *
 * IMPORTANT: The middleware (`retryObserver`) provides observability hooks only
 * (onRetry callbacks, attempt tracking). It does NOT perform actual retries.
 *
 * For actual retry behavior, use the `withRetry()` transport wrapper instead.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { withRetry } from 'rpc.do/middleware'
 * import { http } from 'rpc.do/transports'
 *
 * // Actual retry behavior via transport wrapper:
 * const transport = withRetry(http('https://my-do.workers.dev'), {
 *   maxAttempts: 3,
 *   onRetry: (method, error, attempt) => console.log(`Retry ${attempt}`)
 * })
 * const $ = RPC(transport)
 * ```
 */

import type { RpcClientMiddleware } from '../types'
import { ConnectionError, RPCError } from '../errors'

/**
 * Options for the retry middleware
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Initial delay in ms before first retry (default: 100) */
  initialDelay?: number
  /** Maximum delay in ms between retries (default: 5000) */
  maxDelay?: number
  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number
  /** Whether to add jitter to delay (default: true) */
  jitter?: boolean
  /** Custom function to determine if an error is retryable */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Callback when a retry is attempted */
  onRetry?: (method: string, error: unknown, attempt: number, delay: number) => void
}

/**
 * Retry context stored per request
 */
interface RetryContext {
  method: string
  args: unknown[]
  attempts: number
  lastError?: unknown
}

/**
 * Default implementation of shouldRetry
 * Returns true for network errors, timeouts, and 5xx errors
 */
function defaultShouldRetry(error: unknown): boolean {
  // ConnectionError with retryable flag
  if (error instanceof ConnectionError) {
    return error.retryable
  }

  // RPCError is typically not retryable (business logic error)
  if (error instanceof RPCError) {
    // Some RPC errors may be retryable (temporary server issues)
    const code = error.code.toUpperCase()
    return (
      code === 'UNAVAILABLE' ||
      code === 'DEADLINE_EXCEEDED' ||
      code === 'RESOURCE_EXHAUSTED'
    )
  }

  // Generic Error - check message for common retryable patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('fetch') ||
      message.includes('socket') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    )
  }

  return false
}

/**
 * Calculate delay with optional jitter
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  useJitter: boolean
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt)

  // Cap at maxDelay
  delay = Math.min(delay, maxDelay)

  // Add jitter (up to 25% variation)
  if (useJitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5 // 0.75 to 1.25
    delay = delay * jitterFactor
  }

  return Math.round(delay)
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a retry observer middleware.
 *
 * This middleware provides **observability only** -- it tracks retry-related
 * state (attempt counts) and fires the `onRetry` callback, but it does NOT
 * actually re-issue failed requests.  Middleware hooks (`onRequest`, `onError`,
 * `onResponse`) run around a single transport call and cannot initiate new ones.
 *
 * For actual retry behavior, use the {@link withRetry} transport wrapper which
 * implements a real retry loop with exponential backoff.
 *
 * @param options - Retry options (shared with `withRetry`)
 * @returns RpcClientMiddleware that observes retry-eligible errors
 *
 * @example
 * ```typescript
 * import { retryObserver } from 'rpc.do/middleware'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [retryObserver({
 *     onRetry: (method, error, attempt, delay) => {
 *       console.log(`[observer] ${method} attempt ${attempt}, delay ${delay}ms`)
 *     }
 *   })]
 * })
 * ```
 */
export function retryObserver(options: RetryOptions = {}): RpcClientMiddleware {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffMultiplier = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options

  // Track retry state per method call
  // Note: This is a simplified approach that works for sequential calls
  // For concurrent calls, the retry transport wrapper should be used
  const retryState = new Map<string, RetryContext>()
  let requestId = 0

  return {
    onRequest(method: string, args: unknown[]): void {
      // Store initial request context
      const key = `${method}:${++requestId}`
      retryState.set(key, {
        method,
        args,
        attempts: 0,
      })
    },

    async onError(method: string, error: unknown): Promise<void> {
      // Find the retry context for this method
      let context: RetryContext | undefined
      let contextKey: string | undefined

      const entries = Array.from(retryState.entries())
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry) continue
        const [key, ctx] = entry
        if (ctx.method === method) {
          context = ctx
          contextKey = key
          break
        }
      }

      if (!context || !contextKey) {
        return
      }

      // Check if we should retry
      const shouldRetryError = shouldRetry(error, context.attempts)
      const canRetry = context.attempts < maxAttempts - 1 // -1 because we haven't counted this attempt yet

      if (shouldRetryError && canRetry) {
        context.attempts++
        context.lastError = error

        // Calculate delay
        const delay = calculateDelay(
          context.attempts - 1,
          initialDelay,
          maxDelay,
          backoffMultiplier,
          jitter
        )

        // Call retry callback
        if (onRetry) {
          onRetry(method, error, context.attempts, delay)
        }

        // Middleware hooks cannot re-issue requests. This observer only
        // tracks state and fires callbacks. Use withRetry() for real retries.
      } else {
        // Clean up on final failure
        retryState.delete(contextKey)
      }
    },

    onResponse(method: string): void {
      // Clean up on success
      const entries = Array.from(retryState.entries())
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (!entry) continue
        const [key, ctx] = entry
        if (ctx.method === method) {
          retryState.delete(key)
          break
        }
      }
    },
  }
}

/**
 * Create a retry-enabled transport wrapper
 *
 * This wraps a transport to add automatic retry functionality.
 * Unlike the middleware, this actually implements the retry loop.
 *
 * @param transport - The transport to wrap
 * @param options - Retry options
 * @returns A new transport with retry support
 *
 * @example
 * ```typescript
 * import { http, withRetry } from 'rpc.do/transports'
 *
 * const transport = withRetry(http('https://api.example.com'), {
 *   maxAttempts: 5,
 *   onRetry: (method, error, attempt) => console.log(`Retry ${attempt}`)
 * })
 *
 * const $ = RPC(transport)
 * ```
 */
export function withRetry(
  transport: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void },
  options: RetryOptions = {}
): { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 5000,
    backoffMultiplier = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options

  const wrapped: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } = {
    async call(method: string, args: unknown[]): Promise<unknown> {
      let lastError: unknown
      let attempt = 0

      while (attempt < maxAttempts) {
        try {
          return await transport.call(method, args)
        } catch (error) {
          lastError = error
          attempt++

          // Check if we should retry
          const canRetry = attempt < maxAttempts && shouldRetry(error, attempt)

          if (!canRetry) {
            throw error
          }

          // Calculate and wait for delay
          const delay = calculateDelay(
            attempt - 1,
            initialDelay,
            maxDelay,
            backoffMultiplier,
            jitter
          )

          // Call retry callback
          if (onRetry) {
            onRetry(method, error, attempt, delay)
          }

          await sleep(delay)
        }
      }

      // Should not reach here, but just in case
      throw lastError
    },
  }

  // Only set close if it exists
  if (transport.close) {
    wrapped.close = transport.close
  }

  return wrapped
}

/**
 * @deprecated Renamed to {@link retryObserver}. This middleware provides
 * observability hooks only and does **not** perform actual retries. For real
 * retry behavior, use the {@link withRetry} transport wrapper from
 * `'rpc.do/middleware'`.
 *
 * @example
 * ```typescript
 * // BEFORE (misleading -- no retries happen):
 * middleware: [retryMiddleware({ maxAttempts: 3 })]
 *
 * // AFTER (actual retries via transport wrapper):
 * import { withRetry } from 'rpc.do/middleware'
 * const transport = withRetry(http('https://api.example.com'), { maxAttempts: 3 })
 * const $ = RPC(transport)
 *
 * // If you only need the observer callbacks, use the new name:
 * middleware: [retryObserver({ onRetry: ... })]
 * ```
 */
export function retryMiddleware(options: RetryOptions = {}): RpcClientMiddleware {
  return retryObserver(options)
}

export default retryMiddleware
