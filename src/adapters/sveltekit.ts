/**
 * rpc.do SvelteKit Adapter
 *
 * Framework-specific integration for SvelteKit applications with full
 * support for Svelte stores, load functions, server hooks, and endpoints.
 *
 * Features:
 * - Svelte store integration with writable and derived stores
 * - load() function helpers for server-side data fetching
 * - Server hooks integration for authentication and middleware
 * - +server.ts endpoint wrapper for RPC handlers
 *
 * @example Svelte Store
 * ```typescript
 * // lib/stores/users.ts
 * import { createRPCStore } from 'rpc.do/sveltekit'
 * import { rpc } from '$lib/rpc'
 *
 * export const usersStore = createRPCStore(rpc.users.list)
 * ```
 *
 * @example Load Function
 * ```typescript
 * // +page.server.ts
 * import { createRPCLoad } from 'rpc.do/sveltekit'
 * import { rpc } from '$lib/rpc'
 *
 * export const load = createRPCLoad(async ({ params }) => {
 *   return {
 *     user: await rpc.users.get(params.id),
 *     posts: await rpc.posts.byUser(params.id)
 *   }
 * })
 * ```
 *
 * @example Server Hook
 * ```typescript
 * // hooks.server.ts
 * import { createRPCHook } from 'rpc.do/sveltekit'
 *
 * export const handle = createRPCHook({
 *   basePath: '/api/rpc',
 *   handlers: myHandlers
 * })
 * ```
 *
 * @example +server.ts Endpoint
 * ```typescript
 * // routes/api/rpc/[...path]/+server.ts
 * import { createRPCEndpoint } from 'rpc.do/sveltekit'
 *
 * export const { GET, POST } = createRPCEndpoint(handlers)
 * ```
 *
 * @packageDocumentation
 */

import type { RpcProxy, RpcResult, RpcInput, RpcClientMiddleware } from '../types'
import { RPC, type RpcOptions, type DOClientFeatures } from '../index'

// ============================================================================
// Types
// ============================================================================

/**
 * Svelte store subscribe function type
 */
type Subscriber<T> = (value: T) => void
type Unsubscriber = () => void
type Updater<T> = (value: T) => T

/**
 * Minimal Svelte readable store interface
 */
interface Readable<T> {
  subscribe: (run: Subscriber<T>, invalidate?: () => void) => Unsubscriber
}

/**
 * Minimal Svelte writable store interface
 */
interface Writable<T> extends Readable<T> {
  set: (value: T) => void
  update: (updater: Updater<T>) => void
}

/**
 * RPC store state
 */
export interface RPCStoreState<T> {
  /** The fetched data */
  data: T | undefined
  /** Whether loading is in progress */
  loading: boolean
  /** Error if fetch failed */
  error: Error | null
  /** Whether initial load has completed */
  initialized: boolean
}

/**
 * RPC store with additional methods
 */
export interface RPCStore<T> extends Readable<RPCStoreState<T>> {
  /** Manually fetch/refetch data */
  fetch: (...args: unknown[]) => Promise<void>
  /** Refetch with current arguments */
  refetch: () => Promise<void>
  /** Optimistically update data */
  mutate: (data: T | ((prev: T | undefined) => T)) => void
  /** Reset store to initial state */
  reset: () => void
}

/**
 * Options for RPC store
 */
export interface RPCStoreOptions<T> {
  /** Initial data */
  initialData?: T
  /** Whether to fetch on subscription */
  fetchOnSubscribe?: boolean
  /** Default arguments for fetch */
  defaultArgs?: unknown[]
  /** Error handler */
  onError?: (error: Error) => void
  /** Success handler */
  onSuccess?: (data: T) => void
}

/**
 * Mutation store state
 */
export interface MutationStoreState<T> {
  /** The mutation result */
  data: T | undefined
  /** Whether mutation is in progress */
  loading: boolean
  /** Error if mutation failed */
  error: Error | null
  /** Whether mutation has been called */
  isIdle: boolean
  /** Whether mutation succeeded */
  isSuccess: boolean
  /** Whether mutation failed */
  isError: boolean
}

/**
 * Mutation store with trigger function
 */
