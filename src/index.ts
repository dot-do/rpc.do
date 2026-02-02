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
// Core types (extracted to src/types.ts to break circular imports)
// ============================================================================

export type {
  Transport,
  TransportFactory,
  AsyncFunction,
  RpcFunction,
  RPCFunction,
  RpcProxy,
  RPCProxy,
  RPCPromise,
  RpcResult,
  RPCResult,
  RpcInput,
  RPCInput,
  RpcClientMiddleware,
  RPCClientMiddleware,
} from './types'

import type { Transport, TransportFactory, RpcProxy, RpcClientMiddleware } from './types'

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
 * Note: The rpc.do `Transport` type is now an alias for `MinimalTransport`
 * from `@dotdo/types/rpc`. For the full transport lifecycle interface with
 * connect/disconnect/events, use `ManagedTransport` from `@dotdo/types/rpc`.
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
// RPC Factory
// ============================================================================

/**
 * Options for RPC client
 */
export interface RpcOptions {
  /** Auth token or provider */
  auth?: string | (() => string | null | Promise<string | null>)
  /** Request timeout in milliseconds */
  timeout?: number
  /** Enable WebSocket reconnection (default: true for ws/wss URLs) */
  reconnect?: boolean
  /** Middleware chain for request/response hooks */
  middleware?: RpcClientMiddleware[]
}

/**
 * Options for RPC client
 * @deprecated Use `RpcOptions` instead (lowercase 'pc' for consistency with capnweb convention). Planned removal: v2.0
 */
export interface RPCOptions extends RpcOptions {}

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
export function RPC<T extends object = Record<string, unknown>>(
  urlOrTransport: string | Transport | TransportFactory,
  options?: RpcOptions
): RpcProxy<T> & DOClientFeatures {
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
  return createDOClient<T>(transport, doClientOpts) as RpcProxy<T> & DOClientFeatures
}

/**
 * DO Client features available on RPC proxy.
 *
 * This interface describes the built-in features added to every RPC proxy
 * when using `RPC()` or `createDOClient()`. These map to the DO's internal
 * SQL, storage, and collection capabilities.
 *
 * @example
 * ```typescript
 * const $ = RPC<MyAPI>('https://my-do.workers.dev')
 *
 * // SQL (tagged template for safe parameter binding)
 * const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
 *
 * // Storage (key-value)
 * const config = await $.storage.get('config')
 *
 * // Collections (MongoDB-style)
 * const admins = await $.collection('users').find({ role: 'admin' })
 *
 * // Schema introspection
 * const schema = await $.schema()
 * ```
 */
export interface DOClientFeatures {
  /** Tagged template SQL query */
  sql: <R extends Record<string, unknown> = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => SqlQuery<R>
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
 * Options for createRpcClient factory
 * @deprecated Use RpcOptions with RPC() instead
 */
export interface RpcClientOptions {
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
 * Options for createRPCClient factory
 * @deprecated Use `RpcClientOptions` and then `RpcOptions` with RPC() instead. Planned removal: v2.0
 */
export interface RPCClientOptions extends RpcClientOptions {}

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
export function createRPCClient<T extends object = Record<string, unknown>>(options: RpcClientOptions): RpcProxy<T> & DOClientFeatures {
  // Build options, only adding defined values to satisfy exactOptionalPropertyTypes
  const rpcOpts: RpcOptions = {}
  if (options.auth !== undefined) rpcOpts.auth = options.auth
  if (options.timeout !== undefined) rpcOpts.timeout = options.timeout
  return RPC<T>(options.baseUrl, rpcOpts)
}

// Re-export transports (browser-safe) - selective exports only, internal helpers are not re-exported
export {
  // Transport factory functions
  http,
  capnweb,
  binding,
  composite,
  // Unified transport factory
  Transports,
  // Type guards (public API)
  isFunction,
  isServerMessage,
} from './transports'

export type {
  // Transport option types
  AuthProvider,
  ServerMessage,
  HttpTransportOptions,
  CapnwebTransportOptions,
  // Transport factory types
  TransportType,
  TransportConfig,
  HttpTransportConfig,
  CapnwebTransportConfig,
  BindingTransportConfig,
  CompositeTransportConfig,
} from './transports'

// Re-export reconnecting transport and middleware (from transports sub-modules)
export {
  ReconnectingWebSocketTransport,
  reconnectingWs,
  createRpcSession,
  type ConnectionState,
  type ConnectionEventHandlers,
  type ReconnectingWebSocketOptions,
  type RpcSessionOptions,
} from './transports/reconnecting-ws.js'

export { withMiddleware, withRetry, type RetryOptions } from './middleware/index.js'

// DO Client - remote access to DO sql/storage/collections
export {
  createDOClient,
  connectDO,
  type DOClient,
  type CreateDOClientOptions,
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
  type RpcMethodSchema,
  type RpcNamespaceSchema,
} from './do-client'

// Internal method constants (for custom transport implementations)
export {
  INTERNAL_METHODS,
  INTERNAL_METHOD_NAMES,
  type InternalMethod,
} from './constants'

// Capnweb loader testing utilities
export {
  setCapnwebMock,
  clearCapnwebCache,
  hasCapnwebMock,
  getCapnwebMock,
  type CapnwebModule,
} from './capnweb-loader'

// Note: auth() is available via 'rpc.do/auth' for server-side usage
// It's not exported from main index to avoid oauth.do dependency in browser contexts

// Server: capnweb server utilities via 'rpc.do/server' (RpcTarget, createTarget, createHandler)
// Expose: SDK-to-RpcTarget wrapper via 'rpc.do/expose' (WorkerEntrypoint with capnweb pipelining)
// Both are separate entry points to avoid cloudflare:workers / capnweb/server deps in browser contexts

// ============================================================================
// Default RPC Client (without auth - browser-safe)
// ============================================================================

/**
 * Pre-configured RPC client for rpc.do without auth.
 *
 * Lazily initialized on first property access to avoid side effects at import
 * time (compatible with `sideEffects: false` in package.json for tree-shaking).
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
let _$: ReturnType<typeof RPC> | undefined
export const $: ReturnType<typeof RPC> = new Proxy({} as ReturnType<typeof RPC>, {
  get(_, prop) {
    if (!_$) _$ = RPC('https://rpc.do')
    return (_$ as any)[prop]
  },
})

export default $
