/**
 * Built-in transports for rpc.do
 */

import type { Transport, RpcMethodPath } from './types'
import type { ServerMessage as TypesServerMessage } from '@dotdo/types/rpc'
import { ConnectionError, RPCError } from './errors'
import { loadCapnweb } from './capnweb-loader.js'

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a callable function
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

/**
 * Server message type - discriminated union for result vs error responses
 * This allows TypeScript to narrow types based on presence of result vs error
 *
 * Note: This is a simplified version for WebSocket responses.
 * For the full discriminated union with type tags, use `ServerMessage` from '@dotdo/types/rpc'.
 *
 * @see TypesServerMessage from '@dotdo/types/rpc' for the full discriminated union
 */
export type ServerMessage =
  | { id?: number; result: unknown; error?: undefined }
  | { id?: number; result?: undefined; error: { message: string; code?: string | number; data?: unknown } }

/**
 * Type guard to check if a value is a non-null object.
 * Useful for narrowing `unknown` before checking properties with `in`.
 */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Type guard for WebSocket server messages
 */
export function isServerMessage(data: unknown): data is ServerMessage {
  if (!isNonNullObject(data)) {
    return false
  }
  // Must have either result or error (but not both as valid data)
  const hasResult = 'result' in data
  const hasError = 'error' in data && isNonNullObject(data['error'])
  return hasResult || hasError
}

// ============================================================================
// Method Path Navigation
// ============================================================================

/**
 * Navigate a dotted method path (e.g. "users.create") on a root object.
 *
 * Splits the method string by '.' and traverses each segment on the root,
 * returning the final value. Throws RPCError if any intermediate segment
 * is not an object or function.
 *
 * @param root - The root object to navigate (e.g. a capnweb session proxy)
 * @param method - The dotted method path (e.g. "users.create")
 * @returns The value at the end of the path
 *
 * @throws {RPCError} With code 'INVALID_PATH' if a path segment is not traversable
 *
 * @internal
 */
/**
 * Type guard to check if a value is traversable (an object or function with indexable properties).
 */
function isTraversable(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
}

/**
 * Navigate a dotted method path (e.g. "users.create") on a root object.
 *
 * Accepts both plain strings (for backward compatibility) and branded RpcMethodPath
 * for compile-time safety when the caller wants to ensure path validity.
 *
 * @param root - The root object to navigate (e.g. a capnweb session proxy)
 * @param method - The dotted method path (string or RpcMethodPath)
 * @returns The value at the end of the path
 */
export function navigateMethodPath(root: unknown, method: string | RpcMethodPath): unknown {
  const parts = method.split('.')
  let target: unknown = root
  for (const part of parts) {
    // Allow both objects and functions (capnweb returns proxy functions that are traversable)
    if (!isTraversable(target)) {
      throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
    }
    target = target[part]
  }
  return target
}

/**
 * Navigate a dotted method path for service bindings with namespace/method error semantics.
 *
 * Unlike {@link navigateMethodPath}, this variant:
 * - Separates intermediate (namespace) segments from the final (method) segment
 * - Throws UNKNOWN_NAMESPACE for invalid intermediate paths
 * - Throws UNKNOWN_METHOD if the final method is not callable
 * - Returns the resolved function directly (not just the target value)
 *
 * @param root - The service binding object
 * @param method - The dotted method path (e.g. "admin.users.delete")
 * @returns The callable method function
 *
 * @throws {RPCError} With code 'UNKNOWN_NAMESPACE' if a namespace segment is invalid
 * @throws {RPCError} With code 'UNKNOWN_METHOD' if the final method is not callable
 *
 * @internal
 */
/**
 * Navigate a dotted method path for service bindings with namespace/method error semantics.
 *
 * Accepts both plain strings (for backward compatibility) and branded RpcMethodPath
 * for compile-time safety when the caller wants to ensure path validity.
 *
 * @param root - The service binding object
 * @param method - The dotted method path (string or RpcMethodPath)
 * @returns The callable method function
 */
