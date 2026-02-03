/**
 * Storage Plugin
 *
 * Adds Durable Object storage capabilities to composed DurableRPC instances.
 * Provides $.storage access and internal RPC methods for remote storage operations.
 *
 * @example
 * ```typescript
 * const myDO = createDurableRPC({
 *   plugins: [storagePlugin()],
 *   methods: {
 *     getConfig: async ($) => $.storage.get('config'),
 *     setConfig: async ($, config: Config) => $.storage.put('config', config),
 *   }
 * })
 * ```
 */

import type { Plugin, PluginInitContext, StorageContext } from '../types.js'

/**
 * Storage Plugin options
 */
export interface StoragePluginOptions {
  /** Enable operation logging (default: false) */
  logging?: boolean
  /** Custom log function */
  log?: (operation: string, key: string | string[]) => void
}

/**
 * Creates a Storage plugin that adds $.storage capabilities.
 *
 * @param options - Plugin configuration options
 * @returns Storage plugin instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * const myDO = createDurableRPC({
 *   plugins: [storagePlugin()],
 *   methods: {
 *     getData: async ($, key: string) => $.storage.get(key)
 *   }
 * })
 *
 * // With logging
 * const myDO = createDurableRPC({
 *   plugins: [storagePlugin({ logging: true })],
 *   methods: { ... }
 * })
 * ```
 */
export function storagePlugin(options: StoragePluginOptions = {}): Plugin<StorageContext> {
  const { logging = false, log = console.log } = options

  // Store storage reference for internal methods
  let storage: DurableObjectStorage

  return {
    name: 'storage',

    init(ctx: PluginInitContext): StorageContext {
      storage = ctx.ctx.storage

      return {
        get storage() {
          return storage
        },
      }
    },

    // Internal methods for RPC transport (called by client-side $.storage proxy)
    internalMethods: {
      /** @internal */
      async __storageGet<T>(key: string): Promise<T | undefined> {
        if (logging) log('GET', key)
        return storage.get<T>(key)
      },

      /** @internal */
      async __storageGetMultiple<T>(keys: string[]): Promise<Map<string, T>> {
        if (logging) log('GET_MULTIPLE', keys)
        return storage.get<T>(keys)
      },

      /** @internal */
      async __storagePut<T>(key: string, value: T): Promise<void> {
        if (logging) log('PUT', key)
        return storage.put(key, value)
      },

      /** @internal */
      async __storagePutMultiple<T>(entries: Record<string, T>): Promise<void> {
        if (logging) log('PUT_MULTIPLE', Object.keys(entries))
        return storage.put(entries)
      },

      /** @internal */
      async __storageDelete(key: string): Promise<boolean> {
        if (logging) log('DELETE', key)
        return storage.delete(key)
      },

      /** @internal */
      async __storageDeleteMultiple(keys: string[]): Promise<number> {
        if (logging) log('DELETE_MULTIPLE', keys)
        return storage.delete(keys)
      },

      /** @internal */
      async __storageList<T>(opts?: DurableObjectListOptions): Promise<Map<string, T>> {
        if (logging) log('LIST', opts?.prefix ?? '*')
        return storage.list<T>(opts)
      },

      /** @internal */
      async __storageKeys(prefix?: string): Promise<string[]> {
        if (logging) log('KEYS', prefix ?? '*')
        const opts: DurableObjectListOptions = prefix ? { prefix } : {}
        const map = await storage.list(opts)
        return Array.from(map.keys())
      },
    },

    skipProps: ['storage'],
  }
}
