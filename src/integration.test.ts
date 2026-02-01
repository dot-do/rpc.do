/**
 * Integration Tests for Client-Server RPC Flows
 *
 * Tests the full RPC flow:
 * - Client creates RPC proxy
 * - Transport sends request
 * - Server receives and handles request (via capnweb)
 * - Response returns to client
 *
 * Uses real capnweb protocol with mocked fetch to avoid network dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RPC, binding, composite, type Transport } from './index'
import { http } from './transports'
import { RPCError } from './errors'
import { RpcTarget, newHttpBatchRpcResponse } from '@dotdo/capnweb/server'
import { mockRPC, mockTransport, createSpy } from './testing'

// ============================================================================
// Test RpcTarget Implementations (Server-Side)
// ============================================================================

/**
 * Simple service with basic methods
 */
class SimpleService extends RpcTarget {
  greet(name: string): string {
    return `Hello, ${name}!`
  }

  echo<T>(value: T): T {
    return value
  }

  add(a: number, b: number): number {
    return a + b
  }

  getObject(): { id: string; name: string; active: boolean } {
    return { id: '123', name: 'Test', active: true }
  }

  getArray(): number[] {
    return [1, 2, 3, 4, 5]
  }

  async asyncMethod(delay: number): Promise<{ delayed: true }> {
    await new Promise(r => setTimeout(r, delay))
    return { delayed: true }
  }
}

/**
 * Nested namespace service
 */
class UsersTarget extends RpcTarget {
  list(): Array<{ id: string; name: string }> {
    return [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]
  }

  get(id: string): { id: string; name: string; email: string } {
    return { id, name: `User ${id}`, email: `user${id}@example.com` }
  }

  create(data: { name: string; email: string }): { id: string; name: string; email: string } {
    return { id: 'new-id', ...data }
  }

  delete(id: string): { deleted: boolean; id: string } {
    return { deleted: true, id }
  }
}

class PostsTarget extends RpcTarget {
  list(userId?: string): Array<{ id: string; title: string; authorId: string }> {
    const posts = [
      { id: 'p1', title: 'First Post', authorId: '1' },
      { id: 'p2', title: 'Second Post', authorId: '2' },
    ]
    if (userId) {
      return posts.filter(p => p.authorId === userId)
    }
    return posts
  }

  get(id: string): { id: string; title: string; content: string } {
    return { id, title: `Post ${id}`, content: 'Lorem ipsum...' }
  }
}

class AdminTarget extends RpcTarget {
  private _users = new UsersAdminTarget()

  get users(): UsersAdminTarget {
    return this._users
  }

  stats(): { totalUsers: number; totalPosts: number } {
    return { totalUsers: 100, totalPosts: 500 }
  }
}

class UsersAdminTarget extends RpcTarget {
  ban(id: string): { banned: boolean; userId: string } {
    return { banned: true, userId: id }
  }

  unban(id: string): { unbanned: boolean; userId: string } {
    return { unbanned: true, userId: id }
  }
}

/**
 * Main API service combining all namespaces
 */
class APIService extends RpcTarget {
  private _simple = new SimpleService()
  private _users = new UsersTarget()
  private _posts = new PostsTarget()
  private _admin = new AdminTarget()

  get simple(): SimpleService {
    return this._simple
  }

  get users(): UsersTarget {
    return this._users
  }

  get posts(): PostsTarget {
    return this._posts
  }

  get admin(): AdminTarget {
    return this._admin
  }

  ping(): 'pong' {
    return 'pong'
  }

  version(): { version: string; timestamp: number } {
    return { version: '1.0.0', timestamp: Date.now() }
  }
}

/**
 * Service that throws errors
 */
class ErrorService extends RpcTarget {
  throwSimple(): never {
    throw new Error('Simple error')
  }

  throwWithCode(): never {
    throw new RPCError('Error with code', 'CUSTOM_ERROR_CODE')
  }

  throwWithData(): never {
    throw new RPCError('Error with data', 'VALIDATION_ERROR', {
      field: 'email',
      message: 'Invalid email format',
    })
  }

  conditionalError(shouldThrow: boolean): { success: true } {
    if (shouldThrow) {
      throw new RPCError('Conditional error', 'CONDITIONAL')
    }
    return { success: true }
  }
}

