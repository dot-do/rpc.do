/**
 * Wire-schema types shared with the server (@dotdo/rpc)
 *
 * These describe what a DurableRPC server returns from its internal methods (`__sql`,
 * `__schema`, `__dbSchema`). The canonical definitions live in @dotdo/rpc
 * (`core/src/introspection.ts` and `core/src/mixins/sql.ts`); rpc.do keeps structural copies
 * because @dotdo/rpc is not a runtime or peer dependency of rpc.do, so its published
 * declarations must not import from it. Keep the two in step.
 *
 * @module
 */

/**
 * SQL query result from remote execution
 */
export interface SqlQueryResult<T = Record<string, unknown>> {
  results: T[]
  meta: {
    rows_read: number
    rows_written: number
  }
}

/**
 * Describes a single RPC method
 */
export interface RpcMethodSchema {
  /** Method name */
  name: string
  /** Dot-separated path (e.g. "users.get") */
  path: string
  /** Number of declared parameters (from Function.length) */
  params: number
}

/**
 * Describes a namespace (object with methods)
 */
export interface RpcNamespaceSchema {
  /** Namespace name */
  name: string
  /** Methods within this namespace */
  methods: RpcMethodSchema[]
}

/**
 * Database column schema
 */
export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
}

/**
 * Database table schema
 */
export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  indexes: IndexSchema[]
}

/**
 * Database index schema
 */
export interface IndexSchema {
  name: string
  columns: string[]
  unique: boolean
}

/**
 * Full database schema (SQLite)
 */
export interface DatabaseSchema {
  tables: TableSchema[]
  version?: number
}

/**
 * Full schema for a DurableRPC class.
 * Returned by GET /__schema and used by `npx rpc.do generate`.
 */
export interface RpcSchema {
  /** Schema version */
  version: 1
  /** Top-level RPC methods */
  methods: RpcMethodSchema[]
  /** Grouped namespaces (e.g. { users: { get, create } }) */
  namespaces: RpcNamespaceSchema[]
  /** Database schema (if SQLite is used) */
  database?: DatabaseSchema
  /** Storage keys (sample for discovery) */
  storageKeys?: string[]
  /** Colo where this DO is running */
  colo?: string
}

