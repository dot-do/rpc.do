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
  type RpcTransport,
  type RpcSessionOptions,
  HibernatableWebSocketTransport,
  TransportRegistry,
} from '@dotdo/capnweb/server'
import { SKIP_PROPS_BASE } from './rpc-interface.js'

// Shared base class
import { DurableRPCBase } from './base.js'

// Re-export capnweb types
export { RpcTarget, RpcSession, type RpcTransport, type RpcSessionOptions }
export { HibernatableWebSocketTransport, TransportRegistry }

// Re-export WebSocket state types and utilities
export {
  type WebSocketState,
  type WebSocketAttachment,
  isWebSocketAttachment,
  createWebSocketAttachment,
  transitionWebSocketState,
  getWebSocketAttachment,
} from './websocket-state.js'

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
// DurableRPC Lite - Minimal Implementation
// ============================================================================

/**
 * Minimal RPC-enabled Durable Object base class.
 * No colo.do, no collections - just RPC handling.
 */
export class DurableRPC extends DurableRPCBase {
  protected getSkipProps(): Set<string> {
    return SKIP_PROPS_BASE
  }

  protected getBasePrototype(): object {
    return DurableRPC.prototype
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
    while (proto && proto !== DurableRPC.prototype && proto !== DurableRPCBase.prototype) {
      collectProps(proto)
      proto = Object.getPrototypeOf(proto)
    }

    return { version: 1, methods, namespaces }
  }
}
