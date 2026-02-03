/**
 * Internal RPC method constants
 *
 * These are the internal method names used for RPC communication
 * between the client and server for built-in DO features like
 * SQL, storage, and collections.
 *
 * IMPORTANT: This file intentionally duplicates core/src/constants.ts.
 * Both rpc.do (client) and @dotdo/rpc (server) need these constants for
 * protocol compatibility, but they are separate packages without a runtime
 * dependency between them. See PACKAGE_BOUNDARY.md for details.
 *
 * When modifying these constants, ensure both files are updated together.
 *
 * @example
 * ```typescript
 * import { INTERNAL_METHODS } from 'rpc.do'
 *
 * // Use in custom transport implementations
 * transport.call(INTERNAL_METHODS.SQL, [serializedQuery])
 * ```
 */

/**
 * Internal RPC method names for built-in DO features
 */
export const INTERNAL_METHODS = {
  // SQL methods
  SQL: '__sql',
  SQL_FIRST: '__sqlFirst',
  SQL_RUN: '__sqlRun',

  // Storage methods
  STORAGE_GET: '__storageGet',
  STORAGE_GET_MULTIPLE: '__storageGetMultiple',
  STORAGE_PUT: '__storagePut',
  STORAGE_PUT_MULTIPLE: '__storagePutMultiple',
  STORAGE_DELETE: '__storageDelete',
  STORAGE_DELETE_MULTIPLE: '__storageDeleteMultiple',
  STORAGE_LIST: '__storageList',
  STORAGE_KEYS: '__storageKeys',

  // Schema methods
  DB_SCHEMA: '__dbSchema',
  SCHEMA: '__schema',

  // Collection methods
  COLLECTION_GET: '__collectionGet',
  COLLECTION_PUT: '__collectionPut',
  COLLECTION_DELETE: '__collectionDelete',
  COLLECTION_HAS: '__collectionHas',
  COLLECTION_FIND: '__collectionFind',
  COLLECTION_COUNT: '__collectionCount',
  COLLECTION_LIST: '__collectionList',
  COLLECTION_KEYS: '__collectionKeys',
  COLLECTION_CLEAR: '__collectionClear',
  COLLECTION_NAMES: '__collectionNames',
  COLLECTION_STATS: '__collectionStats',

  // Streaming methods
  STREAM: '__stream',
  STREAM_CANCEL: '__streamCancel',
  SUBSCRIBE: '__subscribe',
  UNSUBSCRIBE: '__unsubscribe',
} as const

/**
 * Type for internal method names
 */
export type InternalMethod = (typeof INTERNAL_METHODS)[keyof typeof INTERNAL_METHODS]

/**
 * Array of all internal method names (for use in Set construction)
 */
export const INTERNAL_METHOD_NAMES = Object.values(INTERNAL_METHODS)
