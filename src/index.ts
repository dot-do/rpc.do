/**
 * rpc.do - Lightweight transport-agnostic RPC proxy
 *
 * Core: A Proxy that turns property chains into RPC calls
 * Transport: Pluggable (HTTP, WebSocket, capnweb, service bindings, etc.)
 * Auth: Optional, handled by transport or middleware
 */

import { http, capnweb } from './transports'
import { createDOClient } from './do-client'

// ============================================================================
// Re-exports from @dotdo/types
// ============================================================================

/**
 * Re-export RPC types from @dotdo/types for promise pipelining support.
 *
 * These types enable CapnWeb-style promise pipelining where you can chain
 * method calls on not-yet-resolved promises.
 *
 * @example Promise Pipelining
 * ```typescript
 * import type { RpcPromise, RpcArrayMethods } from 'rpc.do'
 *
 * // Without pipelining - 3 round trips:
 * const user = await db.users.get('123')
 * const posts = await user.posts.list()
 * const comments = await posts[0].comments.list()
 *
 * // WITH pipelining - 1 round trip:
 * const comments = await db.users.get('123').posts.list()[0].comments.list()
 * ```
 *
 * Note: The local `Transport` type in rpc.do differs from `@dotdo/types/rpc`
 * Transport interface. rpc.do uses a minimal `{call, close?}` shape for
 * capnweb integration, while @dotdo/types has a full lifecycle interface.
 */
export type {
  // Promise pipelining types (CapnWeb pattern)
  RpcPromise,
  RpcPipelined,
  RpcArrayMethods,
  RpcMapCallback,
  RpcArrayPromise,
  RpcPromiseEnhanced,
  RpcStream,
  RpcAsyncIterable,
  UnwrapRpcPromise,
  MaybeRpcPromise,
  DeepUnwrapRpcPromise,
  IsRpcPromise,

  // JSON-RPC 2.0 message types
  RPCRequest,
  RPCResponse,
  RPCNotification,
  RPCBatchRequest,
  RPCBatchResponse,
  RPCMetadata,
  RPCError as RPCErrorType,
  RPCErrorCode,
  RPCStringErrorCode,

  // Transport types from @dotdo/types
  MinimalTransport,
  TransportFactory as TypesTransportFactory,

  // Connection error types
  ConnectionError as ConnectionErrorInterface,
  ConnectionErrorCode as ConnectionErrorCodeType,
  AuthenticationError as AuthenticationErrorInterface,
  ServerMessage as TypesServerMessage,

  // DO Client types
  DOClient as DOClientInterface,
  DOClientOptions as DOClientOptionsType,
  RemoteStorage as RemoteStorageInterface,
  RemoteCollection as RemoteCollectionInterface,
  SqlQueryResult as SqlQueryResultType,
  SqlQuery as SqlQueryType,

  // Proxy types
  TypedDOStubProxy,
  RPCMiddleware,
  RPCClient,
  RPCServer,
  RPCClientConfig,
  RPCServerConfig,
  RPCMethodHandler,
  RPCHandlerContext,
  CapnWebConfig,
  ProxyOptions,

  // Magic Map types
  MagicMap,
  MutableMagicMap,
} from '@dotdo/types/rpc'

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
 * Defines a single RPC function signature
 * @example
 * type Generate = RPCFunction<{ prompt: string }, { text: string }>
 */
export type RPCFunction<TInput = any, TOutput = any> = (input: TInput) => TOutput

/**
 * Converts a sync function to async
 */
export type AsyncFunction<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never

/**
 * Recursively converts an API definition to async proxy type
 * @example
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 * }
 * type Client = RPCProxy<API>
 * // Client.ai.generate is now (p: { prompt: string }) => Promise<{ text: string }>
 */
export type RPCProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? AsyncFunction<T[K]>
    : T[K] extends object
    ? RPCProxy<T[K]> & { close?: () => Promise<void> }
    : T[K]
} & {
  close?: () => Promise<void>
}

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
 * type Result = RPCResult<typeof rpc.ai.generate> // { text: string }
 */
