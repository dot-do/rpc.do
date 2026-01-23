/**
 * Built-in transports for rpc.do
 */

import type { Transport } from './index'
import { RPCError } from './errors'

/**
 * Auth provider function type for HTTP clients
 * Returns a token string or null/undefined
 */
export type AuthProvider = () => string | null | undefined | Promise<string | null | undefined>

/**
 * HTTP transport - simple fetch-based RPC
 */
export function http(url: string, auth?: string | AuthProvider): Transport {
  const getAuth = typeof auth === 'function' ? auth : () => auth

  return {
    async call(method: string, args: any[]) {
      const token = await getAuth()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ method: 'do', path: method, args })
      })

      if (!res.ok) {
        const error = await res.text()
        throw new RPCError(error || `HTTP ${res.status}`, String(res.status))
      }

      return res.json()
    }
  }
}

/**
 * Service binding transport - for Cloudflare Workers RPC
 */
export function binding(b: any): Transport {
  return {
    async call(method: string, args: any[]) {
      const parts = method.split('.')
      let target = b

      // Navigate to the method
      for (let i = 0; i < parts.length - 1; i++) {
        target = target[parts[i]]
        if (!target) throw new RPCError(`Unknown namespace: ${parts.slice(0, i + 1).join('.')}`, 'UNKNOWN_NAMESPACE')
      }

      const methodName = parts[parts.length - 1]
      if (typeof target[methodName] !== 'function') {
        throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
      }

      return target[methodName](...args)
    }
  }
}

/**
 * WebSocket transport - persistent connection
 */
export function ws(url: string, auth?: string | AuthProvider): Transport {
  let socket: WebSocket | null = null
  let messageId = 0
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  let connectPromise: Promise<WebSocket> | null = null

  const getAuth = typeof auth === 'function' ? auth : () => auth

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
            const { id, result, error } = JSON.parse(event.data as string)
            const handler = pending.get(id)
            if (handler) {
              pending.delete(id)
              if (error) handler.reject(new RPCError(error, 'RPC_ERROR'))
              else handler.resolve(result)
            }
          } catch (parseError) {
            // Log the parse error for debugging
            console.error('[rpc.do] WebSocket message parse error:', parseError)
            console.error('[rpc.do] Raw message data:', event.data)

            // If we can't parse the message, we can't determine which request it belongs to,
            // but we should still surface this error. Emit to any pending handlers wouldn't
            // be correct since we don't know which one. Instead, we throw an RPCError that
            // can be caught by error monitoring.
            const rpcError = new RPCError(
              `Failed to parse WebSocket message: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              'PARSE_ERROR',
              { rawData: typeof event.data === 'string' ? event.data.substring(0, 200) : '[non-string data]' }
            )

            // Dispatch a custom error event on the socket for external error handlers
            sock.dispatchEvent(new CustomEvent('rpc-error', { detail: rpcError }))
          }
        })

        sock.addEventListener('close', () => {
          socket = null
          for (const [, handler] of pending) {
            handler.reject(new RPCError('WebSocket closed', 'CONNECTION_CLOSED'))
          }
          pending.clear()
        })
      })
    })()

    return connectPromise
  }

  return {
    async call(method: string, args: any[]) {
      const sock = await connect()
      const id = ++messageId

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        sock.send(JSON.stringify({ id, method: 'do', path: method, args }))
      })
    },
    close() {
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

  let session: any = null

  return {
    async call(method: string, args: any[]) {
      if (!session) {
        // Dynamic import capnweb (optional dependency)
        const capnwebModule = await import('capnweb') as any

        if (useWebSocket) {
          const wsUrl = url.replace(/^http/, 'ws')
          session = capnwebModule.newWebSocketRpcSession(wsUrl)
        } else {
          session = capnwebModule.newHttpBatchRpcSession(url)
        }
      }

      // Navigate the session proxy
      const parts = method.split('.')
      let target = session
      for (const part of parts) {
        target = target[part]
      }

      // Call with args
      return target(...args)
    },
    close() {
      session?.[Symbol.dispose]?.()
      session = null
    }
  }
}

/**
 * Composite transport - try multiple transports with fallback
 */
export function composite(...transports: Transport[]): Transport {
  return {
    async call(method: string, args: any[]) {
      let lastError: any
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
