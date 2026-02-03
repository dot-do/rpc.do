/**
 * SQL Plugin
 *
 * Adds SQL capabilities to composed DurableRPC instances.
 * Provides $.sql access and internal RPC methods for remote SQL execution.
 *
 * @example
 * ```typescript
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin()],
 *   methods: {
 *     getUsers: async ($) => $.sql`SELECT * FROM users`.all(),
 *     getUser: async ($, id: string) => $.sql`SELECT * FROM users WHERE id = ${id}`.first(),
 *   }
 * })
 * ```
 */

import type { Plugin, PluginInitContext, SqlContext } from '../types.js'

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
 * Serialized SQL query for RPC transport
 */
export interface SerializedSqlQuery {
  strings: string[]
  values: unknown[]
}

/**
 * SQL Plugin options
 */
export interface SqlPluginOptions {
  /** Enable query logging (default: false) */
  logging?: boolean
  /** Custom log function */
  log?: (query: string, values: unknown[]) => void
}

/**
 * Validates SQL query parameter count.
 */
function validateQueryParams(query: SerializedSqlQuery): void {
  if (query.strings.length - 1 !== query.values.length) {
    throw new Error(
      `SQL parameter count mismatch: expected ${query.strings.length - 1} values but got ${query.values.length}. ` +
      `This usually indicates incorrect SQL template tag usage.`
    )
  }
}

/**
 * Creates a SQL plugin that adds $.sql capabilities.
 *
 * @param options - Plugin configuration options
 * @returns SQL plugin instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin()],
 *   methods: {
 *     query: async ($, sql: string) => $.sql`${sql}`.all()
 *   }
 * })
 *
 * // With logging
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin({ logging: true })],
 *   methods: { ... }
 * })
 * ```
 */
export function sqlPlugin(options: SqlPluginOptions = {}): Plugin<SqlContext> {
  const { logging = false, log = console.log } = options

  // Store sql reference for internal methods
  let sqlStorage: SqlStorage

  return {
    name: 'sql',

    init(ctx: PluginInitContext): SqlContext {
      sqlStorage = ctx.ctx.storage.sql

      return {
        get sql() {
          return sqlStorage
        },
      }
    },

    // Internal methods for RPC transport (called by client-side $.sql proxy)
    internalMethods: {
      /**
       * Execute SQL query via RPC
       * @internal
       */
      __sql(query: SerializedSqlQuery): SqlQueryResult {
        validateQueryParams(query)

        const queryString = query.strings.join('?')
        if (logging) {
          log(`[SQL] ${queryString}`, query.values)
        }

        const cursor = sqlStorage.exec(queryString, ...query.values)
        const results = cursor.toArray()

        return {
          results,
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        }
      },

      /**
       * Execute SQL and return first row
       * @internal
       */
      __sqlFirst<T = Record<string, unknown>>(query: SerializedSqlQuery): T | null {
        validateQueryParams(query)

        const queryString = query.strings.join('?')
        if (logging) {
          log(`[SQL First] ${queryString}`, query.values)
        }

        const cursor = sqlStorage.exec(queryString, ...query.values)
        return cursor.one() as T | null
      },

      /**
       * Execute SQL for write operations
       * @internal
       */
      __sqlRun(query: SerializedSqlQuery): { rowsWritten: number } {
        validateQueryParams(query)

        const queryString = query.strings.join('?')
        if (logging) {
          log(`[SQL Run] ${queryString}`, query.values)
        }

        const cursor = sqlStorage.exec(queryString, ...query.values)
        return { rowsWritten: cursor.rowsWritten }
      },
    },

    skipProps: ['sql'],
  }
}
