/**
 * Auth Plugin
 *
 * Adds authentication middleware and context to composed DurableRPC instances.
 * Provides $.auth access and optional authentication enforcement.
 *
 * @example
 * ```typescript
 * const myDO = createDurableRPC({
 *   plugins: [
 *     authPlugin({
 *       required: true,
 *       validate: async (token) => {
 *         const user = await verifyToken(token)
 *         return { valid: !!user, user }
 *       }
 *     })
 *   ],
 *   methods: {
 *     getProfile: async ($) => {
 *       // $.auth.user is available here
 *       return $.auth.user
 *     },
 *   }
 * })
 * ```
 */

import type {
  Plugin,
  PluginInitContext,
  PluginRuntimeContext,
  AuthContext,
  AuthPluginOptions,
} from '../types.js'
import type { ServerMiddleware, MiddlewareContext } from '../../middleware.js'

/**
 * Default auth header name
 */
const DEFAULT_AUTH_HEADER = 'Authorization'

/**
 * Internal auth state (mutable during request handling)
 */
interface AuthState {
  authenticated: boolean
  user?: unknown
  token?: string
  [key: string]: unknown
}

/**
 * Creates an Auth plugin that adds authentication capabilities.
 *
 * @param options - Plugin configuration options
 * @returns Auth plugin instance
 *
 * @example
 * ```typescript
 * // Basic usage - optional auth
 * const myDO = createDurableRPC({
 *   plugins: [authPlugin()],
 *   methods: {
 *     getPublicData: async ($) => {
 *       // $.auth.authenticated may be false
 *       return { public: true }
 *     },
 *   }
 * })
 *
 * // Required auth with custom validation
 * const myDO = createDurableRPC({
 *   plugins: [
 *     authPlugin({
 *       required: true,
 *       validate: async (token) => {
 *         const decoded = await jwt.verify(token)
 *         return { valid: true, user: decoded }
 *       },
 *       excludeMethods: ['healthCheck', 'getPublicData'],
 *     })
 *   ],
 *   methods: { ... }
 * })
 *
 * // Custom header
 * const myDO = createDurableRPC({
 *   plugins: [authPlugin({ header: 'X-API-Key' })],
 *   methods: { ... }
 * })
 * ```
 */
export function authPlugin(options: AuthPluginOptions = {}): Plugin<AuthContext> {
  const {
    required = false,
    header = DEFAULT_AUTH_HEADER,
    validate,
    excludeMethods = [],
  } = options

  // Mutable auth state that gets updated per-request
  let authState: AuthState = {
    authenticated: false,
    user: undefined,
    token: undefined,
  }

  // Set of excluded method names for quick lookup
  const excludedMethods = new Set(excludeMethods)

  /**
   * Extract token from request
   */
  const extractToken = (request: Request | undefined): string | undefined => {
    if (!request) return undefined
    const headerValue = request.headers.get(header)
    if (!headerValue) return undefined

    // Handle "Bearer <token>" format
    if (headerValue.toLowerCase().startsWith('bearer ')) {
      return headerValue.slice(7)
    }
    return headerValue
  }

  /**
   * Validate token and update auth state
   */
  const validateToken = async (
    token: string | undefined,
    ctx: PluginInitContext
  ): Promise<void> => {
    if (!token) {
      authState = { authenticated: false }
      return
    }

    if (validate) {
      const result = await validate(token, ctx)
      authState = {
        authenticated: result.valid,
        user: result.user,
        token,
      }
    } else {
      // Default: just having a token means authenticated
      authState = {
        authenticated: true,
        token,
      }
    }
  }

  // Create auth middleware
  const authMiddleware: ServerMiddleware = {
    async onRequest(method: string, _args: unknown[], mwCtx: MiddlewareContext): Promise<void> {
      // Extract and validate token
      const token = extractToken(mwCtx.request)
      await validateToken(token, {
        ctx: {} as DurableObjectState, // Will be filled in by runtime
        env: (mwCtx.env ?? {}) as Record<string, unknown>,
      })

      // Check if auth is required for this method
      if (required && !excludedMethods.has(method) && !authState.authenticated) {
        throw new Error('Unauthorized: Authentication required')
      }
    },
  }

  return {
    name: 'auth',

    init(_ctx: PluginInitContext): AuthContext {
      return {
        get auth() {
          return { ...authState }
        },
      }
    },

    // Process auth on each fetch
    onFetch(request: Request, ctx: PluginRuntimeContext & AuthContext): void {
      const token = extractToken(request)
      // Synchronously set token - full validation happens in middleware
      authState = {
        authenticated: false,
        token,
      }
    },

    middleware: [authMiddleware],

    skipProps: ['auth', '_authState'],
  }
}
