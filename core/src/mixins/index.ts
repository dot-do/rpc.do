/**
 * DurableRPC Mixins
 *
 * Composable mixins for building custom DurableRPC classes.
 * Each mixin adds a specific set of functionality that can be
 * combined as needed.
 *
 * Note: Due to TypeScript limitations with abstract classes and protected members,
 * the main DurableRPC class doesn't use mixin composition directly. However, these
 * mixins are still useful for:
 * - Understanding the logical groupings of functionality
 * - Building custom minimal RPC classes with only needed features
 * - Reusing the mixin logic in other contexts
 *
 * @example Using SQL mixin standalone
 * ```typescript
 * import { withSQL } from '@dotdo/rpc/mixins'
 * import { DurableRPCBase } from '@dotdo/rpc'
 *
 * // Create a minimal class with just SQL support
 * const SQLOnlyBase = withSQL(DurableRPCBase)
 *
 * export class MyDO extends SQLOnlyBase {
 *   // Has __sql, __sqlFirst, __sqlRun methods
 * }
 * ```
 *
 * @packageDocumentation
 */

// Type utilities
export type {
  Constructor,
  AbstractConstructor,
  AnyConstructor,
  HasSQL,
  HasStorage,
  HasState,
  HasSQLAndStorage,
} from './types.js'

// SQL mixin
export {
  withSQL,
  type SQLMixin,
  type SqlQueryResult,
  type SerializedSqlQuery,
} from './sql.js'

// Storage mixin
export {
  withStorage,
  type StorageMixin,
} from './storage.js'

// Collections mixin
export {
  withCollections,
  type CollectionsMixin,
  type Collection,
  type Filter,
  type QueryOptions,
} from './collections.js'

// Schema mixin
export {
  withSchema,
  type SchemaMixin,
  type SchemaConfig,
  type RpcSchema,
  type DatabaseSchema,
} from './schema.js'

// Colo mixin
export {
  withColo,
  WORKER_COLO_HEADER,
  type ColoMixin,
  type ColoContext,
  type ColoInfo,
} from './colo.js'
