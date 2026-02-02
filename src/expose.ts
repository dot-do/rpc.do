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
import {
  wrapObjectAsTarget,
  wrapObjectWithCustomMethods,
  definePrototypeProperties,
  DEFAULT_SKIP_PROPS,
} from './utils/wrap-target'

// ============================================================================
// Types
// ============================================================================

/** Factory function that creates an SDK instance from env */
export type SDKFactory<Env extends object, SDK extends object> = (env: Env) => SDK

/** Method implementation with access to SDK and env */
export type MethodImpl<Env extends object, SDK extends object> = (
  this: { sdk: SDK; env: Env },
  ...args: unknown[]
) => Promise<unknown> | unknown

/** Options for expose() with a single SDK + optional custom methods */
export interface ExposeOptions<Env, SDK extends object> {
  sdk: SDKFactory<Env, SDK>
  methods?: Record<string, MethodImpl<Env, SDK>>
}

/** Options for expose() with multiple named SDKs */
export interface ExposeMultiOptions<Env extends object> {
  sdks: Record<string, SDKFactory<Env, object>>
  methods?: Record<string, (this: { sdks: Record<string, object>; env: Env }, ...args: unknown[]) => unknown>
}

// ============================================================================
// SDK RpcTarget - exposes SDK methods as individually addressable properties
// ============================================================================

/** Properties to skip when exposing an SDK object */
const SKIP_PROPS = new Set([...DEFAULT_SKIP_PROPS])

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
    subTargets[name] = wrapObjectAsTarget(sdk, { skip: SKIP_PROPS })
  }

  // Create dynamic class with getters for sub-targets
  class MultiTarget extends RpcTarget {}

  // Define namespace getters
  definePrototypeProperties(MultiTarget, {}, subTargets)

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
  return wrapObjectWithCustomMethods(sdk, methods, ctx, { skip: SKIP_PROPS })
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
