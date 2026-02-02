/**
 * @dotdo/rpc - Durable Object RPC Server
 *
 * Wraps capnweb with Cloudflare DO-specific features:
 * - $ context (sql, storage, state)
 * - WebSocket hibernation
 * - Worker -> DO routing
 * - Auth middleware
 *
 * @example
 * ```typescript
 * import { DurableRPC } from '@dotdo/rpc'
 *
 * export class MyDO extends DurableRPC {
 *   users = {
 *     get: async (id: string) => {
 *       return this.$.sql`SELECT * FROM users WHERE id = ${id}`.first()
 *     },
 *     create: async (data: { name: string; email: string }) => {
 *       this.$.sql`INSERT INTO users (name, email) VALUES (${data.name}, ${data.email})`.run()
 *       return { ok: true }
 *     }
 *   }
 * }
 * ```
 */

// Re-export function types from @dotdo/do/types for RPC consumers
export type {
  Fn,
  AsyncFn,
  RpcFn,
  RpcPromise,
  FunctionTier,
  TieredFunctionDef,
  CodeFunction,
  GenerativeFunction,
  AgenticFunction,
  HumanFunction,
  SerializableFnCall,
  FunctionEntry,
} from '@dotdo/do/types'

import {
  RpcSession,
  RpcTarget,
  HibernatableWebSocketTransport,
  TransportRegistry,
  type RpcTransport,
  type RpcSessionOptions,
} from '@dotdo/capnweb/server'

// Colo awareness (using tiny entry point for minimal bundle)
import {
  getColo,
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
  type ColoInfo,
} from 'colo.do/tiny'

// Collections (direct import from @dotdo/collections)
import {
  createCollection,
  Collections,
  type Collection,
  type Filter,
  type QueryOptions,
} from '@dotdo/collections'

// Shared RPC interface
import { SKIP_PROPS_EXTENDED } from './rpc-interface.js'

// Shared base class
import { DurableRPCBase } from './base.js'

// Internal method constants
import { INTERNAL_METHODS, INTERNAL_METHOD_NAMES, type InternalMethod } from './constants.js'

// Shared WebSocket state machine
import {
  type WebSocketState,
  type WebSocketAttachment,
  isWebSocketAttachment,
  createWebSocketAttachment,
  transitionWebSocketState,
  getWebSocketAttachment,
} from './websocket-state.js'

// Re-export WebSocket state types and utilities
export {
  type WebSocketState,
  type WebSocketAttachment,
  isWebSocketAttachment,
  createWebSocketAttachment,
  transitionWebSocketState,
  getWebSocketAttachment,
} from './websocket-state.js'

// Introspection utilities
import {
  introspectDatabase,
  introspectDurableRPC,
  type RpcSchema,
  type DatabaseSchema,
} from './introspection.js'

// Re-export introspection types and functions
export {
  introspectDatabase,
  introspectDurableRPC,
  collectRpcMethods,
  collectRpcNamespaces,
  type RpcSchema,
  type RpcMethodSchema,
  type RpcNamespaceSchema,
  type DatabaseSchema,
  type ColumnSchema,
  type TableSchema,
  type IndexSchema,
  type IntrospectableRpc,
  type IntrospectionConfig,
} from './introspection.js'

// Re-export capnweb types for convenience
export { RpcTarget, RpcSession, type RpcTransport, type RpcSessionOptions }
export { HibernatableWebSocketTransport, TransportRegistry }

// Re-export colo.do/tiny for convenience (minimal bundle)
export {
  getColo,
  getAllColos,
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
  type ColoInfo,
  type ColoRegion,
} from 'colo.do/tiny'

// ============================================================================
// Mixins - Composable functionality (re-export for advanced use)
// ============================================================================

// Re-export mixins for advanced composition
export * from './mixins/index.js'

// Import types from mixins for use in this file
import { WORKER_COLO_HEADER, type ColoContext } from './mixins/colo.js'
import { type SqlQueryResult, type SerializedSqlQuery } from './mixins/sql.js'

// Re-export types for backward compatibility
export type { SqlQueryResult, SerializedSqlQuery, ColoContext }

// ============================================================================
// $ Context (Legacy)
// ============================================================================

/**
 * Server-side context available inside DO RPC methods
 * @deprecated Use this.sql and this.storage directly instead
 */
