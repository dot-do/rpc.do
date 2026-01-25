/**
 * DO Client - Remote access to Durable Object internals
 *
 * Provides the same API remotely as you have inside the DO:
 * - $.sql`SELECT * FROM users` → this.sql`SELECT * FROM users`
 * - $.storage.get('key') → this.storage.get('key')
 *
 * @example
 * ```typescript
 * import { createDOClient } from 'rpc.do'
 *
 * const $ = createDOClient(transport)
 *
 * // Query the DO's SQLite database
 * const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
 *
 * // Access storage
 * const value = await $.storage.get('config')
 *
 * // Get database schema
 * const schema = await $.dbSchema()
 *
 * // Call custom methods
 * const result = await $.users.create({ name: 'John' })
 * ```
 */

import type { Transport, TransportFactory, RPCProxy } from './index'

// ============================================================================
// Types
// ============================================================================

/**
 * SQL query result
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
 * DO Client type - combines remote sql/storage with custom methods
 */
export type DOClient<T = unknown> = {
  /** Tagged template SQL query */
  sql: <R = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => SqlQuery<R>
  /** Remote storage access */
  storage: RemoteStorage
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
 * @example
 * ```typescript
 * import { createDOClient, capnweb } from 'rpc.do'
 *
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
  transport: Transport | TransportFactory
): DOClient<T> {
  let _transport: Transport | null = null
  let _transportPromise: Promise<Transport> | null = null

  const getTransport = async (): Promise<Transport> => {
    if (_transport) return _transport
    if (_transportPromise) return _transportPromise

    if (typeof transport === 'function') {
      _transportPromise = Promise.resolve(transport())
      _transport = await _transportPromise
      _transportPromise = null
    } else {
      _transport = transport
    }
    return _transport
  }

  // Sync transport getter (for sql template tag which must return immediately)
  const getTransportSync = (): Transport => {
    if (!_transport) {
      // Initialize synchronously if possible
      if (typeof transport !== 'function') {
        _transport = transport
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

  const transport = capnweb(url, {
    auth: options?.auth,
    reconnect: options?.reconnect ?? true,
  })

  return createDOClient<T>(transport)
}
