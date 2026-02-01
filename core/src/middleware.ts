/**
 * Server-side Middleware for DurableRPC
 *
 * Middleware hooks for intercepting RPC calls on the server side.
 * Similar to client-side middleware but runs inside the Durable Object.
 *
 * @example
 * ```typescript
 * import { DurableRPC, type ServerMiddleware } from '@dotdo/rpc'
 *
 * const loggingMiddleware: ServerMiddleware = {
 *   onRequest: (method, args, ctx) => console.log(`[RPC] ${method} called`),
 *   onResponse: (method, result, ctx) => console.log(`[RPC] ${method} completed`),
 *   onError: (method, error, ctx) => console.error(`[RPC] ${method} failed`, error),
 * }
 *
 * export class MyDO extends DurableRPC {
 *   middleware = [loggingMiddleware]
 *
 *   users = {
 *     get: async (id: string) => this.sql`SELECT * FROM users WHERE id = ${id}`.one()
 *   }
 * }
 * ```
 */

/**
 * Context provided to server middleware hooks.
 * Contains environment bindings and other request context.
 */
export interface MiddlewareContext {
  /** Environment bindings (from DO constructor) */
  env: unknown
  /** The current request (if available) */
  request?: Request
}

/**
 * Server-side middleware hook interface.
 *
 * All hooks are optional and can be sync or async.
 * Middleware is called in order for onRequest/onResponse,
 * and in reverse order for onError.
 *
 * @example
 * ```typescript
 * const authMiddleware: ServerMiddleware = {
 *   onRequest: async (method, args, ctx) => {
 *     const request = ctx.request
 *     if (!request?.headers.get('Authorization')) {
 *       throw new Error('Unauthorized')
 *     }
 *   }
 * }
 *
 * const loggingMiddleware: ServerMiddleware = {
 *   onRequest: (method, args) => console.log(`Calling ${method}`),
 *   onResponse: (method, result) => console.log(`${method} returned`),
 *   onError: (method, error) => console.error(`${method} failed:`, error),
 * }
 * ```
 */
export interface ServerMiddleware {
  /**
   * Called before the RPC method is executed.
   * Throw to reject the request (e.g., for auth).
   */
  onRequest?(method: string, args: unknown[], ctx: MiddlewareContext): void | Promise<void>

  /**
   * Called after successful RPC method execution.
   * Can be used for logging, metrics, etc.
   */
  onResponse?(method: string, result: unknown, ctx: MiddlewareContext): void | Promise<void>

  /**
   * Called when the RPC method throws an error.
   * Can be used for error logging, metrics, etc.
   * Note: This doesn't prevent the error from propagating.
   */
  onError?(method: string, error: unknown, ctx: MiddlewareContext): void | Promise<void>
}

/**
 * Run onRequest hooks for all middleware in order.
 * If any middleware throws, the error propagates and subsequent middleware is not called.
 *
 * @internal
 */
export async function runOnRequest(
  middleware: ServerMiddleware[],
  method: string,
  args: unknown[],
  ctx: MiddlewareContext
): Promise<void> {
  for (const mw of middleware) {
    if (mw.onRequest) {
      await mw.onRequest(method, args, ctx)
    }
  }
}

/**
 * Run onResponse hooks for all middleware in order.
 * Errors in onResponse hooks are caught and logged, not propagated.
 *
 * @internal
 */
export async function runOnResponse(
  middleware: ServerMiddleware[],
  method: string,
  result: unknown,
  ctx: MiddlewareContext
): Promise<void> {
  for (const mw of middleware) {
    if (mw.onResponse) {
      try {
        await mw.onResponse(method, result, ctx)
      } catch (err) {
        // Log but don't propagate - middleware errors shouldn't break RPC
        console.error(`[ServerMiddleware] onResponse error in middleware:`, err)
      }
    }
  }
}

/**
 * Run onError hooks for all middleware in reverse order.
 * Errors in onError hooks are caught and logged, not propagated.
 *
 * @internal
 */