export interface RpcContext {
  /** SQLite tagged template (DO SQLite storage) */
  sql: SqlStorage
  /** Durable Object storage API */
  storage: DurableObjectStorage
  /** Durable Object state */
  state: DurableObjectState
  /** Current request (if available) */
  request?: Request
  /** Auth context from middleware */
  auth?: { token?: string; user?: unknown; [key: string]: unknown }
  /** Colo (location) context */
  colo: ColoContext
}

// ============================================================================
// DurableRPC Class
// ============================================================================

/**
 * Base class for RPC-enabled Durable Objects
 *
 * DurableRPC extends Cloudflare's DurableObject with:
 * - Automatic WebSocket hibernation with capnweb RPC protocol
 * - HTTP batch RPC via capnweb for efficient request bundling
 * - Direct accessors: `this.sql`, `this.storage` (same API as inside DO and via RPC)
 * - Collections: MongoDB-style document store on SQLite
 * - Schema reflection for typed client generation
 * - Colo-aware helpers for global deployment
 *
 * DurableRPC handles all the RPC protocol details so you can focus on your
 * business logic. Simply define methods on your class and they become callable
 * via RPC automatically.
 *
 * @example Basic usage
 * ```typescript
 * import { DurableRPC } from '@dotdo/rpc'
 *
 * export class MyDO extends DurableRPC {
 *   // Define RPC methods directly on the class
 *   async getUser(id: string) {
 *     return this.sql`SELECT * FROM users WHERE id = ${id}`.first()
 *   }
 *
 *   async createUser(data: { name: string; email: string }) {
 *     this.sql`INSERT INTO users (name, email) VALUES (${data.name}, ${data.email})`.run()
 *     return { ok: true }
 *   }
 *
 *   // Nested namespaces via object properties
 *   users = {
 *     get: async (id: string) => this.sql`SELECT * FROM users WHERE id = ${id}`.first(),
 *     list: async () => this.sql`SELECT * FROM users`.all(),
 *   }
 * }
 * ```
 *
 * @example Using collections (MongoDB-style)
 * ```typescript
 * interface User {
 *   name: string
 *   email: string
 *   active: boolean
 * }
 *
 * export class MyDO extends DurableRPC {
 *   // Create a typed collection
 *   users = this.collection<User>('users')
 *
 *   async createUser(data: User) {
 *     const id = crypto.randomUUID()
 *     this.users.put(id, data)
 *     return { id }
 *   }
 *
 *   async getActiveUsers() {
 *     return this.users.find({ active: true })
 *   }
 * }
 * ```
 *
 * @example Accessing storage
 * ```typescript
 * export class MyDO extends DurableRPC {
 *   async getConfig() {
 *     return this.storage.get<Config>('config')
 *   }
 *
 *   async setConfig(config: Config) {
 *     await this.storage.put('config', config)
 *   }
 * }
 * ```
 *
 * @example Client-side usage
 * ```typescript
 * import { RPC } from 'rpc.do'
 *
 * const $ = RPC('https://my-do.workers.dev')
 *
 * // Call methods defined on MyDO
 * const user = await $.getUser('123')
 * await $.users.list()
 *
 * // Access SQL, storage, collections remotely (same API!)
 * const users = await $.sql`SELECT * FROM users`.all()
 * const config = await $.storage.get('config')
 * const admins = await $.collection('users').find({ role: 'admin' })
 * ```
 */
export class DurableRPC extends DurableRPCBase {
  /** Cached colo for this DO instance */
  private _colo: string | null = null

  /** Collections manager (lazy-initialized) */
  private _collections?: Collections

  private _currentAuth?: Record<string, unknown>

  // ==========================================================================
  // Abstract method implementations
  // ==========================================================================

  protected getSkipProps(): Set<string> {
    return SKIP_PROPS_EXTENDED
  }

  protected getBasePrototype(): object {
    return DurableRPC.prototype
  }

  // ==========================================================================
  // Collections (MongoDB-style document store on SQLite)
  // ==========================================================================

