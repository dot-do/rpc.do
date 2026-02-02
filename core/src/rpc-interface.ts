/**
 * Shared RPC Interface implementation
 *
 * This module contains the RpcInterface class and SKIP_PROPS constant
 * used by both index.ts (full) and lite.ts (minimal) entry points.
 */

import { RpcTarget } from '@dotdo/capnweb/server'
import { INTERNAL_METHOD_NAMES } from './constants.js'
import {
  type ServerMiddleware,
  type MiddlewareContext,
  wrapWithMiddleware,
} from './middleware.js'

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
  'middleware', // Server-side middleware hooks
  '_currentRequest',
  '_transportRegistry',
  '_sessions',
  '_rpcInterface',
  'handleWebSocketUpgrade',
  'handleHttpRpc',
  'getRpcInterface',
  'getRpcSessionOptions',
  // DurableRPCBase abstract/protected methods
  'getSkipProps',
  'getBasePrototype',
  'onFetch',
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
  ...INTERNAL_METHOD_NAMES,
  'collection',
  '_collections',
])

// ============================================================================
// Shared Utility Functions
// ============================================================================

/**
 * Check if an object has functions at any nesting level.
 * Used to determine if an object should be wrapped as a namespace.
 */
export function hasNestedFunctions(obj: Record<string, unknown>, maxDepth = 5): boolean {
  if (maxDepth <= 0) return false
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (typeof value === 'function') return true
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (hasNestedFunctions(value as Record<string, unknown>, maxDepth - 1)) return true
    }
  }
  return false
}

/**
 * Collected methods and namespaces from object introspection
 */
export interface CollectedInterfaceProperties {
  methods: Record<string, Function>
  namespaces: Record<string, Record<string, Function>>
}

/**
 * Collect methods and namespaces from an instance and its prototype chain.
 * Stops at the specified base prototype.
 */
export function collectInterfaceProperties(
  instance: object,
  skipProps: Set<string>,
  basePrototype: object
): CollectedInterfaceProperties {
  const methods: Record<string, Function> = {}
  const namespaces: Record<string, Record<string, Function>> = {}
  const seen = new Set<string>()

  const collectProps = (obj: unknown) => {
    if (!obj || obj === Object.prototype) return
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (seen.has(key) || skipProps.has(key) || key.startsWith('_')) continue
      seen.add(key)

      let value: unknown
      try {
        value = (instance as Record<string, unknown>)[key]
      } catch {
        continue
      }

      if (typeof value === 'function') {
        methods[key] = (value as Function).bind(instance)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const valueObj = value as Record<string, unknown>
        if (hasNestedFunctions(valueObj, 1)) {
          // Create a namespace object with bound methods (shallow)
          const namespace: Record<string, Function> = {}
          for (const nsKey of Object.keys(valueObj)) {
            if (typeof valueObj[nsKey] === 'function') {
              namespace[nsKey] = (valueObj[nsKey] as Function).bind(valueObj)
            }
          }
          namespaces[key] = namespace
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

  return { methods, namespaces }
}

/**
 * Define collected properties on an instance
 */
export function defineInstanceProperties(
  target: object,
  collected: CollectedInterfaceProperties
): void {
  // Define methods
  for (const [key, fn] of Object.entries(collected.methods)) {
    Object.defineProperty(target, key, {
      value: fn,
      enumerable: true,
      configurable: true,
    })
  }

  // Define namespaces
  for (const [key, namespace] of Object.entries(collected.namespaces)) {
    Object.defineProperty(target, key, {
      value: namespace,
      enumerable: true,
      configurable: true,
    })
  }
}

// ============================================================================
// RPC Interface - Wrapper for RpcTarget
// ============================================================================

/**
 * Interface for DurableRPC instances that can be wrapped by RpcInterface
 */
export interface RpcWrappable {
  getSchema(): unknown
  /** Optional middleware array for server-side hooks */
  middleware?: ServerMiddleware[]
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
  /** Function to get the current request (for middleware context) */
  getRequest?: () => Request | undefined
  /** Function to get the environment bindings (for middleware context) */
  getEnv?: () => unknown
}

/**
 * Wraps a DurableRPC instance as an RpcTarget for capnweb
 *
 * This is necessary because:
 * 1. DurableRPC extends DurableObject, not RpcTarget
 * 2. We need to control which methods are exposed over RPC
 * 3. We want to preserve the $ context access pattern
 * 4. We need to wrap methods with middleware hooks
 */
export class RpcInterface<T extends RpcWrappable> extends RpcTarget {
  private durableRpc: T
  private getRequest?: () => Request | undefined
  private getEnv?: () => unknown

  constructor(config: RpcInterfaceConfig<T>) {
    super()
    this.durableRpc = config.instance
    this.getRequest = config.getRequest
    this.getEnv = config.getEnv
    const collected = collectInterfaceProperties(
      config.instance,
      config.skipProps,
      config.basePrototype
    )
    this.definePropertiesWithMiddleware(collected)
  }

  /**
   * Define properties with middleware wrapping if middleware is configured
   */
  private definePropertiesWithMiddleware(collected: CollectedInterfaceProperties): void {
    const middleware = this.durableRpc.middleware ?? []
    const getContext = (): MiddlewareContext => ({
      env: this.getEnv?.(),
      request: this.getRequest?.(),
    })

    // Define methods (with middleware wrapping if needed)
    for (const [key, fn] of Object.entries(collected.methods)) {
      const wrappedFn = middleware.length > 0
        ? wrapWithMiddleware(key, fn as (...args: unknown[]) => unknown, middleware, getContext)
        : fn
      Object.defineProperty(this, key, {
        value: wrappedFn,
        enumerable: true,
        configurable: true,
      })
    }

    // Define namespaces (with middleware wrapping for each method)
    for (const [nsKey, namespace] of Object.entries(collected.namespaces)) {
      const wrappedNamespace: Record<string, Function> = {}
      for (const [methodKey, fn] of Object.entries(namespace)) {
        const fullMethodName = `${nsKey}.${methodKey}`
        wrappedNamespace[methodKey] = middleware.length > 0
          ? wrapWithMiddleware(fullMethodName, fn as (...args: unknown[]) => unknown, middleware, getContext)
          : fn
      }
      Object.defineProperty(this, nsKey, {
        value: wrappedNamespace,
        enumerable: true,
        configurable: true,
      })
    }
  }

  /**
   * Schema reflection method - always available
   */
  __schema(): unknown {
    return this.durableRpc.getSchema()
  }
}
