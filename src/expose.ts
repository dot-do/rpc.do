/**
 * expose() - Wrap an SDK/object as a WorkerEntrypoint with capnweb RpcTarget
 *
 * SDK methods become individually addressable properties on an RpcTarget,
 * supporting capnweb pipelining, .map(), and pass-by-reference.
 *
 * @example
 * // Simple usage - expose a single SDK
 * import { Cloudflare } from 'cloudflare'
 * import { expose } from 'rpc.do/expose'
 *
 * export default expose((env) => new Cloudflare({ apiToken: env.CF_API_TOKEN }))
 * // Client: await worker.zones.list({ account: { id: '...' } })
 *
 * @example
 * // With custom methods
 * import Stripe from 'stripe'
 * import { expose } from 'rpc.do/expose'
 *
 * export default expose({
 *   sdk: (env) => new Stripe(env.STRIPE_SECRET_KEY),
 *   methods: {
 *     async createCheckout(amount: number, currency: string) {
 *       return this.sdk.checkout.sessions.create({ ... })
 *     }
 *   }
 * })
 *
 * @example
 * // Multiple SDKs
 * import { expose } from 'rpc.do/expose'
 *
 * export default expose({
 *   sdks: {
 *     cf: (env) => new Cloudflare({ apiToken: env.CF_TOKEN }),
 *     gh: (env) => new Octokit({ auth: env.GH_TOKEN }),
 *   }
 * })
 * // Client: await worker.cf.zones.list({}) or await worker.gh.repos.get({ owner, repo })
 */

import { WorkerEntrypoint } from 'cloudflare:workers'
import { RpcTarget } from '@dotdo/capnweb/server'

// ============================================================================
// Types
// ============================================================================

/** Factory function that creates an SDK instance from env */
export type SDKFactory<Env, SDK> = (env: Env) => SDK

/** Method implementation with access to SDK and env */
export type MethodImpl<Env, SDK> = (
  this: { sdk: SDK; env: Env },
  ...args: any[]
) => Promise<any> | any

/** Options for expose() with a single SDK + optional custom methods */
export interface ExposeOptions<Env, SDK extends object> {
  sdk: SDKFactory<Env, SDK>
  methods?: Record<string, MethodImpl<Env, SDK>>
}

/** Options for expose() with multiple named SDKs */
export interface ExposeMultiOptions<Env> {
  sdks: Record<string, SDKFactory<Env, object>>
  methods?: Record<string, (this: { sdks: Record<string, object>; env: Env }, ...args: any[]) => any>
}

// ============================================================================
// SDK RpcTarget - exposes SDK methods as individually addressable properties
// ============================================================================

/** Properties to skip when exposing an SDK object */
const SKIP_PROPS = new Set([
  'constructor', 'toString', 'valueOf', 'toJSON',
  'then', 'catch', 'finally', // prevent thenable confusion
])

/**
 * Check if an object has functions at any nesting level.
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
 * Recursively wrap an object as an RpcTarget, converting namespace
 * objects into sub-RpcTargets so they're callable over capnweb RPC.
 *
 * Creates a dynamic class with methods on the prototype (required by capnweb).
 */
