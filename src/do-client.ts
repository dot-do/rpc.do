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

import type { Transport, TransportFactory, RPCProxy, RPCClientMiddleware } from './index'
import type {
  SqlQueryResult as TypesSqlQueryResult,
  SqlQuery as TypesSqlQuery,
  RemoteStorage as TypesRemoteStorage,
  RemoteCollection as TypesRemoteCollection,
  DOClient as TypesDOClient,
  DOClientOptions as TypesDOClientOptions,
} from '@dotdo/types/rpc'

// ============================================================================
// Types
// ============================================================================

/**
 * SQL query result
 *
 * Note: rpc.do uses a slightly different shape than @dotdo/types SqlQueryResult.
 * This interface uses `results` and `meta`, while @dotdo/types uses `rows` and separate fields.
 *
 * @see TypesSqlQueryResult from '@dotdo/types/rpc' for the standard interface
 */
export interface SqlQueryResult<T = Record<string, unknown>> {
  results: T[]
  meta: {
    rows_read: number
    rows_written: number
  }
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
export type Filter<T> = {
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
 * Database schema types
 */
export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
}

export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  indexes: IndexSchema[]
}

export interface IndexSchema {
  name: string
  columns: string[]
  unique: boolean
}

export interface DatabaseSchema {
  tables: TableSchema[]
  version?: number
}

/**
 * Full RPC schema
 */
export interface RpcSchema {
  version: 1
  methods: Array<{ name: string; path: string; params: number }>
  namespaces: Array<{ name: string; methods: Array<{ name: string; path: string; params: number }> }>
  database?: DatabaseSchema
  storageKeys?: string[]
  colo?: string
}

/**
 * DO Client type - combines remote sql/storage/collections with custom methods
 *
 * This extends the DOClient interface from '@dotdo/types/rpc' with
 * rpc.do-specific features like tagged template SQL, collections manager,
 * and schema introspection.
 *
 * @see TypesDOClient from '@dotdo/types/rpc' for the base interface
 */
export type DOClient<T = unknown> = {
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
} & RPCProxy<T>

// ============================================================================
// Implementation
// ============================================================================

/**
 * Options for createDOClient
 */
export interface CreateDOClientOptions {
  /** Middleware chain for request/response hooks */
  middleware?: RPCClientMiddleware[]
}

/**
 * Execute middleware chain for onRequest hooks
 */
async function executeOnRequest(middleware: RPCClientMiddleware[], method: string, args: unknown[]): Promise<void> {
  for (const mw of middleware) {
    if (mw.onRequest) {
      await mw.onRequest(method, args)
    }
  }
}

/**
 * Execute middleware chain for onResponse hooks
 */
async function executeOnResponse(middleware: RPCClientMiddleware[], method: string, result: unknown): Promise<void> {
  for (const mw of middleware) {
    if (mw.onResponse) {
      await mw.onResponse(method, result)
    }
  }
}

/**
 * Execute middleware chain for onError hooks
 */
async function executeOnError(middleware: RPCClientMiddleware[], method: string, error: unknown): Promise<void> {
  for (const mw of middleware) {
    if (mw.onError) {
      await mw.onError(method, error)
    }
  }
}

/**
 * Wrap a transport with middleware support
 */
