/**
 * rpc.do auth
 *
 * Returns JWT or API key for Authorization: Bearer TOKEN
 */

import type { AuthProvider } from './transports'

/**
 * Get auth token from environment or oauth.do
 *
 * Checks in order:
 * 1. globalThis.DO_ADMIN_TOKEN / DO_TOKEN (Workers)
 * 2. process.env.DO_ADMIN_TOKEN / DO_TOKEN (Node.js)
 * 3. oauth.do stored credentials (keychain/secure file)
 *
 * @returns JWT or API key for Bearer auth
 */
export function auth(): AuthProvider {
  return async () => {
    // Try globalThis first (Workers)
    if ((globalThis as any).DO_ADMIN_TOKEN) return (globalThis as any).DO_ADMIN_TOKEN
    if ((globalThis as any).DO_TOKEN) return (globalThis as any).DO_TOKEN

    // Try process.env (Node.js)
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.DO_ADMIN_TOKEN) return process.env.DO_ADMIN_TOKEN
      if (process.env.DO_TOKEN) return process.env.DO_TOKEN
    }

    // Try oauth.do stored token (from CLI login)
    try {
      const { getToken } = await import('oauth.do')
      return await getToken()
    } catch {
      return null
    }
  }
}