export function navigateBindingMethodPath(root: unknown, method: string | RpcMethodPath): (...args: unknown[]) => unknown {
  const parts = method.split('.')
  let target: unknown = root

  // Navigate to the method (all parts except the last are namespaces)
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isNonNullObject(target)) {
      throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
    }
    const partName = parts[i]
    if (!partName) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
    target = target[partName]
    if (!target) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
  }

  const methodName = parts[parts.length - 1]
  if (!methodName) {
    throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
  }
  if (!isNonNullObject(target)) {
    throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
  }
  const methodFn = target[methodName]
  if (!isFunction(methodFn)) {
    throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
  }

  return methodFn
}

// ============================================================================
// Error Wrapping
// ============================================================================

/**
 * Extract an HTTP status code from an error object.
 * Checks for common `status` or `statusCode` properties used by HTTP libraries.
 */
function getErrorStatusCode(error: Error): number | undefined {
  const err = error as Record<string, unknown>
  if (typeof err['status'] === 'number') return err['status']
  if (typeof err['statusCode'] === 'number') return err['statusCode']
  return undefined
}

/**
 * Type guard to check if an error has a string `code` property (e.g., RPC errors from server).
 */
function hasStringCode(error: Error): error is Error & { code: string } {
  return 'code' in error && typeof (error as Record<string, unknown>)['code'] === 'string'
}

/**
 * Wrap transport errors from capnweb into appropriate rpc.do error types.
 *
 * Converts generic errors thrown by capnweb into:
 * - ConnectionError for network failures, HTTP errors, timeouts
 * - RPCError for server-side RPC errors
 *
 * @internal
 */
export function wrapTransportError(error: unknown): ConnectionError | RPCError {
  if (error instanceof ConnectionError || error instanceof RPCError) {
    return error
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Network errors (fetch failures, DNS, etc.)
    if (
      error.name === 'TypeError' ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('failed to fetch') ||
      message.includes('networkerror')
    ) {
      return new ConnectionError(error.message, 'CONNECTION_FAILED', true)
    }

    // Check for HTTP status code directly on the error object
    const statusCode = getErrorStatusCode(error)

    // Auth failures (401) - use status code or word-boundary regex
    if (statusCode === 401 || /\b401\b/.test(message) || message.includes('unauthorized') || message.includes('authentication failed')) {
      return ConnectionError.authFailed(error.message)
    }

    // Rate limiting (429) - use status code or word-boundary regex
    if (statusCode === 429 || /\b429\b/.test(message) || message.includes('rate limit') || message.includes('too many requests')) {
      return new ConnectionError(error.message, 'CONNECTION_FAILED', true)
    }

    // Server errors (5xx) - retryable; use status code or word-boundary regex
    if ((statusCode !== undefined && statusCode >= 500 && statusCode < 600) || /\b5\d{2}\b/.test(message) || message.includes('internal server error')) {
      return new ConnectionError(error.message, 'CONNECTION_FAILED', true)
    }

    // Client errors (4xx except 401, 429) - typically not retryable, treat as RPC error
    if (
      (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 401 && statusCode !== 429) ||
      (/\b4\d{2}\b/.test(message) && !/\b401\b/.test(message) && !/\b429\b/.test(message))
    ) {
      return new RPCError(error.message, 'REQUEST_ERROR')
    }

    // RPC-level errors from the server (usually have code property)
    if (hasStringCode(error)) {
      return new RPCError(error.message, error.code)
    }

    // Default: treat as RPC error
    return new RPCError(error.message, 'UNKNOWN_ERROR')
  }

  // Non-Error thrown
  return new RPCError(String(error), 'UNKNOWN_ERROR')
}

/**
 * Auth provider function type for HTTP clients
 * Returns a token string or null/undefined
 */
export type AuthProvider = () => string | null | undefined | Promise<string | null | undefined>

/**
 * Options for HTTP transport
 */
export interface HttpTransportOptions {
  /** Authentication token or provider function */
  auth?: string | AuthProvider
  /** Request timeout in milliseconds (default: undefined - no timeout) */
  timeout?: number
}

