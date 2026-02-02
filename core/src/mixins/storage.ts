/**
 * Storage Mixin
 *
 * Provides RPC-callable storage methods for remote key-value access.
 * These methods are called by the client-side $.storage proxy.
 */

import type { AbstractConstructor, HasStorage } from './types.js'

/**
 * Interface provided by the Storage mixin
 */
export interface StorageMixin {
  __storageGet<T>(key: string): Promise<T | undefined>
  __storageGetMultiple<T>(keys: string[]): Promise<Map<string, T>>
  __storagePut<T>(key: string, value: T): Promise<void>
  __storagePutMultiple<T>(entries: Record<string, T>): Promise<void>
  __storageDelete(key: string): Promise<boolean>
  __storageDeleteMultiple(keys: string[]): Promise<number>
  __storageList<T>(options?: DurableObjectListOptions): Promise<Map<string, T>>
  __storageKeys(prefix?: string): Promise<string[]>
}

/**
 * Storage mixin that adds RPC-callable storage methods.
 *
 * @example
 * ```typescript
 * class MyDO extends withStorage(DurableRPCBase) {
 *   // Now has __storageGet, __storagePut, etc. methods
 * }
 * ```
 */
export function withStorage<T extends AbstractConstructor<HasStorage>>(Base: T) {
  abstract class StorageMixinClass extends Base implements StorageMixin {
    /** @internal */
    async __storageGet<V>(key: string): Promise<V | undefined> {
      return this.storage.get<V>(key)
    }

    /** @internal */
    async __storageGetMultiple<V>(keys: string[]): Promise<Map<string, V>> {
      return this.storage.get<V>(keys)
    }

    /** @internal */
    async __storagePut<V>(key: string, value: V): Promise<void> {
      return this.storage.put(key, value)
    }

    /** @internal */
    async __storagePutMultiple<V>(entries: Record<string, V>): Promise<void> {
      return this.storage.put(entries)
    }

    /** @internal */
    async __storageDelete(key: string): Promise<boolean> {
      return this.storage.delete(key)
    }

    /** @internal */
    async __storageDeleteMultiple(keys: string[]): Promise<number> {
      return this.storage.delete(keys)
    }

    /** @internal */
    async __storageList<V>(options?: DurableObjectListOptions): Promise<Map<string, V>> {
      return this.storage.list<V>(options)
    }

    /**
     * Get storage keys (with optional prefix filter)
     * @internal
     */
    async __storageKeys(prefix?: string): Promise<string[]> {
      const options: DurableObjectListOptions = prefix ? { prefix } : {}
      const map = await this.storage.list(options)
      return Array.from(map.keys())
    }
  }

  return StorageMixinClass
}