export interface MutationStore<TData, TVariables> extends Readable<MutationStoreState<TData>> {
  /** Trigger the mutation */
  mutate: (variables: TVariables) => Promise<TData>
  /** Reset store to initial state */
  reset: () => void
}

/**
 * Options for mutation store
 */
export interface MutationStoreOptions<TData, TVariables> {
  /** Called before mutation */
  onMutate?: (variables: TVariables) => void | Promise<void>
  /** Called on success */
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>
  /** Called on error */
  onError?: (error: Error, variables: TVariables) => void | Promise<void>
  /** Called on completion */
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void | Promise<void>
}

/**
 * SvelteKit RequestEvent (simplified type)
 */
interface RequestEvent {
  request: Request
  url: URL
  params: Record<string, string>
  locals: Record<string, unknown>
  fetch: typeof fetch
  cookies: {
    get: (name: string) => string | undefined
    set: (name: string, value: string, opts?: Record<string, unknown>) => void
    delete: (name: string, opts?: Record<string, unknown>) => void
  }
  platform?: unknown
}

/**
 * SvelteKit ServerLoadEvent
 */
interface ServerLoadEvent extends RequestEvent {
  parent: () => Promise<Record<string, unknown>>
  depends: (...deps: string[]) => void
}

/**
 * SvelteKit Handle function type
 */
type Handle = (input: {
  event: RequestEvent
  resolve: (event: RequestEvent) => Promise<Response>
}) => Promise<Response>

/**
 * Server endpoint options
 */
export interface RPCEndpointOptions {
  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
    headers?: string[]
    credentials?: boolean
  }
  /** Authentication handler */
  authenticate?: (event: RequestEvent) => Promise<unknown | null>
  /** Error handler */
  onError?: (error: Error, event: RequestEvent) => Response | Promise<Response>
}

/**
 * Hook options
 */
export interface RPCHookOptions extends RPCEndpointOptions {
  /** Base path for RPC routes */
  basePath: string
  /** RPC method handlers */
  handlers: Record<string, unknown>
}

// ============================================================================
// Store Implementations
// ============================================================================

/**
 * Create a simple writable store (Svelte-compatible)
 */
function createWritable<T>(initialValue: T): Writable<T> {
  let value = initialValue
  const subscribers = new Set<Subscriber<T>>()

  function set(newValue: T): void {
    value = newValue
    subscribers.forEach(fn => fn(value))
  }

  function update(fn: Updater<T>): void {
    set(fn(value))
  }

  function subscribe(run: Subscriber<T>): Unsubscriber {
    subscribers.add(run)
    run(value)
    return () => subscribers.delete(run)
  }

  return { subscribe, set, update }
}

/**
 * Create an RPC store for reactive data fetching.
 *
 * This creates a Svelte store that wraps an RPC method call with
 * automatic state management for loading, error, and data states.
 *
 * @typeParam TMethod - The RPC method type
 * @param method - The RPC method to call
 * @param options - Store configuration options
 * @returns An RPC store with fetch, refetch, mutate, and reset methods
 *
 * @example Basic usage
 * ```svelte
 * <script>
 *   import { createRPCStore } from 'rpc.do/sveltekit'
 *   import { rpc } from '$lib/rpc'
 *
 *   const users = createRPCStore(rpc.users.list)
 *
 *   // Fetch on mount
 *   users.fetch()
 * </script>
 *
 * {#if $users.loading}
 *   <Spinner />
 * {:else if $users.error}
 *   <Error message={$users.error.message} />
 * {:else if $users.data}
 *   <UserList users={$users.data} />
 * {/if}
 * ```
 *
 * @example With initial data and auto-fetch
 * ```typescript
 * const user = createRPCStore(rpc.users.get, {
 *   initialData: cachedUser,
 *   fetchOnSubscribe: true,
 *   defaultArgs: [userId],
 *   onSuccess: (data) => console.log('Fetched:', data.name)
 * })
 * ```
 *
 * @example Reactive refetching
 * ```svelte
 * <script>
 *   import { createRPCStore } from 'rpc.do/sveltekit'
 *
 *   export let userId
 *
 *   const user = createRPCStore(rpc.users.get)
 *
 *   // Refetch when userId changes
 *   $: user.fetch(userId)
 * </script>
 * ```
 */