  /**
   * Get or create a named collection for MongoDB-style document operations
   *
   * Collections provide a document-oriented interface on top of SQLite:
   * - **CRUD**: `get(id)`, `put(id, doc)`, `delete(id)`, `has(id)`
   * - **Queries**: `find(filter, options)` with MongoDB-style operators
   * - **Aggregation**: `count(filter)`, `list(options)`, `keys()`
   * - **Bulk**: `clear()` to delete all documents
   *
   * @typeParam T - The document type (must extend `Record<string, unknown>`)
   * @param name - The collection name (used as SQLite table name)
   * @returns A Collection instance with typed document operations
   */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<T> {
    if (!this._collections) {
      this._collections = new Collections(this.sql)
    }
    return this._collections.collection<T>(name)
  }

  /**
   * Context accessor (legacy, prefer direct this.sql/this.storage)
   * @deprecated Use this.sql and this.storage directly
   */
  get $(): RpcContext {
    const workerColo = this._currentRequest?.headers.get(WORKER_COLO_HEADER) ?? undefined
    const colo = this._colo ?? 'UNKNOWN'
    const info = getColo(colo)
    const latencyMs = workerColo && this._colo ? estimateLatency(workerColo, this._colo) : undefined
    const distanceKm = workerColo && this._colo ? coloDistance(workerColo, this._colo) : undefined

    const coloContext: ColoContext = { colo }
    if (info) coloContext.info = info
    if (workerColo) coloContext.workerColo = workerColo
    if (latencyMs !== undefined) coloContext.latencyMs = latencyMs
    if (distanceKm !== undefined) coloContext.distanceKm = distanceKm

    const rpcContext: RpcContext = {
      sql: this.ctx.storage.sql,
      storage: this.ctx.storage,
      state: this.ctx,
      colo: coloContext,
    }
    if (this._currentRequest) rpcContext.request = this._currentRequest
    if (this._currentAuth) rpcContext.auth = this._currentAuth
    return rpcContext
  }

  // ==========================================================================
  // RPC-callable SQL methods (from SQL mixin logic)
  // ==========================================================================

  /**
   * Execute SQL query via RPC
   * Called by client-side $.sql`...` proxy
   * @internal
   */
  __sql(query: SerializedSqlQuery): SqlQueryResult {
    if (query.strings.length - 1 !== query.values.length) {
      throw new Error(
        `SQL parameter count mismatch: expected ${query.strings.length - 1} values but got ${query.values.length}. ` +
        `This usually indicates incorrect SQL template tag usage.`
      )
    }
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    const results = cursor.toArray()
    return {
      results,
      meta: {
        rows_read: cursor.rowsRead,
        rows_written: cursor.rowsWritten,
      },
    }
  }

  /**
   * Execute SQL and return first row
   * @internal
   */
  __sqlFirst<T = Record<string, unknown>>(query: SerializedSqlQuery): T | null {
    if (query.strings.length - 1 !== query.values.length) {
      throw new Error(
        `SQL parameter count mismatch: expected ${query.strings.length - 1} values but got ${query.values.length}. ` +
        `This usually indicates incorrect SQL template tag usage.`
      )
    }
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return cursor.one() as T | null
  }

  /**
   * Execute SQL for write operations (INSERT, UPDATE, DELETE)
   * @internal
   */
  __sqlRun(query: SerializedSqlQuery): { rowsWritten: number } {
    if (query.strings.length - 1 !== query.values.length) {
      throw new Error(
        `SQL parameter count mismatch: expected ${query.strings.length - 1} values but got ${query.values.length}. ` +
        `This usually indicates incorrect SQL template tag usage.`
      )
    }
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return { rowsWritten: cursor.rowsWritten }
  }

  // ==========================================================================
  // RPC-callable storage methods (from Storage mixin logic)
  // ==========================================================================

