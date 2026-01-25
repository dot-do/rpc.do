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

import {
  RpcSession,
  RpcTarget,
  newHttpBatchRpcResponse,
  type RpcTransport,
  type RpcSessionOptions,
} from 'capnweb'

import {
  HibernatableWebSocketTransport,
  TransportRegistry,
} from './transports/hibernatable-ws.js'

// Colo awareness (using tiny entry point for minimal bundle)
import {
  getColo,
  coloDistance,
  estimateLatency,
  nearestColo,
  sortByDistance,
  type ColoInfo,
} from 'colo.do/tiny'

// Collections
import {
  createCollection,
  Collections,
  type Collection,
  type Filter,
  type QueryOptions,
} from './collections.js'

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
// Cloudflare DO Base (declared for type safety without runtime import)
// The actual DurableObject class is provided by the Workers runtime
// ============================================================================

declare class DurableObject {
  protected ctx: DurableObjectState
  protected env: any
  constructor(ctx: DurableObjectState, env: any)
  fetch?(request: Request): Response | Promise<Response>
  alarm?(): void | Promise<void>
  webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>
  webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>
  webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>
}

// ============================================================================
// $ Context
// ============================================================================

/**
 * Colo (colocation) context for location-aware DOs
 */
export interface ColoContext {
  /** The colo where this DO instance is running */
  colo: string
  /** Full colo information (city, country, coordinates, etc.) */
  info?: ColoInfo
  /** The colo of the worker that made this request (if known) */
  workerColo?: string
  /** Estimated latency from worker to DO in milliseconds */
  latencyMs?: number
  /** Distance from worker to DO in kilometers */
  distanceKm?: number
}

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
  auth?: { token?: string; user?: any; [key: string]: any }
  /** Colo (location) context */
  colo: ColoContext
}

/**
 * SQL query result from remote execution
 */
export interface SqlQueryResult<T = Record<string, unknown>> {
  results: T[]
  meta: {
    rows_read: number
    rows_written: number
  }
}

/**
 * Serialized SQL query for RPC transport
 */
export interface SerializedSqlQuery {
  strings: string[]
  values: unknown[]
}

// ============================================================================
// RPC Interface Wrapper
// ============================================================================

/**
 * Wraps the DurableRPC instance as an RpcTarget for capnweb
 *
 * This is necessary because:
 * 1. DurableRPC extends DurableObject, not RpcTarget
 * 2. We need to control which methods are exposed over RPC
 * 3. We want to preserve the $ context access pattern
 */
class RpcInterface extends RpcTarget {
  constructor(private durableRpc: DurableRPC) {
    super()

    // Dynamically expose all public methods and namespaces from the DurableRPC instance
    // Only prototype properties are exposed by RpcTarget, so we define getters
    this.exposeInterface()
  }

  private exposeInterface(): void {
    const instance = this.durableRpc
    const seen = new Set<string>()

    // Collect properties from instance and prototype chain
    const collectProps = (obj: any) => {
      if (!obj || obj === Object.prototype) return
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (!seen.has(key) && !SKIP_PROPS.has(key) && !key.startsWith('_')) {
          seen.add(key)

          let value: any
          try {
            value = (instance as any)[key]
          } catch {
            continue
          }

          if (typeof value === 'function') {
            // Bind method to the DurableRPC instance
            Object.defineProperty(this, key, {
              value: value.bind(instance),
              enumerable: true,
              configurable: true,
            })
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Check if it's a namespace (object with function properties)
            const hasMethodKeys = Object.keys(value).some(k => typeof value[k] === 'function')
            if (hasMethodKeys) {
              // Create a namespace object with bound methods
              const namespace: Record<string, Function> = {}
              for (const nsKey of Object.keys(value)) {
                if (typeof value[nsKey] === 'function') {
                  namespace[nsKey] = value[nsKey].bind(value)
                }
              }
              Object.defineProperty(this, key, {
                value: namespace,
                enumerable: true,
                configurable: true,
              })
            }
          }
        }
      }
    }

