/**
 * @dotdo/rpc Base Class
 *
 * Shared implementation for DurableRPC (full) and DurableRPC lite.
 * Contains all the common WebSocket hibernation, HTTP RPC, and broadcast logic
 * that both entry points need.
 *
 * Subclasses must implement:
 * - getSkipProps(): returns the set of properties to skip during RPC exposure
 * - getBasePrototype(): returns the prototype to stop at when walking the chain
 * - getSchema(): returns the schema for the /__schema endpoint
 */

import {
  RpcSession,
  newHttpBatchRpcResponse,
  HibernatableWebSocketTransport,
  TransportRegistry,
  type RpcSessionOptions,
} from '@dotdo/capnweb/server'

import { RpcInterface, type RpcWrappable } from './rpc-interface.js'

import {
  createWebSocketAttachment,
  transitionWebSocketState,
  getWebSocketAttachment,
} from './websocket-state.js'

// ============================================================================
// Cloudflare DO Base (declared for type safety without runtime import)
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
// DurableRPCBase - Shared Base Class
// ============================================================================

/**
 * Abstract base class for RPC-enabled Durable Objects.
 *
 * Contains all shared logic for WebSocket hibernation, HTTP RPC handling,
 * broadcast, and session management. Subclasses provide their own
 * skip-props, base-prototype, and schema implementation.
 */
export abstract class DurableRPCBase extends DurableObject implements RpcWrappable {
  /** Transport registry for managing WebSocket transports */
  private _transportRegistry = new TransportRegistry()

  /** Map of WebSocket -> RpcSession for active sessions */
  private _sessions = new Map<WebSocket, RpcSession>()

  /** RPC interface wrapper for capnweb */
  private _rpcInterface?: RpcInterface<DurableRPCBase>

  /** Current request (available during fetch handling) */
  protected _currentRequest?: Request

  /**
   * Optional server-side middleware for RPC hooks.
   * Override in subclass to add middleware.
   */
  middleware?: import('./middleware.js').ServerMiddleware[]

  // ==========================================================================
  // Storage Accessors
  // ==========================================================================

  /** SQLite tagged template - use directly as this.sql`query` */
  get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  /** Durable Object storage API */
  get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  /** Durable Object state (for advanced use) */
  get state(): DurableObjectState {
    return this.ctx
  }

  // ==========================================================================
  // Abstract methods - subclasses must implement
  // ==========================================================================

  /** Return the set of property names to skip when exposing methods via RPC */
  protected abstract getSkipProps(): Set<string>

  /** Return the base prototype to stop at when walking the prototype chain */
  protected abstract getBasePrototype(): object

  /** Return the schema for this DO's API */
  abstract getSchema(): unknown

  // ==========================================================================
  // RPC Interface
  // ==========================================================================

  /**
   * Get or create the RPC interface wrapper
   */
  private getRpcInterface(): RpcInterface<DurableRPCBase> {
    if (!this._rpcInterface) {
      this._rpcInterface = new RpcInterface({
        instance: this,
        skipProps: this.getSkipProps(),
        basePrototype: this.getBasePrototype(),
        getRequest: () => this._currentRequest,
        getEnv: () => this.env,
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
        console.error('[DurableRPC] Error:', error.message)
        return new Error(error.message)
      },
    }
  }

  // ==========================================================================
  // Fetch Handler
  // ==========================================================================

  /**
   * Handle incoming fetch requests (HTTP + WebSocket upgrade).
   *
   * Subclasses can override onFetch() for pre-processing (e.g. colo detection).
   */
  override async fetch(request: Request): Promise<Response> {
    this._currentRequest = request

    // Hook for subclass pre-processing
    this.onFetch(request)

    // GET /__schema -> return API schema
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.pathname === '/__schema' || url.pathname === '/') {
        const response = Response.json(this.getSchema())
        this._currentRequest = undefined
        return response
      }
    }

