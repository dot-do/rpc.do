/**
 * rpc.do auth - OAuth.do integration for RPC authentication
 *
 * Provides authentication utilities that integrate with oauth.do for token management.
 * Includes caching, automatic token refresh, and flexible provider patterns.
 */

/**
 * Auth provider function type for HTTP clients
 * Returns a token string or null/undefined
 */
export type AuthProvider = () => string | null | undefined | Promise<string | null | undefined>

/**
 * Options for cached auth provider
 */
export interface CachedAuthOptions {
  /**
   * How long to cache the token in milliseconds
   * @default 300000 (5 minutes)
   */
  ttl?: number
  /**
   * Time before expiry to refresh the token (in ms)
   * @default 60000 (1 minute)
   */
  refreshBuffer?: number
}

/**
 * Options for oauth.do provider
 */
export interface OAuthProviderOptions extends CachedAuthOptions {
  /**
   * Fallback token to use if oauth.do token retrieval fails
   */
  fallbackToken?: string
  /**
   * Custom fetch implementation (for testing or special environments)
   */
  fetch?: typeof fetch
}

// ============================================================================
// Constants
// ============================================================================

/** Default time-to-live for cached tokens (5 minutes in milliseconds) */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

/** Default buffer time before expiry to refresh tokens (1 minute in milliseconds) */
const DEFAULT_REFRESH_BUFFER_MS = 60 * 1000

// ============================================================================
// Types
// ============================================================================

// Token cache entry
interface CacheEntry {
  token: string
  expiresAt: number
}

/**
 * Create a cached auth provider that wraps any auth function
 * Caches tokens to avoid repeated calls to the underlying provider
 *
 * @param getTokenFn - The underlying token retrieval function
 * @param options - Caching options
 * @returns AuthProvider that caches tokens
 *
 * @example
 * import { cachedAuth } from 'rpc.do/auth'
 * import { getToken } from 'oauth.do'
 *
 * const auth = cachedAuth(getToken, { ttl: 60000 })
 * const token = await auth()
 */
export function cachedAuth(
  getTokenFn: () => string | null | Promise<string | null>,
  options: CachedAuthOptions = {}
): AuthProvider {
  const { ttl = DEFAULT_CACHE_TTL_MS, refreshBuffer = DEFAULT_REFRESH_BUFFER_MS } = options

  let cache: CacheEntry | null = null
  let refreshPromise: Promise<string | null> | null = null

  return async (): Promise<string | null> => {
    const now = Date.now()

    // Return cached token if still valid
    if (cache && now < cache.expiresAt - refreshBuffer) {
      return cache.token
    }

    // If cache is expiring soon but not expired, refresh in background
    if (cache && now < cache.expiresAt && !refreshPromise) {
      refreshPromise = Promise.resolve(getTokenFn()).then((token) => {
        if (token) {
          cache = { token, expiresAt: now + ttl }
        }
        refreshPromise = null
        return token
      }).catch(() => {
        refreshPromise = null
        return cache?.token ?? null
      })
      // Return current cache while refreshing
      return cache.token
    }

    // Cache is expired or doesn't exist, must fetch
    if (refreshPromise) {
      return refreshPromise
    }

    refreshPromise = Promise.resolve(getTokenFn()).then((token) => {
      if (token) {
        cache = { token, expiresAt: now + ttl }
      } else {
        cache = null
      }
      refreshPromise = null
      return token
    }).catch((err) => {
      refreshPromise = null
      throw err
    })

    return refreshPromise
  }
}

/**
 * Create an auth provider that integrates with oauth.do
 * Provides automatic token retrieval with caching and fallback support
 *
 * @param options - Provider options
 * @returns AuthProvider that uses oauth.do for token management
 *
 * @example
 * import { oauthProvider } from 'rpc.do/auth'
 * import { RPC, http } from 'rpc.do'
 *
 * // Basic usage - uses oauth.do getToken with caching
 * const rpc = RPC(http('https://rpc.do', oauthProvider()))
 *
 * // With fallback token
 * const rpc = RPC(http('https://rpc.do', oauthProvider({
 *   fallbackToken: process.env.API_TOKEN
 * })))
 *
 * // With custom TTL
 * const rpc = RPC(http('https://rpc.do', oauthProvider({
 *   ttl: 60000,  // 1 minute cache
 *   refreshBuffer: 10000  // refresh 10s before expiry
 * })))
 */
