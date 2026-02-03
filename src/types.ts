/**
 * Core types for rpc.do
 *
 * This module contains the fundamental type definitions shared across the
 * rpc.do codebase. It exists to break circular type imports between
 * index.ts, transports.ts, and do-client.ts.
 *
 * All types here are re-exported from index.ts for backward compatibility.
 *
 * @internal
 */

import type { MinimalTransport, TransportFactory as DotdoTransportFactory } from '@dotdo/types/rpc'

// ============================================================================
// Transport Types (imported from @dotdo/types for consistency)
// ============================================================================

/**
 * Transport interface for rpc.do.
 *
 * This is an alias for `MinimalTransport` from `@dotdo/types/rpc`.
 * For the full transport lifecycle interface with connect/disconnect/events,
 * see `ManagedTransport` from `@dotdo/types/rpc`.
 *
 * @see MinimalTransport from '@dotdo/types/rpc'
 */
export type Transport = MinimalTransport

/**
 * Factory function for creating transports (lazy initialization).
 *
 * This is an alias for `TransportFactory` from `@dotdo/types/rpc`.
 *
 * @see TransportFactory from '@dotdo/types/rpc'
 */
export type TransportFactory = DotdoTransportFactory

// ============================================================================
// Branded Types (Compile-Time Safety)
// ============================================================================

/**
 * Branded type for raw SQL query strings.
 *
 * This provides compile-time safety to ensure SQL queries are explicitly marked
 * as such, preventing accidental injection of untrusted strings into SQL contexts.
 *
 * @example
 * ```typescript
 * import { sqlQuery, type SqlQueryString } from 'rpc.do'
 *
 * // Create a branded SQL query
 * const query: SqlQueryString = sqlQuery('SELECT * FROM users WHERE id = ?')
 *
 * // Type error - cannot assign plain string to SqlQueryString
 * const badQuery: SqlQueryString = 'SELECT * FROM users' // Error!
 * ```
 */
export type SqlQueryString = string & { readonly __brand: 'SqlQuery' }

/**
 * Branded type for RPC method paths (e.g., "users.create", "admin.users.delete").
 *
 * This provides compile-time safety for method path strings, ensuring they are
 * explicitly constructed rather than from arbitrary user input.
 *
 * @example
 * ```typescript
 * import { methodPath, type RpcMethodPath } from 'rpc.do'
 *
 * // Create a branded method path
 * const path: RpcMethodPath = methodPath('users.create')
 *
 * // Type error - cannot assign plain string to RpcMethodPath
 * const badPath: RpcMethodPath = 'users.delete' // Error!
 * ```
 */
export type RpcMethodPath = string & { readonly __brand: 'RpcMethodPath' }

/**
 * Branded type for authentication tokens.
 *
 * This provides compile-time safety for auth tokens, ensuring they are handled
 * through proper channels rather than arbitrary strings.
 *
 * @example
 * ```typescript
 * import { authToken, type AuthToken } from 'rpc.do'
 *
 * // Create a branded auth token
 * const token: AuthToken = authToken('sk_live_xxxxx')
 *
 * // Type error - cannot assign plain string to AuthToken
 * const badToken: AuthToken = 'secret' // Error!
 * ```
 */
export type AuthToken = string & { readonly __brand: 'AuthToken' }

/**
 * Create a branded SQL query string.
 *
 * Use this function to explicitly mark a string as a SQL query for compile-time safety.
 * This is useful when you have a known-safe SQL string that you want to pass to
 * functions expecting SqlQueryString.
 *
 * @param query - The raw SQL query string
 * @returns A branded SqlQueryString
 *
 * @example
 * ```typescript
 * import { sqlQuery } from 'rpc.do'
 *
 * const query = sqlQuery('SELECT * FROM users WHERE id = ?')
 * ```
 */
export function sqlQuery(query: string): SqlQueryString {
  return query as SqlQueryString
}

