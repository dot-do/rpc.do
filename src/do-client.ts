/**
 * DO Client - Remote access to Durable Object internals
 *
 * Provides the same API remotely as you have inside the DO:
 * - $.sql`SELECT * FROM users` → this.sql`SELECT * FROM users`
 * - $.storage.get('key') → this.storage.get('key')
 * - $.collection('users').find({ active: true }) → this.collection('users').find({ active: true })
 *
 * Note: Some types are also available from '@dotdo/types/rpc' for cross-package compatibility:
 * - SqlQueryResult, SqlQuery - SQL query types
 * - RemoteStorage, RemoteCollection - Storage interfaces
 * - DOClient, DOClientOptions - Client types
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 *
 * // Connect to your DO (recommended)
 * const $ = RPC('https://my-do.workers.dev')
 *
 * // Query the DO's SQLite database
 * const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
 *
 * // Access storage
 * const value = await $.storage.get('config')
 *
 * // Access collections (MongoDB-style)
 * const admins = await $.collection('users').find({ active: true, role: 'admin' })
 * await $.collection('users').put('user-123', { name: 'John', active: true })
 *
 * // Get database schema
 * const schema = await $.dbSchema()
 *
 * // Call custom RPC methods
 * const result = await $.users.create({ name: 'John' })
 * ```
 */

import type { Transport, TransportFactory, RpcProxy, RpcClientMiddleware } from './index'
import type {
  SqlQueryResult as TypesSqlQueryResult,
  SqlQuery as TypesSqlQuery,
  RemoteStorage as TypesRemoteStorage,
  RemoteCollection as TypesRemoteCollection,
  DOClient as TypesDOClient,
  DOClientOptions as TypesDOClientOptions,
} from '@dotdo/types/rpc'
import { INTERNAL_METHODS } from './constants.js'

// Import schema types from @dotdo/rpc (canonical location)
// These are bundled by tsup so no runtime dependency is added
import type {
  SqlQueryResult,
  RpcSchema,
  RpcMethodSchema,
  RpcNamespaceSchema,
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  IndexSchema,
} from '@dotdo/rpc'

// Re-export schema types for consumers
export type {
  SqlQueryResult,
  RpcSchema,
  RpcMethodSchema,
  RpcNamespaceSchema,
  DatabaseSchema,
  TableSchema,
  ColumnSchema,
  IndexSchema,
}

/**
 * SQL query builder (returned by $.sql`...`)
 *
 * This is rpc.do's fluent query builder interface.
 * For the simpler parameterized query type, see SqlQuery from '@dotdo/types/rpc'.
 */
export interface SqlQuery<T = Record<string, unknown>> {
  /** Execute and return all rows */
  all(): Promise<T[]>
  /** Execute and return first row */
  first(): Promise<T | null>
  /** Execute for side effects (INSERT, UPDATE, DELETE) */
  run(): Promise<{ rowsWritten: number }>
  /** Get the raw result with metadata */
  raw(): Promise<SqlQueryResult<T>>
}

/**
 * Remote storage interface
 *
 * rpc.do's storage interface with batch operations.
 * For the simpler interface with transaction support, see RemoteStorage from '@dotdo/types/rpc'.
 *
 * @see TypesRemoteStorage from '@dotdo/types/rpc'
 */
export interface RemoteStorage {
  get<T = unknown>(key: string): Promise<T | undefined>
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>
  put<T = unknown>(key: string, value: T): Promise<void>
  put<T = unknown>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T = unknown>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>>
  keys(prefix?: string): Promise<string[]>
}

// ============================================================================
// Collection Types (MongoDB-style)
// ============================================================================

/**
 * MongoDB-style filter operators
 */
export type FilterOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $in: unknown[] }
  | { $nin: unknown[] }
  | { $exists: boolean }
  | { $regex: string }

/**
 * MongoDB-style filter query
 */
