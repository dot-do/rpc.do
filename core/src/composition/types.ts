/**
 * Composition Types for DurableRPC
 *
 * Type definitions for the composition-based architecture that enables
 * building DurableRPC instances from composable plugins instead of
 * class inheritance.
 *
 * @example
 * ```typescript
 * const myDO = createDurableRPC({
 *   plugins: [sqlPlugin(), storagePlugin(), authPlugin({ required: true })],
 *   methods: {
 *     getUser: async ($, id: string) => $.sql`SELECT * FROM users WHERE id = ${id}`.first(),
 *     createUser: async ($, data: { name: string }) => {
 *       $.sql`INSERT INTO users (name) VALUES (${data.name})`.run()
 *       return { ok: true }
 *     }
 *   }
 * })
 * ```
 */

import type { ServerMiddleware, MiddlewareContext } from '../middleware.js'
import type { Collection, Filter, QueryOptions } from '@dotdo/collections'

// ============================================================================
// Core Plugin Types
// ============================================================================

/**
 * Base context always available in plugin methods.
 * This is the minimal context that every DO has access to.
 */
export interface BaseContext {
  /** Durable Object state */
  readonly ctx: DurableObjectState
  /** Environment bindings */
  readonly env: Record<string, unknown>
  /** Current request (if available) */
  readonly request?: Request
  /** Broadcast a message to all connected WebSocket clients */
  broadcast(message: unknown, exclude?: WebSocket): void
  /** Get count of connected WebSocket clients */
  readonly connectionCount: number
}

/**
 * Context when SQL plugin is enabled
 */
export interface SqlContext {
  /** SQLite tagged template - use as $.sql`query` */
  readonly sql: SqlStorage
}

/**
 * Context when Storage plugin is enabled
 */
export interface StorageContext {
  /** Durable Object storage API */
  readonly storage: DurableObjectStorage
}

/**
 * Context when Collection plugin is enabled
 */
export interface CollectionContext {
  /** Get or create a named collection */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<T>
}

/**
 * Context when Auth plugin is enabled
 */
export interface AuthContext {
  /** Auth information from the auth plugin */
  readonly auth: {
    /** Whether the request is authenticated */
    authenticated: boolean
    /** User information (if authenticated) */
    user?: unknown
    /** Auth token (if provided) */
    token?: string
    /** Additional auth context */
    [key: string]: unknown
  }
}

/**
 * Context when Colo plugin is enabled
 */
export interface ColoContext {
  /** The colo where this DO is running */
  readonly colo: string | undefined
  /** Full colo information */
  readonly coloInfo?: import('colo.do/tiny').ColoInfo
  /** Estimate latency to another colo */
  estimateLatencyTo(targetColo: string): number | undefined
  /** Get distance to another colo */
  distanceTo(targetColo: string): number | undefined
  /** Find the nearest colo from candidates */
  findNearestColo(candidates: string[]): string | undefined
}

// ============================================================================
// Plugin Definition Types
// ============================================================================

/**
 * Plugin initialization context provided during setup
 */
export interface PluginInitContext {
  /** Durable Object state */
  ctx: DurableObjectState
  /** Environment bindings */
  env: Record<string, unknown>
}

/**
 * Plugin runtime context for method invocation
 */
export interface PluginRuntimeContext extends PluginInitContext {
  /** Current request */
  request?: Request
  /** Base context (always available) */
  base: BaseContext
}

/**
 * Base plugin interface that all plugins implement
 */
export interface Plugin<TContext = object> {
  /** Unique plugin name for identification */
  readonly name: string

  /**
   * Initialize the plugin (called once per DO instance)
   * Returns the context additions this plugin provides
   */
  init(ctx: PluginInitContext): TContext

  /**
   * Optional: Setup hook called after all plugins are initialized
   * Can be used for cross-plugin coordination
   */
  setup?(ctx: PluginRuntimeContext & TContext, allContexts: Record<string, unknown>): void

  /**
   * Optional: Methods to expose via RPC
   * Keys are method names, values are method implementations
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  methods?: Record<string, (...args: any[]) => any>

  /**
   * Optional: Internal methods (prefixed with __) for RPC transport
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  internalMethods?: Record<string, (...args: any[]) => any>

  /**
   * Optional: Middleware provided by this plugin
   */
  middleware?: ServerMiddleware[]

  /**
   * Optional: Properties to skip during schema introspection
   */
  skipProps?: string[]