  /** @internal */ async __storageGet<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key)
  }

  /** @internal */ async __storageGetMultiple<T>(keys: string[]): Promise<Map<string, T>> {
    return this.storage.get<T>(keys)
  }

  /** @internal */ async __storagePut<T>(key: string, value: T): Promise<void> {
    return this.storage.put(key, value)
  }

  /** @internal */ async __storagePutMultiple<T>(entries: Record<string, T>): Promise<void> {
    return this.storage.put(entries)
  }

  /** @internal */ async __storageDelete(key: string): Promise<boolean> {
    return this.storage.delete(key)
  }

  /** @internal */ async __storageDeleteMultiple(keys: string[]): Promise<number> {
    return this.storage.delete(keys)
  }

  /** @internal */ async __storageList<T>(options?: DurableObjectListOptions): Promise<Map<string, T>> {
    return this.storage.list<T>(options)
  }

  // ==========================================================================
  // Schema & Discovery (from Schema mixin logic)
  // ==========================================================================

  /**
   * Get database schema (tables, columns, indexes)
   * @internal
   */
  __dbSchema(): DatabaseSchema {
    return introspectDatabase(this.sql)
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

  // ==========================================================================
  // RPC-callable collection methods (from Collections mixin logic)
  // ==========================================================================

  /** @internal */ __collectionGet<T extends Record<string, unknown>>(
    collection: string,
    id: string
  ): T | null {
    return this.collection<T>(collection).get(id)
  }

  /** @internal */ __collectionPut<T extends Record<string, unknown>>(
    collection: string,
    id: string,
    doc: T
  ): void {
    this.collection<T>(collection).put(id, doc)
  }

  /** @internal */ __collectionDelete(collection: string, id: string): boolean {
    return this.collection(collection).delete(id)
  }

  /** @internal */ __collectionHas(collection: string, id: string): boolean {
    return this.collection(collection).has(id)
  }

  /** @internal */ __collectionFind<T extends Record<string, unknown>>(
    collection: string,
    filter?: Filter<T>,
    options?: QueryOptions
  ): T[] {
    return this.collection<T>(collection).find(filter, options)
  }

  /** @internal */ __collectionCount<T extends Record<string, unknown>>(
    collection: string,
    filter?: Filter<T>
  ): number {
    return this.collection<T>(collection).count(filter)
  }

  /** @internal */ __collectionList<T extends Record<string, unknown>>(
    collection: string,
    options?: QueryOptions
  ): T[] {
    return this.collection<T>(collection).list(options)
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

  // ==========================================================================
  // Colo helpers (from Colo mixin logic)
  // ==========================================================================

  /**
   * Get the colo where this DO is running
   * Detected from first request, undefined before any requests
   */
  get colo(): string | undefined {
    return this._colo ?? undefined
  }

  /**
   * Get full colo information for this DO's location
   */
  get coloInfo(): ColoInfo | undefined {
    return this._colo ? getColo(this._colo) : undefined
  }

  /**
   * Get sorted list of colos by distance from this DO
   *
   * @param colos - Optional list of colos to sort (defaults to all DO-capable colos)
   * @returns Sorted array of { colo, distance, latency } objects
   */
  getColosByDistance(colos?: string[]): Array<{ colo: string; distance: number; latency: number }> {
    if (!this._colo) return []
    return sortByDistance(this._colo, colos)
  }

  /**
   * Find the nearest colo from a list of candidates
   *
   * @param candidates - List of candidate colo IATA codes
   * @returns Nearest colo, or first candidate if this DO's colo is unknown
   */
  findNearestColo(candidates: string[]): string | undefined {
    if (!this._colo) return candidates[0]
    return nearestColo(this._colo, candidates)
  }

  /**
   * Estimate latency to another colo from this DO's location
   *
   * @param targetColo - Target colo IATA code
   * @returns Estimated round-trip latency in milliseconds
   */
  estimateLatencyTo(targetColo: string): number | undefined {
    if (!this._colo) return undefined
    return estimateLatency(this._colo, targetColo)
  }

  /**
   * Get distance to another colo from this DO's location
   *
   * @param targetColo - Target colo IATA code
   * @returns Distance in kilometers
   */
  distanceTo(targetColo: string): number | undefined {
    if (!this._colo) return undefined
    return coloDistance(this._colo, targetColo)
  }

  // ==========================================================================
  // Fetch pre-processing (colo detection)
  // ==========================================================================

  /**
   * Detect colo from cf object on first request.
   */
  protected override onFetch(request: Request): void {
    if (!this._colo) {
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      this._colo = cf?.colo ?? null
    }
  }

  // ==========================================================================
  // Schema Reflection
  // ==========================================================================

  /**
   * Introspect this DO's API and return a complete schema description
   *
   * Returns a schema containing:
   * - All public RPC methods with parameter counts
   * - Nested namespaces and their methods
   * - Database schema (tables, columns, indexes)
   * - Storage key samples (optional)
   * - Current colo (datacenter location)
   *
   * This is used by:
   * - `npx rpc.do generate` for typed client codegen
   * - GET requests to `/__schema` endpoint
   * - API documentation and tooling
   *
   * @returns Complete RPC schema for this Durable Object
   */
  getSchema(): RpcSchema {
    return introspectDurableRPC(this, {
      skipProps: SKIP_PROPS_EXTENDED,
      basePrototype: DurableRPC.prototype,
    })
  }
}

// ============================================================================
// Worker Router (Worker -> DO routing)
// ============================================================================

/**
 * Options for the RPC worker router
 */
export interface RouterOptions<Env> {
  /** Map of namespace to DO binding name */
  bindings?: Record<string, keyof Env>
  /** Auth middleware */
  auth?: (request: Request, env: Env) => Promise<{ authorized: boolean; id?: string; context?: unknown }>
  /** Custom ID resolver (default: uses X-DO-Id header or URL path) */
  resolveId?: (request: Request, namespace: string) => string | DurableObjectId
}

/**
 * Create a Worker that routes RPC requests to Durable Objects
 *
 * @example
 * ```typescript
 * import { router } from '@dotdo/rpc'
 *
 * export default router<Env>({
 *   bindings: {
 *     users: 'USER_DO',
 *     rooms: 'ROOM_DO',
 *   }
 * })
 * ```
 */
export function router<Env extends Record<string, unknown>>(options: RouterOptions<Env> = {}) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      // Auth check
      if (options.auth) {
        const result = await options.auth(request, env)
        if (!result.authorized) {
          return new Response('Unauthorized', { status: 401 })
        }
      }

      // Parse the URL to determine DO namespace and ID
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)

      const namespace = parts[0]
      if (!namespace) {
        return new Response('Missing namespace', { status: 400 })
      }

      const id = parts[1] ?? request.headers.get('X-DO-Id') ?? 'default'

      // Resolve the DO binding
      const bindingName = options.bindings?.[namespace] || namespace
      const binding = env[bindingName as string] as DurableObjectNamespace | undefined

      if (!binding) {
        return Response.json({ error: `Unknown namespace: ${namespace}` }, { status: 404 })
      }

      // Get or create the DO instance
      let doId: DurableObjectId
      if (options.resolveId) {
        const resolved = options.resolveId(request, namespace)
        doId = typeof resolved === 'string' ? binding.idFromName(resolved) : resolved
      } else {
        doId = binding.idFromName(id)
      }

      const stub = binding.get(doId)

      // Forward the request (strip the namespace/id prefix)
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = '/' + parts.slice(2).join('/')

      // Pass worker colo to DO for location awareness
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      const headers = new Headers(request.headers)
      if (cf?.colo) {
        headers.set(WORKER_COLO_HEADER, cf.colo)
      }

      const forwardRequest = new Request(forwardUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
      })
      return stub.fetch(forwardRequest)
    },
  }
}