export type Filter<T extends Record<string, unknown>> = {
  [K in keyof T]?: T[K] | FilterOperator
} & {
  $and?: Filter<T>[]
  $or?: Filter<T>[]
}

/**
 * Query options for find/list
 */
export interface QueryOptions {
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Sort by field (prefix with - for descending) */
  sort?: string
}

/**
 * Remote collection interface (MongoDB-style document store)
 *
 * Extended version of RemoteCollection from '@dotdo/types/rpc' with
 * additional MongoDB-style query methods like `find`, `has`, and `clear`.
 *
 * @see TypesRemoteCollection from '@dotdo/types/rpc' for the base interface
 */
export interface RemoteCollection<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Get a document by ID */
  get(id: string): Promise<T | null>
  /** Put a document (insert or update) */
  put(id: string, doc: T): Promise<void>
  /** Delete a document */
  delete(id: string): Promise<boolean>
  /** Check if document exists */
  has(id: string): Promise<boolean>
  /** Find documents matching filter */
  find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]>
  /** Count documents matching filter */
  count(filter?: Filter<T>): Promise<number>
  /** List all documents */
  list(options?: QueryOptions): Promise<T[]>
  /** Get all IDs */
  keys(): Promise<string[]>
  /** Delete all documents in collection */
  clear(): Promise<number>
}

/**
 * Collections manager interface
 */
export interface RemoteCollections {
  /** Get or create a collection by name */
  <T extends Record<string, unknown> = Record<string, unknown>>(name: string): RemoteCollection<T>
  /** List all collection names */
  names(): Promise<string[]>
  /** Get stats for all collections */
  stats(): Promise<Array<{ name: string; count: number; size: number }>>
}

/**
 * Durable Object Client type - combines remote SQL, storage, collections with custom RPC methods
 *
 * DOClient provides the same API remotely that you have inside a Durable Object:
 * - `sql` - Tagged template SQL queries with automatic parameterization
 * - `storage` - Key-value storage with batch operations
 * - `collection` - MongoDB-style document store on SQLite
 * - `dbSchema` - Database introspection (tables, columns, indexes)
 * - `schema` - Full RPC schema for codegen and tooling
 * - `close` - Clean up the connection
 *
 * Plus all custom RPC methods defined on your DO, accessed via proxy.
 *
 * This extends the DOClient interface from '@dotdo/types/rpc' with
 * rpc.do-specific features like tagged template SQL, collections manager,
 * and schema introspection.
 *
 * @typeParam T - The type of custom RPC methods on your Durable Object
 *
 * @example SQL queries with tagged templates
 * ```typescript
 * const $ = RPC<MyDoApi>('https://my-do.workers.dev')
 *
 * // All values are automatically parameterized (SQL injection safe)
 * const users = await $.sql<User>`SELECT * FROM users WHERE active = ${true}`.all()
 * const user = await $.sql<User>`SELECT * FROM users WHERE id = ${id}`.first()
 * const { rowsWritten } = await $.sql`UPDATE users SET name = ${name} WHERE id = ${id}`.run()
 * ```
 *
 * @example Storage operations
 * ```typescript
 * // Single key
 * const value = await $.storage.get<Config>('config')
 * await $.storage.put('config', { theme: 'dark' })
 * await $.storage.delete('temp-data')
 *
 * // Batch operations
 * const values = await $.storage.get(['key1', 'key2'])  // Returns Map
 * await $.storage.put({ key1: 'value1', key2: 'value2' })
 * const count = await $.storage.delete(['temp1', 'temp2'])
 *
 * // List with prefix
 * const settings = await $.storage.list({ prefix: 'settings:' })
 * ```
 *
 * @example Collection operations (MongoDB-style)
 * ```typescript
 * interface User {
 *   name: string
 *   email: string
 *   role: 'admin' | 'user'
 *   active: boolean
 * }
 *
 * const users = $.collection<User>('users')
 *
 * // CRUD
 * await users.put('user-123', { name: 'John', email: 'john@example.com', role: 'user', active: true })
 * const user = await users.get('user-123')
 * await users.delete('user-123')
 *
 * // Queries with filters
 * const admins = await users.find({ role: 'admin', active: true })
 * const count = await users.count({ active: true })
 *
 * // Advanced filters
 * const recentUsers = await users.find({
 *   createdAt: { $gt: Date.now() - 86400000 }
 * }, { limit: 10, sort: '-createdAt' })
 * ```
 *
 * @example Schema introspection
 * ```typescript
 * // Get database schema (tables, columns, indexes)
 * const dbSchema = await $.dbSchema()
 * console.log(dbSchema.tables)  // [{ name: 'users', columns: [...], indexes: [...] }]
 *
 * // Get full RPC schema (methods, namespaces, database)
 * const schema = await $.schema()
 * console.log(schema.methods)  // [{ name: 'getUser', path: 'users.get', params: 1 }]
 * ```
 *
 * @see TypesDOClient from '@dotdo/types/rpc' for the base interface
 */
