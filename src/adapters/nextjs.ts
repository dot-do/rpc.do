/**
 * rpc.do Next.js Adapter
 *
 * Framework-specific integration for Next.js applications, supporting both
 * App Router (React Server Components) and Pages Router patterns.
 *
 * Features:
 * - useRPC() hook for client-side usage with React 18+ features
 * - Server component support with async data fetching
 * - API route handler wrapper for both App Router and Pages Router
 * - Type-safe integration with full TypeScript support
 *
 * @example Client Component
 * ```typescript
 * 'use client'
 * import { useRPC, useRPCMutation } from 'rpc.do/nextjs'
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const { data, loading, error, refetch } = useRPC(
 *     rpc.users.get,
 *     [userId],
 *     { key: ['user', userId] }
 *   )
 *
 *   if (loading) return <Spinner />
 *   if (error) return <Error message={error.message} />
 *   return <Profile user={data} />
 * }
 * ```
 *
 * @example Server Component (App Router)
 * ```typescript
 * import { createServerRPC } from 'rpc.do/nextjs'
 *
 * const rpc = createServerRPC('https://api.example.com/rpc')
 *
 * export default async function UserPage({ params }: { params: { id: string } }) {
 *   const user = await rpc.users.get(params.id)
 *   return <UserProfile user={user} />
 * }
 * ```
 *
 * @example API Route (App Router)
 * ```typescript
 * // app/api/rpc/[...path]/route.ts
 * import { createRPCHandler } from 'rpc.do/nextjs'
 * import { myApi } from '@/lib/api'
 *
 * export const { GET, POST } = createRPCHandler(myApi)
 * ```
 *
 * @packageDocumentation
 */

import type { RpcProxy, RpcResult, RpcInput, Transport, RpcClientMiddleware } from '../types'
import { RPC, type RpcOptions, type DOClientFeatures } from '../index'

// Browser window type for focus/online events (may not exist in SSR)
declare const window: { addEventListener: (event: string, handler: () => void) => void; removeEventListener: (event: string, handler: () => void) => void } | undefined

// ============================================================================
// Types
// ============================================================================

/**
 * Options for useRPC hook
 */
export interface UseRPCOptions<T> {
  /**
   * Unique key for caching/deduplication (similar to React Query)
   * If not provided, method + args will be used
   */
  key?: readonly unknown[]

  /**
   * Initial data to use before the first fetch completes
   */
  initialData?: T

  /**
   * Whether to skip the fetch (useful for conditional fetching)
   */
  skip?: boolean

  /**
   * Refetch on window focus
   * @default false
   */
  refetchOnFocus?: boolean

  /**
   * Refetch on reconnect
   * @default false
   */
  refetchOnReconnect?: boolean

  /**
   * Polling interval in milliseconds (0 = disabled)
   * @default 0
   */
  pollingInterval?: number

  /**
   * Custom error handler
   */
  onError?: (error: Error) => void

  /**
   * Custom success handler
   */
  onSuccess?: (data: T) => void
}

/**
 * Result of useRPC hook
 */
export interface UseRPCResult<T> {
  /** The fetched data (undefined until loaded) */
  data: T | undefined
  /** Whether the initial fetch is in progress */
  loading: boolean
  /** Whether a refetch is in progress */
  isRefetching: boolean
  /** Error if the fetch failed */
  error: Error | null
  /** Manually trigger a refetch */
  refetch: () => Promise<void>
  /** Optimistically update data */
  mutate: (data: T | ((prev: T | undefined) => T)) => void
}

/**
 * Options for useRPCMutation hook
 */
export interface UseRPCMutationOptions<TData, TVariables> {
  /**
   * Called before mutation (useful for optimistic updates)
   */
  onMutate?: (variables: TVariables) => void | Promise<void>

  /**
   * Called on successful mutation
   */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>

  /**
   * Called on mutation error
   */
  onError?: (error: Error, variables: TVariables) => void | Promise<void>

  /**
   * Called after mutation completes (success or error)
   */
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables
  ) => void | Promise<void>
}

/**
 * Result of useRPCMutation hook
 */
export interface UseRPCMutationResult<TData, TVariables> {
  /** Execute the mutation */
  mutate: (variables: TVariables) => void
  /** Execute the mutation and return a promise */
  mutateAsync: (variables: TVariables) => Promise<TData>
  /** The mutation result data */
  data: TData | undefined
  /** Whether the mutation is in progress */
  loading: boolean
  /** Mutation error if it failed */
  error: Error | null
  /** Whether the mutation has ever been called */
  isIdle: boolean
  /** Whether the mutation was successful */
  isSuccess: boolean
  /** Whether the mutation failed */
  isError: boolean
  /** Reset the mutation state */
  reset: () => void
}