class ErrorServiceRoot extends RpcTarget {
  private _errors = new ErrorService()

  get errors(): ErrorService {
    return this._errors
  }
}

// ============================================================================
// Test Helper: Mock Fetch for Capnweb HTTP
// ============================================================================

function createFetchMock(target: RpcTarget): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url

    // Handle test RPC URLs
    if (url.startsWith('https://test-rpc.example.com')) {
      const request = input instanceof Request
        ? new Request(input, init)
        : new Request(url, init)
      return newHttpBatchRpcResponse(request, target)
    }

    throw new Error(`Unexpected fetch to: ${url}`)
  }
}

/**
 * Helper to create a fresh RPC client for each call.
 * Capnweb HTTP batch sessions are single-use, so we need a new transport per batch.
 */
function createRpcClient(target: RpcTarget): ReturnType<typeof RPC> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = createFetchMock(target)

  const transport = http('https://test-rpc.example.com')
  const rpc = RPC(transport)

  // Add cleanup method
  const cleanup = () => {
    transport.close?.()
    globalThis.fetch = originalFetch
  }

  return Object.assign(rpc, { cleanup })
}

// ============================================================================
// Integration Tests: Simple Method Calls
// ============================================================================

describe('Integration: Simple Method Calls', () => {
  const originalFetch = globalThis.fetch
  let apiService: APIService

  beforeEach(() => {
    apiService = new APIService()
    globalThis.fetch = createFetchMock(apiService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should call a simple method and return primitive result', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.ping()
    expect(result).toBe('pong')
  })

  it('should call method with string argument and return string', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.greet('World')
    expect(result).toBe('Hello, World!')
  })

  it('should call method with multiple arguments', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.add(5, 3)
    expect(result).toBe(8)
  })

  it('should return object from server', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.getObject()
    expect(result).toEqual({ id: '123', name: 'Test', active: true })
  })

  it('should return array from server', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.getArray()
    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  it('should echo string values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    expect(await rpc.simple.echo('hello')).toBe('hello')
  })

  it('should echo number values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    expect(await rpc.simple.echo(42)).toBe(42)
  })

  it('should echo boolean values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    expect(await rpc.simple.echo(true)).toBe(true)
  })

  it('should echo null values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    expect(await rpc.simple.echo(null)).toBe(null)
  })

  it('should echo object values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const obj = { foo: 'bar', nested: { a: 1 } }
    expect(await rpc.simple.echo(obj)).toEqual(obj)
  })

  it('should echo array values', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const arr = [1, 'two', { three: 3 }]
    expect(await rpc.simple.echo(arr)).toEqual(arr)
  })

  it('should handle async server methods', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const start = Date.now()
    const result = await rpc.simple.asyncMethod(50)
    const elapsed = Date.now() - start

    expect(result).toEqual({ delayed: true })
    expect(elapsed).toBeGreaterThanOrEqual(40) // Allow some timing variance
  })
})

// ============================================================================
// Integration Tests: Nested Namespace Calls
// ============================================================================

describe('Integration: Nested Namespace Calls', () => {
  const originalFetch = globalThis.fetch
  let apiService: APIService

  beforeEach(() => {
    apiService = new APIService()
    globalThis.fetch = createFetchMock(apiService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should call methods in first-level namespace', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const users = await rpc.users.list()
    expect(users).toHaveLength(2)
    expect(users[0]).toEqual({ id: '1', name: 'Alice' })
    expect(users[1]).toEqual({ id: '2', name: 'Bob' })
  })

  it('should pass arguments to nested namespace methods', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const user = await rpc.users.get('123')
    expect(user).toEqual({
      id: '123',
      name: 'User 123',
      email: 'user123@example.com',
    })
  })

  it('should call methods with object arguments in nested namespace', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const newUser = await rpc.users.create({
      name: 'Charlie',
      email: 'charlie@example.com',
    })

    expect(newUser).toEqual({
      id: 'new-id',
      name: 'Charlie',
      email: 'charlie@example.com',
    })
  })

  it('should call deeply nested namespace methods (3 levels)', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.admin.users.ban('user-123')
    expect(result).toEqual({ banned: true, userId: 'user-123' })
  })

  it('should call users namespace', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const users = await rpc.users.list()
    expect(users).toHaveLength(2)
  })

  it('should call posts namespace', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const posts = await rpc.posts.list()
    expect(posts).toHaveLength(2)
  })

  it('should call admin namespace', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const stats = await rpc.admin.stats()
    expect(stats).toEqual({ totalUsers: 100, totalPosts: 500 })
  })

  it('should call methods without optional arguments', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const allPosts = await rpc.posts.list()
    expect(allPosts).toHaveLength(2)
  })

  it('should call methods with optional arguments', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const userPosts = await rpc.posts.list('1')
    expect(userPosts).toHaveLength(1)
    expect(userPosts[0].authorId).toBe('1')
  })
})