// ============================================================================
// Config Convention (do.config.ts)
// ============================================================================

/**
 * Configuration for `npx rpc.do generate`
 */
export interface RpcDoConfig {
  /** Path(s) to DO source files or glob patterns */
  durableObjects: string | string[]
  /** Output directory for generated types (default: ./generated) */
  output?: string
  /** Base URL for runtime schema fetching (optional) */
  schemaUrl?: string
}

/**
 * Define configuration for rpc.do codegen.
 *
 * @example
 * ```typescript
 * // do.config.ts
 * import { defineConfig } from '@dotdo/rpc'
 *
 * export default defineConfig({
 *   durableObjects: './src/do/*.ts',
 *   output: './generated/rpc',
 * })
 * ```
 */
export function defineConfig(config: RpcDoConfig): RpcDoConfig {
  return config
}

// ============================================================================
// Collections Exports
// ============================================================================

export {
  createCollection,
  Collections,
  type Collection,
  type Filter,
  type FilterOperator,
  type QueryOptions,
} from './collections.js'

// ============================================================================
// Internal Method Constants
// ============================================================================

export {
  INTERNAL_METHODS,
  INTERNAL_METHOD_NAMES,
  type InternalMethod,
} from './constants.js'

// ============================================================================
// Server-side Middleware
// ============================================================================

export {
  type ServerMiddleware,
  type MiddlewareContext,
  serverLoggingMiddleware,
  serverTimingMiddleware,
  type ServerLoggingOptions,
  type ServerTimingOptions,
} from './middleware.js'