export type DOClient<T extends object = Record<string, unknown>> = {
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
  /** Close the connection */
  close: () => Promise<void>
} & RpcProxy<T>

// ============================================================================
// Implementation
// ============================================================================

/**
 * Options for createDOClient
 */
export interface CreateDOClientOptions {
  /** Middleware chain for request/response hooks */
  middleware?: RpcClientMiddleware[]
}

/**
 * Execute middleware chain for onRequest hooks
 */
async function executeOnRequest(middleware: RpcClientMiddleware[], method: string, args: unknown[]): Promise<void> {
  for (const mw of middleware) {
    if (mw.onRequest) {
      await mw.onRequest(method, args)
    }
  }
}

/**
 * Execute middleware chain for onResponse hooks
 */
async function executeOnResponse(middleware: RpcClientMiddleware[], method: string, result: unknown): Promise<void> {
  for (const mw of middleware) {
    if (mw.onResponse) {
      await mw.onResponse(method, result)
    }
  }
}

/**
 * Execute middleware chain for onError hooks
 */
async function executeOnError(middleware: RpcClientMiddleware[], method: string, error: unknown): Promise<void> {
  for (const mw of middleware) {
    if (mw.onError) {
      await mw.onError(method, error)
    }
  }
}

/**
 * Wrap a transport with middleware support
 */
function wrapTransportWithMiddleware(transport: Transport, middleware: RpcClientMiddleware[]): Transport {
  if (!middleware.length) {
    return transport
  }

  return {
    async call(method: string, args: unknown[]): Promise<unknown> {
      // Execute onRequest hooks
      await executeOnRequest(middleware, method, args)

      try {
        // Make the actual call
        const result = await transport.call(method, args)

        // Execute onResponse hooks
        await executeOnResponse(middleware, method, result)

        return result
      } catch (error) {
        // Execute onError hooks
        await executeOnError(middleware, method, error)

        // Re-throw the error
        throw error
      }
    },
    close: transport.close ? transport.close.bind(transport) : undefined,
  } as Transport
}

/**
 * Create a serialized SQL query from tagged template
 */
function serializeSql(strings: TemplateStringsArray, values: unknown[]): { strings: string[]; values: unknown[] } {
  return {
    strings: Array.from(strings),
    values,
  }
}

/**
 * Create a SQL query builder
 */
function createSqlQuery<T>(
  transport: Transport,
  strings: TemplateStringsArray,
  values: unknown[]
): SqlQuery<T> {
  const serialized = serializeSql(strings, values)

  return {
    async all(): Promise<T[]> {
      const result = await transport.call(INTERNAL_METHODS.SQL, [serialized]) as SqlQueryResult<T>
      return result.results
    },
    async first(): Promise<T | null> {
      return transport.call(INTERNAL_METHODS.SQL_FIRST, [serialized]) as Promise<T | null>
    },
    async run(): Promise<{ rowsWritten: number }> {
      return transport.call(INTERNAL_METHODS.SQL_RUN, [serialized]) as Promise<{ rowsWritten: number }>
    },
    async raw(): Promise<SqlQueryResult<T>> {
      return transport.call(INTERNAL_METHODS.SQL, [serialized]) as Promise<SqlQueryResult<T>>
    },
  }
}

