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
import { wrapObjectAsTarget, DEFAULT_SKIP_PROPS } from './utils/wrap-target'

// ============================================================================
// Convenience wrappers
// ============================================================================

/** Properties to skip when wrapping a plain object as an RpcTarget */
const DEFAULT_SKIP = new Set([...DEFAULT_SKIP_PROPS])

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

  return wrapObjectAsTarget(obj, { skip })
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