function wrapTransportWithMiddleware(transport: Transport, middleware: RPCClientMiddleware[]): Transport {
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
      const result = await transport.call('__sql', [serialized]) as SqlQueryResult<T>
      return result.results
    },
    async first(): Promise<T | null> {
      return transport.call('__sqlFirst', [serialized]) as Promise<T | null>
    },
    async run(): Promise<{ rowsWritten: number }> {
      return transport.call('__sqlRun', [serialized]) as Promise<{ rowsWritten: number }>
    },
    async raw(): Promise<SqlQueryResult<T>> {
      return transport.call('__sql', [serialized]) as Promise<SqlQueryResult<T>>
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
      return transport.call('__collectionGet', [name, id]) as Promise<T | null>
    },
    async put(id: string, doc: T): Promise<void> {
      await transport.call('__collectionPut', [name, id, doc])
    },
    async delete(id: string): Promise<boolean> {
      return transport.call('__collectionDelete', [name, id]) as Promise<boolean>
    },
    async has(id: string): Promise<boolean> {
      return transport.call('__collectionHas', [name, id]) as Promise<boolean>
    },
    async find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]> {
      return transport.call('__collectionFind', [name, filter, options]) as Promise<T[]>
    },
    async count(filter?: Filter<T>): Promise<number> {
      return transport.call('__collectionCount', [name, filter]) as Promise<number>
    },
    async list(options?: QueryOptions): Promise<T[]> {
      return transport.call('__collectionList', [name, options]) as Promise<T[]>
    },
    async keys(): Promise<string[]> {
      return transport.call('__collectionKeys', [name]) as Promise<string[]>
    },
    async clear(): Promise<number> {
      return transport.call('__collectionClear', [name]) as Promise<number>
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
    return getTransport().call('__collectionNames', []) as Promise<string[]>
  }

  fn.stats = async (): Promise<Array<{ name: string; count: number; size: number }>> => {
    return getTransport().call('__collectionStats', []) as Promise<Array<{ name: string; count: number; size: number }>>
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
        const result = await transport.call('__storageGetMultiple', [keyOrKeys]) as Record<string, T>
        return new Map(Object.entries(result))
      }
      return transport.call('__storageGet', [keyOrKeys]) as Promise<T | undefined>
    },
    async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof keyOrEntries === 'string') {
        await transport.call('__storagePut', [keyOrEntries, value])
      } else {
        await transport.call('__storagePutMultiple', [keyOrEntries])
      }
    },
    async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
      if (Array.isArray(keyOrKeys)) {
        return transport.call('__storageDeleteMultiple', [keyOrKeys]) as Promise<number>
      }
      return transport.call('__storageDelete', [keyOrKeys]) as Promise<boolean>
    },
    async list<T>(options?: { prefix?: string; limit?: number; start?: string; end?: string }): Promise<Map<string, T>> {
      const result = await transport.call('__storageList', [options]) as Record<string, T>
      return new Map(Object.entries(result))
    },
    async keys(prefix?: string): Promise<string[]> {
      return transport.call('__storageKeys', [prefix]) as Promise<string[]>
    },
  } as RemoteStorage
}

/**
 * Create a DO client with remote sql/storage access
 *
 * Note: For most use cases, use `RPC(url)` instead which is simpler:
 * ```typescript
 * const $ = RPC('https://my-do.workers.dev')
 * ```
 *
 * @example
 * ```typescript
 * import { createDOClient, capnweb } from 'rpc.do'
 *
 * // With explicit transport (advanced use)
 * const $ = createDOClient(capnweb('wss://my-do.workers.dev'))
 *
 * // Query SQL (same syntax as inside DO)
 * const users = await $.sql`SELECT * FROM users`.all()
 *
 * // Access storage
 * const config = await $.storage.get('config')
 *
 * // Call custom RPC methods
 * const result = await $.myMethod({ arg: 'value' })
 * ```
 */
export function createDOClient<T = unknown>(
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

  // Create the proxy for custom RPC methods
  const createMethodProxy = (path: string[]): any => {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined
        }
        return createMethodProxy([...path, prop])
      },
      apply(_, __, args: any[]) {
        return (async () => {
          const t = await getTransport()
          return t.call(path.join('.'), args)
        })()
      },
    })
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
          return t.call('__dbSchema', []) as Promise<DatabaseSchema>
        }
      }

      if (prop === 'schema') {
        return async (): Promise<RpcSchema> => {
          const t = await getTransport()
          return t.call('__schema', []) as Promise<RpcSchema>
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
export async function connectDO<T = unknown>(
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