  /**
   * Optional: Hook called on each fetch request
   */
  onFetch?(request: Request, ctx: PluginRuntimeContext & TContext): void
}

// ============================================================================
// Specific Plugin Types
// ============================================================================

/**
 * SQL Plugin - adds $.sql capabilities
 */
export interface SqlPlugin extends Plugin<SqlContext> {
  name: 'sql'
}

/**
 * Storage Plugin - adds $.storage capabilities
 */
export interface StoragePlugin extends Plugin<StorageContext> {
  name: 'storage'
}

/**
 * Collection Plugin - adds $.collection() capabilities
 */
export interface CollectionPlugin extends Plugin<CollectionContext> {
  name: 'collection'
}

/**
 * Auth Plugin options
 */
export interface AuthPluginOptions {
  /** Whether authentication is required for all methods (default: false) */
  required?: boolean
  /** Header to extract token from (default: 'Authorization') */
  header?: string
  /** Custom token validation function */
  validate?: (token: string, ctx: PluginInitContext) => Promise<{ valid: boolean; user?: unknown }> | { valid: boolean; user?: unknown }
  /** Methods to exclude from auth check */
  excludeMethods?: string[]
}

/**
 * Auth Plugin - adds authentication middleware and $.auth context
 */
export interface AuthPlugin extends Plugin<AuthContext> {
  name: 'auth'
}

/**
 * Colo Plugin - adds location awareness
 */
export interface ColoPlugin extends Plugin<ColoContext> {
  name: 'colo'
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Extract context type from a plugin
 */
export type PluginContext<P> = P extends Plugin<infer C> ? C : never

/**
 * Union type of all built-in plugins
 */
export type BuiltinPlugin = SqlPlugin | StoragePlugin | CollectionPlugin | AuthPlugin | ColoPlugin

/**
 * Merge multiple plugin contexts into a single type
 */
export type MergeContexts<Plugins extends readonly Plugin<unknown>[]> = Plugins extends readonly [
  infer First extends Plugin<unknown>,
  ...infer Rest extends readonly Plugin<unknown>[]
]
  ? PluginContext<First> & MergeContexts<Rest>
  : object

/**
 * Configuration for createDurableRPC
 */
export interface CreateDurableRPCConfig<
  TPlugins extends readonly Plugin<unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TMethods extends Record<string, MethodDefinition<any> | Record<string, MethodDefinition<any>>>
> {
  /** Plugins to compose into the DO */
  plugins?: TPlugins
  /** RPC methods to expose */
  methods?: TMethods
  /** Server-side middleware */
  middleware?: ServerMiddleware[]
  /** Custom schema configuration */
  schema?: {
    /** Additional properties to skip in schema */
    skipProps?: string[]
  }
}

/**
 * Method definition type - receives context as first argument
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MethodDefinition<TContext> = (
  $: TContext,
  ...args: any[]
) => any | Promise<any>

/**
 * Namespace definition - object containing method definitions
 */
export type NamespaceDefinition<TContext> = {
  [key: string]: MethodDefinition<TContext>
}

/**
 * Methods or namespaces
 */
export type MethodsOrNamespaces<TContext> = {
  [key: string]: MethodDefinition<TContext> | NamespaceDefinition<TContext>
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * The shape of the composed context ($) passed to methods
 */
export type ComposedContext<TPlugins extends readonly Plugin<unknown>[]> = BaseContext & MergeContexts<TPlugins>

/**
 * Extract method signatures from method definitions (strip $ parameter)
 */
export type ExtractMethodSignature<T> = T extends (
  $: unknown,
  ...args: infer Args
) => infer Return
  ? (...args: Args) => Return
  : never

/**
 * Transform methods definition into exposed RPC interface
 */
export type ExposedMethods<TMethods> = {
  [K in keyof TMethods]: TMethods[K] extends MethodDefinition<unknown>
    ? ExtractMethodSignature<TMethods[K]>
    : TMethods[K] extends NamespaceDefinition<unknown>
    ? { [NK in keyof TMethods[K]]: ExtractMethodSignature<TMethods[K][NK]> }
    : never
}

/**
 * Type for the created DO class
 */
export interface ComposedDurableObjectClass<
  TPlugins extends readonly Plugin<unknown>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TMethods extends Record<string, MethodDefinition<any> | Record<string, MethodDefinition<any>>>
> {
  new (ctx: DurableObjectState, env: Record<string, unknown>): DurableObject & ExposedMethods<TMethods>
}
