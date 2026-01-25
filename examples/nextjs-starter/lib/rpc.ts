/**
 * RPC Client Configuration
 *
 * This module exports a typed RPC client that can be used
 * in both Server Components and Client Components.
 */

import { createRPCClient, type RPCProxy } from 'rpc.do'
import type { RPCAPI } from './rpc-types'

/**
 * Get the base URL for the RPC endpoint
 * Handles both server and client environments
 */
function getBaseUrl(): string {
  // In browser, use relative URL
  if (typeof window !== 'undefined') {
    return '/api/rpc'
  }

  // In server environment, need absolute URL
  // Use VERCEL_URL in production, localhost in development
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  return `${host}/api/rpc`
}

/**
 * Create a typed RPC client
 *
 * Usage in Server Components:
 * ```tsx
 * import { rpc } from '@/lib/rpc'
 *
 * export default async function Page() {
 *   const result = await rpc.greeting.sayHello({ name: 'World' })
 *   return <div>{result.message}</div>
 * }
 * ```
 *
 * Usage in Client Components:
 * ```tsx
 * 'use client'
 * import { rpc } from '@/lib/rpc'
 *
 * export default function Component() {
 *   const [message, setMessage] = useState('')
 *
 *   const greet = async () => {
 *     const result = await rpc.greeting.sayHello({ name: 'World' })
 *     setMessage(result.message)
 *   }
 *
 *   return <button onClick={greet}>Greet</button>
 * }
 * ```
 */
export const rpc: RPCProxy<RPCAPI> = createRPCClient<RPCAPI>({
  baseUrl: getBaseUrl(),
})

/**
 * Create a new RPC client instance with custom options
 *
 * Useful when you need different configuration (e.g., auth token)
 */
export function createRpc(options?: { auth?: string }): RPCProxy<RPCAPI> {
  return createRPCClient<RPCAPI>({
    baseUrl: getBaseUrl(),
    auth: options?.auth,
  })
}
