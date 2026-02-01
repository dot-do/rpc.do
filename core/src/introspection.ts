/**
 * Introspection utilities for DurableRPC
 *
 * This module provides schema reflection for:
 * - RPC methods and namespaces
 * - SQLite database schema (tables, columns, indexes)
 *
 * Used by:
 * - GET /__schema endpoint
 * - `npx rpc.do generate` for typed client codegen
 */

// ============================================================================
// Schema Type Interfaces
// ============================================================================

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

// ============================================================================
// SQL Helpers
// ============================================================================

/**
 * Escape a SQLite identifier (table/column/index name) to prevent SQL injection.
 * Doubles any internal double-quotes and wraps in double-quotes.
 */
function escapeSqlIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// ============================================================================
// RPC Method/Namespace Collection
// ============================================================================

/**
 * Collect RPC methods from an object and its prototype chain.
 *
 * Walks the object's own properties looking for functions that should be
 * exposed as RPC methods. Skips properties in the skipProps set and
 * private properties (starting with _).
 *
 * @param obj - The object to collect methods from
 * @param skipProps - Set of property names to skip
 * @returns Array of RPC method schemas
 */
export function collectRpcMethods(obj: any, skipProps: Set<string>): RpcMethodSchema[] {
  const methods: RpcMethodSchema[] = []

  if (!obj || obj === Object.prototype) return methods

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (skipProps.has(key) || key.startsWith('_')) continue

    let value: any
    try {
      value = obj[key]
    } catch {
      continue
    }

    if (typeof value === 'function') {
      methods.push({ name: key, path: key, params: value.length })
    }
  }

  return methods
}

/**
 * Collect RPC namespaces (objects containing methods) from an object.
 *
 * A namespace is an object property that contains function properties.
 * For example: `{ users: { get: fn, create: fn } }` would yield a
 * namespace "users" with methods "get" and "create".
 *
 * @param obj - The object to collect namespaces from
 * @param skipProps - Set of property names to skip
 * @returns Array of RPC namespace schemas
 */
export function collectRpcNamespaces(obj: any, skipProps: Set<string>): RpcNamespaceSchema[] {
  const namespaces: RpcNamespaceSchema[] = []

  if (!obj || obj === Object.prototype) return namespaces

  for (const key of Object.getOwnPropertyNames(obj)) {
    if (skipProps.has(key) || key.startsWith('_')) continue

    let value: any
    try {
      value = obj[key]
    } catch {
      continue
    }

    // Check if it's a namespace (object with function properties)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nsMethods: RpcMethodSchema[] = []
      for (const nsKey of Object.keys(value)) {
        if (typeof value[nsKey] === 'function') {
          nsMethods.push({
            name: nsKey,
            path: `${key}.${nsKey}`,
            params: value[nsKey].length,
          })
        }
      }
      if (nsMethods.length > 0) {
        namespaces.push({ name: key, methods: nsMethods })
      }
    }
  }

  return namespaces
}

// ============================================================================
// Database Introspection
// ============================================================================

/**
 * Introspect SQLite database schema.
 *
 * Queries SQLite metadata to extract:
 * - Tables (excluding sqlite_ and _cf_ internal tables)
 * - Column definitions (name, type, nullable, primaryKey, default)
 * - Index definitions (name, columns, unique)
 *
 * @param sql - SqlStorage instance to introspect
 * @returns Database schema with tables, columns, and indexes
 */