/**
 * Create a branded RPC method path.
 *
 * Use this function to explicitly mark a string as a method path for compile-time safety.
 * Method paths are dot-separated strings like "users.create" or "admin.users.delete".
 *
 * @param path - The dot-separated method path
 * @returns A branded RpcMethodPath
 *
 * @example
 * ```typescript
 * import { methodPath } from 'rpc.do'
 *
 * const path = methodPath('users.create')
 * ```
 */
export function methodPath(path: string): RpcMethodPath {
  return path as RpcMethodPath
}

/**
 * Create a branded authentication token.
 *
 * Use this function to explicitly mark a string as an auth token for compile-time safety.
 * This ensures tokens are handled through proper channels.
 *
 * @param token - The authentication token string
 * @returns A branded AuthToken
 *
 * @example
 * ```typescript
 * import { authToken } from 'rpc.do'
 *
 * const token = authToken(process.env.API_TOKEN!)
 * ```
 */
export function authToken(token: string): AuthToken {
  return token as AuthToken
}

// ============================================================================
// RPC Type System
// ============================================================================

/**
 * Converts a sync function to async
 */
export type AsyncFunction<T extends (...args: unknown[]) => unknown> = T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never

/**
 * Defines a single RPC function signature
 * @example
 * type Generate = RpcFunction<{ prompt: string }, { text: string }>
 */
export type RpcFunction<TInput = unknown, TOutput = unknown> = (input: TInput) => TOutput

/**
 * Defines a single RPC function signature
 * @deprecated Use `RpcFunction` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 * @example
 * type Generate = RPCFunction<{ prompt: string }, { text: string }>
 */
export type RPCFunction<TInput = unknown, TOutput = unknown> = RpcFunction<TInput, TOutput>

/**
 * Recursively converts an API definition to async proxy type.
 *
 * Note: Uses `(...args: any[]) => any` intentionally in the conditional type.
 * TypeScript requires `any` (not `unknown`) for function type inference to work
 * correctly. Using `unknown` here would prevent TypeScript from properly
 * inferring function types in the mapped type. This is a well-known TypeScript
 * pattern for generic function type handling. See: TS Handbook on Conditional Types.
 *
 * @example
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 * }
 * type Client = RpcProxy<API>
 * // Client.ai.generate is now (p: { prompt: string }) => Promise<{ text: string }>
 */
export type RpcProxy<T extends object> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for function type inference
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? AsyncFunction<T[K]>
    : T[K] extends object
    ? RpcProxy<T[K]> & { close?: () => Promise<void> }
    : T[K]
} & {
  close?: () => Promise<void>
}

/**
 * Recursively converts an API definition to async proxy type
 * @deprecated Use `RpcProxy` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 * @example
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 * }
 * type Client = RPCProxy<API>
 * // Client.ai.generate is now (p: { prompt: string }) => Promise<{ text: string }>
 */
export type RPCProxy<T extends object> = RpcProxy<T>

/**
 * Simple promise type for RPC returns.
 *
 * @deprecated Use `RpcPromise<T>` from @dotdo/types for promise pipelining support. Planned removal: v2.0
 *
 * @example
 * // Old (simple promise):
 * const result: RPCPromise<{ text: string }> = rpc.ai.generate({ prompt: 'hello' })
 *
 * // New (with pipelining):
 * import type { RpcPromise } from 'rpc.do'
 * const result: RpcPromise<{ text: string }> = rpc.ai.generate({ prompt: 'hello' })
 */
export type RPCPromise<T> = Promise<T>

/**
 * Infer the return type of an RPC function.
 *
 * Note: Uses `(...args: any[])` intentionally. TypeScript requires `any` for
 * conditional type inference to work correctly with function types.
 *
 * @example
 * type Result = RpcResult<typeof rpc.ai.generate> // { text: string }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for return type inference
export type RpcResult<T extends (...args: unknown[]) => Promise<unknown>> = T extends (...args: any[]) => Promise<infer R> ? R : never

/**
 * Infer the return type of an RPC function
 * @deprecated Use `RpcResult` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 * @example
 * type Result = RPCResult<typeof rpc.ai.generate> // { text: string }
 */