/**
 * HTTP transport - uses capnweb's HTTP batch protocol
 *
 * This transport uses capnweb's `newHttpBatchRpcSession()` for protocol compatibility
 * with DurableRPC servers. All rpc.do transports now use capnweb protocol.
 *
 * NOTE: Authentication in capnweb uses "in-band authorization" - auth tokens are
 * passed as RPC method parameters (e.g., `api.authenticate(token)`) rather than
 * HTTP headers. The `auth` option is accepted for API consistency but is not
 * directly used by the HTTP batch transport. For WebSocket with reconnection,
 * use `capnweb()` transport with `reconnect: true` which supports first-message auth.
 *
 * @param url - The RPC endpoint URL
 * @param authOrOptions - Either an auth token/provider string, or an options object
 *
 * @example
 * // Basic usage
 * const transport = http('https://api.example.com/rpc')
 *
 * @example
 * // With auth token (for API consistency, but in-band auth is recommended)
 * const transport = http('https://api.example.com/rpc', 'my-token')
 *
 * @example
 * // With timeout
 * const transport = http('https://api.example.com/rpc', { timeout: 5000 })
 *
 * @example
 * // With auth and timeout
 * const transport = http('https://api.example.com/rpc', { auth: 'my-token', timeout: 30000 })
 */
export function http(url: string, authOrOptions?: string | AuthProvider | HttpTransportOptions): Transport {
  // Normalize options - support both legacy (auth) and new (options) signatures
  let timeout: number | undefined

  if (typeof authOrOptions === 'object' && authOrOptions !== null && !('call' in authOrOptions)) {
    // It's an options object
    timeout = authOrOptions.timeout
  }

  // Warn if auth is provided since http() transport does not use it
  if (authOrOptions && (typeof authOrOptions === 'string' || typeof authOrOptions === 'function' ||
      (typeof authOrOptions === 'object' && 'auth' in authOrOptions && authOrOptions.auth))) {
    console.warn('[rpc.do] Warning: auth option is not used by http() transport. Use capnweb() with reconnect: true for authenticated connections, or use in-band auth.')
  }

  // Note: capnweb is a dynamically imported external library with its own type system.
  // We use 'unknown' for the session and navigate it dynamically.
  // Use a promise to prevent concurrent calls from creating multiple sessions.
  let sessionPromise: Promise<unknown> | null = null

  async function getSession(): Promise<unknown> {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        // Load capnweb via centralized loader
        const capnwebModule = await loadCapnweb()
        return capnwebModule.newHttpBatchRpcSession(url)
      })()
    }
    return sessionPromise
  }

  return {
    async call(method: string, args: unknown[]) {
      const session = await getSession()

      // Set up timeout handling
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const timeoutPromise = timeout !== undefined && timeout > 0
        ? new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(ConnectionError.requestTimeout(timeout))
            }, timeout)
          })
        : null

      try {
        // Navigate the session proxy and resolve the target method
        const target = navigateMethodPath(session, method)

        // Call with args
        if (!isFunction(target)) {
          throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
        }

        // Race the call against timeout if timeout is set
        const callPromise = target(...args)
        if (timeoutPromise) {
          return await Promise.race([callPromise, timeoutPromise])
        }
        return await callPromise
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
        }
      }
    },
    close() {
      // Resolve the current session synchronously if available, then dispose
      if (sessionPromise) {
        void sessionPromise.then((session) => {
          if (isNonNullObject(session) && typeof session[Symbol.dispose] === 'function') {
            (session[Symbol.dispose] as () => void)()
          }
        })
      }
      sessionPromise = null
    }
  }
}

/**
 * Service binding transport - for Cloudflare Workers RPC
 *
 * Creates a transport that calls methods directly on a Cloudflare Workers service binding.
 * This enables zero-latency RPC between Workers in the same account without network overhead.
 *
 * @param b - The service binding object from the Worker's env (e.g., `env.MY_SERVICE`)
 * @returns A Transport that routes RPC calls through the service binding
 *
 * @throws {RPCError} With code 'UNKNOWN_NAMESPACE' if the method path navigates to an undefined namespace
 * @throws {RPCError} With code 'UNKNOWN_METHOD' if the final method does not exist or is not callable
 *
 * @example
 * ```typescript
 * // In your Worker
 * import { RPC, binding } from 'rpc.do'
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     // Create RPC client using service binding
 *     const api = RPC(binding(env.MY_SERVICE))
 *
 *     // Call methods on the bound service
 *     const result = await api.users.get('123')
 *     return Response.json(result)
 *   }
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With nested namespaces
 * const api = RPC(binding(env.MY_SERVICE))
 * await api.admin.users.delete('user-id')  // Calls admin.users.delete on the service
 * ```
 */
