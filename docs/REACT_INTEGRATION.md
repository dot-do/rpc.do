# React Integration Guide

This guide shows how to integrate rpc.do with popular React data-fetching libraries. Since rpc.do is transport-agnostic and returns standard Promises, it works seamlessly with any React state management solution.

---

## Table of Contents

- [React Query (@tanstack/react-query)](#react-query-tanstackreact-query)
- [SWR](#swr)
- [Simple useState/useEffect Pattern](#simple-usestateuseeffect-pattern)
- [Error Handling Patterns](#error-handling-patterns)
- [Type Helpers](#type-helpers)

---

## React Query (@tanstack/react-query)

[React Query](https://tanstack.com/query) is the recommended approach for complex applications with caching, refetching, and optimistic updates.

### Setup

```bash
npm install rpc.do @tanstack/react-query
```

### Basic Usage

```typescript
import { useQuery, useMutation, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RPC } from 'rpc.do'

// Define your API types
interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string; email: string }
    create: (args: { name: string; email: string }) => { id: string }
    list: () => { id: string; name: string }[]
  }
}

// Create typed RPC client
const rpc = RPC<API>('https://your-api.com/rpc')

// Query client setup
const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserList />
    </QueryClientProvider>
  )
}
```

### Query Example

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => rpc.users.getById({ id: userId }),
  })

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div>
      <h1>{data?.name}</h1>
      <p>{data?.email}</p>
    </div>
  )
}
```

### Mutation Example

```typescript
function CreateUserForm() {
  const mutation = useMutation({
    mutationFn: (newUser: { name: string; email: string }) =>
      rpc.users.create(newUser),
    onSuccess: () => {
      // Invalidate and refetch user list
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    mutation.mutate({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creating...' : 'Create User'}
      </button>
      {mutation.error && <p>Error: {mutation.error.message}</p>}
    </form>
  )
}
```

### Creating Reusable Query Hooks

For better organization, create custom hooks for each RPC method:

```typescript
// hooks/useUser.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RPC, type RPCProxy } from 'rpc.do'
import type { API } from '../types/api'

const rpc = RPC<API>('https://your-api.com/rpc')

export function useUser(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: () => rpc.users.getById({ id: userId }),
    enabled: !!userId,
  })
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => rpc.users.list(),
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; email: string }) =>
      rpc.users.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
```

### With SQL Queries (Durable Objects)

rpc.do's SQL tagged template works naturally with React Query:

```typescript
const rpc = RPC('https://my-do.workers.dev')

function useActiveUsers() {
  return useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => rpc.sql`SELECT * FROM users WHERE active = ${true}`.all(),
  })
}

function useUserCount() {
  return useQuery({
    queryKey: ['users', 'count'],
    queryFn: async () => {
      const result = await rpc.sql`SELECT COUNT(*) as count FROM users`.first()
      return result?.count ?? 0
    },
  })
}
```

---

## SWR

[SWR](https://swr.vercel.app/) is a lightweight alternative focused on stale-while-revalidate caching.

### Setup

```bash
npm install rpc.do swr
```

### Basic Usage

```typescript
import useSWR from 'swr'
import useSWRMutation from 'swr/mutation'
import { RPC } from 'rpc.do'

interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string; email: string }
    create: (args: { name: string; email: string }) => { id: string }
  }
}

const rpc = RPC<API>('https://your-api.com/rpc')
```

### Query Example

```typescript
function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useSWR(
    ['user', userId],
    () => rpc.users.getById({ id: userId })
  )

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div>
      <h1>{data?.name}</h1>
      <p>{data?.email}</p>
    </div>
  )
}
```

### Mutation Example

```typescript
import useSWRMutation from 'swr/mutation'
import { useSWRConfig } from 'swr'

function CreateUserForm() {
  const { mutate } = useSWRConfig()

  const { trigger, isMutating, error } = useSWRMutation(
    'createUser',
    (_, { arg }: { arg: { name: string; email: string } }) => rpc.users.create(arg)
  )

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    await trigger({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
    })

    // Revalidate users list
    mutate(['users'])
  }

  return (
    <form onSubmit={handleSubmit}>
      <input name="name" placeholder="Name" required />
      <input name="email" type="email" placeholder="Email" required />
      <button type="submit" disabled={isMutating}>
        {isMutating ? 'Creating...' : 'Create User'}
      </button>
      {error && <p>Error: {error.message}</p>}
    </form>
  )
}
```

### Creating a Reusable Fetcher

```typescript
// lib/rpc.ts
import { RPC } from 'rpc.do'
import type { API } from '../types/api'

