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

// ============================================================================
// Transport Types (rpc.do-specific - compatible with @dotdo/types MinimalTransport)
// ============================================================================

/**
 * Transport interface for rpc.do.
 *
 * This is compatible with MinimalTransport from `@dotdo/types/rpc`.
 * For the full transport lifecycle interface with connect/disconnect/events,
 * see `ManagedTransport` from `@dotdo/types/rpc`.
 *
 * @see MinimalTransport from '@dotdo/types/rpc'
 */
export type Transport = {
  call(method: string, args: unknown[]): Promise<unknown>
  close?(): void
}

/**
 * Factory function for creating transports (lazy initialization).
 *
 * @see TransportFactory from '@dotdo/types/rpc'
 */
export type TransportFactory = () => Transport | Promise<Transport>

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
 * @deprecated Use `RpcFunction` instead (lowercase 'pc' for consistency with capnweb convention)
 * @example
 * type Generate = RPCFunction<{ prompt: string }, { text: string }>
 */
export type RPCFunction<TInput = unknown, TOutput = unknown> = RpcFunction<TInput, TOutput>

/**
 * Recursively converts an API definition to async proxy type
 * @example
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 * }
 * type Client = RpcProxy<API>
 * // Client.ai.generate is now (p: { prompt: string }) => Promise<{ text: string }>
 */
export type RpcProxy<T extends object> = {
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
 * @deprecated Use `RpcProxy` instead (lowercase 'pc' for consistency with capnweb convention)
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
 * @deprecated Use `RpcPromise<T>` from @dotdo/types for promise pipelining support.
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
 * Infer the return type of an RPC function
 * @example
 * type Result = RpcResult<typeof rpc.ai.generate> // { text: string }
 */
export type RpcResult<T extends (...args: unknown[]) => Promise<unknown>> = T extends (...args: any[]) => Promise<infer R> ? R : never

/**
 * Infer the return type of an RPC function
 * @deprecated Use `RpcResult` instead (lowercase 'pc' for consistency with capnweb convention)
 * @example
 * type Result = RPCResult<typeof rpc.ai.generate> // { text: string }
 */
export type RPCResult<T extends (...args: unknown[]) => Promise<unknown>> = RpcResult<T>

/**
 * Infer the input type of an RPC function
 * @example
 * type Params = RpcInput<typeof rpc.ai.generate> // { prompt: string }
 */
export type RpcInput<T extends (...args: unknown[]) => unknown> = T extends (input: infer I) => any ? I : never

/**
 * Infer the input type of an RPC function
 * @deprecated Use `RpcInput` instead (lowercase 'pc' for consistency with capnweb convention)
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
 * @deprecated Use `RpcClientMiddleware` instead (lowercase 'pc' for consistency with capnweb convention)
 */
export type RPCClientMiddleware = RpcClientMiddleware
