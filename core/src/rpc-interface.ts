/**
 * Shared RPC Interface implementation
 *
 * This module contains the RpcInterface class and SKIP_PROPS constant
 * used by both index.ts (full) and lite.ts (minimal) entry points.
 */

import { RpcTarget } from '@dotdo/capnweb/server'

// ============================================================================
// Skip Props - Properties to exclude from RPC exposure
// ============================================================================

/**
 * Base properties to skip during introspection.
 * Used by lite.ts - the minimal DurableRPC implementation.
 */
export const SKIP_PROPS_BASE = new Set([
  // DurableObject lifecycle
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  // DurableRPC internals
  'constructor',
  'getSchema',
  'broadcast',
  'connectionCount',
  'sql',
  'storage',
  'state',
  'ctx',
  'env',
  '_currentRequest',
  '_transportRegistry',
  '_sessions',
  '_rpcInterface',
  'handleWebSocketUpgrade',
  'handleHttpRpc',
  'getRpcInterface',
  'getRpcSessionOptions',
])

/**
 * Extended properties to skip - includes colo, collections, and internal RPC methods.
 * Used by index.ts - the full DurableRPC implementation.
 */
export const SKIP_PROPS_EXTENDED = new Set([
  ...SKIP_PROPS_BASE,
  // Full DurableRPC internals
  '$',
  '_currentAuth',
  '_colo',
  // Colo helpers (internal use)
  'colo',
  'coloInfo',
  'getColosByDistance',
  'findNearestColo',
  'estimateLatencyTo',
  'distanceTo',
  // RPC internal methods (exposed but not in schema)
  '__sql',
  '__sqlFirst',
  '__sqlRun',
  '__storageGet',
  '__storageGetMultiple',
  '__storagePut',
  '__storagePutMultiple',
  '__storageDelete',
  '__storageDeleteMultiple',
  '__storageList',
  '__dbSchema',
  '__storageKeys',
  // Collection methods
  '__collectionGet',
  '__collectionPut',
  '__collectionDelete',
  '__collectionHas',
  '__collectionFind',
  '__collectionCount',
  '__collectionList',
  '__collectionKeys',
  '__collectionClear',
  '__collectionNames',
  '__collectionStats',
  'collection',
  '_collections',
])

// ============================================================================
// RPC Interface - Wrapper for RpcTarget
// ============================================================================

/**
 * Interface for DurableRPC instances that can be wrapped by RpcInterface
 */
export interface RpcWrappable {
  getSchema(): unknown
}

/**
 * Configuration for RpcInterface
 */
export interface RpcInterfaceConfig<T extends RpcWrappable> {
  /** The DurableRPC instance to wrap */
  instance: T
  /** Properties to skip during exposure */
  skipProps: Set<string>
  /** The base prototype to stop at when walking the prototype chain */
  basePrototype: object
}

/**
 * Wraps a DurableRPC instance as an RpcTarget for capnweb
 *
 * This is necessary because:
 * 1. DurableRPC extends DurableObject, not RpcTarget
 * 2. We need to control which methods are exposed over RPC
 * 3. We want to preserve the $ context access pattern
 */
export class RpcInterface<T extends RpcWrappable> extends RpcTarget {
  private durableRpc: T

  constructor(config: RpcInterfaceConfig<T>) {
    super()
    this.durableRpc = config.instance
    this.exposeInterface(config.skipProps, config.basePrototype)
  }

  private exposeInterface(skipProps: Set<string>, basePrototype: object): void {
    const instance = this.durableRpc
    const seen = new Set<string>()

    // Collect properties from instance and prototype chain
    const collectProps = (obj: unknown) => {
      if (!obj || obj === Object.prototype) return
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (!seen.has(key) && !skipProps.has(key) && !key.startsWith('_')) {
          seen.add(key)

          let value: unknown
          try {
            value = (instance as Record<string, unknown>)[key]
          } catch {
            continue
          }

          if (typeof value === 'function') {
            // Bind method to the DurableRPC instance
            Object.defineProperty(this, key, {
              value: (value as (...args: unknown[]) => unknown).bind(instance),
              enumerable: true,
              configurable: true,
            })
          } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Check if it's a namespace (object with function properties)
            const valueObj = value as Record<string, unknown>
            const hasMethodKeys = Object.keys(valueObj).some(k => typeof valueObj[k] === 'function')
            if (hasMethodKeys) {
              // Create a namespace object with bound methods
              const namespace: Record<string, (...args: unknown[]) => unknown> = {}
              for (const nsKey of Object.keys(valueObj)) {
                if (typeof valueObj[nsKey] === 'function') {
                  namespace[nsKey] = (valueObj[nsKey] as (...args: unknown[]) => unknown).bind(valueObj)
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
      }
    }

    // Walk instance own props first, then prototype chain
    collectProps(instance)
    let proto = Object.getPrototypeOf(instance)
    while (proto && proto !== basePrototype && proto !== Object.prototype) {
      collectProps(proto)
      proto = Object.getPrototypeOf(proto)
    }
  }

  /**
   * Schema reflection method - always available
   */
  __schema(): unknown {
    return this.durableRpc.getSchema()
  }
}