export function binding(b: unknown): Transport {
  return {
    async call(method: string, args: unknown[]) {
      const methodFn = navigateBindingMethodPath(b, method)
      return methodFn(...args)
    }
  }
}

// ============================================================================
// Capnweb Transport Options
// ============================================================================

/**
 * Options for capnweb transport
 */
export interface CapnwebTransportOptions {
  /**
   * Use WebSocket (true) or HTTP batch (false)
   * @default true
   */
  websocket?: boolean

  /**
   * Authentication token or provider (from oauth.do, static, or custom)
   *
   * For WebSocket mode with reconnect: true, the token is sent via first-message auth.
   * For HTTP batch mode, capnweb uses in-band auth (pass token to RPC methods).
   */
  auth?: string | AuthProvider

  /**
   * Enable reconnection support (WebSocket only)
   * When true, uses ReconnectingWebSocketTransport for resilience
   * @default false
   */
  reconnect?: boolean

  /**
   * Reconnection options (only used when reconnect: true)
   */
  reconnectOptions?: {
    maxReconnectAttempts?: number
    reconnectBackoff?: number
    maxReconnectBackoff?: number
    heartbeatInterval?: number
    onConnect?: () => void
    onDisconnect?: (reason: string) => void
    onReconnecting?: (attempt: number, maxAttempts: number) => void
    onError?: (error: Error) => void
  }

  /**
   * Local RPC target to expose to the server (for bidirectional RPC)
   */
  localMain?: unknown

  /**
   * Allow auth over insecure ws:// connections
   * WARNING: Only for local development
   * @default false
   */
  allowInsecureAuth?: boolean
}

/**
 * Capnweb transport - the recommended transport for RPC
 *
 * Uses capnweb's native protocol for compatibility with DurableRPC servers.
 * Supports both WebSocket and HTTP batch modes, with optional reconnection.
 *
 * Authentication:
 * - WebSocket + reconnect: Uses first-message auth (token sent after connection)
 * - WebSocket (no reconnect): Standard capnweb WebSocket (use in-band auth)
 * - HTTP batch: Uses in-band auth (pass token to RPC methods like `api.auth(token)`)
 *
 * @example
 * ```typescript
 * import { capnweb } from 'rpc.do/transports'
 * import { oauthProvider } from 'rpc.do/auth'
 * import { RPC } from 'rpc.do'
 *
 * // Simple usage
 * const rpc = RPC(capnweb('wss://api.example.com/rpc'))
 *
 * // With oauth.do authentication (WebSocket + reconnection)
 * const rpc = RPC(capnweb('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   reconnect: true, // Required for first-message auth
 * }))
 *
 * // With reconnection support
 * const rpc = RPC(capnweb('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   reconnect: true,
 *   reconnectOptions: {
 *     onConnect: () => console.log('Connected!'),
 *     onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
 *   }
 * }))
 *
 * // HTTP batch mode (use in-band auth)
 * const rpc = RPC(capnweb('https://api.example.com/rpc', {
 *   websocket: false,
 * }))
 * // Then: const authedApi = await rpc.authenticate(token)
 *
 * // Bidirectional RPC (server can call client)
 * const clientHandler = {
 *   notify: (msg: string) => console.log('Server says:', msg)
 * }
 * const rpc = RPC(capnweb('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   reconnect: true,
 *   localMain: clientHandler,
 * }))
 * ```
 */
