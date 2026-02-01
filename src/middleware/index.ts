/**
 * RPC Client Middleware
 *
 * Middleware hooks for request/response interception.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [
 *     loggingMiddleware(),
 *     timingMiddleware({ threshold: 100 })
 *   ]
 * })
 * ```
 */

export { loggingMiddleware, type LoggingOptions } from './logging'
export { timingMiddleware, type TimingOptions } from './timing'