/**
 * Create a remote collection proxy
 */
function createCollectionProxy<T extends Record<string, unknown>>(
  transport: Transport,
  name: string
): RemoteCollection<T> {
  return {
    async get(id: string): Promise<T | null> {
      return transport.call(INTERNAL_METHODS.COLLECTION_GET, [name, id]) as Promise<T | null>
    },
    async put(id: string, doc: T): Promise<void> {
      await transport.call(INTERNAL_METHODS.COLLECTION_PUT, [name, id, doc])
    },
    async delete(id: string): Promise<boolean> {
      return transport.call(INTERNAL_METHODS.COLLECTION_DELETE, [name, id]) as Promise<boolean>
    },
    async has(id: string): Promise<boolean> {
      return transport.call(INTERNAL_METHODS.COLLECTION_HAS, [name, id]) as Promise<boolean>
    },
    async find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]> {
      return transport.call(INTERNAL_METHODS.COLLECTION_FIND, [name, filter, options]) as Promise<T[]>
    },
    async count(filter?: Filter<T>): Promise<number> {
      return transport.call(INTERNAL_METHODS.COLLECTION_COUNT, [name, filter]) as Promise<number>
    },
    async list(options?: QueryOptions): Promise<T[]> {
      return transport.call(INTERNAL_METHODS.COLLECTION_LIST, [name, options]) as Promise<T[]>
    },
    async keys(): Promise<string[]> {
      return transport.call(INTERNAL_METHODS.COLLECTION_KEYS, [name]) as Promise<string[]>
    },
    async clear(): Promise<number> {
      return transport.call(INTERNAL_METHODS.COLLECTION_CLEAR, [name]) as Promise<number>
    },
  }
}

/**
 * Create a remote collections manager
 */
function createCollectionsProxy(getTransport: () => Transport): RemoteCollections {
  const fn = <T extends Record<string, unknown>>(name: string): RemoteCollection<T> => {
    return createCollectionProxy<T>(getTransport(), name)
  }

  fn.names = async (): Promise<string[]> => {
    return getTransport().call(INTERNAL_METHODS.COLLECTION_NAMES, []) as Promise<string[]>
  }

  fn.stats = async (): Promise<Array<{ name: string; count: number; size: number }>> => {
    return getTransport().call(INTERNAL_METHODS.COLLECTION_STATS, []) as Promise<Array<{ name: string; count: number; size: number }>>
  }

  return fn as RemoteCollections
}

/**
 * Create a remote storage proxy
 */
function createStorageProxy(transport: Transport): RemoteStorage {
  return {
    async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
      if (Array.isArray(keyOrKeys)) {
        const result = await transport.call(INTERNAL_METHODS.STORAGE_GET_MULTIPLE, [keyOrKeys]) as Record<string, T>
        return new Map(Object.entries(result))
      }
      return transport.call(INTERNAL_METHODS.STORAGE_GET, [keyOrKeys]) as Promise<T | undefined>
    },
    async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof keyOrEntries === 'string') {
        await transport.call(INTERNAL_METHODS.STORAGE_PUT, [keyOrEntries, value])
      } else {
        await transport.call(INTERNAL_METHODS.STORAGE_PUT_MULTIPLE, [keyOrEntries])
      }
    },
    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      if (Array.isArray(keyOrKeys)) {
        return transport.call(INTERNAL_METHODS.STORAGE_DELETE_MULTIPLE, [keyOrKeys]) as Promise<number>
      }
      return transport.call(INTERNAL_METHODS.STORAGE_DELETE, [keyOrKeys]) as Promise<boolean>
    },
    async list<T>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>> {
      const result = await transport.call(INTERNAL_METHODS.STORAGE_LIST, [options]) as Record<string, T>
      return new Map(Object.entries(result))
    },
    async keys(prefix?: string): Promise<string[]> {
      return transport.call(INTERNAL_METHODS.STORAGE_KEYS, [prefix]) as Promise<string[]>
    },
  } as RemoteStorage
}