export function capnweb(
  url: string,
  options?: CapnwebTransportOptions
): Transport {
  const useWebSocket = options?.websocket ?? true
  const useReconnect = options?.reconnect ?? false

  // For reconnecting WebSocket, use the new transport (supports first-message auth)
  if (useWebSocket && useReconnect) {
    return createReconnectingCapnwebTransport(url, options)
  }

  // Note: capnweb is a dynamically imported external library with its own type system.
  // We use 'unknown' for the session and navigate it dynamically.
  // Use a promise to prevent concurrent calls from creating multiple sessions.
  // For non-reconnecting mode, auth is handled via in-band RPC methods
  let sessionPromise: Promise<unknown> | null = null

  async function getSession(): Promise<unknown> {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        // Load capnweb via centralized loader
        const capnwebModule = await loadCapnweb()

        if (useWebSocket) {
          const wsUrl = url.replace(/^http/, 'ws')
          return capnwebModule.newWebSocketRpcSession(wsUrl)
        } else {
          return capnwebModule.newHttpBatchRpcSession(url)
        }
      })()
    }
    return sessionPromise
  }

  return {
    async call(method: string, args: unknown[]) {
      const session = await getSession()

      try {
        // Navigate the session proxy and resolve the target method
        const target = navigateMethodPath(session, method)

        // Call with args
        if (!isFunction(target)) {
          throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
        }
        return await target(...args)
      } catch (error) {
        // Wrap errors from capnweb into appropriate error types
        throw wrapTransportError(error)
      }
    },
    close() {
      // Resolve the current session synchronously if available, then dispose
      if (sessionPromise) {
        void sessionPromise.then((session) => {
          if (isTraversable(session) && typeof session[Symbol.dispose] === 'function') {
            (session[Symbol.dispose] as () => void)()
          }
        })
      }
      sessionPromise = null
    }
  }
}

/**
 * Create a reconnecting capnweb transport using ReconnectingWebSocketTransport
 */
function createReconnectingCapnwebTransport(
  url: string,
  options?: CapnwebTransportOptions
): Transport {
  // Use a promise to prevent concurrent calls from creating multiple sessions.
  let sessionPromise: Promise<unknown> | null = null
  let transport: { close: () => void } | null = null

  async function getSession(): Promise<unknown> {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        // Load modules in parallel via centralized loader
        const [capnwebModule, { ReconnectingWebSocketTransport }] = await Promise.all([
          loadCapnweb(),
          import('./transports/reconnecting-ws.js')
        ])

        // Create reconnecting transport with first-message auth
        const wsUrl = url.replace(/^http/, 'ws')
        const authProvider: AuthProvider | undefined = typeof options?.auth === 'function'
          ? options.auth
          : options?.auth
          ? () => options.auth as string
          : undefined

        const reconnectTransport = new ReconnectingWebSocketTransport(wsUrl, {
          ...(authProvider ? { auth: authProvider } : {}),
          ...(options?.allowInsecureAuth !== undefined ? { allowInsecureAuth: options.allowInsecureAuth } : {}),
          ...options?.reconnectOptions,
        })

        transport = reconnectTransport

        // Create RpcSession with the transport
        const rpcSession = new capnwebModule.RpcSession(reconnectTransport, options?.localMain)
        return rpcSession.getRemoteMain()
      })()
    }
    return sessionPromise
  }

  return {
    async call(method: string, args: unknown[]) {
      const session = await getSession()

      try {
        // Navigate the session proxy and resolve the target method
        const target = navigateMethodPath(session, method)

        // Call with args
        if (!isFunction(target)) {
          throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
        }
        return await target(...args)
      } catch (error) {
        // Wrap errors from capnweb into appropriate error types
        throw wrapTransportError(error)
      }
    },
    close() {
      transport?.close()
      sessionPromise = null
      transport = null
    }
  }
}

