/**
 * Tests for rpc.do SvelteKit Adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRPCStore,
  createMutationStore,
  deriveFromRPC,
  createRPCHook,
  createRPCEndpoint,
  createRPCAction,
  createRPCLoad,
} from './sveltekit'

// ============================================================================
// Test API Handlers
// ============================================================================

const testHandlers = {
  users: {
    list: async () => [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ],
    get: async (id: string) => {
      if (id === 'not-found') return null
      return { id, name: `User ${id}` }
    },
    create: async (data: { name: string; email: string }) => ({
      id: 'new-123',
      ...data,
    }),
  },
  posts: {
    byUser: async (userId: string) => [
      { id: 'p1', title: `Post by ${userId}`, userId },
    ],
  },
  health: async () => ({ status: 'ok' }),
  fail: async () => {
    throw new Error('Intentional failure')
  },
}

// ============================================================================
// Mock RPC Methods
// ============================================================================

const mockListUsers = vi.fn().mockResolvedValue([
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
])

const mockGetUser = vi.fn().mockImplementation(async (id: string) => ({
  id,
  name: `User ${id}`,
}))

const mockCreateUser = vi.fn().mockImplementation(async (data: { name: string }) => ({
  id: 'new-123',
  ...data,
}))

const mockFailingMethod = vi.fn().mockRejectedValue(new Error('Mock error'))

// ============================================================================
// createRPCStore Tests
// ============================================================================

describe('createRPCStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a store with initial state', () => {
    const store = createRPCStore(mockListUsers)

    let state: unknown
    const unsubscribe = store.subscribe((s) => {
      state = s
    })

    expect(state).toEqual({
      data: undefined,
      loading: false,
      error: null,
      initialized: false,
    })

    unsubscribe()
  })

  it('should create a store with initial data', () => {
    const initialData = [{ id: '0', name: 'Initial' }]
    const store = createRPCStore(mockListUsers, { initialData })

    let state: unknown
    const unsubscribe = store.subscribe((s) => {
      state = s
    })

    expect(state).toEqual({
      data: initialData,
      loading: false,
      error: null,
      initialized: true,
    })

    unsubscribe()
  })

  it('should fetch data and update store', async () => {
    const store = createRPCStore(mockListUsers)

    const states: unknown[] = []
    const unsubscribe = store.subscribe((s) => {
      states.push({ ...s })
    })

    await store.fetch()

    // Should have transitioned through loading -> success
    expect(states.length).toBeGreaterThan(1)
    expect(states[states.length - 1]).toEqual({
      data: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
      loading: false,
      error: null,
      initialized: true,
    })

    expect(mockListUsers).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('should handle fetch errors', async () => {
    const store = createRPCStore(mockFailingMethod)

    let state: unknown
    const unsubscribe = store.subscribe((s) => {
      state = s
    })

    await store.fetch()

    expect(state).toMatchObject({
      data: undefined,
      loading: false,
      initialized: false,
    })
    expect((state as { error: Error }).error).toBeInstanceOf(Error)
    expect((state as { error: Error }).error.message).toBe('Mock error')

    unsubscribe()
  })

  it('should pass arguments to fetch', async () => {
    const store = createRPCStore(mockGetUser)

    await store.fetch('user-42')

    expect(mockGetUser).toHaveBeenCalledWith('user-42')
  })

  it('should support refetch with same arguments', async () => {
    const store = createRPCStore(mockGetUser)

    await store.fetch('user-1')
    await store.refetch()

    expect(mockGetUser).toHaveBeenCalledTimes(2)
    expect(mockGetUser).toHaveBeenLastCalledWith('user-1')
  })

  it('should support optimistic mutation', () => {
    const store = createRPCStore(mockListUsers, {
      initialData: [{ id: '1', name: 'Alice' }],
    })

    let state: { data: { id: string; name: string }[] | undefined }
    const unsubscribe = store.subscribe((s) => {
      state = s as typeof state
    })

    // Mutate with direct value
    store.mutate([
      { id: '1', name: 'Alice Updated' },
      { id: '2', name: 'Bob' },
    ])

    expect(state!.data).toEqual([
      { id: '1', name: 'Alice Updated' },
      { id: '2', name: 'Bob' },
    ])

    // Mutate with function
    store.mutate((prev: { id: string; name: string }[] | undefined) => prev ? [...prev, { id: '3', name: 'Charlie' }] : [])

    expect(state!.data).toEqual([
      { id: '1', name: 'Alice Updated' },
      { id: '2', name: 'Bob' },
      { id: '3', name: 'Charlie' },
    ])

    unsubscribe()
  })

  it('should reset store to initial state', async () => {
    const store = createRPCStore(mockListUsers, {
      initialData: undefined,
    })

    await store.fetch()

    let state: { data: unknown; initialized: boolean } | undefined
    const unsubscribe = store.subscribe((s) => {
      state = s as typeof state
    })

    expect(state?.data).toBeDefined()
    expect(state?.initialized).toBe(true)

    store.reset()

    expect(state?.data).toBeUndefined()
    expect(state?.initialized).toBe(false)

    unsubscribe()
  })

  it('should call onSuccess callback', async () => {
    const onSuccess = vi.fn()
    const store = createRPCStore(mockListUsers, { onSuccess })

    await store.fetch()

    expect(onSuccess).toHaveBeenCalledWith([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  it('should call onError callback', async () => {
    const onError = vi.fn()
    const store = createRPCStore(mockFailingMethod, { onError })

    await store.fetch()

    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('should support fetchOnSubscribe', async () => {
    const store = createRPCStore(mockListUsers, {
      fetchOnSubscribe: true,
      defaultArgs: [],
    })

    // First subscription triggers fetch
    const unsubscribe = store.subscribe(() => {})

    // Give time for async fetch
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockListUsers).toHaveBeenCalledTimes(1)

    unsubscribe()
  })
})

// ============================================================================
// createMutationStore Tests
// ============================================================================

describe('createMutationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a mutation store with initial state', () => {
    const store = createMutationStore(mockCreateUser)

    let state: unknown
    const unsubscribe = store.subscribe((s) => {
      state = s
    })

    expect(state).toEqual({
      data: undefined,
      loading: false,
      error: null,
      isIdle: true,
      isSuccess: false,
      isError: false,
    })

    unsubscribe()
  })

  it('should execute mutation and update state', async () => {
    const store = createMutationStore(mockCreateUser)

    let state: { data: unknown; isSuccess: boolean }
    const unsubscribe = store.subscribe((s) => {
      state = s as typeof state
    })

    const result = await store.mutate({ name: 'Charlie' })

    expect(result).toEqual({ id: 'new-123', name: 'Charlie' })
    expect(state!.data).toEqual({ id: 'new-123', name: 'Charlie' })
    expect(state!.isSuccess).toBe(true)
    expect(mockCreateUser).toHaveBeenCalledWith({ name: 'Charlie' })

    unsubscribe()
  })

  it('should handle mutation errors', async () => {
    const store = createMutationStore(mockFailingMethod)

    let state: { error: Error | null; isError: boolean }
    const unsubscribe = store.subscribe((s) => {
      state = s as typeof state
    })

    await expect(store.mutate({})).rejects.toThrow('Mock error')

    expect(state!.error).toBeInstanceOf(Error)
    expect(state!.isError).toBe(true)

    unsubscribe()
  })

  it('should call lifecycle callbacks', async () => {
    const onMutate = vi.fn()
    const onSuccess = vi.fn()
    const onSettled = vi.fn()

    const store = createMutationStore(mockCreateUser, {
      onMutate,
      onSuccess,
      onSettled,
    })

    const unsubscribe = store.subscribe(() => {})

    await store.mutate({ name: 'Dave' })

    expect(onMutate).toHaveBeenCalledWith({ name: 'Dave' })
    expect(onSuccess).toHaveBeenCalledWith(
      { id: 'new-123', name: 'Dave' },
      { name: 'Dave' }
    )
    expect(onSettled).toHaveBeenCalledWith(
      { id: 'new-123', name: 'Dave' },
      null,
      { name: 'Dave' }
    )

    unsubscribe()
  })

  it('should call onError on failure', async () => {
    const onError = vi.fn()
    const onSettled = vi.fn()

    const store = createMutationStore(mockFailingMethod, {
      onError,
      onSettled,
    })

    const unsubscribe = store.subscribe(() => {})

    await expect(store.mutate({})).rejects.toThrow()

    expect(onError).toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalled()
    expect(onSettled.mock.calls[0]?.[0]).toBeUndefined() // data
    expect(onSettled.mock.calls[0]?.[1]).toBeInstanceOf(Error) // error

    unsubscribe()
  })

  it('should reset mutation state', async () => {
    const store = createMutationStore(mockCreateUser)

    let state: { data: unknown; isIdle: boolean } | undefined
    const unsubscribe = store.subscribe((s) => {
      state = s as typeof state
    })

    await store.mutate({ name: 'Eve' })
    expect(state?.data).toBeDefined()
    expect(state?.isIdle).toBe(false)

    store.reset()

    expect(state?.data).toBeUndefined()
    expect(state?.isIdle).toBe(true)

    unsubscribe()
  })
})

// ============================================================================
// deriveFromRPC Tests
// ============================================================================

describe('deriveFromRPC', () => {
  it('should create a derived store', () => {
    const store = createRPCStore(mockListUsers, {
      initialData: [
        { id: '1', name: 'Alice', active: true },
        { id: '2', name: 'Bob', active: false },
      ],
    })

    const countStore = deriveFromRPC(store, (state) =>
      state.data?.length ?? 0
    )

    let count: number
    const unsubscribe = countStore.subscribe((c) => {
      count = c
    })

    expect(count!).toBe(2)

    // Mutate source store
    store.mutate([{ id: '1', name: 'Alice' }])

    expect(count!).toBe(1)

    unsubscribe()
  })

  it('should handle loading state in derived store', () => {
    const store = createRPCStore(mockListUsers)

    const loadingStore = deriveFromRPC(store, (state) => state.loading)

    let isLoading: boolean
    const unsubscribe = loadingStore.subscribe((l) => {
      isLoading = l
    })

    expect(isLoading!).toBe(false)

    unsubscribe()
  })
})

// ============================================================================
// createRPCEndpoint Tests
// ============================================================================

describe('createRPCEndpoint', () => {
  const { GET, POST, OPTIONS } = createRPCEndpoint(testHandlers)

  const createMockEvent = (
    method: string,
    path: string,
    body?: unknown
  ): Parameters<typeof POST>[0] => ({
    request: new Request(`http://localhost/api/rpc/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    } as RequestInit),
    url: new URL(`http://localhost/api/rpc/${path}`),
    params: { path },
    locals: {},
    fetch: globalThis.fetch,
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
  })

  it('should handle POST request to nested method', async () => {
    const event = createMockEvent('POST', 'users/get', { params: ['123'] })
    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ result: { id: '123', name: 'User 123' } })
  })

  it('should handle POST request to simple method', async () => {
    const event = createMockEvent('POST', 'health', { params: [] })
    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toEqual({ result: { status: 'ok' } })
  })

  it('should return 404 for non-existent method', async () => {
    const event = createMockEvent('POST', 'nonexistent/method', { params: [] })
    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(404)
    expect(data).toEqual({ error: 'Method not found: nonexistent.method' })
  })

  it('should return 500 for handler errors', async () => {
    const event = createMockEvent('POST', 'fail', { params: [] })
    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data).toEqual({ error: 'Intentional failure' })
  })

  it('should handle OPTIONS for CORS', async () => {
    const { OPTIONS } = createRPCEndpoint(testHandlers, {
      cors: { origin: '*' },
    })

    const event = createMockEvent('OPTIONS', 'health')
    const res = await OPTIONS(event)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('should return 400 when path is empty', async () => {
    const event = createMockEvent('POST', '', { params: [] })
    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(400)
    expect(data).toEqual({ error: 'Method not specified' })
  })
})

// ============================================================================
// createRPCEndpoint with options
// ============================================================================

describe('createRPCEndpoint with options', () => {
  it('should support authentication', async () => {
    const { POST } = createRPCEndpoint(testHandlers, {
      authenticate: async (event) => {
        const authHeader = event.request.headers.get('Authorization')
        if (authHeader === 'Bearer valid-token') {
          return { userId: 'auth-user' }
        }
        return null
      },
    })

    // Without auth
    const eventNoAuth: Parameters<typeof POST>[0] = {
      request: new Request('http://localhost/api/rpc/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: [] }),
      }),
      url: new URL('http://localhost/api/rpc/health'),
      params: { path: 'health' },
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const resNoAuth = await POST(eventNoAuth)
    expect(resNoAuth.status).toBe(401)

    // With auth
    const eventWithAuth: Parameters<typeof POST>[0] = {
      request: new Request('http://localhost/api/rpc/health', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-token',
        },
        body: JSON.stringify({ params: [] }),
      }),
      url: new URL('http://localhost/api/rpc/health'),
      params: { path: 'health' },
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const resWithAuth = await POST(eventWithAuth)
    expect(resWithAuth.status).toBe(200)
  })

  it('should support custom error handler', async () => {
    const { POST } = createRPCEndpoint(testHandlers, {
      onError: (error) =>
        new Response(JSON.stringify({ customError: error.message }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    const event: Parameters<typeof POST>[0] = {
      request: new Request('http://localhost/api/rpc/fail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: [] }),
      }),
      url: new URL('http://localhost/api/rpc/fail'),
      params: { path: 'fail' },
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const res = await POST(event)
    const data = await res.json()

    expect(res.status).toBe(503)
    expect(data).toEqual({ customError: 'Intentional failure' })
  })
})

// ============================================================================
// createRPCHook Tests
// ============================================================================

describe('createRPCHook', () => {
  it('should pass through non-RPC requests', async () => {
    const hook = createRPCHook({
      basePath: '/api/rpc',
      handlers: testHandlers,
    })

    const mockResolve = vi.fn().mockResolvedValue(new Response('OK'))

    const event = {
      url: new URL('http://localhost/other/path'),
      request: new Request('http://localhost/other/path'),
      params: {},
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    await hook({ event, resolve: mockResolve })

    expect(mockResolve).toHaveBeenCalledWith(event)
  })

  it('should handle RPC requests', async () => {
    const hook = createRPCHook({
      basePath: '/api/rpc',
      handlers: testHandlers,
    })

    const event = {
      url: new URL('http://localhost/api/rpc/health'),
      request: new Request('http://localhost/api/rpc/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: [] }),
      }),
      params: {},
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const mockResolve = vi.fn()
    const res = await hook({ event, resolve: mockResolve })
    const data = await res.json()

    expect(mockResolve).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(data).toEqual({ result: { status: 'ok' } })
  })
})

// ============================================================================
// createRPCAction Tests
// ============================================================================

describe('createRPCAction', () => {
  it('should create an action that transforms form data', async () => {
    const action = createRPCAction(mockCreateUser, {
      transformInput: (formData) => ({
        name: formData.get('name') as string,
      }),
      onSuccess: (result) => ({ success: true, user: result }),
    })

    const formData = new FormData()
    formData.append('name', 'Frank')

    const event = {
      request: {
        formData: async () => formData,
      } as unknown as Request,
      url: new URL('http://localhost'),
      params: {},
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const result = await action(event as Parameters<typeof action>[0])

    expect(result).toEqual({
      success: true,
      user: { id: 'new-123', name: 'Frank' },
    })
  })

  it('should handle action errors', async () => {
    const action = createRPCAction(mockFailingMethod, {
      transformInput: () => ({}),
      onError: (error) => ({ success: false, error: error.message }),
    })

    const formData = new FormData()

    const event = {
      request: {
        formData: async () => formData,
      } as unknown as Request,
      url: new URL('http://localhost'),
      params: {},
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const result = await action(event as Parameters<typeof action>[0])

    expect(result).toEqual({
      success: false,
      error: 'Mock error',
    })
  })
})

// ============================================================================
// createRPCLoad Tests
// ============================================================================

describe('createRPCLoad', () => {
  it('should create a load function', async () => {
    const load = createRPCLoad(async ({ params }) => {
      const user = await mockGetUser(params['id'])
      return { user }
    })

    const event = {
      params: { id: '42' },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost'),
      request: new Request('http://localhost'),
      locals: {},
      fetch: globalThis.fetch,
      cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    }

    const result = await load(event as Parameters<typeof load>[0])

    expect(result).toEqual({
      user: { id: '42', name: 'User 42' },
    })
  })
})
