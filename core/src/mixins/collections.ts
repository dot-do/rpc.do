/**
 * Collections Mixin
 *
 * Provides MongoDB-style document store operations on SQLite.
 * Includes both the collection() method and RPC-callable collection methods.
 */

import type { AbstractConstructor, HasSQL } from './types.js'
import {
  Collections,
  type Collection,
  type Filter,
  type QueryOptions,
} from '@dotdo/collections'

/**
 * Interface provided by the Collections mixin
 */
export interface CollectionsMixin {
  /** Collections manager instance */
  _collections?: Collections
  /** Get or create a named collection */
  collection<T extends Record<string, unknown>>(name: string): Collection<T>
  /** @internal */ __collectionGet<T extends Record<string, unknown>>(collection: string, id: string): T | null
  /** @internal */ __collectionPut<T extends Record<string, unknown>>(collection: string, id: string, doc: T): void
  /** @internal */ __collectionDelete(collection: string, id: string): boolean
  /** @internal */ __collectionHas(collection: string, id: string): boolean
  /** @internal */ __collectionFind<T extends Record<string, unknown>>(collection: string, filter?: Filter<T>, options?: QueryOptions): T[]
  /** @internal */ __collectionCount<T extends Record<string, unknown>>(collection: string, filter?: Filter<T>): number
  /** @internal */ __collectionList<T extends Record<string, unknown>>(collection: string, options?: QueryOptions): T[]
  /** @internal */ __collectionKeys(collection: string): string[]
  /** @internal */ __collectionClear(collection: string): number
  /** @internal */ __collectionNames(): string[]
  /** @internal */ __collectionStats(): Array<{ name: string; count: number; size: number }>
}

/**
 * Collections mixin that adds MongoDB-style document operations.
 *
 * @example
 * ```typescript
 * class MyDO extends withCollections(DurableRPCBase) {
 *   users = this.collection<User>('users')
 *
 *   async createUser(data: User) {
 *     this.users.put(data.id, data)
 *   }
 * }
 * ```
 */
export function withCollections<T extends AbstractConstructor<HasSQL>>(Base: T) {
  abstract class CollectionsMixinClass extends Base implements CollectionsMixin {
    /** Collections manager (lazy-initialized) */
    _collections?: Collections

    /**
     * Get or create a named collection for MongoDB-style document operations
     *
     * Collections provide a document-oriented interface on top of SQLite:
     * - **CRUD**: `get(id)`, `put(id, doc)`, `delete(id)`, `has(id)`
     * - **Queries**: `find(filter, options)` with MongoDB-style operators
     * - **Aggregation**: `count(filter)`, `list(options)`, `keys()`
     * - **Bulk**: `clear()` to delete all documents
     *
     * Supported filter operators:
     * - `$eq`, `$ne` - Equality/inequality
     * - `$gt`, `$gte`, `$lt`, `$lte` - Comparisons
     * - `$in`, `$nin` - Array membership
     * - `$exists` - Field existence
     * - `$regex` - Pattern matching
     * - `$and`, `$or` - Logical operators
     *
     * @typeParam T - The document type (must extend `Record<string, unknown>`)
     * @param name - The collection name (used as SQLite table name)
     * @returns A Collection instance with typed document operations
     */
    collection<V extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<V> {
      if (!this._collections) {
        this._collections = new Collections(this.sql)
      }
      return this._collections.collection<V>(name)
    }

    /** @internal */ __collectionGet<V extends Record<string, unknown>>(
      collection: string,
      id: string
    ): V | null {
      return this.collection<V>(collection).get(id)
    }

    /** @internal */ __collectionPut<V extends Record<string, unknown>>(
      collection: string,
      id: string,
      doc: V
    ): void {
      this.collection<V>(collection).put(id, doc)
    }

    /** @internal */ __collectionDelete(collection: string, id: string): boolean {
      return this.collection(collection).delete(id)
    }

    /** @internal */ __collectionHas(collection: string, id: string): boolean {
      return this.collection(collection).has(id)
    }

    /** @internal */ __collectionFind<V extends Record<string, unknown>>(
      collection: string,
      filter?: Filter<V>,
      options?: QueryOptions
    ): V[] {
      return this.collection<V>(collection).find(filter, options)
    }

    /** @internal */ __collectionCount<V extends Record<string, unknown>>(
      collection: string,
      filter?: Filter<V>
    ): number {
      return this.collection<V>(collection).count(filter)
    }

    /** @internal */ __collectionList<V extends Record<string, unknown>>(
      collection: string,
      options?: QueryOptions
    ): V[] {
      return this.collection<V>(collection).list(options)
    }

    /** @internal */ __collectionKeys(collection: string): string[] {
      return this.collection(collection).keys()
    }

    /** @internal */ __collectionClear(collection: string): number {
      return this.collection(collection).clear()
    }

    /** @internal */ __collectionNames(): string[] {
      if (!this._collections) {
        this._collections = new Collections(this.sql)
      }
      return this._collections.names()
    }

    /** @internal */ __collectionStats(): Array<{ name: string; count: number; size: number }> {
      if (!this._collections) {
        this._collections = new Collections(this.sql)
      }
      return this._collections.stats()
    }
  }

  return CollectionsMixinClass
}

// Re-export collection types for convenience
export type { Collection, Filter, QueryOptions }