// ============================================================================
// Integration Tests: Error Handling Round-Trip
// ============================================================================

describe('Integration: Error Handling Round-Trip', () => {
  const originalFetch = globalThis.fetch
  let errorService: ErrorServiceRoot

  beforeEach(() => {
    errorService = new ErrorServiceRoot()
    globalThis.fetch = createFetchMock(errorService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should propagate simple errors from server', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    await expect(rpc.errors.throwSimple()).rejects.toThrow('Simple error')
  })

  it('should propagate RPCError with code', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    try {
      await rpc.errors.throwWithCode()
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const errorMessage = (error as Error).message
      expect(errorMessage).toContain('Error with code')
    }
  })

  it('should propagate RPCError with data', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    try {
      await rpc.errors.throwWithData()
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const errorMessage = (error as Error).message
      expect(errorMessage).toContain('Error with data')
    }
  })

  it('should handle conditional errors - success case', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const success = await rpc.errors.conditionalError(false)
    expect(success).toEqual({ success: true })
  })

  it('should handle conditional errors - error case', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    await expect(rpc.errors.conditionalError(true)).rejects.toThrow('Conditional error')
  })
})

// ============================================================================
// Integration Tests: Type Preservation
// ============================================================================

describe('Integration: Type Preservation', () => {
  const originalFetch = globalThis.fetch
  let apiService: APIService

  beforeEach(() => {
    apiService = new APIService()
    globalThis.fetch = createFetchMock(apiService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should preserve number types', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.add(1.5, 2.5)
    expect(result).toBe(4)
    expect(typeof result).toBe('number')
  })

  it('should preserve boolean types in returned objects', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.getObject()
    expect(typeof result.active).toBe('boolean')
    expect(result.active).toBe(true)
  })

  it('should preserve string types', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.greet('Test')
    expect(typeof result).toBe('string')
  })

  it('should preserve array types', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const result = await rpc.simple.getArray()
    expect(Array.isArray(result)).toBe(true)
    expect(result.every(n => typeof n === 'number')).toBe(true)
  })

  it('should preserve nested object structure', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const nested = { level1: { level2: { value: 'deep' } } }
    const result = await rpc.simple.echo(nested)

    expect(result).toEqual(nested)
    expect(result.level1.level2.value).toBe('deep')
  })
})

// ============================================================================
// Integration Tests: Typed RPC Proxy
// ============================================================================

describe('Integration: Typed RPC Proxy', () => {
  const originalFetch = globalThis.fetch
  let apiService: APIService

  beforeEach(() => {
    apiService = new APIService()
    globalThis.fetch = createFetchMock(apiService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  interface TypedAPI {
    ping: () => 'pong'
    version: () => { version: string; timestamp: number }
    simple: {
      greet: (name: string) => string
      add: (a: number, b: number) => number
    }
    users: {
      list: () => Array<{ id: string; name: string }>
      get: (id: string) => { id: string; name: string; email: string }
    }
  }

  it('should work with typed ping method', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC<TypedAPI>(transport)

    const pong: 'pong' = await rpc.ping()
    expect(pong).toBe('pong')
  })

  it('should work with typed simple.greet method', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC<TypedAPI>(transport)

    const greeting: string = await rpc.simple.greet('Typed')
    expect(greeting).toBe('Hello, Typed!')
  })

  it('should work with typed simple.add method', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC<TypedAPI>(transport)

    const sum: number = await rpc.simple.add(10, 20)
    expect(sum).toBe(30)
  })

  it('should work with typed users.list method', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC<TypedAPI>(transport)

    const users: Array<{ id: string; name: string }> = await rpc.users.list()
    expect(users).toHaveLength(2)
  })
})