export type RPCResult<T> = T extends (...args: any[]) => Promise<infer R> ? R : never

/**
 * Infer the input type of an RPC function
 * @example
 * type Params = RPCInput<typeof rpc.ai.generate> // { prompt: string }
 */
export type RPCInput<T> = T extends (input: infer I) => any ? I : never

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
 * const loggingMiddleware: RPCClientMiddleware = {
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
export type RPCClientMiddleware = {
  /** Called before the RPC call is made */
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  /** Called after a successful response */
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (method: string, error: unknown) => void | Promise<void>
}

// ============================================================================
// RPC Factory
// ============================================================================

/**
 * Options for RPC client
 */
export interface RPCOptions {
  /** Auth token or provider */
  auth?: string | (() => string | null | Promise<string | null>)
  /** Request timeout in milliseconds */
  timeout?: number
  /** Enable WebSocket reconnection (default: true for ws/wss URLs) */
  reconnect?: boolean
  /** Middleware chain for request/response hooks */
  middleware?: RPCClientMiddleware[]
}

/**
 * Create an RPC proxy
 *
 * @example
 * // Simple URL (recommended)
 * const $ = RPC('https://my-do.workers.dev')
 * await $.users.create({ name: 'John' })
 *
 * // With auth
 * const $ = RPC('https://my-do.workers.dev', { auth: 'my-token' })
 *
 * // WebSocket for real-time
 * const $ = RPC('wss://my-do.workers.dev')
 *
 * // DO features (sql, storage, collections)
 * const users = await $.sql`SELECT * FROM users`.all()
 * const config = await $.storage.get('config')
 * const admins = await $.collection('users').find({ role: 'admin' })
 *
 * @example
 * // With explicit transport (advanced)
 * const $ = RPC(http('https://my-do.workers.dev'))
 *
 * @example
 * // Typed API
 * interface API {
 *   users: { create: (data: { name: string }) => { id: string } }
 * }
 * const $ = RPC<API>('https://my-do.workers.dev')
 * const result = await $.users.create({ name: 'John' }) // typed!
 */
export function RPC<T = any>(
  urlOrTransport: string | Transport | TransportFactory,
  options?: RPCOptions
): RPCProxy<T> & DOClientFeatures {
  let transport: Transport | TransportFactory

  if (typeof urlOrTransport === 'string') {
    const url = urlOrTransport
    const isWebSocket = url.startsWith('ws://') || url.startsWith('wss://')

    if (isWebSocket) {
      // Build options object, only adding defined values to satisfy exactOptionalPropertyTypes
      const capnwebOpts: import('./transports').CapnwebTransportOptions = {
        reconnect: options?.reconnect ?? true,
      }
      if (options?.auth !== undefined) capnwebOpts.auth = options.auth
      transport = capnweb(url, capnwebOpts)
    } else {
      // Build options object, only adding defined values to satisfy exactOptionalPropertyTypes
      const httpOpts: import('./transports').HttpTransportOptions = {}
      if (options?.auth !== undefined) httpOpts.auth = options.auth
      if (options?.timeout !== undefined) httpOpts.timeout = options.timeout
      transport = http(url, httpOpts)
    }
  } else {
    transport = urlOrTransport
  }

  // Build options for DOClient, only adding defined values
  const doClientOpts: import('./do-client').CreateDOClientOptions = {}
  if (options?.middleware !== undefined) doClientOpts.middleware = options.middleware

  // Use DOClient which has sql, storage, collection built in
  return createDOClient<T>(transport, doClientOpts) as RPCProxy<T> & DOClientFeatures
}

/**
 * DO Client features available on RPC proxy
 */
interface DOClientFeatures {
  /** Tagged template SQL query */
  sql: <R = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => SqlQuery<R>
  /** Remote storage access */
  storage: RemoteStorage
  /** Remote collection access (MongoDB-style) */
  collection: RemoteCollections
  /** Get database schema */
  dbSchema: () => Promise<DatabaseSchema>
  /** Get full RPC schema */
  schema: () => Promise<RpcSchema>
}

// Import types for DOClientFeatures
import type {
  SqlQuery,
  RemoteStorage,
  RemoteCollections,
  DatabaseSchema,
  RpcSchema,
} from './do-client'

// ============================================================================
// RPC Client Factory (deprecated - use RPC() directly)
// ============================================================================

/**
 * Options for createRPCClient factory
 * @deprecated Use RPCOptions with RPC() instead
 */
export interface RPCClientOptions {
  /** Base URL for the RPC endpoint */
  baseUrl: string
  /** Custom headers to include (reserved for future use) */
  headers?: Record<string, string>
  /** Custom fetch implementation (reserved for future use) */
  fetch?: typeof globalThis.fetch
  /** Request timeout in milliseconds */
  timeout?: number
  /** Retry configuration (reserved for future use) */
  retry?: { maxAttempts?: number; backoff?: number }
  /** Auth token or provider */
  auth?: string | (() => string | null | Promise<string | null>)
}

/**
 * Create an RPC client with simplified options.
 *
 * @deprecated Use `RPC(url, options)` instead:
 * ```typescript
 * // Old
 * const client = createRPCClient({ baseUrl: 'https://example.com', auth: 'token' })
 *
 * // New (recommended)
 * const client = RPC('https://example.com', { auth: 'token' })
 * ```
 *
 * @example
 * // Basic usage
 * const client = createRPCClient({ baseUrl: 'https://api.example.com/rpc' })
 * await client.ai.generate({ prompt: 'hello' })
 */
export function createRPCClient<T = unknown>(options: RPCClientOptions): RPCProxy<T> & DOClientFeatures {
  // Build options, only adding defined values to satisfy exactOptionalPropertyTypes
  const rpcOpts: RPCOptions = {}
  if (options.auth !== undefined) rpcOpts.auth = options.auth
  if (options.timeout !== undefined) rpcOpts.timeout = options.timeout
  return RPC<T>(options.baseUrl, rpcOpts)
}

// Re-export transports (browser-safe)
export * from './transports'

// Explicit type re-exports for better discoverability
export type { AuthProvider, ServerMessage } from './transports'
export { isFunction, isServerMessage } from './transports'

// DO Client - remote access to DO sql/storage/collections
export {
  createDOClient,
  connectDO,
  type DOClient,
  type SqlQuery,
  type SqlQueryResult,
  type RemoteStorage,
  type RemoteCollection,
  type RemoteCollections,
  type Filter,
  type FilterOperator,
  type QueryOptions,
  type DatabaseSchema,
  type TableSchema,
  type ColumnSchema,
  type IndexSchema,
  type RpcSchema,
} from './do-client'

// Note: auth() is available via 'rpc.do/auth' for server-side usage
// It's not exported from main index to avoid oauth.do dependency in browser contexts

// Server: capnweb server utilities via 'rpc.do/server' (RpcTarget, createTarget, createHandler)
// Expose: SDK-to-RpcTarget wrapper via 'rpc.do/expose' (WorkerEntrypoint with capnweb pipelining)
// Both are separate entry points to avoid cloudflare:workers / capnweb/server deps in browser contexts

// ============================================================================
// Default RPC Client (without auth - browser-safe)
// ============================================================================

/**
 * Pre-configured RPC client for rpc.do without auth
 *
 * @example
 * import { $, RPC } from 'rpc.do'
 *
 * // Anonymous request
 * await $.ai.generate({ prompt: 'hello' })
 *
 * // With auth token
 * const authenticated = RPC('https://rpc.do', { auth: 'your-token' })
 * await authenticated.db.get({ id: '123' })
 *
 * // Connect to your own DO
 * const myDO = RPC('https://my-do.workers.dev')
 * const users = await myDO.sql`SELECT * FROM users`.all()
 */
export const $ = RPC('https://rpc.do')

export default $