/**
 * Create a Durable Object client with remote SQL, storage, and collection access
 *
 * Creates a typed RPC client that provides the same API remotely as you have inside the DO:
 * - `$.sql\`...\`` for SQLite queries (mirrors `this.sql` inside DO)
 * - `$.storage.get/put/delete` for key-value storage (mirrors `this.storage`)
 * - `$.collection('name')` for MongoDB-style document operations
 * - `$.schema()` for API introspection
 * - Custom RPC method calls via proxy
 *
 * For most use cases, prefer `RPC(url)` which is simpler and handles transport creation:
 * ```typescript
 * const $ = RPC('https://my-do.workers.dev')
 * ```
 *
 * Use `createDOClient` directly when you need:
 * - Custom transport configuration
 * - Middleware injection
 * - Service binding transport
 * - Advanced transport composition
 *
 * @typeParam T - The type of the DO's custom RPC methods (optional)
 * @param transport - A Transport instance or factory function for RPC communication
 * @param options - Optional configuration including middleware chain
 * @returns A DOClient proxy with SQL, storage, collection, and custom method access
 *
 * @throws {Error} "Transport not initialized" if sync methods (sql, storage, collection)
 *   are called before any async method when using a TransportFactory
 *
 * @example Basic usage with explicit transport
 * ```typescript
 * import { createDOClient, capnweb } from 'rpc.do'
 *
 * const $ = createDOClient(capnweb('wss://my-do.workers.dev'))
 *
 * // Query SQL (same syntax as inside DO)
 * const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
 * const user = await $.sql`SELECT * FROM users WHERE id = ${id}`.first()
 *
 * // Access storage
 * const config = await $.storage.get<Config>('config')
 * await $.storage.put('config', { theme: 'dark' })
 *
 * // Access collections (MongoDB-style)
 * const admins = await $.collection<User>('users').find({ role: 'admin' })
 *
 * // Call custom RPC methods
 * const result = await $.myMethod({ arg: 'value' })
 * ```
 *
 * @example With TypeScript generics for typed methods
 * ```typescript
 * interface MyDoApi {
 *   users: {
 *     create: (data: { name: string; email: string }) => { id: string }
 *     get: (id: string) => User | null
 *   }
 *   config: {
 *     get: () => Config
 *   }
 * }
 *
 * const $ = createDOClient<MyDoApi>(transport)
 * const user = await $.users.get('123')  // Typed as User | null
 * ```
 *
 * @example With middleware for logging and timing
 * ```typescript
 * import { createDOClient, http } from 'rpc.do'
 * import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'
 *
 * const $ = createDOClient(http('https://my-do.workers.dev'), {
 *   middleware: [loggingMiddleware(), timingMiddleware()]
 * })
 * ```
 *
 * @example With service binding (zero network latency)
 * ```typescript
 * import { createDOClient, binding } from 'rpc.do'
 *
 * // Inside a Cloudflare Worker
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const $ = createDOClient(binding(env.MY_DO))
 *     const data = await $.getData()
 *     return Response.json(data)
 *   }
 * }
 * ```
 *
 * @see RPC - Simpler API for most use cases
 * @see connectDO - Async convenience wrapper with automatic capnweb transport
 */
