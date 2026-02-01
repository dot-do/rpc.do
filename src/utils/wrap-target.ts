/**
 * Shared wrapAsTarget utility
 *
 * Provides functions to wrap objects as RpcTargets with methods on prototype.
 * Used by server.ts, expose.ts, and core/src/rpc-interface.ts.
 */

import { RpcTarget } from '@dotdo/capnweb/server'

// ============================================================================
// Security Blocklist and Default Skip Properties
// ============================================================================

/**
 * Security blocklist: dangerous properties that must never be exposed via RPC.
 * These could enable prototype pollution or access to internal JavaScript mechanisms.
 */
export const SECURITY_BLOCKLIST = new Set([
  // Prototype chain access - could enable prototype pollution attacks
  '__proto__',
  'constructor',
  'prototype',
  // Legacy property descriptor methods - could modify object behavior
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

/** Default properties to skip when wrapping a plain object as an RpcTarget */
export const DEFAULT_SKIP_PROPS = new Set([
  // Include all security-critical properties
  ...SECURITY_BLOCKLIST,
  // Standard object methods that shouldn't be exposed
  'toString',
  'valueOf',
  'toJSON',
  // Promise-like methods to prevent thenable detection issues
  'then',
  'catch',
  'finally',
])

// ============================================================================
// Types
// ============================================================================

export interface WrapAsTargetOptions {
  /** Properties to skip (default: DEFAULT_SKIP_PROPS) */
  skip?: Set<string>
  /** WeakSet to track visited objects for circular reference detection */
  seen?: WeakSet<object>
}

export interface CollectedProperties {
  /** Methods bound to the source object */
  methods: Record<string, Function>
  /** Namespace objects wrapped as sub-RpcTargets */
  namespaces: Record<string, RpcTarget>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an object has functions at any nesting level.
 * Used to determine if an object should be wrapped as a namespace.
 *
 * @param obj - Object to check
 * @param maxDepth - Maximum depth to search (default: 5)
 * @returns true if the object contains callable functions
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
 * Collect methods and namespaces from an object and its prototype chain.
 *
 * @param obj - The object to collect from
 * @param skip - Properties to skip
 * @param seen - WeakSet for circular reference detection
 * @returns Collected methods and namespaces
 */
export function collectObjectProperties(
  obj: object,
  skip: Set<string>,
  seen: WeakSet<object>
): CollectedProperties {
  const methods: Record<string, Function> = {}
  const namespaces: Record<string, RpcTarget> = {}
  const visited = new Set<string>()

  const collect = (source: object) => {
    for (const key of Object.getOwnPropertyNames(source)) {
      if (visited.has(key) || skip.has(key) || key.startsWith('_')) continue
      visited.add(key)

      let value: unknown
      try {
        value = (obj as Record<string, unknown>)[key]
      } catch (err) {
        // Debug logging for property access errors (usually getters that throw)
        if (typeof process !== 'undefined' && process.env?.['DEBUG']) {
          console.debug(`[rpc.do] Failed to access property '${key}':`, err)
        }
        continue
      }

      if (typeof value === 'function') {
        // Bind method to original object
        methods[key] = (value as Function).bind(obj)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Check if it's a namespace (object with function properties or nested namespaces)
        const valueObj = value as Record<string, unknown>
        if (hasNestedFunctions(valueObj)) {
          // Recursively wrap namespace as a sub-RpcTarget
          namespaces[key] = wrapObjectAsTarget(valueObj, { skip, seen })
        }
      }
    }
  }

  // Collect from object itself
  collect(obj)

  // Walk prototype chain
  let proto = Object.getPrototypeOf(obj)
  while (proto && proto !== Object.prototype) {
    collect(proto)
    proto = Object.getPrototypeOf(proto)
  }

  return { methods, namespaces }
}

/**
 * Define methods and namespace getters on a class prototype.
 *
 * @param TargetClass - The class whose prototype will be modified
 * @param methods - Methods to define (as values)
 * @param namespaces - Namespaces to define (as getters)
 */
export function definePrototypeProperties(
  TargetClass: { prototype: object },
  methods: Record<string, Function>,
  namespaces: Record<string, RpcTarget>
): void {
  // Define methods on the prototype
  for (const [key, fn] of Object.entries(methods)) {
    Object.defineProperty(TargetClass.prototype, key, {
      value: fn,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  // Define namespace getters on the prototype
  for (const [key, subTarget] of Object.entries(namespaces)) {
    Object.defineProperty(TargetClass.prototype, key, {
      get() { return subTarget },
      enumerable: true,
      configurable: true,
    })
  }
}

// ============================================================================
// Main Wrapper Function
// ============================================================================

/**
 * Wrap a plain object as an RpcTarget, recursively converting namespace
 * objects into sub-RpcTargets so the entire API is callable over capnweb RPC.
 *
 * Creates a dynamic class that extends RpcTarget with methods defined on
 * the prototype (not instance properties). This is required because capnweb
 * only allows prototype methods to be called over RPC for security.
 *
 * @param obj - The object whose methods should be exposed
 * @param options - Configuration options
 * @returns An RpcTarget instance with all methods exposed
 *
 * @example
 * import { wrapObjectAsTarget } from './utils/wrap-target'
 *
 * const sdk = { greet: (name) => `Hello, ${name}!` }
 * const target = wrapObjectAsTarget(sdk)
 */
export function wrapObjectAsTarget(obj: object, options: WrapAsTargetOptions = {}): RpcTarget {
  const skip = options.skip ?? DEFAULT_SKIP_PROPS
  const seen = options.seen ?? new WeakSet<object>()

  // Prevent infinite recursion on circular references
  if (seen.has(obj)) {
    return new RpcTarget()
  }
  seen.add(obj)

  // Collect all methods and namespaces
  const { methods, namespaces } = collectObjectProperties(obj, skip, seen)

  // Create a dynamic class with methods on the prototype
  class DynamicTarget extends RpcTarget {}

  // Define properties on prototype
  definePrototypeProperties(DynamicTarget, methods, namespaces)

  return new DynamicTarget()
}

/**
 * Create an RpcTarget with SDK methods plus custom methods.
 * Custom methods are bound to a provided context.
 *
 * @param obj - The SDK/object to wrap
 * @param customMethods - Additional methods to add
 * @param ctx - Context to bind custom methods to
 * @param options - Configuration options
 * @returns An RpcTarget with both SDK and custom methods
 */
export function wrapObjectWithCustomMethods(
  obj: object,
  customMethods?: Record<string, Function>,
  ctx?: object,
  options: WrapAsTargetOptions = {}
): RpcTarget {
  const skip = options.skip ?? DEFAULT_SKIP_PROPS
  const seen = options.seen ?? new WeakSet<object>()

  // Collect SDK methods and namespaces
  const { methods, namespaces } = collectObjectProperties(obj, skip, seen)

  // Create dynamic class
  class DynamicTarget extends RpcTarget {}

  // Define SDK properties
  definePrototypeProperties(DynamicTarget, methods, namespaces)

  // Add custom methods on prototype
  if (customMethods && ctx) {
    for (const [name, method] of Object.entries(customMethods)) {
      Object.defineProperty(DynamicTarget.prototype, name, {
        value: method.bind(ctx),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }

  return new DynamicTarget()
}