export function createRPCStore<
  TMethod extends (...args: any[]) => Promise<any>
>(
  method: TMethod,
  options?: RPCStoreOptions<Awaited<ReturnType<TMethod>>>
): RPCStore<Awaited<ReturnType<TMethod>>> {
  type TData = Awaited<ReturnType<TMethod>>

  const initialState: RPCStoreState<TData> = {
    data: options?.initialData,
    loading: false,
    error: null,
    initialized: !!options?.initialData,
  }

  const store = createWritable<RPCStoreState<TData>>(initialState)
  let currentArgs: unknown[] = options?.defaultArgs || []
  let subscriberCount = 0
  let hasInitialFetch = false

  const fetch = async (...args: unknown[]): Promise<void> => {
    if (args.length > 0) {
      currentArgs = args
    }

    store.update(s => ({ ...s, loading: true, error: null }))

    try {
      const data = await method(...currentArgs) as TData
      store.update(s => ({ ...s, data, loading: false, initialized: true }))
      options?.onSuccess?.(data)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      store.update(s => ({ ...s, error, loading: false }))
      options?.onError?.(error)
    }
  }

  const refetch = async (): Promise<void> => {
    await fetch(...currentArgs)
  }

  const mutate = (data: TData | ((prev: TData | undefined) => TData)): void => {
    store.update(s => ({
      ...s,
      data: typeof data === 'function' ? (data as (prev: TData | undefined) => TData)(s.data) : data,
    }))
  }

  const reset = (): void => {
    store.set(initialState)
    currentArgs = options?.defaultArgs || []
    hasInitialFetch = false
  }

  // Wrap subscribe to handle fetchOnSubscribe
  const originalSubscribe = store.subscribe
  const subscribe = (run: Subscriber<RPCStoreState<TData>>, invalidate?: () => void): Unsubscriber => {
    subscriberCount++

    // Auto-fetch on first subscriber if configured
    if (options?.fetchOnSubscribe && subscriberCount === 1 && !hasInitialFetch) {
      hasInitialFetch = true
      fetch(...currentArgs)
    }

    const unsub = originalSubscribe(run, invalidate)
    return () => {
      subscriberCount--
      unsub()
    }
  }

  return {
    subscribe,
    fetch,
    refetch,
    mutate,
    reset,
  }
}

/**
 * Create a mutation store for data-modifying operations.
 *
 * This creates a Svelte store designed for mutations (create, update, delete)
 * with support for optimistic updates and lifecycle callbacks.
 *
 * @typeParam TMethod - The RPC method type
 * @param method - The RPC method to call
 * @param options - Mutation options including callbacks
 * @returns A mutation store with mutate and reset methods
 *
 * @example Basic mutation
 * ```svelte
 * <script>
 *   import { createMutationStore } from 'rpc.do/sveltekit'
 *   import { rpc } from '$lib/rpc'
 *
 *   const createUser = createMutationStore(rpc.users.create)
 *
 *   async function handleSubmit() {
 *     try {
 *       const user = await createUser.mutate({ name: 'John' })
 *       console.log('Created:', user.id)
 *     } catch (error) {
 *       console.error('Failed:', error)
 *     }
 *   }
 * </script>
 *
 * <button on:click={handleSubmit} disabled={$createUser.loading}>
 *   {$createUser.loading ? 'Creating...' : 'Create User'}
 * </button>
 *
 * {#if $createUser.error}
 *   <p class="error">{$createUser.error.message}</p>
 * {/if}
 * ```
 *
 * @example With callbacks
 * ```typescript
 * const updateUser = createMutationStore(rpc.users.update, {
 *   onMutate: (variables) => {
 *     // Optimistic update
 *     usersStore.mutate(users =>
 *       users.map(u => u.id === variables.id ? { ...u, ...variables } : u)
 *     )
 *   },
 *   onSuccess: (data, variables) => {
 *     toast.success('User updated!')
 *   },
 *   onError: (error, variables) => {
 *     // Rollback optimistic update
 *     usersStore.refetch()
 *     toast.error(error.message)
 *   }
 * })
 * ```
 */