/**
 * Options for server-side RPC client
 */
export interface ServerRPCOptions extends RpcOptions {
  /**
   * Cache strategy for server components
   * @default 'force-cache'
   */
  cache?: 'default' | 'force-cache' | 'no-cache' | 'no-store' | 'only-if-cached' | 'reload'

  /**
   * Revalidation time in seconds (for ISR)
   */
  revalidate?: number | false

  /**
   * Tags for on-demand revalidation
   */
  tags?: string[]
}

/**
 * Next.js API route handler options
 */
export interface RPCHandlerOptions {
  /**
   * Base path for RPC routes (e.g., '/api/rpc')
   */
  basePath?: string

  /**
   * CORS configuration
   */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
    headers?: string[]
    credentials?: boolean
  }

  /**
   * Custom error handler
   */
  onError?: (error: Error, req: Request) => Response | Promise<Response>

  /**
   * Authentication handler - return null to reject, or context to pass to handlers
   */
  authenticate?: (req: Request) => Promise<unknown | null>
}

// ============================================================================
// Client-side Hooks (React 18+)
// ============================================================================

// Simple in-memory cache for deduplication
const queryCache = new Map<string, { data: unknown; timestamp: number; promise?: Promise<unknown> }>()

/**
 * Generate a cache key from method path and arguments
 */
function getCacheKey(key: readonly unknown[] | undefined, methodPath: string, args: unknown[]): string {
  if (key) {
    return JSON.stringify(key)
  }
  return JSON.stringify([methodPath, ...args])
}

/**
 * React hook for RPC queries with automatic caching and revalidation.
 *
 * This hook provides a data-fetching pattern similar to React Query but
 * designed specifically for rpc.do. It handles:
 * - Automatic caching and deduplication
 * - Loading and error states
 * - Manual refetching
 * - Optimistic updates
 * - Optional polling
 *
 * @typeParam TMethod - The RPC method type
 * @param method - The RPC method to call (e.g., rpc.users.get)
 * @param args - Arguments to pass to the method
 * @param options - Configuration options
 * @returns Query result with data, loading state, error, and control functions
 *
 * @example Basic usage
 * ```typescript
 * 'use client'
 * import { useRPC } from 'rpc.do/nextjs'
 * import { rpc } from '@/lib/rpc'
 *
 * function UserList() {
 *   const { data, loading, error } = useRPC(rpc.users.list, [])
 *
 *   if (loading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <ul>
 *       {data?.map(user => <li key={user.id}>{user.name}</li>)}
 *     </ul>
 *   )
 * }
 * ```
 *
 * @example With custom key and initial data
 * ```typescript
 * const { data, refetch } = useRPC(
 *   rpc.users.get,
 *   [userId],
 *   {
 *     key: ['user', userId],
 *     initialData: cachedUser,
 *     onSuccess: (user) => console.log('Fetched:', user.name)
 *   }
 * )
 * ```
 *
 * @example Conditional fetching
 * ```typescript
 * const { data } = useRPC(
 *   rpc.users.get,
 *   [userId],
 *   { skip: !userId }
 * )
 * ```
 */
export function useRPC<
  TMethod extends (...args: any[]) => Promise<any>
