/**
 * @dotdo/rpc/lite - Minimal DurableRPC without colo.do or collections
 *
 * Use this for the smallest possible bundle size.
 * Add features by importing from sub-packages:
 *   - @dotdo/rpc/collections - MongoDB-style collections
 *   - @dotdo/rpc/colo - Location awareness (or use colo.do service)
 *
 * @example
 * ```typescript
 * import { DurableRPC } from '@dotdo/rpc/lite'
 *
 * export class MyDO extends DurableRPC {
 *   echo(msg: string) { return msg }
 * }
 * ```
 */

// Re-export function types from @dotdo/do/types for RPC consumers
export type {
  Fn,
  AsyncFn,
  RpcFn,
  RpcPromise,
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
import { RpcInterface, SKIP_PROPS_BASE } from './rpc-interface.js'

// Re-export capnweb types
export { RpcTarget, RpcSession, type RpcTransport, type RpcSessionOptions }
export { HibernatableWebSocketTransport, TransportRegistry }

// ============================================================================
// Cloudflare DO Base
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
// Schema Types (minimal)
// ============================================================================

export interface RpcMethodSchema {
  name: string
  path: string
  params: number
}

export interface RpcNamespaceSchema {
  name: string
  methods: RpcMethodSchema[]
}

export interface LiteRpcSchema {
  version: 1
  methods: RpcMethodSchema[]
  namespaces: RpcNamespaceSchema[]
}

// ============================================================================
// DurableRPC Lite - Minimal Base Class
// ============================================================================

/**
 * Minimal RPC-enabled Durable Object base class.
 * No colo.do, no collections - just RPC handling.
 */
export class DurableRPC extends DurableObject {
  private _transportRegistry = new TransportRegistry()
  private _sessions = new Map<WebSocket, RpcSession>()
  private _rpcInterface?: RpcInterface<DurableRPC>
  protected _currentRequest?: Request

  /** SQLite storage */
  get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  /** Durable Object storage API */
  get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  /** Durable Object state */
  get state(): DurableObjectState {
    return this.ctx
  }

  private getRpcInterface(): RpcInterface<DurableRPC> {
    if (!this._rpcInterface) {
      this._rpcInterface = new RpcInterface({
        instance: this,
        skipProps: SKIP_PROPS_BASE,
        basePrototype: DurableRPC.prototype,
      })
    }
    return this._rpcInterface
  }

  protected getRpcSessionOptions(): RpcSessionOptions {
    return {
      onSendError: (error: Error) => {
        console.error('[DurableRPC] Error:', error.message)
        return new Error(error.message)
      },
    }
  }

  override async fetch(request: Request): Promise<Response> {
    this._currentRequest = request

    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.pathname === '/__schema' || url.pathname === '/') {
        return Response.json(this.getSchema())
      }
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    return this.handleHttpRpc(request)
  }

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    this.ctx.acceptWebSocket(server)
    const transport = new HibernatableWebSocketTransport(server)
    this._transportRegistry.register(transport)

    const session = new RpcSession(
      transport,
      this.getRpcInterface(),
      this.getRpcSessionOptions()
    )
    this._sessions.set(server, session)
    server.serializeAttachment({ transportId: transport.id })

    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    let transport: HibernatableWebSocketTransport | undefined
    try {
      const attachment = ws.deserializeAttachment() as { transportId?: string } | null
      if (attachment?.transportId) {
        transport = this._transportRegistry.get(attachment.transportId)
      }
    } catch (error) {
      console.debug('[DurableRPC] Failed to deserialize WebSocket attachment:', error)
    }

    if (!transport) {
      transport = new HibernatableWebSocketTransport(ws)
      this._transportRegistry.register(transport)
      const session = new RpcSession(transport, this.getRpcInterface(), this.getRpcSessionOptions())
      this._sessions.set(ws, session)
      ws.serializeAttachment({ transportId: transport.id })
    }

    transport.enqueueMessage(message)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    try {
      const attachment = ws.deserializeAttachment() as { transportId?: string } | null
      if (attachment?.transportId) {
        const transport = this._transportRegistry.get(attachment.transportId)
        if (transport) {
          transport.handleClose(code, reason)
          this._transportRegistry.remove(attachment.transportId)
        }
      }
    } catch {}
    this._sessions.delete(ws)
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
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
    } catch {}
    this._sessions.delete(ws)
  }

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

  getSchema(): LiteRpcSchema {
    const methods: RpcMethodSchema[] = []
    const namespaces: RpcNamespaceSchema[] = []
    const seen = new Set<string>()

    const collectProps = (obj: any) => {
      if (!obj || obj === Object.prototype) return
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (!seen.has(key) && !SKIP_PROPS_BASE.has(key) && !key.startsWith('_')) {
          seen.add(key)
          let value: any
          try { value = (this as any)[key] } catch { continue }

          if (typeof value === 'function') {
            methods.push({ name: key, path: key, params: value.length })
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            const nsMethods: RpcMethodSchema[] = []
            for (const nsKey of Object.keys(value)) {
              if (typeof value[nsKey] === 'function') {
                nsMethods.push({ name: nsKey, path: `${key}.${nsKey}`, params: value[nsKey].length })
              }
            }
            if (nsMethods.length > 0) {
              namespaces.push({ name: key, methods: nsMethods })
            }
          }
        }
      }
    }

    collectProps(this)
    let proto = Object.getPrototypeOf(this)
    while (proto && proto !== DurableRPC.prototype && proto !== DurableObject.prototype) {
      collectProps(proto)
      proto = Object.getPrototypeOf(proto)
    }

    return { version: 1, methods, namespaces }
  }

  broadcast(message: unknown, exclude?: WebSocket): void {
    const sockets = this.ctx.getWebSockets()
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    for (const ws of sockets) {
      if (ws !== exclude) {
        try { ws.send(data) } catch {}
      }
    }
  }

  get connectionCount(): number {
    return this.ctx.getWebSockets().length
  }
}
