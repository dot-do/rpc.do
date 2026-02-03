/**
 * DurableRPC Factory
 *
 * The createDurableRPC factory function enables composition-based
 * DurableRPC creation as an alternative to class inheritance.
 *
 * @example
 * ```typescript
 * import { createDurableRPC, sqlPlugin, storagePlugin } from '@dotdo/rpc'
 *
 * // Instead of:
 * // class MyDO extends DurableRPC { ... }
 *
 * // Use composition:
 * export const MyDO = createDurableRPC({
 *   plugins: [sqlPlugin(), storagePlugin()],
 *   methods: {
 *     getUser: async ($, id: string) => {
 *       return $.sql`SELECT * FROM users WHERE id = ${id}`.first()
 *     },
 *     users: {
 *       list: async ($) => $.sql`SELECT * FROM users`.all(),
 *       create: async ($, name: string) => {
 *         $.sql`INSERT INTO users (name) VALUES (${name})`.run()
 *         return { ok: true }
 *       }
 *     }
 *   }
 * })
 * ```
 */

import {
  RpcSession,
  newHttpBatchRpcResponse,
  HibernatableWebSocketTransport,
  TransportRegistry,
  RpcTarget,
  type RpcSessionOptions,
} from '@dotdo/capnweb/server'

import {
  createWebSocketAttachment,
  transitionWebSocketState,
  getWebSocketAttachment,
} from '../websocket-state.js'

import type { ServerMiddleware, MiddlewareContext } from '../middleware.js'
import { wrapWithMiddleware } from '../middleware.js'

import type {
  Plugin,
  PluginInitContext,
  PluginRuntimeContext,
  BaseContext,
  CreateDurableRPCConfig,
  ComposedContext,
  MethodDefinition,
  MergeContexts,
  ComposedDurableObjectClass,
} from './types.js'

import {
  introspectDatabase,
  type RpcSchema,
  type RpcMethodSchema,
  type RpcNamespaceSchema,
} from '../introspection.js'

// ============================================================================
// Cloudflare DO Base
// ============================================================================

/**
 * Base class for Durable Objects.
 *
 * In the Cloudflare Workers runtime, the global DurableObject class is provided.
 * For testing and other environments, we provide a minimal implementation.
 */
const DurableObjectBase: {
  new (ctx: DurableObjectState, env: Record<string, unknown>): {
    ctx: DurableObjectState
    env: Record<string, unknown>
    fetch?(request: Request): Response | Promise<Response>
    alarm?(): void | Promise<void>
    webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>
    webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>
    webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>
  }
} = (typeof DurableObject !== 'undefined'
  ? DurableObject
  : class DurableObjectPolyfill {
      protected ctx: DurableObjectState
      protected env: Record<string, unknown>
      constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
        this.ctx = ctx
        this.env = env
      }
    }) as any

// ============================================================================
// Skip Props
// ============================================================================

/**
 * Base properties to always skip during introspection
 */
const ALWAYS_SKIP = new Set([
  // DurableObject lifecycle
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  // Constructor and internals
  'constructor',
  'prototype',
  // Composition internals
  '_ctx',
  '_env',
  '_plugins',
  '_pluginContexts',
  '_methods',
  '_middleware',
  '_transportRegistry',
  '_sessions',
  '_rpcTarget',
  '_currentRequest',
  '_composedContext',
  // Schema
  'getSchema',
  '__schema',
  '__dbSchema',
])

// ============================================================================
// RpcTarget Wrapper
// ============================================================================

/**
 * Creates an RpcTarget that wraps composed methods
 */