export function createDOClient<T extends object = Record<string, unknown>>(
  transport: Transport | TransportFactory,
  options?: CreateDOClientOptions
): DOClient<T> {
  const middleware = options?.middleware ?? []
  let _transport: Transport | null = null
  let _transportPromise: Promise<Transport> | null = null

  const getTransport = async (): Promise<Transport> => {
    if (_transport) return _transport
    if (_transportPromise) return _transportPromise

    if (typeof transport === 'function') {
      _transportPromise = Promise.resolve(transport())
      const rawTransport = await _transportPromise
      _transport = wrapTransportWithMiddleware(rawTransport, middleware)
      _transportPromise = null
    } else {
      _transport = wrapTransportWithMiddleware(transport, middleware)
    }
    return _transport
  }

  // Sync transport getter (for sql template tag which must return immediately)
  const getTransportSync = (): Transport => {
    if (!_transport) {
      // Initialize synchronously if possible
      if (typeof transport !== 'function') {
        _transport = wrapTransportWithMiddleware(transport, middleware)
      } else {
        throw new Error('Transport not initialized. Call any async method first.')
      }
    }
    return _transport
  }

  /**
   * Dynamic method proxy type - represents a chainable RPC method path
   * that can be called as a function or accessed as a namespace.
   */
  type MethodProxy = ((...args: unknown[]) => Promise<unknown>) & {
    [key: string]: MethodProxy
  }

  // Create the proxy for custom RPC methods
  const createMethodProxy = (path: string[]): MethodProxy => {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined
        }
        return createMethodProxy([...path, prop])
      },
      apply(_, __, args: unknown[]) {
        return (async () => {
          const t = await getTransport()
          return t.call(path.join('.'), args)
        })()
      },
    }) as MethodProxy
  }

  // The main client proxy
  const client = new Proxy({} as DOClient<T>, {
    get(_, prop: string) {
      // Special properties
      if (prop === 'sql') {
        return <R = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery<R> => {
          const t = getTransportSync()
          return createSqlQuery<R>(t, strings, values)
        }
      }

      if (prop === 'storage') {
        return createStorageProxy(getTransportSync())
      }

      if (prop === 'collection') {
        return createCollectionsProxy(getTransportSync)
      }

      if (prop === 'dbSchema') {
        return async (): Promise<DatabaseSchema> => {
          const t = await getTransport()
          return t.call(INTERNAL_METHODS.DB_SCHEMA, []) as Promise<DatabaseSchema>
        }
      }

      if (prop === 'schema') {
        return async (): Promise<RpcSchema> => {
          const t = await getTransport()
          return t.call(INTERNAL_METHODS.SCHEMA, []) as Promise<RpcSchema>
        }
      }

      if (prop === 'close') {
        return async () => {
          const t = await getTransport()
          t.close?.()
        }
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Custom RPC methods
      return createMethodProxy([prop])
    },
  })

  return client
}

/**
 * Connect to a DO and get a client
 *
 * Convenience wrapper that creates transport + client
 *
 * @example
 * ```typescript
 * import { connectDO } from 'rpc.do'
 *
 * const $ = await connectDO('wss://my-do.workers.dev')
 *
 * const users = await $.sql`SELECT * FROM users`.all()
 * ```
 */
export async function connectDO<T extends object = Record<string, unknown>>(
  url: string,
  options?: {
    auth?: string | (() => string | null | Promise<string | null>)
    reconnect?: boolean
  }
): Promise<DOClient<T>> {
  // Dynamic import to avoid circular deps
  const { capnweb } = await import('./transports.js')

  // Build options object, only adding defined values to satisfy exactOptionalPropertyTypes
  const capnwebOpts: { auth?: string | (() => string | null | Promise<string | null>); reconnect: boolean } = {
    reconnect: options?.reconnect ?? true,
  }
  if (options?.auth !== undefined) capnwebOpts.auth = options.auth
  const transport = capnweb(url, capnwebOpts)

  return createDOClient<T>(transport)
}
