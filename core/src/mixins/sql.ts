/**
 * SQL Mixin
 *
 * Provides RPC-callable SQL methods for remote query execution.
 * These methods are called by the client-side $.sql`...` proxy.
 */

import type { AbstractConstructor, HasSQL } from './types.js'

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
 * Interface provided by the SQL mixin
 */
export interface SQLMixin {
  __sql(query: SerializedSqlQuery): SqlQueryResult
  __sqlFirst<T = Record<string, unknown>>(query: SerializedSqlQuery): T | null
  __sqlRun(query: SerializedSqlQuery): { rowsWritten: number }
}

/**
 * Validates SQL query parameter count.
 * Template strings should have one more element than values.
 * e.g., sql`SELECT * FROM users WHERE id = ${id}` has strings=["SELECT * FROM users WHERE id = ", ""], values=[id]
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
 * SQL mixin that adds RPC-callable SQL query methods.
 *
 * @example
 * ```typescript
 * class MyDO extends withSQL(DurableRPCBase) {
 *   // Now has __sql, __sqlFirst, __sqlRun methods
 * }
 * ```
 */
export function withSQL<T extends AbstractConstructor<HasSQL>>(Base: T) {
  abstract class SQLMixinClass extends Base implements SQLMixin {
    /**
     * Execute SQL query via RPC
     * Called by client-side $.sql`...` proxy
     * @internal
     */
    __sql(query: SerializedSqlQuery): SqlQueryResult {
      validateQueryParams(query)
      const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
      const results = cursor.toArray()
      return {
        results,
        meta: {
          rows_read: cursor.rowsRead,
          rows_written: cursor.rowsWritten,
        },
      }
    }

    /**
     * Execute SQL and return first row
     * @internal
     */
    __sqlFirst<R = Record<string, unknown>>(query: SerializedSqlQuery): R | null {
      validateQueryParams(query)
      const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
      return cursor.one() as R | null
    }

    /**
     * Execute SQL for write operations (INSERT, UPDATE, DELETE)
     * @internal
     */
    __sqlRun(query: SerializedSqlQuery): { rowsWritten: number } {
      validateQueryParams(query)
      const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
      return { rowsWritten: cursor.rowsWritten }
    }
  }

  return SQLMixinClass
}