/**
 * Composite transport - try multiple transports with fallback
 *
 * Creates a transport that attempts RPC calls through multiple transports in order.
 * If one transport fails, the next transport is tried. This enables resilient RPC
 * with automatic fallback between different connection methods.
 *
 * @param transports - One or more Transport instances to try in order
 * @returns A Transport that tries each transport until one succeeds
 *
 * @throws The last error encountered if all transports fail
 *
 * @example
 * ```typescript
 * import { RPC, composite, capnweb, http } from 'rpc.do'
 *
 * // Try WebSocket first, fall back to HTTP if WebSocket fails
 * const transport = composite(
 *   capnweb('wss://api.example.com/rpc', { reconnect: true }),
 *   http('https://api.example.com/rpc')
 * )
 *
 * const $ = RPC(transport)
 * await $.users.get('123')  // Tries WebSocket, falls back to HTTP on error
 * ```
 *
 * @example
 * ```typescript
 * // Multi-region failover
 * const transport = composite(
 *   http('https://us-east.api.example.com/rpc'),
 *   http('https://eu-west.api.example.com/rpc'),
 *   http('https://ap-south.api.example.com/rpc')
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Local development with production fallback
 * const transport = composite(
 *   http('http://localhost:8787/rpc'),  // Local dev server
 *   http('https://api.example.com/rpc')  // Production fallback
 * )
 * ```
 */
export function composite(...transports: Transport[]): Transport {
  return {
    async call(method: string, args: unknown[]) {
      let lastError: unknown
      for (const transport of transports) {
        try {
          return await transport.call(method, args)
        } catch (e) {
          lastError = e
        }
      }
      throw lastError
    },
    close() {
      for (const transport of transports) {
        transport.close?.()
      }
    }
  }
}

// ============================================================================
// Re-exports
// ============================================================================

// Export reconnecting transport for direct use
export {
  ReconnectingWebSocketTransport,
  reconnectingWs,
  createRpcSession,
  type ConnectionState,
  type ConnectionEventHandlers,
  type ReconnectingWebSocketOptions,
  type RpcSessionOptions,
} from './transports/reconnecting-ws.js'

// Export middleware wrappers for transport composition
export { withMiddleware, withRetry, type RetryOptions } from './middleware/index.js'
export {
  withBatching,
  withDebouncedBatching,
  type BatchingOptions,
  type BatchedRequest,
  type BatchedResponse,
} from './middleware/batching.js'

// ============================================================================
// Transport Factory Pattern
// ============================================================================

/**
 * Transport type discriminator for factory pattern
 */
export type TransportType = 'http' | 'capnweb' | 'binding' | 'composite'

/**
 * Base transport configuration
 */
interface TransportConfigBase {
  type: TransportType
}

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig extends TransportConfigBase {
  type: 'http'
  url: string
  auth?: string | AuthProvider
  timeout?: number
}

/**
 * Capnweb transport configuration
 */
export interface CapnwebTransportConfig extends TransportConfigBase {
  type: 'capnweb'
  url: string
  websocket?: boolean
  auth?: string | AuthProvider
  reconnect?: boolean
  reconnectOptions?: CapnwebTransportOptions['reconnectOptions']
  localMain?: unknown
  allowInsecureAuth?: boolean
}

/**
 * Binding transport configuration
 */
export interface BindingTransportConfig extends TransportConfigBase {
  type: 'binding'
  binding: unknown
}

/**
 * Composite transport configuration
 */
export interface CompositeTransportConfig extends TransportConfigBase {
  type: 'composite'
  transports: Transport[]
}

/**
 * Union of all transport configurations
 */
export type TransportConfig =
  | HttpTransportConfig
  | CapnwebTransportConfig
  | BindingTransportConfig
  | CompositeTransportConfig

/**
 * Transport factory namespace - unified transport creation
 *
 * Provides a cleaner, unified API for creating transports. All existing
 * factory functions (http, capnweb, binding, composite) continue to work
 * and are the underlying implementation.
 *
 * @example
 * ```typescript
 * import { Transports } from 'rpc.do'
 *
 * // Create HTTP transport
 * const httpTransport = Transports.create({
 *   type: 'http',
 *   url: 'https://api.example.com/rpc',
 *   auth: 'my-token',
 *   timeout: 5000,
 * })
 *
 * // Create capnweb WebSocket transport with reconnection
 * const wsTransport = Transports.create({
 *   type: 'capnweb',
 *   url: 'wss://api.example.com/rpc',
 *   auth: () => getToken(),
 *   reconnect: true,
 * })
 *
 * // Create binding transport (Cloudflare Workers)
 * const bindingTransport = Transports.create({
 *   type: 'binding',
 *   binding: env.MY_SERVICE,
 * })
 *
 * // Create composite transport with fallback
 * const compositeTransport = Transports.create({
 *   type: 'composite',
 *   transports: [wsTransport, httpTransport],
 * })
 *
 * // Use with RPC
 * const $ = RPC(httpTransport)
 * ```
 *
 * @example
 * ```typescript
 * // Shorthand factory methods
 * const t1 = Transports.http('https://api.example.com/rpc', { timeout: 5000 })
 * const t2 = Transports.capnweb('wss://api.example.com/rpc', { reconnect: true })
 * const t3 = Transports.binding(env.MY_SERVICE)
 * const t4 = Transports.composite(t1, t2)
 * ```
 */