function wrapAsTarget(obj: object, seen: WeakSet<object>): RpcTarget {
  if (seen.has(obj)) {
    return new RpcTarget()
  }
  seen.add(obj)

  // Collect methods and namespaces
  const methods: Record<string, Function> = {}
  const namespaces: Record<string, RpcTarget> = {}
  const visited = new Set<string>()

  const collect = (source: object) => {
    for (const key of Object.getOwnPropertyNames(source)) {
      if (visited.has(key) || SKIP_PROPS.has(key) || key.startsWith('_')) continue
      visited.add(key)

      let value: unknown
      try {
        value = (obj as Record<string, unknown>)[key]
      } catch {
        continue
      }

      if (typeof value === 'function') {
        methods[key] = (value as Function).bind(obj)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const valueObj = value as Record<string, unknown>
        const hasCallableContent = hasNestedFunctions(valueObj)
        if (hasCallableContent) {
          namespaces[key] = wrapAsTarget(valueObj, seen)
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

  // Create dynamic class with prototype methods (capnweb requirement)
  class DynamicTarget extends RpcTarget {}

  for (const [key, fn] of Object.entries(methods)) {
    Object.defineProperty(DynamicTarget.prototype, key, {
      value: fn,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

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
 * Create an RpcTarget that wraps an object's methods.
 */
function createWrappedTarget(obj: object): RpcTarget {
  return wrapAsTarget(obj, new WeakSet())
}

/**
 * Create an RpcTarget for multi-SDK setup with optional custom methods.
 */
function createMultiTarget(
  sdkInstances: Record<string, object>,
  methods?: Record<string, Function>,
  ctx?: { sdks: Record<string, object>; env: unknown }
): RpcTarget {
  const subTargets: Record<string, RpcTarget> = {}
  for (const [name, sdk] of Object.entries(sdkInstances)) {
    subTargets[name] = wrapAsTarget(sdk, new WeakSet())
  }

  // Create dynamic class with getters for sub-targets
  class MultiTarget extends RpcTarget {}

  for (const [name, subTarget] of Object.entries(subTargets)) {
    Object.defineProperty(MultiTarget.prototype, name, {
      get() { return subTarget },
      enumerable: true,
      configurable: true,
    })
  }

  // Add custom methods on prototype
  if (methods && ctx) {
    for (const [name, method] of Object.entries(methods)) {
      Object.defineProperty(MultiTarget.prototype, name, {
        value: (method as Function).bind(ctx),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }

  return new MultiTarget()
}

/**
 * Create an RpcTarget for single SDK with optional custom methods.
 */
function createSingleTarget(
  sdk: object,
  methods?: Record<string, Function>,
  ctx?: { sdk: object; env: unknown }
): RpcTarget {
  // Collect methods and namespaces from SDK
  const sdkMethods: Record<string, Function> = {}
  const namespaces: Record<string, RpcTarget> = {}
  const visited = new Set<string>()
  const seen = new WeakSet<object>()

  const collect = (source: object) => {
    for (const key of Object.getOwnPropertyNames(source)) {
      if (visited.has(key) || SKIP_PROPS.has(key) || key.startsWith('_')) continue
      visited.add(key)

      let value: unknown
      try {
        value = (sdk as Record<string, unknown>)[key]
      } catch {
        continue
      }

      if (typeof value === 'function') {
        sdkMethods[key] = (value as Function).bind(sdk)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const valueObj = value as Record<string, unknown>
        if (hasNestedFunctions(valueObj)) {
          namespaces[key] = wrapAsTarget(valueObj, seen)
        }
      }
    }
  }

  collect(sdk)
  let proto = Object.getPrototypeOf(sdk)
  while (proto && proto !== Object.prototype) {
    collect(proto)
    proto = Object.getPrototypeOf(proto)
  }

  // Create dynamic class with all methods on prototype
  class SingleTarget extends RpcTarget {}

  for (const [key, fn] of Object.entries(sdkMethods)) {
    Object.defineProperty(SingleTarget.prototype, key, {
      value: fn,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  for (const [key, subTarget] of Object.entries(namespaces)) {
    Object.defineProperty(SingleTarget.prototype, key, {
      get() { return subTarget },
      enumerable: true,
      configurable: true,
    })
  }

  // Add custom methods on prototype
  if (methods && ctx) {
    for (const [name, method] of Object.entries(methods)) {
      Object.defineProperty(SingleTarget.prototype, name, {
        value: (method as Function).bind(ctx),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  }

  return new SingleTarget()
}

// ============================================================================
// Main expose() function
// ============================================================================

/**
 * Create a WorkerEntrypoint class that exposes SDK methods as individual
 * RpcTarget properties — supporting capnweb pipelining, .map(), and
 * pass-by-reference.
 *
 * @param factoryOrOptions - SDK factory function or options object
 * @returns A class extending WorkerEntrypoint
 */
export function expose<Env extends object, SDK extends object>(
  factoryOrOptions: SDKFactory<Env, SDK> | ExposeOptions<Env, SDK> | ExposeMultiOptions<Env>
): typeof WorkerEntrypoint<Env> {
  const isSimpleFactory = typeof factoryOrOptions === 'function'
  const isMultiSDK = !isSimpleFactory && 'sdks' in factoryOrOptions

  const ExposedWorker = class extends WorkerEntrypoint<Env> {
    private _rpcTarget: RpcTarget | undefined

    /**
     * Get the RpcTarget that exposes SDK methods.
     * Lazily initializes the SDK and builds the target on first access.
     */
    getRpcTarget(): RpcTarget {
      if (this._rpcTarget) return this._rpcTarget

      let target: RpcTarget

      if (isMultiSDK) {
        // Multiple SDKs: each SDK name becomes a namespace on the target
        const opts = factoryOrOptions as ExposeMultiOptions<Env>
        const sdkInstances: Record<string, object> = {}

        for (const [name, factory] of Object.entries(opts.sdks)) {
          sdkInstances[name] = factory(this.env)
        }

        const ctx = opts.methods ? { sdks: sdkInstances, env: this.env } : undefined
        target = createMultiTarget(sdkInstances, opts.methods, ctx)
      } else {
        // Single SDK
        const sdk = isSimpleFactory
          ? (factoryOrOptions as SDKFactory<Env, SDK>)(this.env)
          : (factoryOrOptions as ExposeOptions<Env, SDK>).sdk(this.env)

        const opts = isSimpleFactory ? undefined : factoryOrOptions as ExposeOptions<Env, SDK>
        const ctx = opts?.methods ? { sdk, env: this.env } : undefined
        target = createSingleTarget(sdk, opts?.methods, ctx)
      }

      this._rpcTarget = target
      return target
    }
  }

  Object.defineProperty(ExposedWorker, 'name', {
    value: 'ExposedSDKWorker',
    configurable: true,
  })

  return ExposedWorker as unknown as typeof WorkerEntrypoint<Env>
}

export default expose