export function createMutationStore<
  TMethod extends (...args: any[]) => Promise<any>
>(
  method: TMethod,
  options?: MutationStoreOptions<
    Awaited<ReturnType<TMethod>>,
    Parameters<TMethod>[0]
  >
): MutationStore<Awaited<ReturnType<TMethod>>, Parameters<TMethod>[0]> {
  type TData = Awaited<ReturnType<TMethod>>
  type TVariables = Parameters<TMethod>[0]

  const initialState: MutationStoreState<TData> = {
    data: undefined,
    loading: false,
    error: null,
    isIdle: true,
    isSuccess: false,
    isError: false,
  }

  const store = createWritable<MutationStoreState<TData>>(initialState)

  const mutate = async (variables: TVariables): Promise<TData> => {
    store.update(s => ({
      ...s,
      loading: true,
      error: null,
      isIdle: false,
      isSuccess: false,
      isError: false,
    }))

    try {
      await options?.onMutate?.(variables)
      const data = await method(variables) as TData

      store.update(s => ({
        ...s,
        data,
        loading: false,
        isSuccess: true,
      }))

      await options?.onSuccess?.(data, variables)
      await options?.onSettled?.(data, null, variables)

      return data
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      store.update(s => ({
        ...s,
        error,
        loading: false,
        isError: true,
      }))

      await options?.onError?.(error, variables)
      await options?.onSettled?.(undefined, error, variables)

      throw error
    }
  }

  const reset = (): void => {
    store.set(initialState)
  }

  return {
    subscribe: store.subscribe,
    mutate,
    reset,
  }
}

/**
 * Create a derived store from an RPC store.
 *
 * This creates a derived store that transforms the data from an RPC store,
 * useful for computed/derived values.
 *
 * @param store - The source RPC store
 * @param fn - Transform function for the data
 * @returns A readable store with the transformed value
 *
 * @example
 * ```typescript
 * const users = createRPCStore(rpc.users.list)
 *
 * // Derived store for user count
 * const userCount = deriveFromRPC(users, (state) =>
 *   state.data?.length ?? 0
 * )
 *
 * // Derived store for active users
 * const activeUsers = deriveFromRPC(users, (state) =>
 *   state.data?.filter(u => u.active) ?? []
 * )
 * ```
 */
export function deriveFromRPC<T, R>(
  store: RPCStore<T>,
  fn: (state: RPCStoreState<T>) => R
): Readable<R> {
  const derived = {
    subscribe: (run: Subscriber<R>): Unsubscriber => {
      return store.subscribe(state => run(fn(state)))
    }
  }
  return derived
}

// ============================================================================
// Load Function Helpers
// ============================================================================

/**
 * Create a typed load function wrapper for SvelteKit.
 *
 * This provides a convenient way to create load functions with type-safe
 * RPC calls and proper error handling.
 *
 * @param loader - Async function that fetches data using RPC
 * @returns A SvelteKit load function
 *
 * @example Basic usage
 * ```typescript
 * // +page.server.ts
 * import { createRPCLoad } from 'rpc.do/sveltekit'
 * import { rpc } from '$lib/rpc'
 *
 * export const load = createRPCLoad(async ({ params }) => {
 *   const user = await rpc.users.get(params.id)
 *   return { user }
 * })
 * ```
 *
 * @example With error handling
 * ```typescript
 * import { error } from '@sveltejs/kit'
 *
 * export const load = createRPCLoad(async ({ params }) => {
 *   const user = await rpc.users.get(params.id)
 *   if (!user) {
 *     throw error(404, 'User not found')
 *   }
 *   return { user }
 * })
 * ```
 *
 * @example Parallel data loading
 * ```typescript
 * export const load = createRPCLoad(async ({ params }) => {
 *   const [user, posts, comments] = await Promise.all([
 *     rpc.users.get(params.id),
 *     rpc.posts.byUser(params.id),
 *     rpc.comments.byUser(params.id)
 *   ])
 *
 *   return { user, posts, comments }
 * })
 * ```
 */
export function createRPCLoad<T extends Record<string, unknown>>(
  loader: (event: ServerLoadEvent) => Promise<T>
): (event: ServerLoadEvent) => Promise<T> {
  return loader
}

