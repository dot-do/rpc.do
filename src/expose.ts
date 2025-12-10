/**
 * expose() - One-liner SDK-to-RPC wrapper
 *
 * Wraps any SDK/object and exposes it via Cloudflare Workers RPC
 * with a generic `rpc(path, ...args)` method that navigates the object tree.
 *
 * @example
 * // Simple usage - expose a single SDK
 * import { Cloudflare } from 'cloudflare'
 * import { expose } from 'rpc.do'
 *
 * export default expose((env) => new Cloudflare({ apiToken: env.CF_API_TOKEN }))
 *
 * @example
 * // With custom methods
 * import Stripe from 'stripe'
 * import { expose } from 'rpc.do'
 *
 * export default expose({
 *   sdk: (env) => new Stripe(env.STRIPE_SECRET_KEY),
 *   methods: {
 *     async createCheckout(amount: number, currency: string) {
 *       // Custom composite operation using this.sdk
 *       return this.sdk.checkout.sessions.create({ ... })
 *     }
 *   }
 * })
 *
 * @example
 * // Multiple SDKs
 * import { expose } from 'rpc.do'
 * import { Cloudflare } from 'cloudflare'
 * import { Octokit } from 'octokit'
 *
 * export default expose({
 *   sdks: {
 *     cf: (env) => new Cloudflare({ apiToken: env.CF_TOKEN }),
 *     gh: (env) => new Octokit({ auth: env.GH_TOKEN }),
 *   }
 * })
 * // Client calls: worker.rpc('cf.zones.list', {}) or worker.rpc('gh.repos.get', { owner, repo })
 */

import { WorkerEntrypoint } from 'cloudflare:workers'

// ============================================================================
// Types
// ============================================================================

/**
 * Factory function that creates an SDK instance from env
 */
export type SDKFactory<Env, SDK> = (env: Env) => SDK

/**
 * Method implementation with access to SDK and env
 */
export type MethodImpl<Env, SDK> = (
  this: { sdk: SDK; env: Env },
  ...args: any[]
) => Promise<any> | any

/**
 * Options for expose() with custom methods
 */
export interface ExposeOptions<Env, SDK extends object> {
  /** Factory to create the SDK instance */
  sdk: SDKFactory<Env, SDK>
  /** Custom methods that can access this.sdk and this.env */
  methods?: Record<string, MethodImpl<Env, SDK>>
}

/**
 * Options for expose() with multiple SDKs
 */
export interface ExposeMultiOptions<Env> {
  /** Multiple SDK factories keyed by name */
  sdks: Record<string, SDKFactory<Env, object>>
  /** Custom methods */
  methods?: Record<string, (this: { sdks: Record<string, object>; env: Env }, ...args: any[]) => any>
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Navigate an object tree via dot-notation path and call the final method
 */
async function navigateAndCall(
  root: object,
  path: string,
  args: unknown[]
): Promise<unknown> {
  const parts = path.split('.')

  // Navigate to the parent of the target method
  let target: any = root
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    target = target[part]
    if (target === undefined || target === null) {
      throw new Error(`Invalid path: ${path} (failed at '${part}')`)
    }
  }

  // Get and call the method
  const methodName = parts[parts.length - 1]
  const method = target[methodName]

  if (typeof method !== 'function') {
    throw new Error(`Not a function: ${path}`)
  }

  // Call the method (bound to its parent for proper 'this')
  const result = await method.apply(target, args)

  // Handle async iterables (pagination) - collect into array
  if (result && typeof result[Symbol.asyncIterator] === 'function') {
    const items: unknown[] = []
    for await (const item of result) {
      items.push(item)
    }
    return items
  }

  return result
}

// ============================================================================
// Main expose() function
// ============================================================================

/**
 * Create a WorkerEntrypoint class that exposes an SDK via RPC
 *
 * @param factoryOrOptions - SDK factory function or options object
 * @returns A class extending WorkerEntrypoint with a generic rpc() method
 */
