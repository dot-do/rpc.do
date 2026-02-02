/**
 * React Integration Type Helpers for rpc.do
 *
 * This module provides type utilities for integrating rpc.do with React
 * data-fetching libraries like React Query and SWR.
 *
 * Note: This module has NO React dependency - it only provides types and
 * helper functions that work with any Promise-based library.
 *
 * @example
 * ```typescript
 * import { createQueryFn, getMethod } from 'rpc.do/react'
 * import { RPC } from 'rpc.do'
 * import { useQuery } from '@tanstack/react-query'
 *
 * interface API {
 *   users: { getById: (args: { id: string }) => { id: string; name: string } }
 * }
 *
 * const rpc = RPC<API>('https://api.example.com/rpc')
 *
 * // Create a query function
 * const getUserById = createQueryFn(rpc, 'users.getById')
 *
 * function UserProfile({ userId }: { userId: string }) {
 *   const { data } = useQuery({
 *     queryKey: ['user', userId],
 *     queryFn: () => getUserById({ id: userId }),
 *   })
 *   // ...
 * }
 * ```
 *
 * @packageDocumentation
 */

import type { RpcProxy, RpcResult, RpcInput, RPCProxy, RPCResult, RPCInput } from './types'

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Extract nested type from object by dot-notation path
 *
 * @example
 * ```typescript
 * interface API { users: { posts: { get: (id: string) => Post } } }
 * type GetPost = PathValue<API, 'users.posts.get'> // (id: string) => Post
 * ```
 */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
  ? T[P]
  : never

/**
 * Get all possible dot-notation paths for an object type
 *
 * @example
 * ```typescript
 * interface API { users: { get: () => User; list: () => User[] } }
 * type Paths = ObjectPaths<API> // 'users' | 'users.get' | 'users.list'
 * ```
 */