    // Walk instance own props first, then prototype chain
    collectProps(instance)
    let proto = Object.getPrototypeOf(instance)
    while (proto && proto !== DurableRPC.prototype && proto !== DurableObject.prototype) {
      collectProps(proto)
      proto = Object.getPrototypeOf(proto)
    }
  }

  /**
   * Schema reflection method - always available
   */
  __schema(): RpcSchema {
    return this.durableRpc.getSchema()
  }
}

// ============================================================================
// DurableRPC Base Class
// ============================================================================

/**
 * Base class for RPC-enabled Durable Objects
 *
 * Extends DurableObject with:
 * - Automatic WebSocket hibernation with capnweb RPC
 * - HTTP batch RPC via capnweb
 * - $ context for storage/sql access
 * - Schema reflection
 */
/** Header used to pass worker colo to DO */
const WORKER_COLO_HEADER = 'X-Worker-Colo'

export class DurableRPC extends DurableObject {
  /** Transport registry for managing WebSocket transports */
  private _transportRegistry = new TransportRegistry()

  /** Map of WebSocket -> RpcSession for active sessions */
  private _sessions = new Map<WebSocket, RpcSession>()

  /** RPC interface wrapper for capnweb */
  private _rpcInterface?: RpcInterface

  /** Cached colo for this DO instance */
  private _colo: string | null = null

  /** Collections manager (lazy-initialized) */
  private _collections?: Collections

  // ==========================================================================
  // Direct accessors (same API inside DO and via RPC)
  // ==========================================================================

  /**
   * SQLite tagged template - use directly as this.sql`query`
   *
   * @example
   * ```typescript
   * // Inside DO
   * const users = this.sql`SELECT * FROM users`.all()
   *
   * // Via RPC (same syntax)
   * const users = await $.sql`SELECT * FROM users`.all()
   * ```
   */
  get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  /**
   * Durable Object storage API
   *
   * @example
   * ```typescript
   * // Inside DO
   * const value = await this.storage.get('key')
   *
   * // Via RPC (same syntax)
   * const value = await $.storage.get('key')
   * ```
   */
  get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  /**
   * Durable Object state (for advanced use)
   */
  get state(): DurableObjectState {
    return this.ctx
  }

  // ==========================================================================
  // Collections (MongoDB-style document store on SQLite)
  // ==========================================================================

  /**
   * Get or create a named collection
   *
   * Collections provide MongoDB-style document operations on SQLite:
   * - get/put/delete by ID
   * - find with filters ($eq, $gt, $in, etc.)
   * - count, list, keys, clear
   *
   * @example
   * ```typescript
   * // Inside DO
   * interface User { name: string; email: string; active: boolean }
   *
   * export class MyDO extends DurableRPC {
   *   users = this.collection<User>('users')
   *
   *   async createUser(data: User) {
   *     this.users.put(data.email, data)
   *   }
   *
   *   async getActiveUsers() {
   *     return this.users.find({ active: true })
   *   }
   * }
   *
   * // Via RPC (same API)
   * const users = await $.collection('users').find({ active: true })
   * ```
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

    return {
      sql: this.ctx.storage.sql,
      storage: this.ctx.storage,
      state: this.ctx,
      request: this._currentRequest,
      auth: this._currentAuth,
      colo: {
        colo,
        info: getColo(colo),
        workerColo,
        latencyMs: workerColo && this._colo ? estimateLatency(workerColo, this._colo) : undefined,
        distanceKm: workerColo && this._colo ? coloDistance(workerColo, this._colo) : undefined,
      },
    }
  }

  // ==========================================================================
  // RPC-callable SQL methods (used by client-side $ proxy)
  // ==========================================================================

  /**
   * Execute SQL query via RPC
   * Called by client-side $.sql`...` proxy
   * @internal
   */
  __sql(query: SerializedSqlQuery): SqlQueryResult {
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
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return cursor.one() as T | null
  }

  /**
   * Execute SQL for write operations (INSERT, UPDATE, DELETE)
   * @internal
   */
  __sqlRun(query: SerializedSqlQuery): { rowsWritten: number } {
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return { rowsWritten: cursor.rowsWritten }
  }

