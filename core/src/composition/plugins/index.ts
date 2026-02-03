/**
 * DurableRPC Plugins
 *
 * Composable plugins for building DurableRPC instances.
 * Each plugin adds specific functionality that can be combined as needed.
 *
 * @example
 * ```typescript
 * import { createDurableRPC, sqlPlugin, storagePlugin, authPlugin } from '@dotdo/rpc'
 *
 * const myDO = createDurableRPC({
 *   plugins: [
 *     sqlPlugin(),
 *     storagePlugin(),
 *     authPlugin({ required: true }),
 *   ],
 *   methods: {
 *     getData: async ($, key: string) => $.storage.get(key),
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

// SQL Plugin
export {
  sqlPlugin,
  type SqlPluginOptions,
  type SqlQueryResult,
  type SerializedSqlQuery,
} from './sql.js'

// Storage Plugin
export {
  storagePlugin,
  type StoragePluginOptions,
} from './storage.js'

// Collection Plugin
export {
  collectionPlugin,
  type CollectionPluginOptions,
  type Collection,
  type Filter,
  type QueryOptions,
} from './collection.js'

// Auth Plugin
export {
  authPlugin,
} from './auth.js'

// Colo Plugin
export {
  coloPlugin,
  WORKER_COLO_HEADER,
  type ColoPluginOptions,
  type ColoInfo,
} from './colo.js'