/**
 * Create a server-side RPC client for use in load functions.
 *
 * This creates an RPC client that can be used in SvelteKit server-side
 * contexts (load functions, actions, hooks).
 *
 * @typeParam T - The RPC API type
 * @param url - The RPC endpoint URL
 * @param options - RPC options
 * @returns A typed RPC proxy
 *
 * @example
 * ```typescript
 * // lib/server/rpc.ts
 * import { createServerRPC } from 'rpc.do/sveltekit'
 *
 * export const rpc = createServerRPC<MyAPI>('https://api.example.com/rpc')
 *
 * // +page.server.ts
 * import { rpc } from '$lib/server/rpc'
 *
 * export const load = async ({ params }) => {
 *   const user = await rpc.users.get(params.id)
 *   return { user }
 * }
 * ```
 */
export function createServerRPC<T extends object = Record<string, unknown>>(
  url: string,
  options?: RpcOptions
): RpcProxy<T> & DOClientFeatures {
  return RPC<T>(url, options)
}

// ============================================================================
// Server Hooks
// ============================================================================

/**
 * Create a SvelteKit handle hook for RPC endpoints.
 *
 * This creates a handle function that can be used in hooks.server.ts
 * to add RPC endpoint handling to your SvelteKit app.
 *
 * @param options - Hook configuration including basePath and handlers
 * @returns A SvelteKit handle function
 *
 * @example
 * ```typescript
 * // hooks.server.ts
 * import { createRPCHook } from 'rpc.do/sveltekit'
 *
 * const handlers = {
 *   users: {
 *     list: async () => db.users.findMany(),
 *     get: async (id: string) => db.users.findUnique({ where: { id } }),
 *     create: async (data: { name: string }) => db.users.create({ data })
 *   }
 * }
 *
 * export const handle = createRPCHook({
 *   basePath: '/api/rpc',
 *   handlers
 * })
 * ```
 *
 * @example With authentication
 * ```typescript
 * export const handle = createRPCHook({
 *   basePath: '/api/rpc',
 *   handlers,
 *   authenticate: async (event) => {
 *     const token = event.cookies.get('auth-token')
 *     if (!token) return null
 *     return await verifyToken(token)
 *   }
 * })
 * ```
 *
 * @example Composing with other hooks
 * ```typescript
 * import { sequence } from '@sveltejs/kit/hooks'
 *
 * const rpcHook = createRPCHook({ basePath: '/api/rpc', handlers })
 * const authHook = createAuthHook()
 *
 * export const handle = sequence(authHook, rpcHook)
 * ```
 */
export function createRPCHook(options: RPCHookOptions): Handle {
  return async ({ event, resolve }) => {
    const { basePath, handlers } = options

    // Check if this is an RPC request
    if (!event.url.pathname.startsWith(basePath)) {
      return resolve(event)
    }

    // Handle CORS preflight
    if (event.request.method === 'OPTIONS') {
      return createCORSResponse(options.cors)
    }

    const corsHeaders = getCORSHeaders(options.cors)

    try {
      // Authenticate if handler provided
      if (options.authenticate) {
        const auth = await options.authenticate(event)
        if (auth === null) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }
        event.locals['auth'] = auth
      }

      // Extract method path from URL
      const methodPath = event.url.pathname
        .replace(basePath, '')
        .replace(/^\/+/, '')
        .replace(/\//g, '.')

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

      // Parse request body for POST
      let params: unknown[] = []
      if (event.request.method === 'POST') {
        const body = await event.request.json()
        params = (body as { params?: unknown[] }).params || []
      }

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(...params)

      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    } catch (error) {
      if (options.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)), event)
      }

      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    }
  }
}

// ============================================================================
// +server.ts Endpoint Handler
// ============================================================================