  // ==========================================================================
  // RPC-callable storage methods
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
  // Schema & Discovery
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
  // RPC-callable collection methods
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

  private _currentRequest?: Request
  private _currentAuth?: Record<string, any>

  /**
   * Get or create the RPC interface wrapper
   */
  private getRpcInterface(): RpcInterface {
    if (!this._rpcInterface) {
      this._rpcInterface = new RpcInterface(this)
    }
    return this._rpcInterface
  }

  /**
   * RPC session options (can be overridden in subclasses)
   */
  protected getRpcSessionOptions(): RpcSessionOptions {
    return {
      onSendError: (error: Error) => {
        // Log errors but don't expose stack traces by default
        console.error('[DurableRPC] Error:', error.message)
        return new Error(error.message) // Return error without stack
      },
    }
  }

  /**
   * Handle incoming fetch requests (HTTP + WebSocket upgrade)
   */
  async fetch(request: Request): Promise<Response> {
    this._currentRequest = request

    // Detect colo from cf object (first request sets it)
    if (!this._colo) {
      const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
      this._colo = cf?.colo ?? null
    }

    // GET /__schema -> return API schema (like GraphQL introspection)
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.pathname === '/__schema' || url.pathname === '/') {
        return Response.json(this.getSchema())
      }
    }

    // WebSocket upgrade -> hibernation-aware handler with capnweb
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // HTTP RPC via capnweb batch
    return this.handleHttpRpc(request)
  }

  // ==========================================================================
  // WebSocket Hibernation with capnweb
  // ==========================================================================

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Use hibernation API
    this.ctx.acceptWebSocket(server)

    // Create transport for this WebSocket
    const transport = new HibernatableWebSocketTransport(server)
    this._transportRegistry.register(transport)

    // Create capnweb RpcSession with the transport
    const session = new RpcSession(
      transport,
      this.getRpcInterface(),
      this.getRpcSessionOptions()
    )

    // Store session reference
    this._sessions.set(server, session)

    // Store transport ID in WebSocket attachment for hibernation recovery
    server.serializeAttachment({ transportId: transport.id })

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Called when a hibernated WebSocket receives a message
   * (Part of the Hibernation API)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      // Binary messages not supported by capnweb text protocol
      return
    }

    // Get transport from attachment (survives hibernation)
    let transport: HibernatableWebSocketTransport | undefined

    try {
      const attachment = ws.deserializeAttachment() as { transportId?: string } | null
      if (attachment?.transportId) {
        transport = this._transportRegistry.get(attachment.transportId)
      }
    } catch {
      // Attachment parsing failed
    }

    // If transport not found, we need to recreate it (DO woke from hibernation)
    if (!transport) {
      transport = new HibernatableWebSocketTransport(ws)
      this._transportRegistry.register(transport)

      // Recreate session
      const session = new RpcSession(
        transport,
        this.getRpcInterface(),
        this.getRpcSessionOptions()
      )
      this._sessions.set(ws, session)

      // Update attachment with new transport ID
      ws.serializeAttachment({ transportId: transport.id })
    }

    // Feed message to transport -> capnweb session will process it
    transport.enqueueMessage(message)
  }

  /**
   * Called when a hibernated WebSocket is closed
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Get transport and clean up
    try {
      const attachment = ws.deserializeAttachment() as { transportId?: string } | null
      if (attachment?.transportId) {
        const transport = this._transportRegistry.get(attachment.transportId)
        if (transport) {
          transport.handleClose(code, reason)
          this._transportRegistry.remove(attachment.transportId)
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    // Remove session
    this._sessions.delete(ws)
  }

  /**
   * Called when a hibernated WebSocket encounters an error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error))

    try {
      const attachment = ws.deserializeAttachment() as { transportId?: string } | null
      if (attachment?.transportId) {
        const transport = this._transportRegistry.get(attachment.transportId)
        if (transport) {
          transport.handleError(err)
          this._transportRegistry.remove(attachment.transportId)
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    // Remove session
    this._sessions.delete(ws)
  }

  // ==========================================================================
  // HTTP RPC via capnweb batch
  // ==========================================================================

  private async handleHttpRpc(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Use capnweb's HTTP batch handler
    try {
      const response = await newHttpBatchRpcResponse(
        request,
        this.getRpcInterface(),
        this.getRpcSessionOptions()
      )
      return response
    } catch (error: any) {
      return Response.json(
        { error: error.message || 'RPC error' },
        { status: 500 }
      )
    }
  }

  // ==========================================================================
  // Schema Reflection
  // ==========================================================================

  /**
   * Introspect this DO's API and return a schema description.
   * Used by `npx rpc.do generate` for typed client codegen.
   */
  getSchema(): RpcSchema {
    return introspect(this)
  }

  // ==========================================================================
  // Broadcast
  // ==========================================================================

  /**
   * Broadcast a message to all connected WebSocket clients
   *
   * Note: This sends raw messages, not capnweb RPC calls.
   * For RPC notifications, use the client's stub methods.
   */
  broadcast(message: any, exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets()
    const data = typeof message === 'string' ? message : JSON.stringify(message)

    for (const ws of sockets) {
      if (ws !== exclude) {
        try {
          ws.send(data)
        } catch {
          /* ignore closed sockets */
        }
      }
    }
  }

  /**
   * Get count of connected WebSocket clients
   */
  get connectionCount(): number {
    return this.ctx.getWebSockets().length
  }

  // ==========================================================================
  // Colo-aware helpers
  // ==========================================================================

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
  auth?: (request: Request, env: Env) => Promise<{ authorized: boolean; id?: string; context?: any }>
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
export function router<Env extends Record<string, any>>(options: RouterOptions<Env> = {}) {
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

      if (parts.length < 1) {
        return new Response('Missing namespace', { status: 400 })
      }

      const namespace = parts[0]
      const id = parts[1] || request.headers.get('X-DO-Id') || 'default'

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
// Schema Reflection
// ============================================================================

/**
 * Describes a single RPC method
 */
export interface RpcMethodSchema {
  /** Method name */
  name: string
  /** Dot-separated path (e.g. "users.get") */
  path: string
  /** Number of declared parameters (from Function.length) */
  params: number
}

/**
 * Describes a namespace (object with methods)
 */
export interface RpcNamespaceSchema {
  /** Namespace name */
  name: string
  /** Methods within this namespace */
  methods: RpcMethodSchema[]
}

/**
 * Database column schema
 */
export interface ColumnSchema {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
}

/**
 * Database table schema
 */
export interface TableSchema {
  name: string
  columns: ColumnSchema[]
  indexes: IndexSchema[]
}

/**
 * Database index schema
 */
export interface IndexSchema {
  name: string
  columns: string[]
  unique: boolean
}

/**
 * Full database schema (SQLite)
 */
export interface DatabaseSchema {
  tables: TableSchema[]
  version?: number
}

/**
 * Full schema for a DurableRPC class.
 * Returned by GET /__schema and used by `npx rpc.do generate`.
 */
export interface RpcSchema {
  /** Schema version */
  version: 1
  /** Top-level RPC methods */
  methods: RpcMethodSchema[]
  /** Grouped namespaces (e.g. { users: { get, create } }) */
  namespaces: RpcNamespaceSchema[]
  /** Database schema (if SQLite is used) */
  database?: DatabaseSchema
  /** Storage keys (sample for discovery) */
  storageKeys?: string[]
  /** Colo where this DO is running */
  colo?: string
}

/** Properties to skip during introspection */
const SKIP_PROPS = new Set([
  // DurableObject lifecycle
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  // DurableRPC internals
  'constructor',
  'getSchema',
  'broadcast',
  'connectionCount',
  '$',
  'sql',
  'storage',
  'state',
  '_currentRequest',
  '_currentAuth',
  '_transportRegistry',
  '_sessions',
  '_rpcInterface',
  '_colo',
  'handleWebSocketUpgrade',
  'handleHttpRpc',
  'getRpcInterface',
  'getRpcSessionOptions',
  // Colo helpers (internal use)
  'colo',
  'coloInfo',
  'getColosByDistance',
  'findNearestColo',
  'estimateLatencyTo',
  'distanceTo',
  // RPC internal methods (exposed but not in schema)
  '__sql',
  '__sqlFirst',
  '__sqlRun',
  '__storageGet',
  '__storageGetMultiple',
  '__storagePut',
  '__storagePutMultiple',
  '__storageDelete',
  '__storageDeleteMultiple',
  '__storageList',
  '__dbSchema',
  '__storageKeys',
  // Collection methods
  '__collectionGet',
  '__collectionPut',
  '__collectionDelete',
  '__collectionHas',
  '__collectionFind',
  '__collectionCount',
  '__collectionList',
  '__collectionKeys',
  '__collectionClear',
  '__collectionNames',
  '__collectionStats',
  'collection',
  '_collections',
])

/**
 * Introspect SQLite database schema
 */
function introspectDatabase(sql: SqlStorage): DatabaseSchema {
  const tables: TableSchema[] = []

  try {
    // Get all tables
    const tableRows = sql.exec<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
    ).toArray()

    for (const { name: tableName } of tableRows) {
      // Get columns
      const columns: ColumnSchema[] = []
      const columnRows = sql.exec<{
        name: string
        type: string
        notnull: number
        pk: number
        dflt_value: string | null
      }>(`PRAGMA table_info('${tableName}')`).toArray()

      for (const col of columnRows) {
        columns.push({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          primaryKey: col.pk > 0,
          defaultValue: col.dflt_value ?? undefined,
        })
      }

      // Get indexes
      const indexes: IndexSchema[] = []
      const indexRows = sql.exec<{ name: string; unique: number }>(
        `PRAGMA index_list('${tableName}')`
      ).toArray()

      for (const idx of indexRows) {
        if (idx.name.startsWith('sqlite_')) continue

        const indexCols = sql.exec<{ name: string }>(
          `PRAGMA index_info('${idx.name}')`
        ).toArray()

        indexes.push({
          name: idx.name,
          columns: indexCols.map(c => c.name),
          unique: idx.unique === 1,
        })
      }

      tables.push({ name: tableName, columns, indexes })
    }
  } catch {
    // SQLite may not be initialized yet
  }

  return { tables }
}

