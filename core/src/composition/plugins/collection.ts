/**
 * Collection Plugin
 *
 * Adds MongoDB-style document collection capabilities to composed DurableRPC instances.
 * Provides $.collection() access and internal RPC methods for remote collection operations.
 *
 * @example
 * ```typescript
 * interface User {
 *   name: string
 *   email: string
 *   active: boolean
 * }
 *
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin(), collectionPlugin()],
 *   methods: {
 *     createUser: async ($, id: string, data: User) => {
 *       $.collection<User>('users').put(id, data)
 *       return { id }
 *     },
 *     findActiveUsers: async ($) => {
 *       return $.collection<User>('users').find({ active: true })
 *     },
 *   }
 * })
 * ```
 */

import type { Plugin, PluginInitContext, PluginRuntimeContext, CollectionContext, SqlContext } from '../types.js'
import { Collections, type Collection, type Filter, type QueryOptions } from '@dotdo/collections'

/**
 * Collection Plugin options
 */
export interface CollectionPluginOptions {
  /** Enable operation logging (default: false) */
  logging?: boolean
  /** Custom log function */
  log?: (operation: string, collection: string, ...args: unknown[]) => void
}

/**
 * Creates a Collection plugin that adds $.collection() capabilities.
 *
 * Note: This plugin requires the SQL plugin to be installed first,
 * as collections are built on top of SQLite.
 *
 * @param options - Plugin configuration options
 * @returns Collection plugin instance
 *
 * @example
 * ```typescript
 * // Basic usage (requires sqlPlugin)
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin(), collectionPlugin()],
 *   methods: {
 *     getUser: async ($, id: string) => $.collection('users').get(id),
 *   }
 * })
 *
 * // With logging
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin(), collectionPlugin({ logging: true })],
 *   methods: { ... }
 * })
 * ```
 */
export function collectionPlugin(options: CollectionPluginOptions = {}): Plugin<CollectionContext> {
  const { logging = false, log = console.log } = options

  // Store references for internal methods
  let collections: Collections | undefined
  let sqlStorage: SqlStorage

  const getCollections = (): Collections => {
    if (!collections) {
      collections = new Collections(sqlStorage)
    }
    return collections
  }

  return {
    name: 'collection',

    init(ctx: PluginInitContext): CollectionContext {
      // Store SQL reference (collections are built on SQLite)
      sqlStorage = ctx.ctx.storage.sql

      return {
        collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<T> {
          if (logging) log('COLLECTION', name)
          return getCollections().collection<T>(name)
        },
      }
    },

    // Setup hook to verify SQL plugin is available
    setup(ctx: PluginRuntimeContext & CollectionContext, allContexts: Record<string, unknown>): void {
      // Verify SQL context is available (collections need SQL)
      const sqlContext = allContexts['sql'] as SqlContext | undefined
      if (!sqlContext) {
        console.warn('[CollectionPlugin] SQL plugin not found. Collections will use direct storage.sql access.')
      }
    },

    // Internal methods for RPC transport (called by client-side $.collection proxy)
    internalMethods: {
      /** @internal */
      __collectionGet<T extends Record<string, unknown>>(
        collectionName: string,
        id: string
      ): T | null {
        if (logging) log('GET', collectionName, id)
        return getCollections().collection<T>(collectionName).get(id)
      },

      /** @internal */
      __collectionPut<T extends Record<string, unknown>>(
        collectionName: string,
        id: string,
        doc: T
      ): void {
        if (logging) log('PUT', collectionName, id)
        getCollections().collection<T>(collectionName).put(id, doc)
      },

      /** @internal */
      __collectionDelete(collectionName: string, id: string): boolean {
        if (logging) log('DELETE', collectionName, id)
        return getCollections().collection(collectionName).delete(id)
      },

      /** @internal */
      __collectionHas(collectionName: string, id: string): boolean {
        if (logging) log('HAS', collectionName, id)
        return getCollections().collection(collectionName).has(id)
      },

      /** @internal */
      __collectionFind<T extends Record<string, unknown>>(
        collectionName: string,
        filter?: Filter<T>,
        opts?: QueryOptions
      ): T[] {
        if (logging) log('FIND', collectionName, filter)
        return getCollections().collection<T>(collectionName).find(filter, opts)
      },

      /** @internal */
      __collectionCount<T extends Record<string, unknown>>(
        collectionName: string,
        filter?: Filter<T>
      ): number {
        if (logging) log('COUNT', collectionName, filter)
        return getCollections().collection<T>(collectionName).count(filter)
      },

      /** @internal */
      __collectionList<T extends Record<string, unknown>>(
        collectionName: string,
        opts?: QueryOptions
      ): T[] {
        if (logging) log('LIST', collectionName)
        return getCollections().collection<T>(collectionName).list(opts)
      },

      /** @internal */
      __collectionKeys(collectionName: string): string[] {
        if (logging) log('KEYS', collectionName)
        return getCollections().collection(collectionName).keys()
      },

      /** @internal */
      __collectionClear(collectionName: string): number {
        if (logging) log('CLEAR', collectionName)
        return getCollections().collection(collectionName).clear()
      },

      /** @internal */
      __collectionNames(): string[] {
        if (logging) log('NAMES', '*')
        return getCollections().names()
      },

      /** @internal */
      __collectionStats(): Array<{ name: string; count: number; size: number }> {
        if (logging) log('STATS', '*')
        return getCollections().stats()
      },
    },

    skipProps: ['collection', '_collections'],
  }
}

// Re-export collection types for convenience
export type { Collection, Filter, QueryOptions }