// ============================================================================
// Integration Tests: Mock Transport Integration
// ============================================================================

describe('Integration: Mock Transport Integration', () => {
  it('should work with mockTransport for unit testing', async () => {
    const transport = mockTransport({
      'api.test': { result: 'mocked' },
      'api.echo': (value: unknown) => value,
    })

    const rpc = RPC(transport)

    expect(await rpc.api.test()).toEqual({ result: 'mocked' })
    expect(await rpc.api.echo('hello')).toBe('hello')
  })

  it('should work with mockRPC for handler-based testing', async () => {
    interface TestAPI {
      math: {
        add: (a: number, b: number) => number
        multiply: (a: number, b: number) => number
      }
    }

    const mock = mockRPC<TestAPI>({
      math: {
        add: (a, b) => a + b,
        multiply: (a, b) => a * b,
      },
    })

    expect(await mock.math.add(2, 3)).toBe(5)
    expect(await mock.math.multiply(4, 5)).toBe(20)
  })

  it('should track calls with mockTransport', async () => {
    const spy = createSpy((name: string) => ({ greeting: `Hi, ${name}!` }))

    const transport = mockTransport({
      'greet': spy,
    })

    const rpc = RPC(transport)

    await rpc.greet('Alice')
    await rpc.greet('Bob')

    expect(spy.calls).toEqual([['Alice'], ['Bob']])
    expect(spy.results).toEqual([
      { greeting: 'Hi, Alice!' },
      { greeting: 'Hi, Bob!' },
    ])
  })
})

// ============================================================================
// Integration Tests: Binding Transport
// ============================================================================

describe('Integration: Binding Transport', () => {
  it('should call methods on binding directly', async () => {
    const mockBinding = {
      users: {
        get: vi.fn(async (id: string) => ({ id, name: `User ${id}` })),
        list: vi.fn(async () => [{ id: '1' }, { id: '2' }]),
      },
      posts: {
        create: vi.fn(async (data: { title: string }) => ({
          id: 'new-post',
          ...data,
        })),
      },
    }

    const transport = binding(mockBinding)
    const rpc = RPC(transport)

    const user = await rpc.users.get('123')
    expect(user).toEqual({ id: '123', name: 'User 123' })
    expect(mockBinding.users.get).toHaveBeenCalledWith('123')

    const users = await rpc.users.list()
    expect(users).toEqual([{ id: '1' }, { id: '2' }])

    const post = await rpc.posts.create({ title: 'New Post' })
    expect(post).toEqual({ id: 'new-post', title: 'New Post' })
  })

  it('should throw for unknown namespace in binding', async () => {
    const mockBinding = {
      existing: {
        method: vi.fn(() => 'ok'),
      },
    }

    const transport = binding(mockBinding)
    const rpc = RPC(transport)

    await expect(rpc.nonexistent.method()).rejects.toThrow(/Unknown namespace/)
  })

  it('should throw for unknown method in binding', async () => {
    const mockBinding = {
      namespace: {},
    }

    const transport = binding(mockBinding)
    const rpc = RPC(transport)

    await expect(rpc.namespace.unknownMethod()).rejects.toThrow(/Unknown method/)
  })
})

// ============================================================================
// Integration Tests: Composite Transport
// ============================================================================

