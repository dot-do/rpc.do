/**
 * Logging middleware for RPC client
 *
 * Logs all RPC requests, responses, and errors to the console.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { loggingMiddleware } from 'rpc.do/middleware/logging'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [loggingMiddleware()]
 * })
 *
 * // All calls will be logged:
 * // [RPC] Calling users.list with args: []
 * // [RPC] users.list returned: [{ id: '1', name: 'John' }]
 * await $.users.list()
 * ```
 */

import type { RpcClientMiddleware } from '../index'
import type { BaseLoggingOptions } from './types'

/**
 * Options for the logging middleware.
 *
 * Extends {@link BaseLoggingOptions} which is shared with server-side middleware.
 *
 * @see BaseLoggingOptions for shared options
 */
export interface LoggingOptions extends BaseLoggingOptions {
  // Currently identical to BaseLoggingOptions
  // Client-specific options can be added here in the future
}

/**
 * Create a logging middleware
 *
 * @param options - Logging options
 * @returns RpcClientMiddleware that logs requests, responses, and errors
 *
 * @example
 * ```typescript
 * // Default logging
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [loggingMiddleware()]
 * })
 *
 * // Custom logger
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [loggingMiddleware({
 *     log: (msg, ...args) => myLogger.info(msg, ...args),
 *     error: (msg, ...args) => myLogger.error(msg, ...args),
 *     prefix: '[API]'
 *   })]
 * })
 *
 * // Minimal logging (no args/results)
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [loggingMiddleware({
 *     logArgs: false,
 *     logResult: false
 *   })]
 * })
 * ```
 */
export function loggingMiddleware(options: LoggingOptions = {}): RpcClientMiddleware {
  const {
    log = console.log.bind(console),
    error = console.error.bind(console),
    prefix = '[RPC]',
    logArgs = true,
    logResult = true,
  } = options

  return {
    onRequest(method: string, args: unknown[]): void {
      if (logArgs) {
        log(`${prefix} Calling ${method} with args:`, args)
      } else {
        log(`${prefix} Calling ${method}`)
      }
    },

    onResponse(method: string, result: unknown): void {
      if (logResult) {
        log(`${prefix} ${method} returned:`, result)
      } else {
        log(`${prefix} ${method} completed`)
      }
    },

    onError(method: string, err: unknown): void {
      error(`${prefix} ${method} failed:`, err)
    },
  }
}

export default loggingMiddleware
