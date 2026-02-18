/**
 * Internal RPC method constants
 *
 * These are the internal method names used for RPC communication
 * between the client and server for built-in DO features like
 * SQL, storage, and collections.
 *
 * IMPORTANT: This file intentionally duplicates src/constants.ts in the rpc.do package.
 * Both @dotdo/rpc (server) and rpc.do (client) need these constants for
 * protocol compatibility, but they are separate packages without a runtime
 * dependency between them. See PACKAGE_BOUNDARY.md for details.
 *
 * When modifying these constants, ensure both files are updated together.
 *
 * @example
 * ```typescript
 * import { INTERNAL_METHODS } from '@dotdo/rpc'
 *
 * // Server-side (methods are defined on DurableRPC class)
 * // Client-side calls these via transport.call()
 * transport.call(INTERNAL_METHODS.SQL, [serializedQuery])
 * ```
 */
/**
 * Internal RPC method names for built-in DO features
 */
export declare const INTERNAL_METHODS: {
    readonly SQL: "__sql";
    readonly SQL_FIRST: "__sqlFirst";
    readonly SQL_RUN: "__sqlRun";
    readonly STORAGE_GET: "__storageGet";
    readonly STORAGE_GET_MULTIPLE: "__storageGetMultiple";
    readonly STORAGE_PUT: "__storagePut";
    readonly STORAGE_PUT_MULTIPLE: "__storagePutMultiple";
    readonly STORAGE_DELETE: "__storageDelete";
    readonly STORAGE_DELETE_MULTIPLE: "__storageDeleteMultiple";
    readonly STORAGE_LIST: "__storageList";
    readonly STORAGE_KEYS: "__storageKeys";
    readonly DB_SCHEMA: "__dbSchema";
    readonly SCHEMA: "__schema";
    readonly COLLECTION_GET: "__collectionGet";
    readonly COLLECTION_PUT: "__collectionPut";
    readonly COLLECTION_DELETE: "__collectionDelete";
    readonly COLLECTION_HAS: "__collectionHas";
    readonly COLLECTION_FIND: "__collectionFind";
    readonly COLLECTION_COUNT: "__collectionCount";
    readonly COLLECTION_LIST: "__collectionList";
    readonly COLLECTION_KEYS: "__collectionKeys";
    readonly COLLECTION_CLEAR: "__collectionClear";
    readonly COLLECTION_NAMES: "__collectionNames";
    readonly COLLECTION_STATS: "__collectionStats";
    readonly STREAM: "__stream";
    readonly STREAM_CANCEL: "__streamCancel";
    readonly SUBSCRIBE: "__subscribe";
    readonly UNSUBSCRIBE: "__unsubscribe";
};
/**
 * Type for internal method names
 */
export type InternalMethod = (typeof INTERNAL_METHODS)[keyof typeof INTERNAL_METHODS];
/**
 * Array of all internal method names (for use in Set construction)
 */
export declare const INTERNAL_METHOD_NAMES: ("__sql" | "__sqlFirst" | "__sqlRun" | "__storageGet" | "__storageGetMultiple" | "__storagePut" | "__storagePutMultiple" | "__storageDelete" | "__storageDeleteMultiple" | "__storageList" | "__storageKeys" | "__dbSchema" | "__schema" | "__collectionGet" | "__collectionPut" | "__collectionDelete" | "__collectionHas" | "__collectionFind" | "__collectionCount" | "__collectionList" | "__collectionKeys" | "__collectionClear" | "__collectionNames" | "__collectionStats" | "__stream" | "__streamCancel" | "__subscribe" | "__unsubscribe")[];
//# sourceMappingURL=constants.d.ts.map