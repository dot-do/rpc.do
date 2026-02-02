/**
 * Shared middleware types for rpc.do
 *
 * These base types are shared between client and server middleware implementations.
 * They define common option interfaces that can be extended by each side.
 *
 * @module
 */

// ============================================================================
// Base Option Types (Shared between client and server)
// ============================================================================

/**
 * Base options for logging middleware.
 *
 * These options are common to both client (`loggingMiddleware`) and
 * server (`serverLoggingMiddleware`) implementations.
 *
 * @example
 * ```typescript
 * // Client-side
 * import { loggingMiddleware } from 'rpc.do/middleware'
 * const mw = loggingMiddleware({
 *   prefix: '[API]',
 *   logArgs: false,
 * })
 *
 * // Server-side (same options)
 * import { serverLoggingMiddleware } from '@dotdo/rpc'
 * const mw = serverLoggingMiddleware({
 *   prefix: '[API]',
 *   logArgs: false,
 * })
 * ```
 */
export interface BaseLoggingOptions {
  /** Custom logger function (default: console.log) */
  log?: (message: string, ...args: unknown[]) => void
  /** Custom error logger function (default: console.error) */
  error?: (message: string, ...args: unknown[]) => void
  /** Prefix for log messages (default: '[RPC]') */
  prefix?: string
  /** Whether to log request arguments (default: true) */
  logArgs?: boolean
  /** Whether to log response data (default: true) */
  logResult?: boolean
}

/**
 * Base options for timing middleware.
 *
 * These options are common to both client (`timingMiddleware`) and
 * server (`serverTimingMiddleware`) implementations.
 *
 * @example
 * ```typescript
 * // Client-side
 * import { timingMiddleware } from 'rpc.do/middleware'
 * const mw = timingMiddleware({
 *   threshold: 100,  // Only log calls > 100ms
 *   onTiming: (method, ms) => metrics.record(method, ms),
 * })
 *
 * // Server-side (same options)
 * import { serverTimingMiddleware } from '@dotdo/rpc'
 * const mw = serverTimingMiddleware({
 *   threshold: 100,
 *   onTiming: (method, ms) => metrics.record(method, ms),
 * })
 * ```
 */
export interface BaseTimingOptions {
  /** Custom logger function (default: console.log) */
  log?: (message: string) => void
  /** Prefix for log messages (default: '[RPC Timing]') */
  prefix?: string
  /** Threshold in ms - only log if call takes longer than this (default: 0) */
  threshold?: number
  /** Callback for each timing measurement */
  onTiming?: (method: string, durationMs: number) => void
}

/**
 * Result type for middleware hooks.
 *
 * Middleware hooks can be synchronous (return void) or asynchronous (return Promise<void>).
 */
export type MiddlewareHookResult = void | Promise<void>

// ============================================================================
// Middleware Interface Documentation Types
// ============================================================================

/**
 * Base middleware hook signature without context.
 *
 * Used by client-side middleware where no server context is available.
 *
 * @internal
 */
export type ClientMiddlewareHook = (
  method: string,
  args: unknown[]
) => MiddlewareHookResult

/**
 * Base middleware response hook signature without context.
 *
 * @internal
 */
export type ClientResponseHook = (
  method: string,
  result: unknown
) => MiddlewareHookResult

/**
 * Base middleware error hook signature without context.
 *
 * @internal
 */
export type ClientErrorHook = (
  method: string,
  error: unknown
) => MiddlewareHookResult