export type RPCResult<T extends (...args: unknown[]) => Promise<unknown>> = RpcResult<T>

/**
 * Infer the input type of an RPC function.
 *
 * Note: Uses `=> any` intentionally. TypeScript requires `any` for conditional
 * type inference to work correctly. The return type is discarded (we only want `I`).
 *
 * @example
 * type Params = RpcInput<typeof rpc.ai.generate> // { prompt: string }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for input type inference
export type RpcInput<T extends (...args: unknown[]) => unknown> = T extends (input: infer I) => any ? I : never

/**
 * Infer the input type of an RPC function
 * @deprecated Use `RpcInput` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 * @example
 * type Params = RPCInput<typeof rpc.ai.generate> // { prompt: string }
 */
export type RPCInput<T extends (...args: unknown[]) => unknown> = RpcInput<T>

// ============================================================================
// Middleware Types
// ============================================================================

/**
 * Middleware hook for RPC requests and responses.
 *
 * Middleware can intercept calls at three points:
 * - `onRequest`: Before the RPC call is made
 * - `onResponse`: After a successful response
 * - `onError`: When an error occurs
 *
 * @example
 * ```typescript
 * const loggingMiddleware: RpcClientMiddleware = {
 *   onRequest: (method, args) => console.log(`Calling ${method}`, args),
 *   onResponse: (method, result) => console.log(`${method} returned`, result),
 *   onError: (method, error) => console.error(`${method} failed`, error),
 * }
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [loggingMiddleware]
 * })
 * ```
 */
export type RpcClientMiddleware = {
  /** Called before the RPC call is made */
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  /** Called after a successful response */
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (method: string, error: unknown) => void | Promise<void>
}

/**
 * Middleware hook for RPC requests and responses.
 * @deprecated Use `RpcClientMiddleware` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 */
export type RPCClientMiddleware = RpcClientMiddleware

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Options for configuring stream behavior
 */
export interface StreamOptions {
  /**
   * Buffer size for backpressure handling
   * When the buffer reaches this size, the stream will pause consuming from source
   * @default 16
   */
  bufferSize?: number

  /**
   * Timeout in ms for waiting for the next chunk
   * If exceeded, stream will emit an error
   * @default 30000
   */
  chunkTimeout?: number

  /**
   * Whether to automatically reconnect on connection loss
   * @default true
   */
  autoReconnect?: boolean

  /**
   * Maximum reconnection attempts before giving up
   * @default 3
   */
  maxReconnectAttempts?: number

  /**
   * Callback when stream starts
   */
  onStart?: () => void

  /**
   * Callback when stream ends successfully
   */
  onEnd?: () => void

  /**
   * Callback when stream errors
   */
  onError?: (error: Error) => void

  /**
   * Callback when attempting to reconnect
   */
  onReconnect?: (attempt: number) => void
}

/**
 * A streaming RPC response that can be consumed as an AsyncIterable.
 *
 * StreamResponse wraps the underlying stream and provides:
 * - AsyncIterable interface for `for await...of` loops
 * - Manual iteration via `next()`
 * - Stream lifecycle control via `close()`
 * - Backpressure handling
 *
 * @typeParam T - The type of each chunk in the stream
 *
 * @example Basic streaming
 * ```typescript
 * const stream = await $.ai.generateStream({ prompt: 'Hello' })
 *
 * for await (const chunk of stream) {
 *   console.log(chunk.text)
 * }
 * ```
 *
 * @example Manual iteration
 * ```typescript
 * const stream = await $.ai.generateStream({ prompt: 'Hello' })
 *
 * while (true) {
 *   const { value, done } = await stream.next()
 *   if (done) break
 *   process.stdout.write(value.text)
 * }
 * ```
 *
 * @example With cleanup
 * ```typescript
 * const stream = await $.events.subscribe('user:123')
 *
 * try {
 *   for await (const event of stream) {
 *     handleEvent(event)
 *   }
 * } finally {
 *   await stream.close()
 * }
 * ```
 */