export function introspectDatabase(sql: SqlStorage): DatabaseSchema {
  const tables: TableSchema[] = []

  try {
    // Get all tables
    const tableRows = sql.exec<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
    ).toArray()

    for (const { name: tableName } of tableRows) {
      // Get columns
      const columns: ColumnSchema[] = []
      const columnRows = sql.exec<{
        name: string
        type: string
        notnull: number
        pk: number
        dflt_value: string | null
      }>(`PRAGMA table_info(${escapeSqlIdentifier(tableName)})`).toArray()

      for (const col of columnRows) {
        const columnSchema: ColumnSchema = {
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          primaryKey: col.pk > 0,
        }
        if (col.dflt_value !== null) {
          columnSchema.defaultValue = col.dflt_value
        }
        columns.push(columnSchema)
      }

      // Get indexes
      const indexes: IndexSchema[] = []
      const indexRows = sql.exec<{ name: string; unique: number }>(
        `PRAGMA index_list(${escapeSqlIdentifier(tableName)})`
      ).toArray()

      for (const idx of indexRows) {
        if (idx.name.startsWith('sqlite_')) continue

        const indexCols = sql.exec<{ name: string }>(
          `PRAGMA index_info(${escapeSqlIdentifier(idx.name)})`
        ).toArray()

        indexes.push({
          name: idx.name,
          columns: indexCols.map(c => c.name),
          unique: idx.unique === 1,
        })
      }

      tables.push({ name: tableName, columns, indexes })
    }
  } catch (error) {
    // SQLite may not be initialized yet
    console.debug('[DurableRPC] SQLite introspection skipped - not initialized:', error)
  }

  return { tables }
}

// ============================================================================
// DurableRPC Introspection
// ============================================================================

/**
 * Interface for objects that can be introspected by introspectDurableRPC.
 * Must have a sql property for database introspection and optional colo.
 */
export interface IntrospectableRpc {
  sql: SqlStorage
  colo: string | undefined
}

/**
 * Configuration for DurableRPC introspection
 */
export interface IntrospectionConfig {
  /** Properties to skip during introspection */
  skipProps: Set<string>
  /** The base prototype to stop at when walking the prototype chain */
  basePrototype: object
}

/**
 * Introspect a DurableRPC instance and return its API schema.
 *
 * Walks the instance's own properties and prototype chain (up to basePrototype),
 * collecting:
 * - Top-level RPC methods
 * - Namespaces (objects containing methods)
 * - Database schema (tables, columns, indexes)
 *
 * @param instance - The DurableRPC instance to introspect
 * @param config - Introspection configuration
 * @returns Full RPC schema
 */
export function introspectDurableRPC<T extends IntrospectableRpc>(
  instance: T,
  config: IntrospectionConfig
): RpcSchema {
  const methods: RpcMethodSchema[] = []
  const namespaces: RpcNamespaceSchema[] = []
  const seen = new Set<string>()

  // Helper to collect properties from an object, merging with seen set
  const collectProps = (obj: any) => {
    if (!obj || obj === Object.prototype) return

    for (const key of Object.getOwnPropertyNames(obj)) {
      if (!seen.has(key) && !config.skipProps.has(key) && !key.startsWith('_')) {
        seen.add(key)

        let value: any
        try {
          value = (instance as any)[key]
        } catch {
          continue
        }

        if (typeof value === 'function') {
          methods.push({ name: key, path: key, params: value.length })
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Check if it's a namespace (object with function properties)
          const nsMethods: RpcMethodSchema[] = []
          for (const nsKey of Object.keys(value)) {
            if (typeof value[nsKey] === 'function') {
              nsMethods.push({
                name: nsKey,
                path: `${key}.${nsKey}`,
                params: value[nsKey].length,
              })
            }
          }
          if (nsMethods.length > 0) {
            namespaces.push({ name: key, methods: nsMethods })
          }
        }
      }
    }
  }

  // Walk instance own props first, then prototype chain
  collectProps(instance)
  let proto = Object.getPrototypeOf(instance)
  while (proto && proto !== config.basePrototype && proto !== Object.prototype) {
    collectProps(proto)
    proto = Object.getPrototypeOf(proto)
  }

  // Add database schema
  let database: DatabaseSchema | undefined
  try {
    database = introspectDatabase(instance.sql)
    if (database.tables.length === 0) {
      database = undefined
    }
  } catch {
    // SQL not available
  }

  const schema: RpcSchema = {
    version: 1,
    methods,
    namespaces,
  }
  if (database) schema.database = database
  if (instance.colo) schema.colo = instance.colo
  return schema
}
