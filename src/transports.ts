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
 * Type guard for WebSocket server messages
 */
export function isServerMessage(data: unknown): data is { id?: number; result?: unknown; error?: unknown } {
  return typeof data === 'object' && data !== null
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
 * HTTP transport - simple fetch-based RPC
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

  return {
    async call(method: string, args: unknown[]) {
      const token = await getAuth()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      // Set up abort controller for timeout
      let abortController: AbortController | undefined
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      if (timeout !== undefined && timeout > 0) {
        abortController = new AbortController()
        timeoutId = setTimeout(() => {
          abortController!.abort()
        }, timeout)
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ method: 'do', path: method, args }),
          signal: abortController?.signal
        })

        if (!res.ok) {
          const error = await res.text()
          throw new RPCError(error || `HTTP ${res.status}`, String(res.status))
        }

        return res.json()
      } catch (error) {
        // Check if this is an abort error (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          throw ConnectionError.requestTimeout(timeout!)
        }
        throw error
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId)
        }
      }
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

/**
 * Options for basic WebSocket transport
 */
export interface WsTransportOptions {
  /** Authentication token or provider function */
  auth?: string | AuthProvider
  /** Request timeout in milliseconds (default: undefined - no timeout) */
  timeout?: number
}

/**
 * WebSocket transport - persistent connection
 *
 * @param url - The WebSocket endpoint URL (can also be http/https, will be converted)
 * @param authOrOptions - Either an auth token/provider string, or an options object
 *
 * @example
 * // Basic usage
 * const transport = ws('wss://api.example.com/rpc')
 *
 * @example
 * // With auth token
 * const transport = ws('wss://api.example.com/rpc', 'my-token')
 *
 * @example
 * // With timeout
 * const transport = ws('wss://api.example.com/rpc', { timeout: 30000 })
 *
 * @example
 * // With auth and timeout
 * const transport = ws('wss://api.example.com/rpc', { auth: 'my-token', timeout: 30000 })
 */
export function ws(url: string, authOrOptions?: string | AuthProvider | WsTransportOptions): Transport {
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

  let socket: WebSocket | null = null
  let messageId = 0
  const pending = new Map<number, {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    timeoutId?: ReturnType<typeof setTimeout>
  }>()
  let connectPromise: Promise<WebSocket> | null = null

  const getAuth = typeof auth === 'function' ? auth : () => auth

  /**
   * Clear timeout for a pending request
   */
  const clearPendingTimeout = (id: number) => {
    const handler = pending.get(id)
    if (handler?.timeoutId !== undefined) {
      clearTimeout(handler.timeoutId)
    }
  }

  const connect = async (): Promise<WebSocket> => {
    if (socket?.readyState === WebSocket.OPEN) return socket
    if (connectPromise) return connectPromise

    connectPromise = (async () => {
      const token = await getAuth()
      const wsUrl = new URL(url.replace(/^http/, 'ws'))
      if (token) {
        console.warn('[rpc.do] Warning: Basic WebSocket transport sends auth token in URL. Consider using wsAdvanced() for better security with first-message authentication.')
        wsUrl.searchParams.set('token', token)
      }

      return new Promise<WebSocket>((resolve, reject) => {
        const sock = new WebSocket(wsUrl.toString())

        sock.addEventListener('open', () => {
          socket = sock
          connectPromise = null
          resolve(sock)
        })

        sock.addEventListener('error', (e: Event) => {
          connectPromise = null
          reject(e)
        })

        sock.addEventListener('message', (event: MessageEvent) => {
          try {
            const data: unknown = JSON.parse(event.data as string)
            if (!isServerMessage(data)) {
              throw new Error('Invalid server message format')
            }
            const { id, result, error } = data
            if (id === undefined) return
            const handler = pending.get(id)
            if (handler) {
              clearPendingTimeout(id)
              pending.delete(id)
              if (error) handler.reject(new RPCError(String(error), 'RPC_ERROR'))
              else handler.resolve(result)
            }
          } catch (parseError) {
            // Log the parse error for debugging
            console.error('[rpc.do] WebSocket message parse error:', parseError)
            console.error('[rpc.do] Raw message data:', event.data)

            const rpcError = new RPCError(
              `Failed to parse WebSocket message: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              'PARSE_ERROR',
              { rawData: typeof event.data === 'string' ? event.data.substring(0, 200) : '[non-string data]' }
            )

            // Dispatch a custom error event on the socket for external error handlers
            sock.dispatchEvent(new CustomEvent('rpc-error', { detail: rpcError }))

            // Since we cannot determine which request this malformed response was for,
            // reject ALL pending requests to prevent them from hanging forever.
            // This is the safest approach - the alternative (doing nothing) leaves
            // requests stuck until socket close or timeout (if any).
            for (const [pendingId, pendingHandler] of pending) {
              clearPendingTimeout(pendingId)
              pending.delete(pendingId)
              pendingHandler.reject(rpcError)
            }
          }
        })

        sock.addEventListener('close', () => {
          socket = null
          for (const [id, handler] of pending) {
            clearPendingTimeout(id)
            handler.reject(new RPCError('WebSocket closed', 'CONNECTION_CLOSED'))
          }
          pending.clear()
        })
      })
    })()

    return connectPromise
  }

  return {
    async call(method: string, args: unknown[]) {
      const sock = await connect()
      const id = ++messageId

      return new Promise((resolve, reject) => {
        // Set up timeout if configured
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        if (timeout !== undefined && timeout > 0) {
          timeoutId = setTimeout(() => {
            const handler = pending.get(id)
            if (handler) {
              pending.delete(id)
              handler.reject(ConnectionError.requestTimeout(timeout))
            }
          }, timeout)
        }

        pending.set(id, { resolve, reject, timeoutId })
        sock.send(JSON.stringify({ id, method: 'do', path: method, args }))
      })
    },
    close() {
      // Clear all pending timeouts before closing
      for (const [id] of pending) {
        clearPendingTimeout(id)
      }
      socket?.close()
      socket = null
    }
  }
}

/**
 * Capnweb transport - for full capnweb RPC features
 */
export function capnweb(
  url: string,
  options?: { websocket?: boolean; auth?: string | AuthProvider }
): Transport {
  const useWebSocket = options?.websocket ?? true
  const getAuth = typeof options?.auth === 'function' ? options.auth : () => options?.auth

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