export interface StreamResponse<T> extends AsyncIterable<T> {
  /**
   * Get the next chunk from the stream
   * @returns Promise resolving to the next value or done indicator
   */
  next(): Promise<IteratorResult<T, void>>

  /**
   * Close the stream and release resources
   * Safe to call multiple times
   */
  close(): Promise<void>

  /**
   * Whether the stream has been closed
   */
  readonly closed: boolean

  /**
   * The stream ID (for reconnection and debugging)
   */
  readonly id: string
}

/**
 * A subscription to real-time updates from the server.
 *
 * Subscriptions are similar to streams but are specifically designed for
 * event-driven updates where the client subscribes to a topic or channel
 * and receives updates as they occur.
 *
 * @typeParam T - The type of each event/update
 *
 * @example Subscribe to user updates
 * ```typescript
 * const subscription = await $.users.subscribe('user:123')
 *
 * subscription.on('data', (user) => {
 *   console.log('User updated:', user)
 * })
 *
 * subscription.on('error', (error) => {
 *   console.error('Subscription error:', error)
 * })
 *
 * // Later: unsubscribe
 * await subscription.unsubscribe()
 * ```
 *
 * @example Using as AsyncIterable
 * ```typescript
 * const subscription = await $.events.subscribe({ channel: 'notifications' })
 *
 * for await (const event of subscription) {
 *   showNotification(event)
 * }
 * ```
 */
export interface Subscription<T> extends AsyncIterable<T> {
  /**
   * Unique subscription ID
   */
  readonly id: string

  /**
   * The topic/channel being subscribed to
   */
  readonly topic: string

  /**
   * Whether the subscription is active
   */
  readonly active: boolean

  /**
   * Add an event listener
   * @param event - Event type: 'data', 'error', 'end', 'reconnect'
   * @param handler - Event handler function
   */
  on(event: 'data', handler: (data: T) => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'end', handler: () => void): void
  on(event: 'reconnect', handler: (attempt: number) => void): void

  /**
   * Remove an event listener
   * @param event - Event type
   * @param handler - Event handler to remove
   */
  off(event: 'data' | 'error' | 'end' | 'reconnect', handler: (...args: unknown[]) => void): void

  /**
   * Unsubscribe and close the subscription
   */
  unsubscribe(): Promise<void>

  /**
   * Pause receiving updates (for backpressure)
   */
  pause(): void

  /**
   * Resume receiving updates
   */
  resume(): void
}

/**
 * Server-side type for methods that return a stream.
 *
 * Use this to type RPC methods that yield multiple values over time.
 *
 * @typeParam T - The type of each chunk in the stream
 *
 * @example Defining a streaming method
 * ```typescript
 * class MyDO extends DurableRPC {
 *   async *generateStream(prompt: string): StreamableResponse<{ text: string }> {
 *     for await (const chunk of ai.generate(prompt)) {
 *       yield { text: chunk }
 *     }
 *   }
 * }
 * ```
 */
export type StreamableResponse<T> = AsyncGenerator<T, void, unknown>

/**
 * Options for subscribing to a topic
 */
export interface SubscribeOptions {
  /**
   * Filter for specific events
   */
  filter?: Record<string, unknown>

  /**
   * Start from a specific position (for replay)
   */
  startFrom?: string | number

  /**
   * Whether to receive historical events on subscribe
   * @default false
   */
  includeHistory?: boolean

  /**
   * Maximum events to buffer
   * @default 100
   */
  bufferSize?: number
}