export type ObjectPaths<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends (...args: unknown[]) => unknown
        ? `${Prefix}${K}`
        : T[K] extends object
        ? `${Prefix}${K}` | ObjectPaths<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`
    }[keyof T & string]
  : never

/**
 * Get only method paths (paths that resolve to functions)
 */
export type MethodPaths<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends (...args: unknown[]) => unknown
        ? `${Prefix}${K}`
        : T[K] extends object
        ? MethodPaths<T[K], `${Prefix}${K}.`>
        : never
    }[keyof T & string]
  : never

/**
 * Extracts the function type from PathValue, using Extract to satisfy
 * TypeScript's constraint checking when PathValue can't be statically proven
 * to resolve to a function type.
 */
type PathFn<T, P extends string> = Extract<PathValue<T, P>, (...args: any[]) => any>

// ============================================================================
// Function Type Extraction Helpers
// ============================================================================

/**
 * Extracts the argument types from a function type.
 *
 * @example
 * ```typescript
 * type Fn = (id: string, name: string) => Promise<User>
 * type Args = ExtractFnArgs<Fn> // [id: string, name: string]
 * ```
 */
export type ExtractFnArgs<T extends (...args: unknown[]) => unknown> = T extends (...args: infer A) => unknown ? A : never

/**
 * Extracts the awaited return type from a function type.
 * Automatically unwraps Promises to get the resolved value type.
 *
 * @example
 * ```typescript
 * type Fn = (id: string) => Promise<User>
 * type Return = ExtractFnReturn<Fn> // User (not Promise<User>)
 * ```
 */
export type ExtractFnReturn<T extends (...args: unknown[]) => unknown> = T extends (...args: unknown[]) => infer R ? Awaited<R> : never

/**
 * Wraps a function type to return a Promise of its awaited return type.
 * This is used to create async wrapper functions that maintain the original
 * argument types while ensuring the return is always a Promise.
 *
 * @example
 * ```typescript
 * type Fn = (id: string) => User | Promise<User>
 * type Wrapped = AsyncWrapperFn<Fn> // (id: string) => Promise<User>
 * ```
 */
export type AsyncWrapperFn<T extends (...args: unknown[]) => unknown> = T extends (...args: infer A) => unknown
  ? (...args: A) => Promise<ExtractFnReturn<T>>
  : never

// ============================================================================
// Query Function Helpers
// ============================================================================

/**
 * Options for creating a query function
 */
export interface QueryFnOptions {
  /**
   * Custom error transformer
   * Useful for normalizing errors across different transports
   */
  transformError?: (error: unknown) => Error
}

/**
 * Options for creating a mutation function
 */
export interface MutationFnOptions extends QueryFnOptions {
  /**
   * Called before the mutation executes
   * Useful for optimistic updates
   */
  onMutate?: (args: unknown) => void | Promise<void>
}

/**
 * Navigate to a nested method on an RPC proxy using dot-notation path
 *
 * @param rpc - The RPC proxy instance
 * @param path - Dot-notation path to the method (e.g., 'users.getById')
 * @returns The method at the specified path
 *
 * @example
 * ```typescript
 * const rpc = RPC<API>('https://api.example.com/rpc')
 * const getUser = getMethod(rpc, 'users.getById')
 * const user = await getUser({ id: '123' })
 * ```
 */
export function getMethod<T extends object, P extends MethodPaths<T> & string>(
  rpc: RpcProxy<T>,
  path: P
): PathFn<T, P> {
  const parts = (path as string).split('.')
  let target: unknown = rpc

  for (const part of parts) {
    if (target === null || target === undefined) {
      throw new Error(`Invalid RPC path: ${path}`)
    }
    target = (target as Record<string, unknown>)[part]
  }

  return target as PathFn<T, P>
}

/**
 * Create a query function for React Query or similar libraries
 *
 * This is a type-safe way to create query functions that properly
 * infer the return type from the RPC method.
 *
 * @param rpc - The RPC proxy instance
 * @param path - Dot-notation path to the method
 * @param options - Optional configuration
 * @returns A function that can be used as a queryFn
 *
 * @example
 * ```typescript
 * const getUserById = createQueryFn(rpc, 'users.getById')
 *
 * // In React Query:
 * const { data } = useQuery({
 *   queryKey: ['user', userId],
 *   queryFn: () => getUserById({ id: userId }),
 * })
 * ```
 */
export function createQueryFn<T extends object, P extends MethodPaths<T> & string>(
  rpc: RpcProxy<T>,
  path: P,
  options?: QueryFnOptions
): AsyncWrapperFn<PathFn<T, P>> {
  const method = getMethod(rpc, path)

  if (typeof method !== 'function') {
    throw new Error(`Path ${path} does not resolve to a method`)
  }

  const wrappedFn = async (...args: unknown[]): Promise<unknown> => {
    try {
      return await (method as (...args: unknown[]) => Promise<unknown>)(...args)
    } catch (error) {
      if (options?.transformError) {
        throw options.transformError(error)
      }
      throw error
    }
  }

  return wrappedFn as AsyncWrapperFn<PathFn<T, P>>
}

/**
 * Create a mutation function for React Query or similar libraries
 *
 * Similar to createQueryFn but with mutation-specific options like onMutate.
 *
 * @param rpc - The RPC proxy instance
 * @param path - Dot-notation path to the method
 * @param options - Optional configuration
 * @returns A function that can be used as a mutationFn
 *
 * @example
 * ```typescript
 * const createUser = createMutationFn(rpc, 'users.create')
 *
 * // In React Query:
 * const mutation = useMutation({
 *   mutationFn: createUser,
 * })
 * ```
 */
export function createMutationFn<T extends object, P extends MethodPaths<T> & string>(
  rpc: RpcProxy<T>,
  path: P,
  options?: MutationFnOptions
): AsyncWrapperFn<PathFn<T, P>> {
  const method = getMethod(rpc, path)

  if (typeof method !== 'function') {
    throw new Error(`Path ${path} does not resolve to a method`)
  }

  const wrappedFn = async (...args: unknown[]): Promise<unknown> => {
    try {
      if (options?.onMutate) {
        await options.onMutate(args)
      }
      return await (method as (...args: unknown[]) => Promise<unknown>)(...args)
    } catch (error) {
      if (options?.transformError) {
        throw options.transformError(error)
      }
      throw error
    }
  }

  return wrappedFn as AsyncWrapperFn<PathFn<T, P>>
}

// ============================================================================
// React Query Type Helpers
// ============================================================================

/**
 * Extract the data type that a query function will return
 *
 * @example
 * ```typescript
 * type UserData = QueryData<typeof rpc.users.getById>
 * // { id: string; name: string; email: string }
 * ```
 */
export type QueryData<T extends (...args: unknown[]) => Promise<unknown>> = T extends (...args: unknown[]) => Promise<infer R> ? R : never

/**
 * Extract the variables/input type for a query or mutation
 *
 * @example
 * ```typescript
 * type GetUserInput = QueryVariables<typeof rpc.users.getById>
 * // { id: string }
 * ```
 */
export type QueryVariables<T extends (...args: unknown[]) => unknown> = T extends (arg: infer A) => unknown ? A : never

/**
 * Helper type for creating React Query useQuery options
 *
 * @example
 * ```typescript
 * function useUser(userId: string) {
 *   return useQuery<UseQueryOptions<typeof rpc.users.getById>>({
 *     queryKey: ['user', userId],
 *     queryFn: () => rpc.users.getById({ id: userId }),
 *   })
 * }
 * ```
 */
export interface UseQueryOptions<TMethod extends (...args: unknown[]) => Promise<unknown>> {
  queryKey: readonly unknown[]
  queryFn: () => Promise<QueryData<TMethod>>
  enabled?: boolean
  staleTime?: number
  cacheTime?: number
  refetchOnWindowFocus?: boolean
  refetchOnMount?: boolean
  refetchOnReconnect?: boolean
  retry?: boolean | number | ((failureCount: number, error: Error) => boolean)
}

/**
 * Helper type for creating React Query useMutation options
 *
 * @example
 * ```typescript
 * function useCreateUser() {
 *   return useMutation<UseMutationOptions<typeof rpc.users.create>>({
 *     mutationFn: rpc.users.create,
 *   })
 * }
 * ```
 */
export interface UseMutationOptions<TMethod extends (...args: unknown[]) => Promise<unknown>> {
  mutationFn: (variables: QueryVariables<TMethod>) => Promise<QueryData<TMethod>>
  onSuccess?: (data: QueryData<TMethod>, variables: QueryVariables<TMethod>) => void | Promise<void>
  onError?: (error: Error, variables: QueryVariables<TMethod>) => void | Promise<void>
  onSettled?: (
    data: QueryData<TMethod> | undefined,
    error: Error | null,
    variables: QueryVariables<TMethod>
  ) => void | Promise<void>
  onMutate?: (variables: QueryVariables<TMethod>) => void | Promise<void>
  retry?: boolean | number | ((failureCount: number, error: Error) => boolean)
}

// ============================================================================
// SWR Type Helpers
// ============================================================================

/**
 * Helper type for creating SWR fetcher functions
 *
 * @example
 * ```typescript
 * const fetcher: SWRFetcher<typeof rpc.users.getById> = ([, args]) =>
 *   rpc.users.getById(args)
 *
 * useSWR(['user', { id: '123' }], fetcher)
 * ```
 */
export type SWRFetcher<TMethod extends (...args: unknown[]) => Promise<unknown>> = (
  key: [string, QueryVariables<TMethod>]
) => Promise<QueryData<TMethod>>

/**
 * Helper type for SWR mutation trigger functions
 */
export type SWRMutationFetcher<TMethod extends (...args: unknown[]) => Promise<unknown>> = (
  key: string,
  options: { arg: QueryVariables<TMethod> }
) => Promise<QueryData<TMethod>>

// ============================================================================
// Generic Async State Types (for useState/useEffect patterns)
// ============================================================================

/**
 * Async state object for custom hooks
 */
export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Async state with refetch capability
 */
export interface AsyncStateWithRefetch<T> extends AsyncState<T> {
  refetch: () => void
}

/**
 * Mutation state object for custom hooks
 */
export interface MutationState<TData, TVariables> {
  data: TData | null
  loading: boolean
  error: Error | null
  mutate: (variables: TVariables) => Promise<TData>
  reset: () => void
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

// Re-export both Rpc-prefixed (preferred) and RPC-prefixed (deprecated) types
export type { RpcProxy, RpcResult, RpcInput, RPCProxy, RPCResult, RPCInput } from './types'
