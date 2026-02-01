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
  newHttpBatchRpcResponse,
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
import { RpcInterface, SKIP_PROPS_EXTENDED } from './rpc-interface.js'

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

// ============================================================================
// WebSocket State Machine
// ============================================================================

/**
 * Explicit state tracking for WebSocket hibernation.
 *
 * State transitions:
 * ```
 *   [connecting] ──accept──> [active] ──hibernate──> [hibernated]
 *        │                      │                         │
 *        │                      │                         │
 *        │                      ▼                         │
 *        │                   [closed] <─────close─────────┤
 *        │                      ▲                         │
 *        └───────error──────────┴────────error────────────┘
 * ```
 *
 * - connecting: WebSocket pair created, waiting for acceptance
 * - active: WebSocket accepted and actively processing messages
 * - hibernated: DO hibernated, WebSocket maintained by runtime (will wake on message)
 * - closed: WebSocket closed (terminal state)
 */
export type WebSocketState = 'connecting' | 'active' | 'hibernated' | 'closed'

/**
 * WebSocket attachment data that survives hibernation.
 * Stored via ws.serializeAttachment() and retrieved via ws.deserializeAttachment()
 */
export interface WebSocketAttachment {
  /** Transport ID for capnweb session recovery */
  transportId: string
  /** Current WebSocket state */
  state: WebSocketState
  /** Timestamp when connection was established */
  connectedAt: number
  /** Timestamp of last state transition */
  lastTransition: number
}

/**
 * Type guard to check if a value is a valid WebSocketAttachment.
 * Used for validating deserialized WebSocket attachments that survive hibernation.
 *
 * @param value - The value to check (typically from ws.deserializeAttachment())
 * @returns True if the value is a valid WebSocketAttachment
 */
