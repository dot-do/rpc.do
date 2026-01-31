/**
 * rpc.do/server - Capnweb server utilities with convenience wrappers
 *
 * Re-exports capnweb/server and adds helpers for common patterns.
 *
 * @example
 * // Wrap any object/SDK as an RpcTarget and serve it
 * import { createTarget, createHandler } from 'rpc.do/server'
 * import esbuild from 'esbuild'
 *
 * const target = createTarget(esbuild)
 * export default { fetch: createHandler(target) }
 *
 * @example
 * // Use newWorkersRpcResponse directly
 * import { newWorkersRpcResponse, RpcTarget } from 'rpc.do/server'
 *
 * class MyTarget extends RpcTarget {
 *   greet(name: string) { return `Hello, ${name}!` }
 * }
 *
 * export default {
 *   fetch(req: Request) {
 *     return newWorkersRpcResponse(req, new MyTarget())
 *   }
 * }
 */

// Re-export everything from capnweb/server
export {
  RpcTarget,
  RpcSession,
  RpcStub,
  newWorkersRpcResponse,
  newHttpBatchRpcResponse,
  HibernatableWebSocketTransport,
  TransportRegistry,
  serialize,
  deserialize,
} from '@dotdo/capnweb/server'

export type {
  RpcCompatible,
  RpcSessionOptions,
  RpcTransport,
} from '@dotdo/capnweb/server'

import { RpcTarget, newWorkersRpcResponse } from '@dotdo/capnweb/server'

// ============================================================================
// Convenience wrappers
// ============================================================================

/** Properties to skip when wrapping a plain object as an RpcTarget */
const DEFAULT_SKIP = new Set([
  'constructor',
  'toString',
  'valueOf',
  'toJSON',
  'then',
  'catch',
  'finally',
])

/**
 * Wrap a plain object/SDK as an RpcTarget, recursively converting namespace
 * objects into sub-RpcTargets so the entire API is callable over capnweb RPC.
 *
 * @param obj - The object whose methods should be exposed
 * @param opts - Optional configuration
 * @param opts.skip - Property names to exclude from RPC exposure
 *
 * @example
 * import esbuild from 'esbuild'
 * import { createTarget, createHandler } from 'rpc.do/server'
 *
 * const target = createTarget(esbuild)
 * export default { fetch: createHandler(target) }
 *
 * @example
 * // With env
 * const target = createTarget(new Stripe(env.STRIPE_SECRET_KEY))
 *
 * @example
 * // Skip specific methods
 * const target = createTarget(sdk, { skip: ['internal', 'debug'] })
 */
export function createTarget(obj: object, opts?: { skip?: string[] }): RpcTarget {
  const skip = opts?.skip
    ? new Set([...DEFAULT_SKIP, ...opts.skip])
    : DEFAULT_SKIP

  return wrapAsTarget(obj, skip, new WeakSet())
}

/**
 * Check if an object has functions at any nesting level.
 * Used to determine if an object should be wrapped as a namespace.
 */
function hasNestedFunctions(obj: Record<string, unknown>, maxDepth = 5): boolean {
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
 * Recursively wrap an object as an RpcTarget.
 *
 * Creates a dynamic class that extends RpcTarget with methods defined on
 * the prototype (not instance properties). This is required because capnweb
 * only allows prototype methods to be called over RPC for security.
 *
 * Namespace objects with function properties become getters returning sub-RpcTargets.
 */
function wrapAsTarget(obj: object, skip: Set<string>, seen: WeakSet<object>): RpcTarget {
  // Prevent infinite recursion on circular references
  if (seen.has(obj)) {
    return new RpcTarget()
  }
  seen.add(obj)

  // Collect all methods and namespaces to expose
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
      } catch {
        continue
      }

      if (typeof value === 'function') {
        // Bind method to original object
        methods[key] = (value as Function).bind(obj)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Check if it's a namespace (object with function properties or nested namespaces)
        const valueObj = value as Record<string, unknown>
        const hasCallableContent = hasNestedFunctions(valueObj)
        if (hasCallableContent) {
          // Recursively wrap namespace as a sub-RpcTarget
          namespaces[key] = wrapAsTarget(valueObj, skip, seen)
        }
      }
    }
  }

  collect(obj)
  let proto = Object.getPrototypeOf(obj)
  while (proto && proto !== Object.prototype) {
    collect(proto)
    proto = Object.getPrototypeOf(proto)
  }

  // Create a dynamic class with methods on the prototype
  // This is required because capnweb only exposes prototype methods over RPC
  class DynamicTarget extends RpcTarget {}

  // Define methods on the prototype
  for (const [key, fn] of Object.entries(methods)) {
    Object.defineProperty(DynamicTarget.prototype, key, {
      value: fn,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  // Define namespace getters on the prototype
  for (const [key, subTarget] of Object.entries(namespaces)) {
    Object.defineProperty(DynamicTarget.prototype, key, {
      get() { return subTarget },
      enumerable: true,
      configurable: true,
    })
  }

  return new DynamicTarget()
}

/**
 * Create a fetch handler from an RpcTarget.
 *
 * Returns a function suitable as a Worker's `fetch` handler that speaks
 * capnweb protocol (HTTP batch + WebSocket upgrade).
 *
 * @example
 * import { createTarget, createHandler } from 'rpc.do/server'
 *
 * const handler = createHandler(createTarget(myService))
 * export default { fetch: handler }
 */
export function createHandler(target: RpcTarget): (req: Request) => Promise<Response> {
  return (req) => newWorkersRpcResponse(req, target)
}
