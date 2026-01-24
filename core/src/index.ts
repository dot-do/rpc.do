/**
 * @dotdo/rpc - Durable Object RPC Server
 *
 * Wraps capnweb with Cloudflare DO-specific features:
 * - $ context (sql, storage, state)
 * - WebSocket hibernation
 * - Worker → DO routing
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
 * Server-side context available inside DO RPC methods
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
}

// ============================================================================
// DurableRPC Base Class
// ============================================================================

/**
 * Base class for RPC-enabled Durable Objects
 *
 * Extends DurableObject with:
 * - Automatic WebSocket hibernation
 * - JSON RPC over WebSocket + HTTP
 * - $ context for storage/sql access
 * - capnweb-compatible protocol
 */
export class DurableRPC extends DurableObject {
  /** Context accessor for storage, sql, state */
  get $(): RpcContext {
    return {
      sql: this.ctx.storage.sql,
      storage: this.ctx.storage,
      state: this.ctx,
      request: this._currentRequest,
      auth: this._currentAuth,
    }
  }

  private _currentRequest?: Request
  private _currentAuth?: Record<string, any>

  /**
   * Handle incoming fetch requests (HTTP + WebSocket upgrade)
   */
  async fetch(request: Request): Promise<Response> {
    this._currentRequest = request

    // WebSocket upgrade → hibernation-aware handler
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // HTTP RPC
    return this.handleHttpRpc(request)
  }

  // ==========================================================================
  // WebSocket Hibernation
  // ==========================================================================

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Use hibernation API
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Called when a hibernated WebSocket receives a message
   * (Part of the Hibernation API)
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    try {
      const { id, path, args } = JSON.parse(message)
      const result = await this.dispatch(path, args || [])
      ws.send(JSON.stringify({ id, result }))
    } catch (error: any) {
      try {
        const { id } = JSON.parse(message as string)
        ws.send(JSON.stringify({ id, error: error.message }))
      } catch {
        ws.send(JSON.stringify({ error: error.message }))
      }
    }
  }

  /**
   * Called when a hibernated WebSocket is closed
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Override in subclass for cleanup
  }

  /**
   * Called when a hibernated WebSocket encounters an error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Override in subclass for error handling
  }

  // ==========================================================================
  // HTTP RPC
  // ==========================================================================

  private async handleHttpRpc(request: Request): Promise<Response> {
    // GET /__schema → return API schema (like GraphQL introspection)
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.pathname === '/__schema' || url.pathname === '/') {
        return Response.json(this.getSchema())
      }
      return new Response('Method not allowed', { status: 405 })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { path, args, method } = body

    // Support both { path, args } and { method, path, args } formats
    const rpcPath = path || method
    if (!rpcPath) {
      return Response.json({ error: 'Missing path' }, { status: 400 })
    }

    try {
      const result = await this.dispatch(rpcPath, args || [])
      return Response.json(result)
    } catch (error: any) {
      return Response.json(
        { error: error.message || 'RPC error' },
        { status: 500 }
      )
    }
  }

  // ==========================================================================
  // Method Dispatch
  // ==========================================================================

  /**
   * Dispatch an RPC call to the appropriate method on this object
   */
  private async dispatch(path: string, args: any[]): Promise<any> {
    // Built-in schema reflection
    if (path === '__schema') {
      return this.getSchema()
    }

    const parts = path.split('.')

    // Navigate the object tree
    let target: any = this
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]]
      if (target === undefined || target === null) {
        throw new Error(`Invalid path: ${path} (failed at '${parts[i]}')`)
      }
    }

    const methodName = parts[parts.length - 1]
    const method = target[methodName]

    if (typeof method !== 'function') {
      throw new Error(`Not a function: ${path}`)
    }

    return method.apply(target, args)
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
   */
  broadcast(message: any, exclude?: WebSocket): void {
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

// ============================================================================
// Worker Router (Worker → DO routing)
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

      const forwardRequest = new Request(forwardUrl.toString(), request)
      return stub.fetch(forwardRequest)
    }
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
}

/** Properties to skip during introspection */
const SKIP_PROPS = new Set([
  // DurableObject lifecycle
  'fetch', 'alarm', 'webSocketMessage', 'webSocketClose', 'webSocketError',
  // DurableRPC internals
  'constructor', 'getSchema', 'broadcast', 'connectionCount',
  '$', '_currentRequest', '_currentAuth',
  'handleWebSocketUpgrade', 'handleHttpRpc', 'dispatch',
])

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

  return { version: 1, methods, namespaces }
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