    // WebSocket upgrade -> hibernation-aware handler with capnweb
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade()
    }

    // HTTP RPC via capnweb batch
    try {
      return await this.handleHttpRpc(request)
    } finally {
      this._currentRequest = undefined
    }
  }

  /**
   * Hook called at the start of fetch(), before routing.
   * Override in subclass for pre-processing (e.g. colo detection).
   * Default implementation does nothing.
   */
  protected onFetch(_request: Request): void {
    // No-op by default
  }

  // ==========================================================================
  // WebSocket Hibernation with capnweb
  // ==========================================================================

  /**
   * Handle WebSocket upgrade request.
   *
   * State transitions: -> connecting -> active
   */
  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Create transport for this WebSocket
    const transport = new HibernatableWebSocketTransport(server)
    this._transportRegistry.register(transport)

    // STATE: -> connecting
    const attachment = createWebSocketAttachment(transport.id)
    server.serializeAttachment(attachment)

    // Use hibernation API to accept the WebSocket
    this.ctx.acceptWebSocket(server)

    // STATE: connecting -> active
    transitionWebSocketState(server, attachment, 'active', 'WebSocket accepted')

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
   * (Part of the Hibernation API)
   *
   * State transitions:
   * - hibernated -> active (DO woke from hibernation)
   * - active -> active (no change)
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    let attachment = getWebSocketAttachment(ws)
    let transport: HibernatableWebSocketTransport | undefined

    if (attachment?.transportId) {
      transport = this._transportRegistry.get(attachment.transportId)
    }

    // If transport not found, DO woke from hibernation
    if (!transport) {
      transport = new HibernatableWebSocketTransport(ws)
      this._transportRegistry.register(transport)
      const session = new RpcSession(transport, this.getRpcInterface(), this.getRpcSessionOptions())
      this._sessions.set(ws, session)

      if (attachment) {
        // STATE: hibernated -> active
        attachment.transportId = transport.id
        transitionWebSocketState(ws, attachment, 'active', 'woke from hibernation')
      } else {
        // Create new attachment (error recovery)
        attachment = createWebSocketAttachment(transport.id)
        attachment.state = 'active'
        ws.serializeAttachment(attachment)
        console.debug('[DurableRPC] WebSocket state: (unknown) -> active (created new attachment)')
      }
    }

    transport.enqueueMessage(message)
  }

  /**
   * Called when a WebSocket is closed.
   * (Part of the Hibernation API)
   *
   * State transition: active|hibernated -> closed
   */
  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const attachment = getWebSocketAttachment(ws)

    // STATE: * -> closed
    if (attachment) {
      const closeReason = `code=${code}, reason=${reason || 'none'}, wasClean=${wasClean}`
      transitionWebSocketState(ws, attachment, 'closed', closeReason)

      const transport = this._transportRegistry.get(attachment.transportId)
      if (transport) {
        transport.handleClose(code, reason)
        this._transportRegistry.remove(attachment.transportId)
      }
    } else {
      console.debug(`[DurableRPC] WebSocket closed without attachment (code=${code})`)
    }

    this._sessions.delete(ws)
  }

  /**
   * Called when a WebSocket encounters an error.
   * (Part of the Hibernation API)
   *
   * State transition: * -> closed
   */
  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error))
    const attachment = getWebSocketAttachment(ws)

    // STATE: * -> closed (via error)
    if (attachment) {
      transitionWebSocketState(ws, attachment, 'closed', `error: ${err.message}`)

      const transport = this._transportRegistry.get(attachment.transportId)
      if (transport) {
        transport.handleError(err)
        this._transportRegistry.remove(attachment.transportId)
      }
    } else {
      console.debug('[DurableRPC] WebSocket error without attachment:', err.message)
    }

    this._sessions.delete(ws)
  }

  // ==========================================================================
  // HTTP RPC via capnweb batch
  // ==========================================================================

  private async handleHttpRpc(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    try {
      return await newHttpBatchRpcResponse(request, this.getRpcInterface(), this.getRpcSessionOptions())
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'RPC error'
      return Response.json({ error: message }, { status: 500 })
    }
  }

  // ==========================================================================
  // Broadcast
  // ==========================================================================

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  broadcast(message: unknown, exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets()
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    for (const ws of sockets) {
      if (ws !== exclude) {
        try { ws.send(data) } catch { /* ignore closed sockets */ }
      }
    }
  }

  /**
   * Get count of connected WebSocket clients
   */
  get connectionCount(): number {
    return this.ctx.getWebSockets().length
  }
}
