/**
 * rpc.do - Lightweight transport-agnostic RPC proxy
 *
 * Core: A Proxy that turns property chains into RPC calls
 * Transport: Pluggable (HTTP, WebSocket, capnweb, service bindings, etc.)
 * Auth: Optional, handled by transport or middleware
 */

// ============================================================================
// Transport Types
// ============================================================================

export type Transport = {
  call(method: string, args: any[]): Promise<any>
  close?(): void
}

export type TransportFactory = () => Transport | Promise<Transport>

// ============================================================================
// RPC Type System
// ============================================================================

/**
 * Defines a single RPC function signature
 * @example
 * type Generate = RPCFunction<{ prompt: string }, { text: string }>
 */
export type RPCFunction<TInput = any, TOutput = any> = (input: TInput) => TOutput

/**
 * Converts a sync function to async
 */
export type AsyncFunction<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never

/**
 * Recursively converts an API definition to async proxy type
 * @example
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 * }
 * type Client = RPCProxy<API>
 * // Client.ai.generate is now (p: { prompt: string }) => Promise<{ text: string }>
 */
export type RPCProxy<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? AsyncFunction<T[K]>
    : T[K] extends object
    ? RPCProxy<T[K]> & { close?: () => Promise<void> }
    : T[K]
} & {
  close?: () => Promise<void>
}

/**
 * Explicit promise type for RPC returns
 * @example
 * const result: RPCPromise<{ text: string }> = rpc.ai.generate({ prompt: 'hello' })
 */
export type RPCPromise<T> = Promise<T>

/**
 * Infer the return type of an RPC function
 * @example
 * type Result = RPCResult<typeof rpc.ai.generate> // { text: string }
 */
export type RPCResult<T> = T extends (...args: any[]) => Promise<infer R> ? R : never

/**
 * Infer the input type of an RPC function
 * @example
 * type Params = RPCInput<typeof rpc.ai.generate> // { prompt: string }
 */
export type RPCInput<T> = T extends (input: infer I) => any ? I : never

// ============================================================================
// RPC Factory
// ============================================================================

/**
 * Create an RPC proxy over any transport
 *
 * @example
 * // Untyped (any)
 * const rpc = RPC(http('https://rpc.do'))
 * await rpc.ai.generate({ prompt: 'hello' })
 *
 * @example
 * // Typed API
 * interface API {
 *   ai: { generate: (p: { prompt: string }) => { text: string } }
 *   db: { get: (p: { id: string }) => { data: any } }
 * }
 * const rpc = RPC<API>(http('https://rpc.do'))
 * const result = await rpc.ai.generate({ prompt: 'hello' }) // typed!
 */
export function RPC<T = any>(transport: Transport | TransportFactory): RPCProxy<T> {
  let _transport: Transport | null = null
  let _transportPromise: Promise<Transport> | null = null

  const getTransport = async (): Promise<Transport> => {
    if (_transport) return _transport
    if (_transportPromise) return _transportPromise

    if (typeof transport === 'function') {
      _transportPromise = Promise.resolve(transport())
      _transport = await _transportPromise
      _transportPromise = null
    } else {
      _transport = transport
    }
    return _transport
  }

  const createMethodProxy = (path: string[]): any => {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined // Not a promise
        }
        // Only handle close/dispose at root level to allow user.account.close() etc
        if (path.length === 0 && (prop === Symbol.dispose as any || prop === 'close')) {
          return async () => {
            const t = await getTransport()
            t.close?.()
          }
        }
        return createMethodProxy([...path, prop])
      },
      apply(_, __, args: any[]) {
        return (async () => {
          const t = await getTransport()
          return t.call(path.join('.'), args)
        })()
      }
    })
  }

  return createMethodProxy([]) as RPCProxy<T>
}

// Re-export transports and auth
export * from './transports'
export { auth } from './auth'

// ============================================================================
// Default RPC Client
// ============================================================================

import { http } from './transports'
import { auth } from './auth'

/**
 * Pre-configured RPC client for rpc.do with default auth
 *
 * @example
 * import { $ } from 'rpc.do'
 * // or
 * import $ from 'rpc.do'
 *
 * await $.ai.generate({ prompt: 'hello' })
 * await $.db.get({ id: '123' })
 */
export const $ = RPC(http('https://rpc.do', auth()))

export default $