/**
 * Introspect a DurableRPC instance and return its API schema.
 * Walks own + prototype properties, skipping internals.
 */
function introspect(instance: DurableRPC): RpcSchema {
  const methods: RpcMethodSchema[] = []
  const namespaces: RpcNamespaceSchema[] = []

  const seen = new Set<string>()

  // Collect properties from instance and prototype chain (up to DurableRPC)
  const collectProps = (obj: any) => {
    if (!obj || obj === Object.prototype) return
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (!seen.has(key) && !SKIP_PROPS.has(key) && !key.startsWith('_')) {
        seen.add(key)

        let value: any
        try {
          value = (instance as any)[key]
        } catch {
          continue
        }

        if (typeof value === 'function') {
          methods.push({ name: key, path: key, params: value.length })
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Check if it's a namespace (object with function properties)
          const nsMethods: RpcMethodSchema[] = []
          for (const nsKey of Object.keys(value)) {
            if (typeof value[nsKey] === 'function') {
              nsMethods.push({
                name: nsKey,
                path: `${key}.${nsKey}`,
                params: value[nsKey].length,
              })
            }
          }
          if (nsMethods.length > 0) {
            namespaces.push({ name: key, methods: nsMethods })
          }
        }
      }
    }
  }

  // Walk instance own props first, then prototype chain
  collectProps(instance)
  let proto = Object.getPrototypeOf(instance)
  while (proto && proto !== DurableRPC.prototype && proto !== DurableObject.prototype) {
    collectProps(proto)
    proto = Object.getPrototypeOf(proto)
  }

  // Add database schema
  let database: DatabaseSchema | undefined
  try {
    database = introspectDatabase(instance.sql)
    if (database.tables.length === 0) {
      database = undefined
    }
  } catch {
    // SQL not available
  }

  return {
    version: 1,
    methods,
    namespaces,
    database,
    colo: instance.colo,
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