/**
 * Create SvelteKit endpoint handlers for RPC.
 *
 * This creates GET and POST handlers that can be exported from a +server.ts
 * file to handle RPC requests.
 *
 * @param handlers - Object with RPC method implementations
 * @param options - Endpoint configuration
 * @returns Object with GET and POST handlers
 *
 * @example Basic usage
 * ```typescript
 * // routes/api/rpc/[...path]/+server.ts
 * import { createRPCEndpoint } from 'rpc.do/sveltekit'
 *
 * const handlers = {
 *   users: {
 *     list: async () => db.users.findMany(),
 *     get: async (id: string) => db.users.findUnique({ where: { id } }),
 *   }
 * }
 *
 * export const { GET, POST } = createRPCEndpoint(handlers)
 * ```
 *
 * @example With authentication
 * ```typescript
 * export const { GET, POST } = createRPCEndpoint(handlers, {
 *   authenticate: async (event) => {
 *     const token = event.cookies.get('session')
 *     return token ? await validateSession(token) : null
 *   },
 *   cors: {
 *     origin: 'https://myapp.com',
 *     credentials: true
 *   }
 * })
 * ```
 */
export function createRPCEndpoint(
  handlers: Record<string, unknown>,
  options?: RPCEndpointOptions
): {
  GET: (event: RequestEvent) => Promise<Response>
  POST: (event: RequestEvent) => Promise<Response>
  OPTIONS: (event: RequestEvent) => Promise<Response>
} {
  const handleRequest = async (event: RequestEvent): Promise<Response> => {
    const corsHeaders = getCORSHeaders(options?.cors)

    try {
      // Authenticate if handler provided
      if (options?.authenticate) {
        const auth = await options.authenticate(event)
        if (auth === null) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          })
        }
        event.locals['auth'] = auth
      }

      // Get method path from params (catch-all route)
      const pathParam = event.params['path']
      const methodPath = pathParam ? pathParam.replace(/\//g, '.') : ''

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

      // Parse request body for POST
      let params: unknown[] = []
      if (event.request.method === 'POST') {
        const body = await event.request.json()
        params = (body as { params?: unknown[] }).params || []
      }

      // Call handler
      const result = await (handler as (...args: unknown[]) => Promise<unknown>)(...params)

      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      })
    } catch (error) {
      if (options?.onError) {
        return options.onError(error instanceof Error ? error : new Error(String(error)), event)
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
    OPTIONS: async () => createCORSResponse(options?.cors),
  }
}

// ============================================================================
// Form Actions Helper
// ============================================================================

/**
 * Create a SvelteKit form action that calls an RPC method.
 *
 * This provides a convenient way to handle form submissions
 * that trigger RPC calls.
 *
 * @param method - The RPC method to call
 * @param options - Action options
 * @returns A SvelteKit action function
 *
 * @example
 * ```typescript
 * // +page.server.ts
 * import { createRPCAction } from 'rpc.do/sveltekit'
 * import { rpc } from '$lib/rpc'
 *
 * export const actions = {
 *   create: createRPCAction(rpc.users.create, {
 *     transformInput: (formData) => ({
 *       name: formData.get('name'),
 *       email: formData.get('email')
 *     }),
 *     onSuccess: (result) => ({ success: true, user: result }),
 *     onError: (error) => ({ success: false, error: error.message })
 *   })
 * }
 * ```
 */
export function createRPCAction<
  TMethod extends (...args: any[]) => Promise<any>,
  TResult = unknown
>(
  method: TMethod,
  options: {
    /** Transform form data to method arguments */
    transformInput: (formData: FormData) => Parameters<TMethod>[0]
    /** Transform successful result */
    onSuccess?: (result: Awaited<ReturnType<TMethod>>) => TResult
    /** Handle error */
    onError?: (error: Error) => TResult
  }
): (event: RequestEvent & { request: Request }) => Promise<TResult> {
  return async (event) => {
    try {
      const formData = await event.request.formData()
      const input = options.transformInput(formData)
      const result = await method(input)
      return options.onSuccess ? options.onSuccess(result) : (result as TResult)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (options.onError) {
        return options.onError(error)
      }
      throw error
    }
  }
}

// ============================================================================
// CORS Utilities
// ============================================================================

function getCORSHeaders(cors?: RPCEndpointOptions['cors']): Record<string, string> {
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

function createCORSResponse(cors?: RPCEndpointOptions['cors']): Response {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(cors)
  })
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { RpcProxy, RpcResult, RpcInput, RpcOptions, DOClientFeatures }
