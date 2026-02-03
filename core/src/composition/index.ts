/**
 * DurableRPC Composition API
 *
 * This module provides a composition-based alternative to class inheritance
 * for creating DurableRPC instances. Instead of extending a base class,
 * you compose your DO from plugins and method definitions.
 *
 * @example
 * ```typescript
 * // Instead of inheritance:
 * // class MyDO extends DurableRPC { ... }
 *
 * // Use composition:
 * import { createDurableRPC, sqlPlugin, storagePlugin } from '@dotdo/rpc'
 *
 * export const MyDO = createDurableRPC({
 *   plugins: [sqlPlugin(), storagePlugin()],
 *   methods: {
 *     getUser: async ($, id: string) => {
 *       return $.sql`SELECT * FROM users WHERE id = ${id}`.first()
 *     },
 *     users: {
 *       list: async ($) => $.sql`SELECT * FROM users`.all(),
 *       create: async ($, data: { name: string }) => {
 *         $.sql`INSERT INTO users (name) VALUES (${data.name})`.run()
 *         return { ok: true }
 *       }
 *     }
 *   }
 * })
 * ```
 *
 * Benefits of composition over inheritance:
 * - **Explicit Dependencies**: Only include the plugins you need
 * - **Smaller Bundles**: Tree-shaking works better with explicit imports
 * - **Better Types**: Full type inference for the $ context
 * - **Testability**: Easy to mock plugins for testing
 * - **Flexibility**: Mix and match plugins as needed
 *
 * @packageDocumentation
 */

// Factory function
export { createDurableRPC } from './factory.js'

// Plugin implementations
export {
  sqlPlugin,
  storagePlugin,
  collectionPlugin,
  authPlugin,
  coloPlugin,
  WORKER_COLO_HEADER,
  type SqlPluginOptions,
  type SqlQueryResult,
  type SerializedSqlQuery,
  type StoragePluginOptions,
  type CollectionPluginOptions,
  type Collection,
  type Filter,
  type QueryOptions,
  type ColoPluginOptions,
  type ColoInfo,
} from './plugins/index.js'

// Types
export type {
  // Core plugin types
  Plugin,
  PluginInitContext,
  PluginRuntimeContext,

  // Context types
  BaseContext,
  SqlContext,
  StorageContext,
  CollectionContext,
  AuthContext,
  ColoContext,

  // Plugin interfaces
  SqlPlugin,
  StoragePlugin,
  CollectionPlugin,
  AuthPlugin,
  ColoPlugin,
  AuthPluginOptions,

  // Factory types
  CreateDurableRPCConfig,
  ComposedContext,
  MethodDefinition,
  NamespaceDefinition,
  MethodsOrNamespaces,
  ComposedDurableObjectClass,

  // Utility types
  PluginContext,
  BuiltinPlugin,
  MergeContexts,
  ExtractMethodSignature,
  ExposedMethods,
} from './types.js'
