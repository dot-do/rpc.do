/**
 * rpc.do Worker
 *
 * Cloudflare Worker fetch handler for serving RPC endpoints
 */

import { createRpcHandler, bearerAuth } from './server'
import { RPCError } from './errors'

export interface Env {
  // Token or secret for bearer auth (optional)
  RPC_TOKEN?: string
  DO_TOKEN?: string
  DO_ADMIN_TOKEN?: string

  // Service bindings to route RPC calls to
  [key: string]: unknown
}

/**
 * Create RPC worker handler
 */
export function createWorker(options?: {
  dispatch?: (method: string, args: any[], env: Env, ctx: ExecutionContext) => Promise<any>
}) {
  return {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
      const handler = createRpcHandler({
        auth: bearerAuth(async (token) => {
          // Check against configured tokens
          if (env.RPC_TOKEN && token === env.RPC_TOKEN) return { admin: true }
          if (env.DO_ADMIN_TOKEN && token === env.DO_ADMIN_TOKEN) return { admin: true }
          if (env.DO_TOKEN && token === env.DO_TOKEN) return { user: true }
          return null
        }),
        dispatch: async (method, args) => {
          if (options?.dispatch) {
            return options.dispatch(method, args, env, ctx)
          }

          // Default dispatch: look for service binding matching first part of method
          const parts = method.split('.')
          const bindingName = parts[0]
          const binding = env[bindingName]

          if (!binding) {
            throw new RPCError(`Unknown service: ${bindingName}`, 'UNKNOWN_SERVICE')
          }

          // Navigate to method on binding
          let target = binding as any
          for (let i = 1; i < parts.length; i++) {
            target = target[parts[i]]
            if (!target) {
              throw new RPCError(`Unknown method: ${method}`, 'UNKNOWN_METHOD')
            }
          }

          if (typeof target !== 'function') {
            throw new RPCError(`${method} is not a function`, 'NOT_A_FUNCTION')
          }

          return target(...args)
        }
      })

      return handler(request)
    }
  }
}

/**
 * Default worker export with standard dispatch
 */
export default createWorker()