export async function runOnError(
  middleware: ServerMiddleware[],
  method: string,
  error: unknown,
  ctx: MiddlewareContext
): Promise<void> {
  // Run in reverse order (like catch blocks)
  for (let i = middleware.length - 1; i >= 0; i--) {
    const mw = middleware[i]
    if (mw?.onError) {
      try {
        await mw.onError(method, error, ctx)
      } catch (err) {
        // Log but don't propagate - middleware errors shouldn't break RPC
        console.error(`[ServerMiddleware] onError error in middleware:`, err)
      }
    }
  }
}

/**
 * Wrap a method with middleware hooks.
 *
 * @internal
 */
export function wrapWithMiddleware<T extends (...args: unknown[]) => unknown>(
  method: string,
  fn: T,
  middleware: ServerMiddleware[],
  getContext: () => MiddlewareContext
): T {
  if (middleware.length === 0) {
    return fn
  }

  const wrapped = async function (...args: unknown[]): Promise<unknown> {
    const ctx = getContext()

    // Run onRequest hooks (can throw to reject)
    await runOnRequest(middleware, method, args, ctx)

    let result: unknown
    try {
      // Call the actual method
      result = await fn(...args)
    } catch (err) {
      // Run onError hooks
      await runOnError(middleware, method, err, ctx)
      throw err
    }

    // Run onResponse hooks
    await runOnResponse(middleware, method, result, ctx)

    return result
  } as T

  return wrapped
}

// ============================================================================
// Pre-built Middleware
// ============================================================================

/**
 * Options for the server logging middleware
 */
export interface ServerLoggingOptions {
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
 * Create a server-side logging middleware.
 *
 * @example
 * ```typescript
 * import { DurableRPC, serverLoggingMiddleware } from '@dotdo/rpc'
 *
 * export class MyDO extends DurableRPC {
 *   middleware = [serverLoggingMiddleware()]
 *   // ...
 * }
 * ```
 */
export function serverLoggingMiddleware(options: ServerLoggingOptions = {}): ServerMiddleware {
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
        log(`${prefix} ${method} called with:`, args)
      } else {
        log(`${prefix} ${method} called`)
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

/**
 * Options for the server timing middleware
 */
export interface ServerTimingOptions {
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
 * Create a server-side timing middleware.
 *
 * @example
 * ```typescript
 * import { DurableRPC, serverTimingMiddleware } from '@dotdo/rpc'
 *
 * export class MyDO extends DurableRPC {
 *   middleware = [serverTimingMiddleware({ threshold: 100 })]
 *   // ...
 * }
 * ```
 */
export function serverTimingMiddleware(options: ServerTimingOptions = {}): ServerMiddleware {
  const {
    log = console.log.bind(console),
    prefix = '[RPC Timing]',
    threshold = 0,
    onTiming,
  } = options

  // Use a Map to track start times per call
  // Key: method + counter for uniqueness
  const timings = new Map<string, number>()
  let callId = 0

  return {
    onRequest(method: string): void {
      // Store start time with unique key
      timings.set(`${method}:${++callId}`, performance.now())
    },

    onResponse(method: string): void {
      const endTime = performance.now()

      // Find the timing entry for this method
      let startTime: number | undefined
      let keyToDelete: string | undefined

      for (const [key, time] of timings) {
        if (key.startsWith(`${method}:`)) {
          startTime = time
          keyToDelete = key
          break
        }
      }

      if (startTime !== undefined && keyToDelete) {
        const durationMs = endTime - startTime
        timings.delete(keyToDelete)

        if (onTiming) {
          onTiming(method, durationMs)
        }

        if (durationMs >= threshold) {
          log(`${prefix} ${method} took ${durationMs.toFixed(2)}ms`)
        }
      }
    },

    onError(method: string): void {
      const endTime = performance.now()

      // Find and clean up the timing entry
      let startTime: number | undefined
      let keyToDelete: string | undefined

      for (const [key, time] of timings) {
        if (key.startsWith(`${method}:`)) {
          startTime = time
          keyToDelete = key
          break
        }
      }

      if (startTime !== undefined && keyToDelete) {
        const durationMs = endTime - startTime
        timings.delete(keyToDelete)

        if (onTiming) {
          onTiming(method, durationMs)
        }

        if (durationMs >= threshold) {
          log(`${prefix} ${method} failed after ${durationMs.toFixed(2)}ms`)
        }
      }
    },
  }
}