export function isWebSocketAttachment(value: unknown): value is WebSocketAttachment {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as WebSocketAttachment).transportId === 'string' &&
    typeof (value as WebSocketAttachment).state === 'string' &&
    typeof (value as WebSocketAttachment).connectedAt === 'number' &&
    typeof (value as WebSocketAttachment).lastTransition === 'number'
  )
}

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
  protected env: Record<string, unknown>
  constructor(ctx: DurableObjectState, env: Record<string, unknown>)
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
  auth?: { token?: string; user?: unknown; [key: string]: unknown }
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
  private _rpcInterface?: RpcInterface<DurableRPC>

  /** Cached colo for this DO instance */
  private _colo: string | null = null

  /** Collections manager (lazy-initialized) */
  private _collections?: Collections

  // ==========================================================================
  // WebSocket State Machine Helpers
  // ==========================================================================

  /**
   * Create initial WebSocket attachment with 'connecting' state.
   *
   * STATE: -> connecting
   */
  private createWebSocketAttachment(transportId: string): WebSocketAttachment {
    const now = Date.now()
    return {
      transportId,
      state: 'connecting',
      connectedAt: now,
      lastTransition: now,
    }
  }

  /**
   * Transition WebSocket to a new state.
   * Updates the attachment and logs the transition for debugging.
   *
   * Valid state transitions:
   * - connecting -> active (WebSocket accepted)
   * - connecting -> closed (error during setup)
   * - active -> hibernated (DO hibernating, implicit)
   * - active -> closed (normal close or error)
   * - hibernated -> active (DO woke from hibernation)
   * - hibernated -> closed (close while hibernated)
   *
   * @param ws - The WebSocket to update
   * @param attachment - Current attachment data
   * @param newState - Target state
   * @param reason - Optional reason for the transition (for debugging)
   */
  private transitionWebSocketState(
    ws: WebSocket,
    attachment: WebSocketAttachment,
    newState: WebSocketState,
    reason?: string
  ): void {
    const oldState = attachment.state
    attachment.state = newState
    attachment.lastTransition = Date.now()

    // Persist the updated state (survives hibernation)
    ws.serializeAttachment(attachment)

    // Debug logging for state transitions
    console.debug(
      `[DurableRPC] WebSocket state: ${oldState} -> ${newState}` +
        (reason ? ` (${reason})` : '')
    )
  }

  /**
   * Get WebSocket attachment with type safety.
   * Returns null if attachment is missing or invalid.
   */
  private getWebSocketAttachment(ws: WebSocket): WebSocketAttachment | null {
    try {
      const attachment = ws.deserializeAttachment()
      if (isWebSocketAttachment(attachment)) {
        return attachment
      }
    } catch (error) {
      console.debug('[DurableRPC] Failed to deserialize WebSocket attachment:', error)
    }
    return null
  }

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
  // RPC-callable SQL methods (used by client-side $ proxy)
  // ==========================================================================

  /**
   * Execute SQL query via RPC
   * Called by client-side $.sql`...` proxy
   * @internal
   */
  __sql(query: SerializedSqlQuery): SqlQueryResult {
    // Validate parameter count: template strings should have one more element than values
    // e.g., sql`SELECT * FROM users WHERE id = ${id}` has strings=["SELECT * FROM users WHERE id = ", ""], values=[id]
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
    // Validate parameter count: template strings should have one more element than values
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
    // Validate parameter count: template strings should have one more element than values
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
  private _currentAuth?: Record<string, unknown>

  /**
   * Get or create the RPC interface wrapper
   */
  private getRpcInterface(): RpcInterface<DurableRPC> {
    if (!this._rpcInterface) {
      this._rpcInterface = new RpcInterface({
        instance: this,
        skipProps: SKIP_PROPS_EXTENDED,
        basePrototype: DurableRPC.prototype,
      })
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
  override async fetch(request: Request): Promise<Response> {
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

  /**
   * Handle WebSocket upgrade request.
   *
   * State transitions: -> connecting -> active
   *
   * This creates the WebSocket pair, accepts the server socket with the
   * hibernation API, and sets up the RPC session. The WebSocket starts
   * in 'connecting' state and immediately transitions to 'active'.
   */
  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Create transport for this WebSocket
    const transport = new HibernatableWebSocketTransport(server)
    this._transportRegistry.register(transport)

    // STATE: -> connecting
    // Create attachment with initial 'connecting' state
    const attachment = this.createWebSocketAttachment(transport.id)
    server.serializeAttachment(attachment)

    // Use hibernation API to accept the WebSocket
    // This allows the DO to hibernate while keeping the connection open
    this.ctx.acceptWebSocket(server)

    // STATE: connecting -> active
    // WebSocket is now accepted and ready to process messages
    this.transitionWebSocketState(server, attachment, 'active', 'WebSocket accepted')

    // Create capnweb RpcSession with the transport
    const session = new RpcSession(
      transport,
      this.getRpcInterface(),
      this.getRpcSessionOptions()
    )

    // Store session reference (in-memory, will be recreated after hibernation)
    this._sessions.set(server, session)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Called when a WebSocket receives a message.
   * (Part of the Hibernation API - also called for non-hibernated sockets)
   *
   * State transitions:
   * - hibernated -> active (DO woke from hibernation to process message)
   * - active -> active (no change, already processing)
   *
   * When the DO hibernates, in-memory state (transport registry, sessions) is lost.
   * The WebSocket attachment survives and contains the previous state.
   * On wake, we detect 'hibernated' state and recreate the necessary objects.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      // Binary messages not supported by capnweb text protocol
      return
    }

    // Get attachment from WebSocket (survives hibernation)
    let attachment = this.getWebSocketAttachment(ws)
    let transport: HibernatableWebSocketTransport | undefined

    if (attachment?.transportId) {
      transport = this._transportRegistry.get(attachment.transportId)
    }

    // If transport not found, the DO woke from hibernation
    // In-memory transport registry was cleared, need to recreate
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

      if (attachment) {
        // STATE: hibernated -> active
        // DO woke from hibernation, restore session and mark as active
        attachment.transportId = transport.id
        this.transitionWebSocketState(ws, attachment, 'active', 'woke from hibernation')
      } else {
        // No existing attachment - create new one (unusual case, possibly error recovery)
        attachment = this.createWebSocketAttachment(transport.id)
        attachment.state = 'active'
        ws.serializeAttachment(attachment)
        console.debug('[DurableRPC] WebSocket state: (unknown) -> active (created new attachment)')
      }
    }
    // If transport exists and state is active, no state change needed

    // Feed message to transport -> capnweb session will process it
    transport.enqueueMessage(message)
  }

  /**
   * Called when a WebSocket is closed.
   * (Part of the Hibernation API)
   *
   * State transition: active|hibernated -> closed
   *
   * The 'closed' state is terminal. We clean up all associated resources:
   * - Remove transport from registry
   * - Remove session from sessions map
   * - Mark state as closed in attachment (for debugging)
   */
  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const attachment = this.getWebSocketAttachment(ws)

    // STATE: * -> closed
    // Terminal state - clean up all resources
    if (attachment) {
      const closeReason = `code=${code}, reason=${reason || 'none'}, wasClean=${wasClean}`
      this.transitionWebSocketState(ws, attachment, 'closed', closeReason)

      // Clean up transport
      const transport = this._transportRegistry.get(attachment.transportId)
      if (transport) {
        transport.handleClose(code, reason)
        this._transportRegistry.remove(attachment.transportId)
      }
    } else {
      console.debug(`[DurableRPC] WebSocket closed without attachment (code=${code})`)
    }

    // Remove session from in-memory map
    this._sessions.delete(ws)
  }

  /**
   * Called when a WebSocket encounters an error.
   * (Part of the Hibernation API)
   *
   * State transition: active|hibernated|connecting -> closed
   *
   * Errors can occur at any point in the WebSocket lifecycle.
   * We transition to 'closed' state and clean up all resources.
   * The error is passed to the transport for proper RPC error handling.
   */
  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error))
    const attachment = this.getWebSocketAttachment(ws)

    // STATE: * -> closed (via error)
    // Error is a terminal condition, transition to closed
    if (attachment) {
      this.transitionWebSocketState(ws, attachment, 'closed', `error: ${err.message}`)

      // Clean up transport with error notification
      const transport = this._transportRegistry.get(attachment.transportId)
      if (transport) {
        transport.handleError(err)
        this._transportRegistry.remove(attachment.transportId)
      }
    } else {
      console.debug('[DurableRPC] WebSocket error without attachment:', err.message)
    }

    // Remove session from in-memory map
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'RPC error'
      return Response.json(
        { error: message },
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
    return introspectDurableRPC(this, {
      skipProps: SKIP_PROPS_EXTENDED,
      basePrototype: DurableRPC.prototype,
    })
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
  broadcast(message: unknown, exclude?: WebSocket): void {
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