export const Transports = {
  /**
   * Create a transport from a configuration object
   *
   * @param config - Transport configuration with type discriminator
   * @returns A Transport instance
   *
   * @example
   * ```typescript
   * const transport = Transports.create({
   *   type: 'http',
   *   url: 'https://api.example.com/rpc',
   *   timeout: 5000,
   * })
   * ```
   */
  create(config: TransportConfig): import('./types').Transport {
    switch (config.type) {
      case 'http': {
        const opts: HttpTransportOptions = {}
        if (config.auth !== undefined) opts.auth = config.auth
        if (config.timeout !== undefined) opts.timeout = config.timeout
        return http(config.url, Object.keys(opts).length > 0 ? opts : undefined)
      }

      case 'capnweb': {
        const opts: CapnwebTransportOptions = {}
        if (config.websocket !== undefined) opts.websocket = config.websocket
        if (config.auth !== undefined) opts.auth = config.auth
        if (config.reconnect !== undefined) opts.reconnect = config.reconnect
        if (config.reconnectOptions !== undefined) opts.reconnectOptions = config.reconnectOptions
        if (config.localMain !== undefined) opts.localMain = config.localMain
        if (config.allowInsecureAuth !== undefined) opts.allowInsecureAuth = config.allowInsecureAuth
        return capnweb(config.url, Object.keys(opts).length > 0 ? opts : undefined)
      }

      case 'binding':
        return binding(config.binding)

      case 'composite':
        return composite(...config.transports)

      default: {
        // Exhaustive type check
        const _exhaustive: never = config
        throw new RPCError(`Unknown transport type: ${(_exhaustive as TransportConfig).type}`, 'INVALID_TRANSPORT')
      }
    }
  },

  /**
   * Create an HTTP transport
   *
   * Shorthand for `Transports.create({ type: 'http', ... })`
   *
   * @param url - The RPC endpoint URL
   * @param options - Optional HTTP transport options
   * @returns A Transport instance
   */
  http(url: string, options?: HttpTransportOptions): import('./types').Transport {
    return http(url, options)
  },

  /**
   * Create a capnweb transport (WebSocket or HTTP batch)
   *
   * Shorthand for `Transports.create({ type: 'capnweb', ... })`
   *
   * @param url - The RPC endpoint URL
   * @param options - Optional capnweb transport options
   * @returns A Transport instance
   */
  capnweb(url: string, options?: CapnwebTransportOptions): import('./types').Transport {
    return capnweb(url, options)
  },

  /**
   * Create a binding transport for Cloudflare Workers
   *
   * Shorthand for `Transports.create({ type: 'binding', ... })`
   *
   * @param b - The service binding object
   * @returns A Transport instance
   */
  binding(b: unknown): import('./types').Transport {
    return binding(b)
  },

  /**
   * Create a composite transport with fallback support
   *
   * Shorthand for `Transports.create({ type: 'composite', ... })`
   *
   * @param transports - Transports to try in order
   * @returns A Transport instance
   */
  composite(...transports: import('./types').Transport[]): import('./types').Transport {
    return composite(...transports)
  },

  /**
   * Type guard to check if a value is a Transport
   *
   * @param value - Value to check
   * @returns true if value has a `call` method (minimal Transport interface)
   */
  isTransport(value: unknown): value is import('./types').Transport {
    return isNonNullObject(value) && typeof (value as Record<string, unknown>)['call'] === 'function'
  },
} as const