export function expose<Env extends object, SDK extends object>(
  factoryOrOptions: SDKFactory<Env, SDK> | ExposeOptions<Env, SDK> | ExposeMultiOptions<Env>
): typeof WorkerEntrypoint<Env> {
  // Normalize options
  const isSimpleFactory = typeof factoryOrOptions === 'function'
  const isMultiSDK = !isSimpleFactory && 'sdks' in factoryOrOptions

  // Create the WorkerEntrypoint subclass
  const ExposedWorker = class extends WorkerEntrypoint<Env> {
    // Cached SDK instance(s)
    private _sdk: SDK | undefined
    private _sdks: Map<string, object> | undefined

    /**
     * Get the SDK instance (lazy initialization)
     */
    get sdk(): SDK {
      if (this._sdk === undefined) {
        if (isSimpleFactory) {
          this._sdk = (factoryOrOptions as SDKFactory<Env, SDK>)(this.env)
        } else if (!isMultiSDK) {
          this._sdk = (factoryOrOptions as ExposeOptions<Env, SDK>).sdk(this.env)
        } else {
          throw new Error('Use sdks property for multi-SDK setup')
        }
      }
      return this._sdk
    }

    /**
     * Get named SDKs (for multi-SDK setup)
     */
    get sdks(): Record<string, object> {
      if (!isMultiSDK) {
        throw new Error('Single SDK setup - use sdk property instead')
      }

      if (!this._sdks) {
        this._sdks = new Map()
      }

      const opts = factoryOrOptions as ExposeMultiOptions<Env>

      // Return a proxy that lazily initializes SDKs
      return new Proxy({} as Record<string, object>, {
        get: (_, name: string) => {
          if (!this._sdks!.has(name)) {
            const factory = opts.sdks[name]
            if (!factory) {
              throw new Error(`Unknown SDK: ${name}`)
            }
            this._sdks!.set(name, factory(this.env))
          }
          return this._sdks!.get(name)
        }
      })
    }

    /**
     * Generic RPC method - navigates SDK and calls method by path
     *
     * @param path - Dot-notation path like "zones.list" or "stripe.customers.create"
     * @param args - Arguments to pass to the method
     * @returns The result of the method call
     *
     * @example
     * // From service binding
     * await env.cloudflare.rpc('zones.list', { account: { id: '...' } })
     * await env.stripe.rpc('customers.create', { email: 'user@example.com' })
     */
    async rpc(path: string, ...args: unknown[]): Promise<unknown> {
      // Check for custom methods first
      const methods = isSimpleFactory
        ? undefined
        : isMultiSDK
          ? (factoryOrOptions as ExposeMultiOptions<Env>).methods
          : (factoryOrOptions as ExposeOptions<Env, SDK>).methods

      if (methods) {
        const parts = path.split('.')
        const methodName = parts[0]

        if (methods[methodName]) {
          // For single-path custom method calls like "createCheckout"
          if (parts.length === 1) {
            const ctx = isMultiSDK
              ? { sdks: this.sdks, env: this.env }
              : { sdk: this.sdk, env: this.env }
            // Use type assertion since we handle both SDK and multi-SDK contexts at runtime
            return (methods[methodName] as Function).apply(ctx, args)
          }
        }
      }

      // Multi-SDK: first part is SDK name, rest is path within SDK
      if (isMultiSDK) {
        const parts = path.split('.')
        const sdkName = parts[0]
        const sdkPath = parts.slice(1).join('.')

        if (!sdkPath) {
          throw new Error(`Invalid path for multi-SDK: ${path} (expected 'sdkName.method.path')`)
        }

        const sdk = this.sdks[sdkName]
        return navigateAndCall(sdk, sdkPath, args)
      }

      // Single SDK: navigate directly
      return navigateAndCall(this.sdk, path, args)
    }
  }

  // Set a meaningful class name for debugging
  Object.defineProperty(ExposedWorker, 'name', {
    value: 'ExposedSDKWorker',
    configurable: true
  })

  return ExposedWorker as unknown as typeof WorkerEntrypoint<Env>
}

// ============================================================================
// Convenience exports
// ============================================================================

export default expose
