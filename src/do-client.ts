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

import type { Transport, TransportFactory, RpcProxy, RpcClientMiddleware } from './types'
import type {
  SqlQueryResult as TypesSqlQueryResult,
  SqlQuery as TypesSqlQuery,
  RemoteStorage as TypesRemoteStorage,
  RemoteCollection as TypesRemoteCollection,
  DOClient as TypesDOClient,
  DOClientOptions as TypesDOClientOptions,
} from '@dotdo/types/rpc'
import { INTERNAL_METHODS } from './constants.js'
import {
  asSqlQueryResult,
  asNullable,
  asSqlRunResult,
  asArray,
  asBoolean,
  asNumber,
  asStringArray,
  asCollectionStats,
  asRecord,
  asOptional,
  asDatabaseSchema,
  asRpcSchema,
} from './utils/type-helpers.js'

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
export interface SqlQuery<T extends Record<string, unknown> = Record<string, unknown>> {
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
  sql: <R extends Record<string, unknown> = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => SqlQuery<R>
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

  const wrapped: Transport = {
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
  }

  if (transport.close) {
    wrapped.close = transport.close.bind(transport)
  }

  return wrapped
}

/**
 * Serialized SQL query structure for transport.
 *
 * Note: The SqlQueryString branded type is available for compile-time safety
 * when working with raw SQL strings elsewhere in the codebase. This structure
 * uses parameterized queries (template strings + values) which is inherently safe.
 */
export interface SerializedSqlQuery {
  /** The template string parts */
  strings: string[]
  /** The interpolated values */
  values: unknown[]
}

/**
 * Create a serialized SQL query from tagged template
 */
function serializeSql(strings: TemplateStringsArray, values: unknown[]): SerializedSqlQuery {
  return {
    strings: Array.from(strings),
    values,
  }
}

/**
 * Create a SQL query builder
 */
function createSqlQuery<T extends Record<string, unknown>>(
  transport: Transport,
  strings: TemplateStringsArray,
  values: unknown[]
): SqlQuery<T> {
  const serialized = serializeSql(strings, values)

  return {
    async all(): Promise<T[]> {
      // Safe: INTERNAL_METHODS.SQL returns SqlQueryResult from the server
      const result = asSqlQueryResult<T>(await transport.call(INTERNAL_METHODS.SQL, [serialized]))
      return result.results
    },
    async first(): Promise<T | null> {
      // Safe: INTERNAL_METHODS.SQL_FIRST returns T | null from the server
      return asNullable<T>(await transport.call(INTERNAL_METHODS.SQL_FIRST, [serialized]))
    },
    async run(): Promise<{ rowsWritten: number }> {
      // Safe: INTERNAL_METHODS.SQL_RUN returns { rowsWritten: number } from the server
      return asSqlRunResult(await transport.call(INTERNAL_METHODS.SQL_RUN, [serialized]))
    },
    async raw(): Promise<SqlQueryResult<T>> {
      // Safe: INTERNAL_METHODS.SQL returns SqlQueryResult from the server
      return asSqlQueryResult<T>(await transport.call(INTERNAL_METHODS.SQL, [serialized]))
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
      // Safe: COLLECTION_GET returns T | null from the server
      return asNullable<T>(await transport.call(INTERNAL_METHODS.COLLECTION_GET, [name, id]))
    },
    async put(id: string, doc: T): Promise<void> {
      await transport.call(INTERNAL_METHODS.COLLECTION_PUT, [name, id, doc])
    },
    async delete(id: string): Promise<boolean> {
      // Safe: COLLECTION_DELETE returns boolean from the server
      return asBoolean(await transport.call(INTERNAL_METHODS.COLLECTION_DELETE, [name, id]))
    },
    async has(id: string): Promise<boolean> {
      // Safe: COLLECTION_HAS returns boolean from the server
      return asBoolean(await transport.call(INTERNAL_METHODS.COLLECTION_HAS, [name, id]))
    },
    async find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]> {
      // Safe: COLLECTION_FIND returns T[] from the server
      return asArray<T>(await transport.call(INTERNAL_METHODS.COLLECTION_FIND, [name, filter, options]))
    },
    async count(filter?: Filter<T>): Promise<number> {
      // Safe: COLLECTION_COUNT returns number from the server
      return asNumber(await transport.call(INTERNAL_METHODS.COLLECTION_COUNT, [name, filter]))
    },
    async list(options?: QueryOptions): Promise<T[]> {
      // Safe: COLLECTION_LIST returns T[] from the server
      return asArray<T>(await transport.call(INTERNAL_METHODS.COLLECTION_LIST, [name, options]))
    },
    async keys(): Promise<string[]> {
      // Safe: COLLECTION_KEYS returns string[] from the server
      return asStringArray(await transport.call(INTERNAL_METHODS.COLLECTION_KEYS, [name]))
    },
    async clear(): Promise<number> {
      // Safe: COLLECTION_CLEAR returns number from the server
      return asNumber(await transport.call(INTERNAL_METHODS.COLLECTION_CLEAR, [name]))
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
    // Safe: COLLECTION_NAMES returns string[] from the server
    return asStringArray(await getTransport().call(INTERNAL_METHODS.COLLECTION_NAMES, []))
  }

  fn.stats = async (): Promise<Array<{ name: string; count: number; size: number }>> => {
    // Safe: COLLECTION_STATS returns Array<{ name, count, size }> from the server
    return asCollectionStats(await getTransport().call(INTERNAL_METHODS.COLLECTION_STATS, []))
  }

  // Structural cast: TypeScript cannot verify that a function object with additional
  // properties satisfies an interface with a call signature. This is safe because
  // fn is callable and has names/stats methods attached.
  return fn as RemoteCollections
}

