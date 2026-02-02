/**
 * Type Helper Functions for rpc.do
 *
 * Centralizes type assertions used for RPC transport calls. The transport layer
 * returns `Promise<unknown>` because the actual return type depends on the
 * specific RPC method being called. These helper functions document and
 * centralize the type casts needed to convert transport results to their
 * expected types.
 *
 * Why these casts are safe:
 * - The server-side RPC handlers return specific types for each internal method
 * - The method names (INTERNAL_METHODS.*) are a closed set defined in constants.ts
 * - Each helper corresponds 1:1 with a server method that returns that type
 *
 * @internal These helpers are for internal use within the rpc.do client
 */

import type { SqlQueryResult, RpcSchema, DatabaseSchema } from '@dotdo/rpc'

// ============================================================================
// SQL Query Result Helpers
// ============================================================================

/**
 * Cast transport result to SqlQueryResult.
 *
 * Safe because: INTERNAL_METHODS.SQL always returns SqlQueryResult from the server.
 * The server's _rpc_sql handler executes the query and returns { results, meta }.
 *
 * @internal
 */
export function asSqlQueryResult<T>(value: unknown): SqlQueryResult<T> {
  return value as SqlQueryResult<T>
}

/**
 * Cast transport result to a nullable record type.
 *
 * Safe because: INTERNAL_METHODS.SQL_FIRST returns T | null from the server.
 * The server's _rpc_sql_first handler returns the first row or null.
 *
 * @internal
 */
export function asNullable<T>(value: unknown): T | null {
  return value as T | null
}

/**
 * Cast transport result to SQL run result.
 *
 * Safe because: INTERNAL_METHODS.SQL_RUN always returns { rowsWritten } from server.
 * The server's _rpc_sql_run handler executes the mutation and returns the count.
 *
 * @internal
 */
export function asSqlRunResult(value: unknown): { rowsWritten: number } {
  return value as { rowsWritten: number }
}

// ============================================================================
// Collection Result Helpers
// ============================================================================

/**
 * Cast transport result to an array of records.
 *
 * Safe because: Collection find/list methods always return T[] from the server.
 * The server queries SQLite and returns matching documents as an array.
 *
 * @internal
 */
export function asArray<T>(value: unknown): T[] {
  return value as T[]
}

/**
 * Cast transport result to a boolean.
 *
 * Safe because: Collection has/delete methods return boolean from the server.
 * The server returns true/false based on existence or deletion success.
 *
 * @internal
 */
export function asBoolean(value: unknown): boolean {
  return value as boolean
}

/**
 * Cast transport result to a number.
 *
 * Safe because: Collection count/clear methods return number from the server.
 * The server returns the count of matching/deleted documents.
 *
 * @internal
 */
export function asNumber(value: unknown): number {
  return value as number
}

/**
 * Cast transport result to a string array.
 *
 * Safe because: Collection keys/names and storage keys return string[] from server.
 * The server queries for IDs/names and returns them as a string array.
 *
 * @internal
 */
export function asStringArray(value: unknown): string[] {
  return value as string[]
}

/**
 * Cast transport result to collection stats array.
 *
 * Safe because: INTERNAL_METHODS.COLLECTION_STATS returns this shape from server.
 * The server aggregates stats for each collection into this structure.
 *
 * @internal
 */
export function asCollectionStats(value: unknown): Array<{ name: string; count: number; size: number }> {
  return value as Array<{ name: string; count: number; size: number }>
}

// ============================================================================
// Storage Result Helpers
// ============================================================================

/**
 * Cast transport result to a record/map type.
 *
 * Safe because: Storage get_multiple/list return Record<string, T> from server.
 * The server serializes the Map as a plain object for JSON transport.
 *
 * @internal
 */
export function asRecord<T>(value: unknown): Record<string, T> {
  return value as Record<string, T>
}

/**
 * Cast transport result to optional value.
 *
 * Safe because: Storage get returns T | undefined from the server.
 * The server returns the value if found, undefined otherwise.
 *
 * @internal
 */
export function asOptional<T>(value: unknown): T | undefined {
  return value as T | undefined
}

// ============================================================================
// Schema Result Helpers
// ============================================================================

/**
 * Cast transport result to DatabaseSchema.
 *
 * Safe because: INTERNAL_METHODS.DB_SCHEMA returns DatabaseSchema from server.
 * The server introspects SQLite and returns tables, columns, indexes.
 *
 * @internal
 */
export function asDatabaseSchema(value: unknown): DatabaseSchema {
  return value as DatabaseSchema
}

/**
 * Cast transport result to RpcSchema.
 *
 * Safe because: INTERNAL_METHODS.SCHEMA returns RpcSchema from server.
 * The server introspects the RPC target and returns method/namespace info.
 *
 * @internal
 */
export function asRpcSchema(value: unknown): RpcSchema {
  return value as RpcSchema
}