export const rpc = RPC<API>('https://your-api.com/rpc')

// Generic fetcher for SWR that extracts method path from key
export function createRPCFetcher<T>(method: () => Promise<T>) {
  return () => method()
}
```

```typescript
// Usage
import useSWR from 'swr'
import { rpc, createRPCFetcher } from '../lib/rpc'

function UserList() {
  const { data } = useSWR('users', createRPCFetcher(() => rpc.users.list()))
  // ...
}
```

---

## Simple useState/useEffect Pattern

For simple use cases without external dependencies, use React's built-in hooks:

### Basic Pattern

```typescript
import { useState, useEffect } from 'react'
import { RPC } from 'rpc.do'

interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string }
  }
}

const rpc = RPC<API>('https://your-api.com/rpc')

function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchUser() {
      try {
        setLoading(true)
        setError(null)
        const data = await rpc.users.getById({ id: userId })
        if (!cancelled) {
          setUser(data)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error('Unknown error'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchUser()

    return () => {
      cancelled = true
    }
  }, [userId])

  if (loading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  if (!user) return null

  return <div>{user.name}</div>
}
```

### Custom Hook Pattern

Create a reusable hook for RPC calls:

```typescript
import { useState, useEffect, useCallback } from 'react'

interface UseRPCResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => void
}

function useRPC<T>(
  rpcCall: () => Promise<T>,
  deps: React.DependencyList = []
): UseRPCResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refetchCount, setRefetchCount] = useState(0)

  const refetch = useCallback(() => {
    setRefetchCount(c => c + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function execute() {
      try {
        setLoading(true)
        setError(null)
        const result = await rpcCall()
        if (!cancelled) {
          setData(result)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error('Unknown error'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    execute()

    return () => {
      cancelled = true
    }
  }, [...deps, refetchCount])

  return { data, loading, error, refetch }
}

// Usage
function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error, refetch } = useRPC(
    () => rpc.users.getById({ id: userId }),
    [userId]
  )

  // ...
}
```

### Mutation Hook Pattern

```typescript
interface UseMutationResult<TData, TArgs> {
  mutate: (args: TArgs) => Promise<TData>
  data: TData | null
  loading: boolean
  error: Error | null
  reset: () => void
}

function useMutation<TData, TArgs>(
  mutationFn: (args: TArgs) => Promise<TData>
): UseMutationResult<TData, TArgs> {
  const [data, setData] = useState<TData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const mutate = useCallback(async (args: TArgs): Promise<TData> => {
    setLoading(true)
    setError(null)
    try {
      const result = await mutationFn(args)
      setData(result)
      return result
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Unknown error')
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [mutationFn])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
    setLoading(false)
  }, [])

  return { mutate, data, loading, error, reset }
}

// Usage
function CreateUserForm() {
  const { mutate, loading, error } = useMutation(
    (data: { name: string; email: string }) => rpc.users.create(data)
  )

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    try {
      await mutate({
        name: formData.get('name') as string,
        email: formData.get('email') as string,
      })
      // Success!
    } catch {
      // Error handled in hook
    }
  }

  // ...
}
```

---

## Error Handling Patterns

rpc.do provides typed errors that you can handle in React components.

### Error Types

```typescript
import { ConnectionError, RPCError, AuthenticationError, RateLimitError } from 'rpc.do/errors'
```

### React Query Error Handling

```typescript
import { useQuery } from '@tanstack/react-query'
import { ConnectionError, RPCError, AuthenticationError } from 'rpc.do/errors'

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => rpc.users.getById({ id: userId }),
    retry: (failureCount, error) => {
      // Don't retry auth errors
      if (error instanceof AuthenticationError) return false
      // Don't retry RPC errors (business logic errors)
      if (error instanceof RPCError) return false
      // Retry connection errors up to 3 times
      if (error instanceof ConnectionError && error.retryable) {
        return failureCount < 3
      }
      return false
    },
  })

  if (error) {
    if (error instanceof AuthenticationError) {
      return <LoginPrompt />
    }
    if (error instanceof ConnectionError) {
      return <div>Connection error: {error.message}. Please check your network.</div>
    }
    if (error instanceof RPCError) {
      return <div>Error: {error.message} (Code: {error.code})</div>
    }
    return <div>Unknown error: {error.message}</div>
  }

  // ...
}
```

### Error Boundary Pattern

```typescript
import { Component, ReactNode } from 'react'
import { ConnectionError, AuthenticationError } from 'rpc.do/errors'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

class RPCErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    const { children, fallback } = this.props

    if (error) {
      if (error instanceof AuthenticationError) {
        return <div>Please log in to continue.</div>
      }
      if (error instanceof ConnectionError) {
        return (
          <div>
            <p>Connection error: {error.message}</p>
            {error.retryable && (
              <button onClick={() => this.setState({ error: null })}>
                Retry
              </button>
            )}
          </div>
        )
      }
      return fallback || <div>Something went wrong.</div>
    }

    return children
  }
}

// Usage
function App() {
  return (
    <RPCErrorBoundary>
      <UserProfile userId="123" />
    </RPCErrorBoundary>
  )
}
```

### Rate Limit Handling

```typescript
import { RateLimitError } from 'rpc.do/errors'

function useRPCWithRateLimit<T>(rpcCall: () => Promise<T>) {
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  const execute = async () => {
    try {
      return await rpcCall()
    } catch (error) {
      if (error instanceof RateLimitError && error.retryAfter) {
        setRetryAfter(error.retryAfter)
        // Auto-retry after the specified time
        await new Promise(resolve => setTimeout(resolve, error.retryAfter! * 1000))
        setRetryAfter(null)
        return await rpcCall()
      }
      throw error
    }
  }

  return { execute, retryAfter }
}
```

### Global Error Handler with Context

```typescript
import { createContext, useContext, useState, ReactNode } from 'react'
import { AuthenticationError } from 'rpc.do/errors'

interface ErrorContextType {
  error: Error | null
  setError: (error: Error | null) => void
  clearError: () => void
}

const ErrorContext = createContext<ErrorContextType | null>(null)

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<Error | null>(null)

  // Auto-redirect on auth errors
  if (error instanceof AuthenticationError) {
    window.location.href = '/login'
    return null
  }

  return (
    <ErrorContext.Provider value={{ error, setError, clearError: () => setError(null) }}>
      {error && (
        <div className="global-error-banner">
          {error.message}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {children}
    </ErrorContext.Provider>
  )
}

export function useError() {
  const context = useContext(ErrorContext)
  if (!context) throw new Error('useError must be used within ErrorProvider')
  return context
}
```

---

## Type Helpers

rpc.do provides type utilities to help with React integration. Import them from `rpc.do/react`:

```typescript
import {
  createQueryFn,
  createMutationFn,
  type QueryFnOptions,
  type MutationFnOptions
} from 'rpc.do/react'
```

### Creating Type-Safe Query Functions

```typescript
import { createQueryFn } from 'rpc.do/react'
import { RPC } from 'rpc.do'

interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string }
    list: () => { id: string; name: string }[]
  }
}

const rpc = RPC<API>('https://api.example.com/rpc')

// Create query functions with proper typing
const getUserById = createQueryFn(rpc, 'users.getById')
const listUsers = createQueryFn(rpc, 'users.list')

// Usage with React Query
const { data } = useQuery({
  queryKey: ['user', '123'],
  queryFn: () => getUserById({ id: '123' }),
})
```

### Path-Based Method Access

The `getMethod` helper allows accessing nested RPC methods by path string:

```typescript
import { getMethod } from 'rpc.do/react'

const rpc = RPC<API>('https://api.example.com/rpc')

// Get a method by dot-notation path
const getById = getMethod(rpc, 'users.getById')

// Now call it
const user = await getById({ id: '123' })
```

---

## Best Practices

1. **Create a single RPC client instance** - Initialize once and reuse throughout your app
2. **Define your API types** - TypeScript interfaces make your code safer and provide autocomplete
3. **Use custom hooks** - Wrap RPC calls in custom hooks for reusability
4. **Handle errors appropriately** - Different error types require different handling
5. **Consider caching** - Use React Query or SWR for automatic caching and deduplication
6. **Use WebSocket for real-time** - For frequent updates, switch to `wss://` for better performance

```typescript
// Good: Single instance with types
const rpc = RPC<API>('https://api.example.com/rpc')

// Good: Custom hook encapsulating RPC logic
function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => rpc.users.getById({ id }),
  })
}

// Good: WebSocket for real-time features
const realtimeRpc = RPC<API>('wss://api.example.com/rpc')
```