/**
 * Create a remote storage proxy
 */
function createStorageProxy(transport: Transport): RemoteStorage {
  // RemoteStorage has overloaded get/put/delete methods. TypeScript cannot
  // verify overloaded signatures on object literals, so we build the proxy
  // object and cast once at the boundary. The implementations correctly
  // discriminate on the argument type (string vs array vs object).
  const proxy = {
    async get<T>(keyOrKeys: string | string[]): Promise<T | undefined | Map<string, T>> {
      if (Array.isArray(keyOrKeys)) {
        // Safe: STORAGE_GET_MULTIPLE returns Record<string, T> from the server
        const result = asRecord<T>(await transport.call(INTERNAL_METHODS.STORAGE_GET_MULTIPLE, [keyOrKeys]))
        return new Map(Object.entries(result))
      }
      // Safe: STORAGE_GET returns T | undefined from the server
      return asOptional<T>(await transport.call(INTERNAL_METHODS.STORAGE_GET, [keyOrKeys]))
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
        // Safe: STORAGE_DELETE_MULTIPLE returns number from the server
        return asNumber(await transport.call(INTERNAL_METHODS.STORAGE_DELETE_MULTIPLE, [keyOrKeys]))
      }
      // Safe: STORAGE_DELETE returns boolean from the server
      return asBoolean(await transport.call(INTERNAL_METHODS.STORAGE_DELETE, [keyOrKeys]))
    },
    async list<T>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>> {
      // Safe: STORAGE_LIST returns Record<string, T> from the server
      const result = asRecord<T>(await transport.call(INTERNAL_METHODS.STORAGE_LIST, [options]))
      return new Map(Object.entries(result))
    },
    async keys(prefix?: string): Promise<string[]> {
      // Safe: STORAGE_KEYS returns string[] from the server
      return asStringArray(await transport.call(INTERNAL_METHODS.STORAGE_KEYS, [prefix]))
    },
  }
  // Structural cast: TypeScript cannot verify overloaded method signatures on
  // object literals. This is safe because the proxy correctly discriminates
  // on argument type (string vs array vs object) for each overloaded method.
  return proxy as RemoteStorage
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
    // Structural cast: Proxy<() => void> cannot be typed as a callable with
    // arbitrary property access. This is safe because the proxy correctly
    // implements both function call (apply trap) and property access (get trap).
    }) as MethodProxy
  }

  // The main client proxy
  // Structural cast: TypeScript cannot infer the full DOClient<T> type from
  // a Proxy. This is safe because the proxy's get trap handles all DOClient
  // properties (sql, storage, collection, dbSchema, schema, close) and
  // delegates unknown properties to createMethodProxy for custom RPC methods.
  const client = new Proxy({} as DOClient<T>, {
    get(_, prop: string) {
      // Special properties
      if (prop === 'sql') {
        return <R extends Record<string, unknown> = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery<R> => {
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
          // Safe: DB_SCHEMA returns DatabaseSchema from the server
          return asDatabaseSchema(await t.call(INTERNAL_METHODS.DB_SCHEMA, []))
        }
      }

      if (prop === 'schema') {
        return async (): Promise<RpcSchema> => {
          const t = await getTransport()
          // Safe: SCHEMA returns RpcSchema from the server
          return asRpcSchema(await t.call(INTERNAL_METHODS.SCHEMA, []))
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