export function oauthProvider(options: OAuthProviderOptions = {}): AuthProvider {
  const { fallbackToken, ttl, refreshBuffer } = options

  // Lazy-load oauth.do to keep it optional
  let oauthGetToken: (() => Promise<string | null>) | null = null
  let loadPromise: Promise<void> | null = null

  const loadOAuth = async (): Promise<void> => {
    if (oauthGetToken) return
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
      try {
        const oauth = await import('oauth.do')
        oauthGetToken = oauth.getToken
      } catch {
        // oauth.do not available, will use fallback
        oauthGetToken = async () => null
      }
    })()

    return loadPromise
  }

  const getTokenFn = async (): Promise<string | null> => {
    await loadOAuth()
    const token = await oauthGetToken!()
    return token ?? fallbackToken ?? null
  }

  // Build options object, only setting defined values to satisfy exactOptionalPropertyTypes
  const cacheOptions: CachedAuthOptions = {}
  if (ttl !== undefined) cacheOptions.ttl = ttl
  if (refreshBuffer !== undefined) cacheOptions.refreshBuffer = refreshBuffer
  return cachedAuth(getTokenFn, cacheOptions)
}

/**
 * Simple auth provider that returns a static token
 * Useful for server-side usage with environment variables
 *
 * @param token - The token to return, or a function that returns the token
 * @returns AuthProvider
 *
 * @example
 * import { staticAuth } from 'rpc.do/auth'
 * import { RPC, http } from 'rpc.do'
 *
 * // With static token
 * const rpc = RPC(http('https://rpc.do', staticAuth('sk_live_xxx')))
 *
 * // With environment variable (evaluated at call time)
 * const rpc = RPC(http('https://rpc.do', staticAuth(() => process.env.API_TOKEN)))
 */
export function staticAuth(token: string | (() => string | undefined)): AuthProvider {
  return () => typeof token === 'function' ? token() ?? null : token
}

/**
 * Composite auth provider that tries multiple providers in order
 * Returns the first non-null token
 *
 * @param providers - Array of auth providers to try
 * @returns AuthProvider that tries each provider in order
 *
 * @example
 * import { compositeAuth, oauthProvider, staticAuth } from 'rpc.do/auth'
 *
 * const auth = compositeAuth([
 *   oauthProvider(),  // Try oauth.do first
 *   staticAuth(() => process.env.API_TOKEN),  // Fall back to env var
 * ])
 */
export function compositeAuth(providers: AuthProvider[]): AuthProvider {
  return async (): Promise<string | null> => {
    for (const provider of providers) {
      try {
        const token = await provider()
        if (token) return token
      } catch {
        // Continue to next provider
      }
    }
    return null
  }
}

/**
 * Get a token from global variables or oauth.do
 * Checks DO_ADMIN_TOKEN and DO_TOKEN globals first, then falls back to oauth.do
 *
 * @returns The token or null if not available
 *
 * @example
 * import { getToken } from 'rpc.do/auth'
 *
 * const token = await getToken()
 */
export async function getToken(): Promise<string | null> {
  // Check global tokens first (works in browser and Node.js)
  const globalToken = (globalThis as any).DO_ADMIN_TOKEN ?? (globalThis as any).DO_TOKEN
  if (globalToken) {
    return globalToken
  }

  // Check environment variables (Node.js only)
  if (typeof process !== 'undefined' && process.env) {
    const envToken = process.env['DO_ADMIN_TOKEN'] ?? process.env['DO_TOKEN']
    if (envToken) {
      return envToken
    }
  }

  // Fall back to oauth.do (dynamically imported)
  try {
    const oauth = await import('oauth.do')
    return await oauth.getToken()
  } catch {
    // oauth.do not available
    return null
  }
}

/**
 * Create an auth provider that checks global tokens and oauth.do
 * This is the recommended way to create an auth provider for RPC clients
 *
 * @returns AuthProvider function
 *
 * @example
 * import { auth } from 'rpc.do/auth'
 * import { RPC, http } from 'rpc.do'
 *
 * const rpc = RPC(http('https://rpc.do', auth()))
 */
export function auth(): AuthProvider {
  return getToken
}

// Note: OAuthAuthProvider type is NOT re-exported here because oauth.do is an
// optional peer dependency. Static type re-exports would fail at import time
// if oauth.do is not installed.
//
// If you need the oauth.do AuthProvider type, import directly from oauth.do:
//   import type { AuthProvider } from 'oauth.do'
