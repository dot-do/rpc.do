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
 * Infer the return type of an RPC function
 * @example
 * type Result = RpcResult<typeof rpc.ai.generate> // { text: string }
 */
export type RpcResult<T extends (...args: unknown[]) => Promise<unknown>> = T extends (...args: any[]) => Promise<infer R> ? R : never

/**
 * Infer the return type of an RPC function
 * @deprecated Use `RpcResult` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
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