describe('Integration: Composite Transport', () => {
  it('should fallback to second transport when first fails', async () => {
    const failingTransport: Transport = {
      call: async () => {
        throw new Error('First transport failed')
      },
    }

    const workingTransport = mockTransport({
      'test.method': { source: 'second' },
    })

    const transport = composite(failingTransport, workingTransport)
    const rpc = RPC(transport)

    const result = await rpc.test.method()
    expect(result).toEqual({ source: 'second' })
  })

  it('should use first transport when it succeeds', async () => {
    const firstTransport = mockTransport({
      'test.method': { source: 'first' },
    })

    const secondTransport = mockTransport({
      'test.method': { source: 'second' },
    })

    const transport = composite(firstTransport, secondTransport)
    const rpc = RPC(transport)

    const result = await rpc.test.method()
    expect(result).toEqual({ source: 'first' })
  })

  it('should throw last error when all transports fail', async () => {
    const transport1: Transport = {
      call: async () => {
        throw new Error('Error 1')
      },
    }

    const transport2: Transport = {
      call: async () => {
        throw new Error('Error 2')
      },
    }

    const transport3: Transport = {
      call: async () => {
        throw new Error('Error 3')
      },
    }

    const transport = composite(transport1, transport2, transport3)
    const rpc = RPC(transport)

    await expect(rpc.any.method()).rejects.toThrow('Error 3')
  })

  it('should close all transports', () => {
    const closed: string[] = []

    const transport1: Transport = {
      call: async () => ({}),
      close: () => closed.push('transport1'),
    }

    const transport2: Transport = {
      call: async () => ({}),
      close: () => closed.push('transport2'),
    }

    const compositeTransport = composite(transport1, transport2)
    compositeTransport.close?.()

    expect(closed).toEqual(['transport1', 'transport2'])
  })
})

// ============================================================================
// Integration Tests: RPC Proxy Behavior
// ============================================================================

describe('Integration: RPC Proxy Behavior', () => {
  it('should not be thenable (avoid promise confusion)', () => {
    const transport = mockTransport({})
    const rpc = RPC(transport)

    expect((rpc as unknown as Record<string, unknown>).then).toBeUndefined()
    expect((rpc as unknown as Record<string, unknown>).catch).toBeUndefined()
    expect((rpc as unknown as Record<string, unknown>).finally).toBeUndefined()
  })

  it('should support close() method on proxy', async () => {
    let closed = false
    const transport: Transport = {
      call: async () => ({}),
      close: () => {
        closed = true
      },
    }

    const rpc = RPC(transport)
    await rpc.close?.()

    expect(closed).toBe(true)
  })

  it('should support lazy transport initialization', async () => {
    let initialized = false

    const factory = () => {
      initialized = true
      return mockTransport({
        'test': { result: 'ok' },
      })
    }

    const rpc = RPC(factory)

    // Factory not called yet
    expect(initialized).toBe(false)

    // First call triggers initialization
    await rpc.test()
    expect(initialized).toBe(true)
  })

  it('should support async transport factory', async () => {
    const transport = mockTransport({
      'delayed.method': { delayed: true },
    })

    const asyncFactory = async () => {
      await new Promise(r => setTimeout(r, 10))
      return transport
    }

    const rpc = RPC(asyncFactory)
    const result = await rpc.delayed.method()

    expect(result).toEqual({ delayed: true })
  })
})

// ============================================================================
// Integration Tests: End-to-End Scenarios
// ============================================================================

describe('Integration: End-to-End Scenarios', () => {
  const originalFetch = globalThis.fetch
  let apiService: APIService

  beforeEach(() => {
    apiService = new APIService()
    globalThis.fetch = createFetchMock(apiService)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should list users in CRUD workflow', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const initialUsers = await rpc.users.list()
    expect(initialUsers.length).toBeGreaterThan(0)
  })

  it('should create user in CRUD workflow', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const newUser = await rpc.users.create({
      name: 'New User',
      email: 'new@example.com',
    })
    expect(newUser.id).toBeDefined()
    expect(newUser.name).toBe('New User')
  })

  it('should get user in CRUD workflow', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const fetchedUser = await rpc.users.get('new-id')
    expect(fetchedUser.id).toBe('new-id')
  })

  it('should delete user in CRUD workflow', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const deleteResult = await rpc.users.delete('new-id')
    expect(deleteResult.deleted).toBe(true)
  })

  it('should handle version request', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    const version = await rpc.version()
    expect(version.version).toBe('1.0.0')
  })

  it('should get posts filtered by user id', async () => {
    const transport = http('https://test-rpc.example.com')
    const rpc = RPC(transport)

    // Get posts for user '1'
    const userPosts = await rpc.posts.list('1')
    expect(userPosts.every(p => p.authorId === '1')).toBe(true)
  })
})
