/**
 * Built-in transports for rpc.do
 */

import type { Transport } from './index'
import type { ServerMessage as TypesServerMessage } from '@dotdo/types/rpc'
import { ConnectionError, RPCError } from './errors'

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
 * Type guard for WebSocket server messages
 */
export function isServerMessage(data: unknown): data is ServerMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const msg = data as Record<string, unknown>
  // Must have either result or error (but not both as valid data)
  const hasResult = 'result' in msg
  const errorVal = msg['error']
  const hasError = 'error' in msg && typeof errorVal === 'object' && errorVal !== null
  return hasResult || hasError
}

// ============================================================================
// Error Wrapping
// ============================================================================

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

    // Auth failures (401)
    if (message.includes('401') || message.includes('unauthorized') || message.includes('authentication failed')) {
      return ConnectionError.authFailed(error.message)
    }

    // Rate limiting (429)
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return new ConnectionError(error.message, 'CONNECTION_FAILED', true)
    }

    // Server errors (5xx) - retryable
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504') || message.includes('internal server error')) {
      return new ConnectionError(error.message, 'CONNECTION_FAILED', true)
    }

    // Client errors (4xx except 401, 429) - typically not retryable, treat as RPC error
    if (/\b4\d{2}\b/.test(message) && !message.includes('401') && !message.includes('429')) {
      return new RPCError(error.message, 'REQUEST_ERROR')
    }

    // RPC-level errors from the server (usually have code property)
    if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
      return new RPCError(error.message, (error as { code: string }).code)
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
  // Note: auth is accepted for API consistency but not used - see function docs

  // Note: capnweb is a dynamically imported external library with its own type system.
  // We use 'unknown' for the session and navigate it dynamically.
  let session: unknown = null

  return {
    async call(method: string, args: unknown[]) {
      if (!session) {
        // Dynamic import capnweb (optional dependency)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capnwebModule: Record<string, unknown> = await import('@dotdo/capnweb')

        const createSession = capnwebModule['newHttpBatchRpcSession'] as ((url: string) => unknown) | undefined
        if (!createSession) throw new RPCError('capnweb.newHttpBatchRpcSession not found', 'MODULE_ERROR')
        session = createSession(url)
      }

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
        // Navigate the session proxy
        const parts = method.split('.')
        let target: unknown = session
        for (const part of parts) {
          // Allow both objects and functions (capnweb returns proxy functions that are traversable)
          if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
            throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
          }
          target = (target as Record<string, unknown>)[part]
        }

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
      if (session && typeof session === 'object' && session !== null) {
        const disposable = session as { [Symbol.dispose]?: () => void }
        disposable[Symbol.dispose]?.()
      }
      session = null
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
      const parts = method.split('.')
      let target: unknown = b

      // Navigate to the method
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof target !== 'object' || target === null) {
          throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
        }
        const partName = parts[i]
        if (!partName) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
        target = (target as Record<string, unknown>)[partName]
        if (!target) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
      }

      const methodName = parts[parts.length - 1]
      if (!methodName) {
        throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
      }
      if (typeof target !== 'object' || target === null) {
        throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
      }
      const methodFn = (target as Record<string, unknown>)[methodName]
      if (!isFunction(methodFn)) {
        throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
      }

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
  // For non-reconnecting mode, auth is handled via in-band RPC methods
  let session: unknown = null

  return {
    async call(method: string, args: unknown[]) {
      if (!session) {
        // Dynamic import capnweb (optional dependency)
        // capnweb types are not available at compile time, so we use Record<string, unknown>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capnwebModule: Record<string, unknown> = await import('@dotdo/capnweb')

        if (useWebSocket) {
          const wsUrl = url.replace(/^http/, 'ws')
          const createSession = capnwebModule['newWebSocketRpcSession'] as ((url: string) => unknown) | undefined
          if (!createSession) throw new RPCError('capnweb.newWebSocketRpcSession not found', 'MODULE_ERROR')
          session = createSession(wsUrl)
        } else {
          const createSession = capnwebModule['newHttpBatchRpcSession'] as ((url: string) => unknown) | undefined
          if (!createSession) throw new RPCError('capnweb.newHttpBatchRpcSession not found', 'MODULE_ERROR')
          session = createSession(url)
        }
      }

      try {
        // Navigate the session proxy
        const parts = method.split('.')
        let target: unknown = session
        for (const part of parts) {
          // Allow both objects and functions (capnweb returns proxy functions that are traversable)
          if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
            throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
          }
          target = (target as Record<string, unknown>)[part]
        }

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
      if (session && (typeof session === 'object' || typeof session === 'function') && session !== null) {
        const disposable = session as { [Symbol.dispose]?: () => void }
        disposable[Symbol.dispose]?.()
      }
      session = null
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
  let session: unknown = null
  let transport: { close: () => void } | null = null

  return {
    async call(method: string, args: unknown[]) {
      if (!session) {
        // Dynamic imports
        const [capnwebModule, { ReconnectingWebSocketTransport }] = await Promise.all([
          import('@dotdo/capnweb'),
          import('./transports/reconnecting-ws.js')
        ])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const RpcSession = (capnwebModule as any).RpcSession
        if (!RpcSession) {
          throw new RPCError('capnweb.RpcSession not found', 'MODULE_ERROR')
        }

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
        const rpcSession = new RpcSession(reconnectTransport, options?.localMain)
        session = rpcSession.getRemoteMain()
      }

      try {
        // Navigate the session proxy
        const parts = method.split('.')
        let target: unknown = session
        for (const part of parts) {
          // Allow both objects and functions (capnweb returns proxy functions that are traversable)
          if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
            throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
          }
          target = (target as Record<string, unknown>)[part]
        }

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
      session = null
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
