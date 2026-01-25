/**
 * Built-in transports for rpc.do
 */

import type { Transport } from './index'
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
 */
export type ServerMessage =
  | { id?: number; result: unknown; error?: undefined }
  | { id?: number; result?: undefined; error: { message: string; code?: string; data?: unknown } }

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
  const hasError = 'error' in msg && typeof msg.error === 'object' && msg.error !== null
  return hasResult || hasError
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
 * @param url - The RPC endpoint URL
 * @param authOrOptions - Either an auth token/provider string, or an options object
 *
 * @example
 * // Basic usage
 * const transport = http('https://api.example.com/rpc')
 *
 * @example
 * // With auth token
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
  let auth: string | AuthProvider | undefined
  let timeout: number | undefined

  if (typeof authOrOptions === 'object' && authOrOptions !== null && !('call' in authOrOptions)) {
    // It's an options object
    auth = authOrOptions.auth
    timeout = authOrOptions.timeout
  } else {
    // Legacy: authOrOptions is the auth token/provider directly
    auth = authOrOptions as string | AuthProvider | undefined
  }

  const getAuth = typeof auth === 'function' ? auth : () => auth

  // Note: capnweb is a dynamically imported external library with its own type system.
  // We use 'unknown' for the session and navigate it dynamically.
  let session: unknown = null

  return {
    async call(method: string, args: unknown[]) {
      if (!session) {
        // Dynamic import capnweb (optional dependency)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capnwebModule: Record<string, unknown> = await import('capnweb')

        const createSession = capnwebModule.newHttpBatchRpcSession as ((url: string) => unknown) | undefined
        if (!createSession) throw new RPCError('capnweb.newHttpBatchRpcSession not found', 'MODULE_ERROR')
        session = createSession(url)
      }

      // Get auth token for this call (for future use with capnweb auth)
      const token = await getAuth()
      // Note: capnweb handles auth internally via the session
      // TODO: Pass auth token to capnweb session when supported
      void token // Suppress unused variable warning for now

      // Set up timeout handling
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      let timeoutReject: ((error: Error) => void) | undefined

      const timeoutPromise = timeout !== undefined && timeout > 0
        ? new Promise<never>((_, reject) => {
            timeoutReject = reject
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
        target = (target as Record<string, unknown>)[parts[i]]
        if (!target) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
      }

      const methodName = parts[parts.length - 1]
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
 * @example
 * ```typescript
 * import { capnweb } from 'rpc.do/transports'
 * import { oauthProvider } from 'rpc.do/auth'
 * import { RPC } from 'rpc.do'
 *
 * // Simple usage
 * const rpc = RPC(capnweb('wss://api.example.com/rpc'))
 *
 * // With oauth.do authentication
 * const rpc = RPC(capnweb('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
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
 * // HTTP batch mode (for serverless/edge)
 * const rpc = RPC(capnweb('https://api.example.com/rpc', {
 *   websocket: false,
 *   auth: oauthProvider(),
 * }))
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
  const getAuth = typeof options?.auth === 'function' ? options.auth : () => options?.auth

  // For reconnecting WebSocket, use the new transport
  if (useWebSocket && useReconnect) {
    return createReconnectingCapnwebTransport(url, options)
  }

  // Note: capnweb is a dynamically imported external library with its own type system.
  // We use 'unknown' for the session and navigate it dynamically.
  let session: unknown = null

  return {
    async call(method: string, args: unknown[]) {
      if (!session) {
        // Dynamic import capnweb (optional dependency)
        // capnweb types are not available at compile time, so we use Record<string, unknown>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const capnwebModule: Record<string, unknown> = await import('capnweb')

        if (useWebSocket) {
          const wsUrl = url.replace(/^http/, 'ws')
          const createSession = capnwebModule.newWebSocketRpcSession as ((url: string) => unknown) | undefined
          if (!createSession) throw new RPCError('capnweb.newWebSocketRpcSession not found', 'MODULE_ERROR')
          session = createSession(wsUrl)
        } else {
          const createSession = capnwebModule.newHttpBatchRpcSession as ((url: string) => unknown) | undefined
          if (!createSession) throw new RPCError('capnweb.newHttpBatchRpcSession not found', 'MODULE_ERROR')
          session = createSession(url)
        }
      }

      // Navigate the session proxy
      const parts = method.split('.')
      let target: unknown = session
      for (const part of parts) {
        if (typeof target !== 'object' || target === null) {
          throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
        }
        target = (target as Record<string, unknown>)[part]
      }

      // Call with args
      if (!isFunction(target)) {
        throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
      }
      return target(...args)
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
          import('capnweb'),
          import('./transports/reconnecting-ws.js')
        ])

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const RpcSession = (capnwebModule as any).RpcSession
        if (!RpcSession) {
          throw new RPCError('capnweb.RpcSession not found', 'MODULE_ERROR')
        }

        // Create reconnecting transport
        const wsUrl = url.replace(/^http/, 'ws')
        const authProvider: AuthProvider | undefined = typeof options?.auth === 'function'
          ? options.auth
          : options?.auth
          ? () => options.auth as string
          : undefined

        const reconnectTransport = new ReconnectingWebSocketTransport(wsUrl, {
          auth: authProvider,
          allowInsecureAuth: options?.allowInsecureAuth,
          ...options?.reconnectOptions,
        })

        transport = reconnectTransport

        // Create RpcSession with the transport
        const rpcSession = new RpcSession(reconnectTransport, options?.localMain)
        session = rpcSession.getRemoteMain()
      }

      // Navigate the session proxy
      const parts = method.split('.')
      let target: unknown = session
      for (const part of parts) {
        if (typeof target !== 'object' || target === null) {
          throw new RPCError(`Invalid path: ${part}`, 'INVALID_PATH')
        }
        target = (target as Record<string, unknown>)[part]
      }

      // Call with args
      if (!isFunction(target)) {
        throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
      }
      return target(...args)
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