>(
  method: TMethod,
  args: Parameters<TMethod>,
  options?: UseRPCOptions<Awaited<ReturnType<TMethod>>>
): UseRPCResult<Awaited<ReturnType<TMethod>>> {
  // Import React dynamically to avoid bundling issues
  // This module requires React to be installed as a peer dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const React = require('react') as {
    useState: <T>(initial: T) => [T, (value: T | ((prev: T) => T)) => void]
    useRef: <T>(initial: T) => { current: T }
    useCallback: <T>(fn: T, deps: unknown[]) => T
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => void
  }

  type TData = Awaited<ReturnType<TMethod>>

  const [data, setData] = React.useState<TData | undefined>(options?.initialData)
  const [loading, setLoading] = React.useState<boolean>(!options?.skip && !options?.initialData)
  const [isRefetching, setIsRefetching] = React.useState<boolean>(false)
  const [error, setError] = React.useState<Error | null>(null)

  // Use a ref to track if this is the initial mount
  const isMountedRef = React.useRef<boolean>(true)
  const argsRef = React.useRef<Parameters<TMethod>>(args)
  argsRef.current = args

  // Generate cache key - use method name from toString if available
  const methodPath = (method as unknown as { toString: () => string }).toString?.() || 'unknown'
  const cacheKey = getCacheKey(options?.key, methodPath, args)

  const fetchData = React.useCallback(async (isRefetch = false) => {
    if (options?.skip) return

    if (isRefetch) {
      setIsRefetching(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      // Check cache for deduplication
      const cached = queryCache.get(cacheKey)
      if (cached?.promise) {
        // Wait for in-flight request
        const result = await cached.promise as TData
        if (isMountedRef.current) {
          setData(result)
          options?.onSuccess?.(result)
        }
        return
      }

      // Create new request
      const promise = method(...argsRef.current)
      queryCache.set(cacheKey, { data: undefined, timestamp: Date.now(), promise })

      const result = await promise as TData

      // Update cache
      queryCache.set(cacheKey, { data: result, timestamp: Date.now() })

      if (isMountedRef.current) {
        setData(result)
        options?.onSuccess?.(result)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      queryCache.delete(cacheKey)

      if (isMountedRef.current) {
        setError(error)
        options?.onError?.(error)
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
        setIsRefetching(false)
      }
    }
  }, [cacheKey, method, options?.skip, options?.onError, options?.onSuccess])

  // Initial fetch
  React.useEffect(() => {
    isMountedRef.current = true
    fetchData()

    return () => {
      isMountedRef.current = false
    }
  }, [fetchData])

  // Polling
  React.useEffect(() => {
    if (!options?.pollingInterval || options.pollingInterval <= 0) return

    const intervalId = setInterval(() => {
      fetchData(true)
    }, options.pollingInterval)

    return () => clearInterval(intervalId)
  }, [options?.pollingInterval, fetchData])

  // Window focus refetch - only runs in browser environment
  React.useEffect(() => {
    if (!options?.refetchOnFocus) return
    // Check for browser window object
    const win = typeof window !== 'undefined' ? window : null
    if (!win) return

    const handleFocus = () => fetchData(true)
    win.addEventListener('focus', handleFocus)
    return () => win.removeEventListener('focus', handleFocus)
  }, [options?.refetchOnFocus, fetchData])

  // Reconnect refetch - only runs in browser environment
  React.useEffect(() => {
    if (!options?.refetchOnReconnect) return
    // Check for browser window object
    const win = typeof window !== 'undefined' ? window : null
    if (!win) return

    const handleOnline = () => fetchData(true)
    win.addEventListener('online', handleOnline)
    return () => win.removeEventListener('online', handleOnline)
  }, [options?.refetchOnReconnect, fetchData])

  const refetch = React.useCallback(async () => {
    await fetchData(true)
  }, [fetchData])

  const mutate = React.useCallback((newData: TData | ((prev: TData | undefined) => TData)): void => {
    setData((prev) => {
      if (typeof newData === 'function') {
        return (newData as (p: TData | undefined) => TData)(prev as TData | undefined)
      }
      return newData
    })
  }, [])

  return {
    data,
    loading,
    isRefetching,
    error,
    refetch,
    mutate,
  }
}

/**
 * React hook for RPC mutations with optimistic updates and callbacks.
 *
 * This hook is designed for data-modifying operations (create, update, delete).
 * It provides:
 * - Loading and error states
 * - Success/error callbacks
 * - Optimistic update support via onMutate
 * - Async and sync mutation triggers
 *
 * @typeParam TMethod - The RPC method type
 * @param method - The RPC method to call
 * @param options - Mutation options including callbacks
 * @returns Mutation result with mutate function and state
 *
 * @example Basic mutation
 * ```typescript
 * 'use client'
 * import { useRPCMutation } from 'rpc.do/nextjs'
 * import { rpc } from '@/lib/rpc'
 *
 * function CreateUserForm() {
 *   const { mutate, loading, error } = useRPCMutation(rpc.users.create)
 *
 *   const handleSubmit = (e: FormEvent) => {
 *     e.preventDefault()
 *     mutate({ name: 'John', email: 'john@example.com' })
 *   }
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       ...
 *       <button disabled={loading}>Create User</button>
 *     </form>
 *   )
 * }
 * ```
 *
 * @example With callbacks and optimistic update
 * ```typescript
 * const { mutateAsync } = useRPCMutation(rpc.users.update, {
 *   onMutate: (variables) => {
 *     // Optimistically update UI
 *     queryClient.setQueryData(['user', variables.id], variables)
 *   },
 *   onSuccess: (data, variables) => {
 *     toast.success('User updated!')
 *   },
 *   onError: (error, variables) => {
 *     // Rollback optimistic update
 *     queryClient.invalidateQueries(['user', variables.id])
 *     toast.error(error.message)
 *   },
 *   onSettled: () => {
 *     // Refetch to ensure consistency
 *     queryClient.refetchQueries(['user'])
 *   }
 * })
 * ```
 */
export function useRPCMutation<
  TMethod extends (...args: any[]) => Promise<any>
>(
  method: TMethod,
  options?: UseRPCMutationOptions<
    Awaited<ReturnType<TMethod>>,
    Parameters<TMethod>[0]
  >
): UseRPCMutationResult<
  Awaited<ReturnType<TMethod>>,
  Parameters<TMethod>[0]
> {
  // Import React dynamically to avoid bundling issues
  // This module requires React to be installed as a peer dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const React = require('react') as {
    useState: <T>(initial: T) => [T, (value: T | ((prev: T) => T)) => void]
    useRef: <T>(initial: T) => { current: T }
    useCallback: <T>(fn: T, deps: unknown[]) => T
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => void
  }

  type TData = Awaited<ReturnType<TMethod>>
  type TVariables = Parameters<TMethod>[0]

  const [data, setData] = React.useState<TData | undefined>(undefined)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [error, setError] = React.useState<Error | null>(null)
  const [isIdle, setIsIdle] = React.useState<boolean>(true)
  const [isSuccess, setIsSuccess] = React.useState<boolean>(false)
  const [isError, setIsError] = React.useState<boolean>(false)

  const isMountedRef = React.useRef<boolean>(true)

  React.useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const mutateAsync = React.useCallback(async (variables: TVariables): Promise<TData> => {
    setLoading(true)
    setError(null)
    setIsIdle(false)
    setIsSuccess(false)
    setIsError(false)

    try {
      await options?.onMutate?.(variables)
      const result = await method(variables) as TData

      if (isMountedRef.current) {
        setData(result)
        setIsSuccess(true)
      }

      await options?.onSuccess?.(result, variables)
      await options?.onSettled?.(result, null, variables)

      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      if (isMountedRef.current) {
        setError(error)
        setIsError(true)
      }

      await options?.onError?.(error, variables)
      await options?.onSettled?.(undefined, error, variables)

      throw error
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [method, options])

  const mutate = React.useCallback((variables: TVariables): void => {
    mutateAsync(variables).catch(() => {
      // Error is already handled in mutateAsync
    })
  }, [mutateAsync])

  const reset = React.useCallback(() => {
    setData(undefined)
    setLoading(false)
    setError(null)
    setIsIdle(true)
    setIsSuccess(false)
    setIsError(false)
  }, [])

  return {
    mutate,
    mutateAsync,
    data,
    loading,
    error,
    isIdle,
    isSuccess,
    isError,
    reset,
  }
}

// ============================================================================
// Server-side utilities
// ============================================================================

/**
 * Create a server-side RPC client for use in Server Components.
 *
 * This creates an RPC client configured for server-side usage with
 * Next.js caching and revalidation support. The client uses the
 * enhanced fetch with Next.js cache options.
 *
 * @typeParam T - The RPC API type
 * @param url - The RPC endpoint URL
 * @param options - Server RPC options including cache configuration
 * @returns A typed RPC proxy for server-side use
 *
 * @example Basic usage in Server Component
 * ```typescript
 * // app/users/page.tsx
 * import { createServerRPC } from 'rpc.do/nextjs'
 *
 * const rpc = createServerRPC<MyAPI>('https://api.example.com/rpc')
 *
 * export default async function UsersPage() {
 *   const users = await rpc.users.list()
 *   return <UserList users={users} />
 * }
 * ```
 *
 * @example With ISR (Incremental Static Regeneration)
 * ```typescript
 * const rpc = createServerRPC<MyAPI>('https://api.example.com/rpc', {
 *   revalidate: 60, // Revalidate every 60 seconds
 *   tags: ['users']
 * })
 *
 * // In another file, trigger on-demand revalidation:
 * // revalidateTag('users')
 * ```
 *
 * @example With authentication
 * ```typescript
 * import { cookies } from 'next/headers'
 *
 * async function getServerRPC() {
 *   const cookieStore = cookies()
 *   const token = cookieStore.get('auth-token')?.value
 *
 *   return createServerRPC<MyAPI>('https://api.example.com/rpc', {
 *     auth: token,
 *   })
 * }
 * ```
 */
export function createServerRPC<T extends object = Record<string, unknown>>(
  url: string,
  options?: ServerRPCOptions
): RpcProxy<T> & DOClientFeatures {
  // Pass through to main RPC function - it handles URL-based transport selection
  return RPC<T>(url, options)
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * Next.js API route handler types
 */
type NextRequest = Request
type NextResponse = Response

/**
 * Pages Router API request/response types
 */
interface PagesApiRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  query?: Record<string, string | string[]>
}

interface PagesApiResponse {
  status: (code: number) => PagesApiResponse
  json: (body: unknown) => void
  setHeader: (name: string, value: string) => void
  end: () => void
}

/**
 * Create App Router API route handlers for RPC.
 *
 * This creates GET and POST handlers that can be exported directly from
 * an App Router route file. It handles:
 * - JSON-RPC 2.0 protocol
 * - CORS configuration
 * - Error handling
 * - Optional authentication
 *
 * @param handlers - Object with RPC method implementations
 * @param options - Handler configuration
 * @returns Object with GET and POST handlers for App Router
 *
 * @example Basic usage
 * ```typescript
 * // app/api/rpc/[...path]/route.ts
 * import { createRPCHandler } from 'rpc.do/nextjs'
 *
 * const handlers = {
 *   users: {
 *     list: async () => db.users.findMany(),
 *     get: async (id: string) => db.users.findUnique({ where: { id } }),
 *     create: async (data: { name: string }) => db.users.create({ data }),
 *   },
 *   posts: {
 *     list: async () => db.posts.findMany(),
 *   },
 * }
 *
 * export const { GET, POST } = createRPCHandler(handlers)
 * ```
 *
 * @example With authentication and CORS
 * ```typescript
 * export const { GET, POST } = createRPCHandler(handlers, {
 *   cors: {
 *     origin: ['https://myapp.com'],
 *     credentials: true,
 *   },
 *   authenticate: async (req) => {
 *     const token = req.headers.get('Authorization')?.replace('Bearer ', '')
 *     if (!token) return null
 *     return verifyToken(token)
 *   },
 *   onError: (error, req) => {
 *     console.error('RPC Error:', error)
 *     return new Response(JSON.stringify({ error: error.message }), {
 *       status: 500,
 *       headers: { 'Content-Type': 'application/json' }
 *     })
 *   }
 * })
 * ```
 */
export function createRPCHandler(
  handlers: Record<string, unknown>,
  options?: RPCHandlerOptions
): { GET: (req: NextRequest) => Promise<NextResponse>; POST: (req: NextRequest) => Promise<NextResponse> } {
  const handleRequest = async (req: NextRequest): Promise<NextResponse> => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return createCORSResponse(options?.cors)
    }

    // Add CORS headers to response
    const corsHeaders = getCORSHeaders(options?.cors)

    try {
      // Authenticate if handler provided
      let context: unknown = null
      if (options?.authenticate) {
        context = await options.authenticate(req)
        if (context === null) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }
      }

      // Parse request body for POST
      let body: unknown = {}
      if (req.method === 'POST') {
        body = await req.json()
      }

      // Extract method path from URL or body
      const url = new URL(req.url)
      let methodPath: string

      if (options?.basePath) {
        // Remove base path to get method path
        methodPath = url.pathname.replace(options.basePath, '').replace(/^\/+/, '').replace(/\//g, '.')
      } else {
        // Try to get from body (JSON-RPC style)
        const rpcBody = body as { method?: string; params?: unknown[] }
        methodPath = rpcBody.method || ''
      }

      if (!methodPath) {
        return new Response(JSON.stringify({ error: 'Method not specified' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }

      // Navigate to handler
      const parts = methodPath.split('.')
      let handler: unknown = handlers

      for (const part of parts) {
        if (handler === null || handler === undefined || typeof handler !== 'object') {
          return new Response(JSON.stringify({ error: `Method not found: ${methodPath}` }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }
        handler = (handler as Record<string, unknown>)[part]
      }

      if (typeof handler !== 'function') {
        return new Response(JSON.stringify({ error: `Method not found: ${methodPath}` }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }

      // Get params from body
      const rpcBody = body as { params?: unknown[] }
      const params = rpcBody.params || []

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(...params)

      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    } catch (error) {
      if (options?.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)), req)
      }

      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }
  }

  return {
    GET: handleRequest,
    POST: handleRequest,
  }
}

/**
 * Create a Pages Router API handler for RPC.
 *
 * This creates a handler compatible with the Next.js Pages Router API format.
 * It wraps the same logic as createRPCHandler but adapts to the req/res pattern.
 *
 * @param handlers - Object with RPC method implementations
 * @param options - Handler configuration
 * @returns API handler function for Pages Router
 *
 * @example
 * ```typescript
 * // pages/api/rpc/[...path].ts
 * import { createPagesRPCHandler } from 'rpc.do/nextjs'
 *
 * const handlers = {
 *   users: {
 *     list: async () => db.users.findMany(),
 *     get: async (id: string) => db.users.findUnique({ where: { id } }),
 *   },
 * }
 *
 * export default createPagesRPCHandler(handlers)
 * ```
 */
export function createPagesRPCHandler(
  handlers: Record<string, unknown>,
  options?: RPCHandlerOptions
): (req: PagesApiRequest, res: PagesApiResponse) => Promise<void> {
  return async (req: PagesApiRequest, res: PagesApiResponse): Promise<void> => {
    // Set CORS headers
    const corsHeaders = getCORSHeaders(options?.cors)
    for (const [key, value] of Object.entries(corsHeaders)) {
      res.setHeader(key, value)
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    try {
      // Parse method path from URL
      const url = req.url || ''
      let methodPath: string

      if (options?.basePath) {
        methodPath = url.replace(options.basePath, '').replace(/^\/+/, '').replace(/\//g, '.').split('?')[0] || ''
      } else {
        const body = req.body as { method?: string } | undefined
        methodPath = body?.method || ''
      }

      if (!methodPath) {
        res.status(400).json({ error: 'Method not specified' })
        return
      }

      // Navigate to handler
      const parts = methodPath.split('.')
      let handler: unknown = handlers

      for (const part of parts) {
        if (handler === null || handler === undefined || typeof handler !== 'object') {
          res.status(404).json({ error: `Method not found: ${methodPath}` })
          return
        }
        handler = (handler as Record<string, unknown>)[part]
      }

      if (typeof handler !== 'function') {
        res.status(404).json({ error: `Method not found: ${methodPath}` })
        return
      }

      // Get params from body
      const body = req.body as { params?: unknown[] } | undefined
      const params = body?.params || []

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(...params)
      res.status(200).json({ result })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
}

// ============================================================================
// CORS Utilities
// ============================================================================

function getCORSHeaders(cors?: RPCHandlerOptions['cors']): Record<string, string> {
  if (!cors) return {}

  const headers: Record<string, string> = {}

  if (cors.origin) {
    if (cors.origin === true) {
      headers['Access-Control-Allow-Origin'] = '*'
    } else if (Array.isArray(cors.origin)) {
      headers['Access-Control-Allow-Origin'] = cors.origin.join(', ')
    } else {
      headers['Access-Control-Allow-Origin'] = cors.origin
    }
  }

  if (cors.methods) {
    headers['Access-Control-Allow-Methods'] = cors.methods.join(', ')
  } else {
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  }

  if (cors.headers) {
    headers['Access-Control-Allow-Headers'] = cors.headers.join(', ')
  } else {
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
  }

  if (cors.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  return headers
}

function createCORSResponse(cors?: RPCHandlerOptions['cors']): Response {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(cors)
  })
}

// ============================================================================
// Cache Utilities
// ============================================================================

/**
 * Clear the RPC query cache.
 *
 * Useful for invalidating cached data after mutations.
 *
 * @param key - Optional specific key to clear. If not provided, clears all.
 *
 * @example
 * ```typescript
 * // Clear all cache
 * clearRPCCache()
 *
 * // Clear specific key
 * clearRPCCache(['user', userId])
 * ```
 */
export function clearRPCCache(key?: readonly unknown[]): void {
  if (key) {
    queryCache.delete(JSON.stringify(key))
  } else {
    queryCache.clear()
  }
}

/**
 * Invalidate and refetch queries matching a key pattern.
 *
 * @param predicate - Function to test cache keys
 *
 * @example
 * ```typescript
 * // Invalidate all user-related queries
 * invalidateRPCQueries((key) => key.startsWith('["user"'))
 * ```
 */
export function invalidateRPCQueries(predicate: (key: string) => boolean): void {
  for (const key of queryCache.keys()) {
    if (predicate(key)) {
      queryCache.delete(key)
    }
  }
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { RpcProxy, RpcResult, RpcInput, RpcOptions, DOClientFeatures }