function createRpcTarget(
  methods: Record<string, Function>,
  namespaces: Record<string, Record<string, Function>>,
  internalMethods: Record<string, Function>,
  middleware: ServerMiddleware[],
  getContext: () => MiddlewareContext,
  getSchema: () => RpcSchema
): RpcTarget {
  const target = new RpcTarget()

  // Define regular methods
  for (const [name, fn] of Object.entries(methods)) {
    const wrapped = middleware.length > 0
      ? wrapWithMiddleware(name, fn as (...args: unknown[]) => unknown, middleware, getContext)
      : fn
    Object.defineProperty(target, name, {
      value: wrapped,
      enumerable: true,
      configurable: true,
    })
  }

  // Define namespaces
  for (const [nsName, nsMethods] of Object.entries(namespaces)) {
    const wrappedNamespace: Record<string, Function> = {}
    for (const [methodName, fn] of Object.entries(nsMethods)) {
      const fullName = `${nsName}.${methodName}`
      wrappedNamespace[methodName] = middleware.length > 0
        ? wrapWithMiddleware(fullName, fn as (...args: unknown[]) => unknown, middleware, getContext)
        : fn
    }
    Object.defineProperty(target, nsName, {
      value: wrappedNamespace,
      enumerable: true,
      configurable: true,
    })
  }

  // Define internal methods (no middleware wrapping - they're transport-level)
  for (const [name, fn] of Object.entries(internalMethods)) {
    Object.defineProperty(target, name, {
      value: fn,
      enumerable: false, // Internal methods are not enumerable
      configurable: true,
    })
  }

  // Define __schema method
  Object.defineProperty(target, '__schema', {
    value: getSchema,
    enumerable: false,
    configurable: true,
  })

  return target
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a DurableRPC class using composition instead of inheritance.
 *
 * This is the recommended way to create DurableRPC instances when you want:
 * - Explicit control over which features are included
 * - Smaller bundle sizes by only including needed plugins
 * - Clear separation between configuration and implementation
 * - Better testability with injectable plugins
 *
 * @typeParam TPlugins - Tuple of plugins to compose
 * @typeParam TMethods - Record of method definitions
 * @param config - Configuration object with plugins and methods
 * @returns A DurableObject class that can be exported for Cloudflare Workers
 *
 * @example Basic usage
 * ```typescript
 * import { createDurableRPC, sqlPlugin } from '@dotdo/rpc'
 *
 * export const MyDO = createDurableRPC({
 *   plugins: [sqlPlugin()],
 *   methods: {
 *     echo: async ($, message: string) => message,
 *     getUsers: async ($) => $.sql`SELECT * FROM users`.all(),
 *   }
 * })
 * ```
 *
 * @example With namespaces
 * ```typescript
 * export const MyDO = createDurableRPC({
 *   plugins: [sqlPlugin(), storagePlugin()],
 *   methods: {
 *     // Top-level method
 *     health: async () => ({ status: 'ok' }),
 *
 *     // Namespace with methods
 *     users: {
 *       get: async ($, id: string) => $.sql`SELECT * FROM users WHERE id = ${id}`.first(),
 *       list: async ($) => $.sql`SELECT * FROM users`.all(),
 *       create: async ($, data: { name: string }) => {
 *         $.sql`INSERT INTO users (name) VALUES (${data.name})`.run()
 *         return { ok: true }
 *       }
 *     }
 *   }
 * })
 * ```
 *
 * @example With middleware
 * ```typescript
 * import { serverLoggingMiddleware } from '@dotdo/rpc'
 *
 * export const MyDO = createDurableRPC({
 *   plugins: [sqlPlugin()],
 *   middleware: [serverLoggingMiddleware()],
 *   methods: { ... }
 * })
 * ```
 */
export function createDurableRPC<
  TPlugins extends readonly Plugin<unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TMethods extends Record<string, MethodDefinition<any> | Record<string, MethodDefinition<any>>>
>(
  config: CreateDurableRPCConfig<TPlugins, TMethods>
): ComposedDurableObjectClass<TPlugins, TMethods> {
  const {
    plugins = [] as unknown as TPlugins,
    methods = {} as TMethods,
    middleware = [],
    schema = {},
  } = config

  // Build skip props set from all plugins
  const skipProps = new Set(ALWAYS_SKIP)
  for (const plugin of plugins) {
    if (plugin.skipProps) {
      for (const prop of plugin.skipProps) {
        skipProps.add(prop)
      }
    }
  }
  if (schema.skipProps) {
    for (const prop of schema.skipProps) {
      skipProps.add(prop)
    }
  }

  // The composed DurableObject class
  class ComposedDurableRPC extends DurableObjectBase {
    // Internal state
    private _transportRegistry = new TransportRegistry()
    private _sessions = new Map<WebSocket, RpcSession>()
    private _rpcTarget?: RpcTarget
    private _currentRequest?: Request
    private _pluginContexts: Record<string, unknown> = {}
    private _composedContext!: ComposedContext<TPlugins>
    private _allMiddleware: ServerMiddleware[]

    constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
      super(ctx, env)

      // Initialize plugins
      const initCtx: PluginInitContext = { ctx, env }
      for (const plugin of plugins) {
        const pluginContext = plugin.init(initCtx)
        this._pluginContexts[plugin.name] = pluginContext
      }

      // Build composed context with base context + plugin contexts
      const baseContext: BaseContext = {
        ctx,
        env,
        get request() {
          return (this as unknown as ComposedDurableRPC)._currentRequest
        },
        broadcast: this.broadcast.bind(this),
        get connectionCount() {
          return ctx.getWebSockets().length
        },
      }

      // Merge all contexts
      this._composedContext = {
        ...baseContext,
        ...Object.values(this._pluginContexts).reduce((acc, ctx) => ({ ...acc, ...ctx }), {}),
      } as ComposedContext<TPlugins>

      // Call plugin setup hooks
      const runtimeCtx: PluginRuntimeContext = {
        ...initCtx,
        base: baseContext,
      }
      for (const plugin of plugins) {
        if (plugin.setup) {
          plugin.setup(
            { ...runtimeCtx, ...this._pluginContexts[plugin.name] } as any,
            this._pluginContexts
          )
        }
      }

      // Collect all middleware (config + plugins)
      this._allMiddleware = [...middleware]
      for (const plugin of plugins) {
        if (plugin.middleware) {
          this._allMiddleware.push(...plugin.middleware)
        }
      }

      // Bind methods to context
      this._bindMethods()
    }

    /**
     * Bind user-defined methods to the composed context
     */
    private _bindMethods(): void {
      for (const [key, value] of Object.entries(methods)) {
        if (typeof value === 'function') {
          // Top-level method
          const boundMethod = (...args: unknown[]) => {
            return (value as MethodDefinition<ComposedContext<TPlugins>>)(this._composedContext, ...args)
          }
          Object.defineProperty(this, key, {
            value: boundMethod,
            enumerable: true,
            configurable: true,
          })
        } else if (typeof value === 'object' && value !== null) {
          // Namespace
          const namespace: Record<string, Function> = {}
          for (const [methodKey, methodFn] of Object.entries(value)) {
            if (typeof methodFn === 'function') {
              namespace[methodKey] = (...args: unknown[]) => {
                return (methodFn as MethodDefinition<ComposedContext<TPlugins>>)(this._composedContext, ...args)
              }
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

    /**
     * Get or create the RPC target
     */
    private _getRpcTarget(): RpcTarget {
      if (!this._rpcTarget) {
        // Collect methods and namespaces from this instance
        const rpcMethods: Record<string, Function> = {}
        const rpcNamespaces: Record<string, Record<string, Function>> = {}
        const internalMethods: Record<string, Function> = {}

        // Add user-defined methods
        for (const [key, value] of Object.entries(methods)) {
          if (typeof value === 'function') {
            rpcMethods[key] = (this as any)[key]
          } else if (typeof value === 'object' && value !== null) {
            rpcNamespaces[key] = (this as any)[key]
          }
        }

        // Add plugin internal methods
        for (const plugin of plugins) {
          if (plugin.internalMethods) {
            for (const [name, fn] of Object.entries(plugin.internalMethods)) {
              internalMethods[name] = fn
            }
          }
          if (plugin.methods) {
            for (const [name, fn] of Object.entries(plugin.methods)) {
              rpcMethods[name] = fn
            }
          }
        }

        // Add schema internal method
        internalMethods['__dbSchema'] = () => {
          return introspectDatabase(this.ctx.storage.sql)
        }

        const getContext = (): MiddlewareContext => ({
          env: this.env,
          request: this._currentRequest,
        })

        this._rpcTarget = createRpcTarget(
          rpcMethods,
          rpcNamespaces,
          internalMethods,
          this._allMiddleware,
          getContext,
          () => this.getSchema()
        )
      }
      return this._rpcTarget
    }

    /**
     * Get RPC session options
     */
    private _getRpcSessionOptions(): RpcSessionOptions {
      return {
        onSendError: (error: Error) => {
          console.error('[ComposedDurableRPC] Error:', error.message)
          return new Error(error.message)
        },
      }
    }

    // ========================================================================
    // Fetch Handler
    // ========================================================================

    override async fetch(request: Request): Promise<Response> {
      this._currentRequest = request

      // Call plugin onFetch hooks
      for (const plugin of plugins) {
        if (plugin.onFetch) {
          plugin.onFetch(request, {
            ctx: this.ctx,
            env: this.env,
            request,
            base: this._composedContext as BaseContext,
            ...this._pluginContexts[plugin.name],
          } as any)
        }
      }

      // GET /__schema or / -> return schema
      if (request.method === 'GET') {
        const url = new URL(request.url)
        if (url.pathname === '/__schema' || url.pathname === '/') {
          const response = Response.json(this.getSchema())
          this._currentRequest = undefined
          return response
        }
      }

      // WebSocket upgrade
      if (request.headers.get('Upgrade') === 'websocket') {
        return this._handleWebSocketUpgrade()
      }

      // HTTP RPC
      try {
        return await this._handleHttpRpc(request)
      } finally {
        this._currentRequest = undefined
      }
    }

    // ========================================================================
    // WebSocket Hibernation
    // ========================================================================

    private _handleWebSocketUpgrade(): Response {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]

      const transport = new HibernatableWebSocketTransport(server)
      this._transportRegistry.register(transport)

      const attachment = createWebSocketAttachment(transport.id)
      server.serializeAttachment(attachment)

      this.ctx.acceptWebSocket(server)
      transitionWebSocketState(server, attachment, 'active', 'WebSocket accepted')

      const session = new RpcSession(
        transport,
        this._getRpcTarget(),
        this._getRpcSessionOptions()
      )
      this._sessions.set(server, session)

      return new Response(null, { status: 101, webSocket: client })
    }

    override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
      if (typeof message !== 'string') return

      let attachment = getWebSocketAttachment(ws)
      let transport: HibernatableWebSocketTransport | undefined

      if (attachment?.transportId) {
        transport = this._transportRegistry.get(attachment.transportId)
      }

      if (!transport) {
        transport = new HibernatableWebSocketTransport(ws)
        this._transportRegistry.register(transport)
        const session = new RpcSession(transport, this._getRpcTarget(), this._getRpcSessionOptions())
        this._sessions.set(ws, session)

        if (attachment) {
          attachment.transportId = transport.id
          transitionWebSocketState(ws, attachment, 'active', 'woke from hibernation')
        } else {
          attachment = createWebSocketAttachment(transport.id)
          attachment.state = 'active'
          ws.serializeAttachment(attachment)
        }
      }

      transport.enqueueMessage(message)
    }

    override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
      const attachment = getWebSocketAttachment(ws)

      if (attachment) {
        transitionWebSocketState(ws, attachment, 'closed', `code=${code}`)

        const transport = this._transportRegistry.get(attachment.transportId)
        if (transport) {
          transport.handleClose(code, reason)
          this._transportRegistry.remove(attachment.transportId)
        }
      }

      this._sessions.delete(ws)
    }

    override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
      const err = error instanceof Error ? error : new Error(String(error))
      const attachment = getWebSocketAttachment(ws)

      if (attachment) {
        transitionWebSocketState(ws, attachment, 'closed', `error: ${err.message}`)

        const transport = this._transportRegistry.get(attachment.transportId)
        if (transport) {
          transport.handleError(err)
          this._transportRegistry.remove(attachment.transportId)
        }
      }

      this._sessions.delete(ws)
    }

    // ========================================================================
    // HTTP RPC
    // ========================================================================

    private async _handleHttpRpc(request: Request): Promise<Response> {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 })
      }
      try {
        return await newHttpBatchRpcResponse(request, this._getRpcTarget(), this._getRpcSessionOptions())
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'RPC error'
        return Response.json({ error: message }, { status: 500 })
      }
    }

    // ========================================================================
    // Broadcast
    // ========================================================================

    broadcast(message: unknown, exclude?: WebSocket): void {
      const sockets = this.ctx.getWebSockets()
      const data = typeof message === 'string' ? message : JSON.stringify(message)
      for (const ws of sockets) {
        if (ws !== exclude) {
          try { ws.send(data) } catch { /* ignore closed sockets */ }
        }
      }
    }

    // ========================================================================
    // Schema
    // ========================================================================

    getSchema(): RpcSchema {
      const rpcMethods: RpcMethodSchema[] = []
      const rpcNamespaces: RpcNamespaceSchema[] = []

      // Collect methods from config
      for (const [key, value] of Object.entries(methods)) {
        if (skipProps.has(key)) continue

        if (typeof value === 'function') {
          // value.length - 1 because first param is $
          rpcMethods.push({
            name: key,
            path: key,
            params: value.length - 1,
          })
        } else if (typeof value === 'object' && value !== null) {
          const nsMethods: RpcMethodSchema[] = []
          for (const [methodKey, methodFn] of Object.entries(value)) {
            if (typeof methodFn === 'function') {
              nsMethods.push({
                name: methodKey,
                path: `${key}.${methodKey}`,
                params: methodFn.length - 1,
              })
            }
          }
          if (nsMethods.length > 0) {
            rpcNamespaces.push({ name: key, methods: nsMethods })
          }
        }
      }

      // Add plugin methods to schema
      for (const plugin of plugins) {
        if (plugin.methods) {
          for (const [name, fn] of Object.entries(plugin.methods)) {
            if (!skipProps.has(name)) {
              rpcMethods.push({
                name,
                path: name,
                params: fn.length,
              })
            }
          }
        }
      }

      // Get colo from colo plugin if available
      const coloContext = this._pluginContexts['colo'] as { colo?: string } | undefined
      const colo = coloContext?.colo

      return {
        version: 1,
        methods: rpcMethods,
        namespaces: rpcNamespaces,
        database: introspectDatabase(this.ctx.storage.sql),
        colo,
      }
    }
  }

  return ComposedDurableRPC as unknown as ComposedDurableObjectClass<TPlugins, TMethods>
}
