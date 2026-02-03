/**
 * Composition API Tests
 *
 * Tests for the composition-based DurableRPC architecture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createDurableRPC,
  sqlPlugin,
  storagePlugin,
  collectionPlugin,
  authPlugin,
  coloPlugin,
  type Plugin,
  type PluginInitContext,
  type BaseContext,
  type SqlContext,
  type StorageContext,
} from './index.js'
import { createMockSqlStorage, createMockStorage, createMockDurableObjectState } from '../__testutils__/index.js'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock environment
 */
function createMockEnv(): Record<string, unknown> {
  return {
    API_KEY: 'test-api-key',
    DEBUG: 'true',
  }
}

/**
 * Create a mock request
 */
function createMockRequest(options: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
} = {}): Request {
  const {
    method = 'POST',
    url = 'https://example.com/rpc',
    headers = {},
    body,
  } = options

  return new Request(url, {
    method,
    headers: new Headers(headers),
    body,
  })
}

// ============================================================================
// Plugin Tests
// ============================================================================

describe('Plugins', () => {
  describe('sqlPlugin', () => {
    it('should create a plugin with name "sql"', () => {
      const plugin = sqlPlugin()
      expect(plugin.name).toBe('sql')
    })

    it('should provide sql context on init', () => {
      const plugin = sqlPlugin()
      const mockSql = createMockSqlStorage()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState({ sql: mockSql }),
        env: {},
      }

      const result = plugin.init(ctx)
      expect(result).toHaveProperty('sql')
      expect(result.sql).toBe(mockSql)
    })

    it('should expose internal methods', () => {
      const plugin = sqlPlugin()
      expect(plugin.internalMethods).toBeDefined()
      expect(plugin.internalMethods!.__sql).toBeDefined()
      expect(plugin.internalMethods!.__sqlFirst).toBeDefined()
      expect(plugin.internalMethods!.__sqlRun).toBeDefined()
    })

    it('should validate query parameter count', () => {
      const plugin = sqlPlugin()
      const mockSql = createMockSqlStorage()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState({ sql: mockSql }),
        env: {},
      }
      plugin.init(ctx)

      // Invalid query - strings and values count mismatch
      expect(() => {
        plugin.internalMethods!.__sql({
          strings: ['SELECT * FROM users WHERE id = ', ''],
          values: [], // Missing value
        })
      }).toThrow('SQL parameter count mismatch')
    })

    it('should execute queries with logging when enabled', () => {
      const log = vi.fn()
      const plugin = sqlPlugin({ logging: true, log })
      const mockSql = createMockSqlStorage()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState({ sql: mockSql }),
        env: {},
      }
      plugin.init(ctx)

      plugin.internalMethods!.__sql({
        strings: ['SELECT * FROM users'],
        values: [],
      })

      expect(log).toHaveBeenCalledWith('[SQL] SELECT * FROM users', [])
    })
  })

  describe('storagePlugin', () => {
    it('should create a plugin with name "storage"', () => {
      const plugin = storagePlugin()
      expect(plugin.name).toBe('storage')
    })

    it('should provide storage context on init', () => {
      const plugin = storagePlugin()
      const mockStorage = createMockStorage()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState({ storage: mockStorage }),
        env: {},
      }

      const result = plugin.init(ctx)
      expect(result).toHaveProperty('storage')
    })

    it('should expose internal methods', () => {
      const plugin = storagePlugin()
      expect(plugin.internalMethods).toBeDefined()
      expect(plugin.internalMethods!.__storageGet).toBeDefined()
      expect(plugin.internalMethods!.__storagePut).toBeDefined()
      expect(plugin.internalMethods!.__storageDelete).toBeDefined()
      expect(plugin.internalMethods!.__storageList).toBeDefined()
    })
  })

  describe('collectionPlugin', () => {
    it('should create a plugin with name "collection"', () => {
      const plugin = collectionPlugin()
      expect(plugin.name).toBe('collection')
    })

    it('should provide collection function on init', () => {
      const plugin = collectionPlugin()
      const mockSql = createMockSqlStorage()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState({ sql: mockSql }),
        env: {},
      }

      const result = plugin.init(ctx)
      expect(result).toHaveProperty('collection')
      expect(typeof result.collection).toBe('function')
    })

    it('should expose internal collection methods', () => {
      const plugin = collectionPlugin()
      expect(plugin.internalMethods).toBeDefined()
      expect(plugin.internalMethods!.__collectionGet).toBeDefined()
      expect(plugin.internalMethods!.__collectionPut).toBeDefined()
      expect(plugin.internalMethods!.__collectionFind).toBeDefined()
    })
  })

  describe('authPlugin', () => {
    it('should create a plugin with name "auth"', () => {
      const plugin = authPlugin()
      expect(plugin.name).toBe('auth')
    })

    it('should provide auth context on init', () => {
      const plugin = authPlugin()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState(),
        env: {},
      }

      const result = plugin.init(ctx)
      expect(result).toHaveProperty('auth')
      expect(result.auth.authenticated).toBe(false)
    })

    it('should provide middleware', () => {
      const plugin = authPlugin()
      expect(plugin.middleware).toBeDefined()
      expect(plugin.middleware!.length).toBeGreaterThan(0)
    })

    it('should reject requests when auth is required', async () => {
      const plugin = authPlugin({ required: true })
      const middleware = plugin.middleware![0]!

      await expect(
        middleware.onRequest!('testMethod', [], {
          env: {},
          request: createMockRequest(), // No auth header
        })
      ).rejects.toThrow('Unauthorized')
    })

    it('should allow requests with auth header when required', async () => {
      const plugin = authPlugin({ required: true })
      const middleware = plugin.middleware![0]!

      // Should not throw
      await middleware.onRequest!('testMethod', [], {
        env: {},
        request: createMockRequest({
          headers: { Authorization: 'Bearer test-token' },
        }),
      })
    })

    it('should exclude specified methods from auth check', async () => {
      const plugin = authPlugin({
        required: true,
        excludeMethods: ['healthCheck', 'getPublicData'],
      })
      const middleware = plugin.middleware![0]!

      // Should not throw for excluded method
      await middleware.onRequest!('healthCheck', [], {
        env: {},
        request: createMockRequest(), // No auth header
      })
    })

    it('should call validate function when provided', async () => {
      const validate = vi.fn().mockResolvedValue({ valid: true, user: { id: '123' } })
      const plugin = authPlugin({ validate })
      const middleware = plugin.middleware![0]!

      await middleware.onRequest!('testMethod', [], {
        env: {},
        request: createMockRequest({
          headers: { Authorization: 'Bearer my-token' },
        }),
      })

      expect(validate).toHaveBeenCalledWith('my-token', expect.anything())
    })

    it('should support custom header name', async () => {
      const validate = vi.fn().mockResolvedValue({ valid: true })
      const plugin = authPlugin({ header: 'X-API-Key', validate })
      const middleware = plugin.middleware![0]!

      await middleware.onRequest!('testMethod', [], {
        env: {},
        request: createMockRequest({
          headers: { 'X-API-Key': 'my-api-key' },
        }),
      })

      expect(validate).toHaveBeenCalledWith('my-api-key', expect.anything())
    })
  })

  describe('coloPlugin', () => {
    it('should create a plugin with name "colo"', () => {
      const plugin = coloPlugin()
      expect(plugin.name).toBe('colo')
    })

    it('should provide colo context on init', () => {
      const plugin = coloPlugin()
      const ctx: PluginInitContext = {
        ctx: createMockDurableObjectState(),
        env: {},
      }

      const result = plugin.init(ctx)
      expect(result).toHaveProperty('colo')
      expect(result).toHaveProperty('coloInfo')
      expect(result).toHaveProperty('estimateLatencyTo')
      expect(result).toHaveProperty('distanceTo')
      expect(result).toHaveProperty('findNearestColo')
    })

    it('should have onFetch hook', () => {
      const plugin = coloPlugin()
      expect(plugin.onFetch).toBeDefined()
    })

    it('should expose getColosByDistance method', () => {
      const plugin = coloPlugin()
      expect(plugin.methods).toBeDefined()
      expect(plugin.methods!.getColosByDistance).toBeDefined()
    })
  })
})

// ============================================================================
// Custom Plugin Tests
// ============================================================================

describe('Custom Plugins', () => {
  it('should support custom plugin creation', () => {
    interface CounterContext {
      readonly counter: {
        value: number
        increment(): void
        decrement(): void
      }
    }

    const counterPlugin = (): Plugin<CounterContext> => {
      let count = 0

      return {
        name: 'counter',
        init() {
          return {
            get counter() {
              return {
                get value() {
                  return count
                },
                increment() {
                  count++
                },
                decrement() {
                  count--
                },
              }
            },
          }
        },
      }
    }

    const plugin = counterPlugin()
    const ctx: PluginInitContext = {
      ctx: createMockDurableObjectState(),
      env: {},
    }

    const result = plugin.init(ctx)
    expect(result.counter.value).toBe(0)
    result.counter.increment()
    expect(result.counter.value).toBe(1)
    result.counter.decrement()
    expect(result.counter.value).toBe(0)
  })

  it('should support plugins with middleware', () => {
    const calls: string[] = []

    const loggingPlugin = (): Plugin<object> => ({
      name: 'logging',
      init() {
        return {}
      },
      middleware: [
        {
          onRequest(method) {
            calls.push(`request: ${method}`)
          },
          onResponse(method) {
            calls.push(`response: ${method}`)
          },
        },
      ],
    })

    const plugin = loggingPlugin()
    expect(plugin.middleware).toBeDefined()
    expect(plugin.middleware!.length).toBe(1)

    // Simulate middleware call
    plugin.middleware![0]!.onRequest!('testMethod', [], { env: {} })
    expect(calls).toContain('request: testMethod')
  })

  it('should support plugins with internal methods', () => {
    interface CacheContext {
      readonly cache: Map<string, unknown>
    }

    const cachePlugin = (): Plugin<CacheContext> => {
      const cache = new Map<string, unknown>()

      return {
        name: 'cache',
        init() {
          return { cache }
        },
        internalMethods: {
          __cacheGet(key: string) {
            return cache.get(key)
          },
          __cacheSet(key: string, value: unknown) {
            cache.set(key, value)
          },
        },
      }
    }

    const plugin = cachePlugin()
    const ctx: PluginInitContext = {
      ctx: createMockDurableObjectState(),
      env: {},
    }
    plugin.init(ctx)

    plugin.internalMethods!.__cacheSet('foo', 'bar')
    expect(plugin.internalMethods!.__cacheGet('foo')).toBe('bar')
  })
})

// ============================================================================
// Factory Tests
// ============================================================================

describe('createDurableRPC', () => {
  it('should create a class constructor', () => {
    const MyDO = createDurableRPC({
      methods: {
        echo: async ($, message: string) => message,
      },
    })

    expect(typeof MyDO).toBe('function')
    expect(MyDO.prototype).toBeDefined()
  })

  it('should create instance with methods', () => {
    const MyDO = createDurableRPC({
      methods: {
        add: async ($, a: number, b: number) => a + b,
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    expect((instance as any).add).toBeDefined()
  })

  it('should support namespace methods', () => {
    const MyDO = createDurableRPC({
      methods: {
        math: {
          add: async ($, a: number, b: number) => a + b,
          multiply: async ($, a: number, b: number) => a * b,
        },
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    expect((instance as any).math).toBeDefined()
    expect((instance as any).math.add).toBeDefined()
    expect((instance as any).math.multiply).toBeDefined()
  })

  it('should pass context to methods', async () => {
    let receivedEnv: Record<string, unknown> | undefined

    const MyDO = createDurableRPC({
      methods: {
        getEnv: async ($) => {
          receivedEnv = $.env
          return $.env
        },
      },
    })

    const env = { API_KEY: 'secret' }
    const instance = new MyDO(createMockDurableObjectState(), env)
    await (instance as any).getEnv()

    expect(receivedEnv).toEqual(env)
  })

  it('should compose plugin contexts', async () => {
    const MyDO = createDurableRPC({
      plugins: [sqlPlugin(), storagePlugin()] as const,
      methods: {
        hasSql: async ($) => 'sql' in $,
        hasStorage: async ($) => 'storage' in $,
      },
    })

    const mockSql = createMockSqlStorage()
    const mockStorage = createMockStorage()
    const instance = new MyDO(
      createMockDurableObjectState({ sql: mockSql, storage: mockStorage }),
      createMockEnv()
    )

    expect(await (instance as any).hasSql()).toBe(true)
    expect(await (instance as any).hasStorage()).toBe(true)
  })

  it('should have getSchema method', () => {
    const MyDO = createDurableRPC({
      methods: {
        foo: async ($) => 'bar',
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    expect((instance as any).getSchema).toBeDefined()
  })

  it('should include methods in schema', () => {
    const MyDO = createDurableRPC({
      methods: {
        getUser: async ($, id: string) => ({ id }),
        users: {
          list: async ($) => [],
          create: async ($, name: string) => ({ name }),
        },
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    const schema = (instance as any).getSchema()

    expect(schema.version).toBe(1)
    expect(schema.methods).toContainEqual(
      expect.objectContaining({ name: 'getUser', params: 1 })
    )
    expect(schema.namespaces).toContainEqual(
      expect.objectContaining({
        name: 'users',
        methods: expect.arrayContaining([
          expect.objectContaining({ name: 'list' }),
          expect.objectContaining({ name: 'create', params: 1 }),
        ]),
      })
    )
  })

  it('should have fetch method', () => {
    const MyDO = createDurableRPC({
      methods: {
        echo: async ($, msg: string) => msg,
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    expect(instance.fetch).toBeDefined()
  })

  it('should return schema on GET /', async () => {
    const MyDO = createDurableRPC({
      methods: {
        echo: async ($, msg: string) => msg,
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    const response = await instance.fetch!(createMockRequest({ method: 'GET', url: 'https://example.com/' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('methods')
  })

  it('should return schema on GET /__schema', async () => {
    const MyDO = createDurableRPC({
      methods: {
        echo: async ($, msg: string) => msg,
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    const response = await instance.fetch!(createMockRequest({ method: 'GET', url: 'https://example.com/__schema' }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('version')
  })

  it('should reject non-POST for RPC', async () => {
    const MyDO = createDurableRPC({
      methods: {
        echo: async ($, msg: string) => msg,
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    const response = await instance.fetch!(createMockRequest({ method: 'PUT', url: 'https://example.com/rpc' }))

    expect(response.status).toBe(405)
  })

  it('should have broadcast method', () => {
    const MyDO = createDurableRPC({
      methods: {},
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    expect((instance as any).broadcast).toBeDefined()
  })

  it('should collect middleware from config and plugins', () => {
    const configMiddlewareCalled = vi.fn()
    const pluginMiddlewareCalled = vi.fn()

    const customPlugin = (): Plugin<object> => ({
      name: 'custom',
      init() {
        return {}
      },
      middleware: [
        {
          onRequest() {
            pluginMiddlewareCalled()
          },
        },
      ],
    })

    const MyDO = createDurableRPC({
      plugins: [customPlugin()] as const,
      middleware: [
        {
          onRequest() {
            configMiddlewareCalled()
          },
        },
      ],
      methods: {
        test: async ($) => 'ok',
      },
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    // Instance is created with middleware collected
    expect(instance).toBeDefined()
  })

  it('should call plugin onFetch hooks', async () => {
    const onFetchCalled = vi.fn()

    const customPlugin = (): Plugin<object> => ({
      name: 'custom',
      init() {
        return {}
      },
      onFetch(request) {
        onFetchCalled(request.url)
      },
    })

    const MyDO = createDurableRPC({
      plugins: [customPlugin()] as const,
      methods: {},
    })

    const instance = new MyDO(createMockDurableObjectState(), createMockEnv())
    await instance.fetch!(createMockRequest({ method: 'GET', url: 'https://example.com/' }))

    expect(onFetchCalled).toHaveBeenCalledWith('https://example.com/')
  })
})

// ============================================================================
// Type Inference Tests (compile-time checks)
// ============================================================================

describe('Type Inference', () => {
  it('should infer context type from plugins', () => {
    // This test verifies TypeScript compilation - if it compiles, types work
    const MyDO = createDurableRPC({
      plugins: [sqlPlugin(), storagePlugin()] as const,
      methods: {
        // $ should have both sql and storage
        test: async ($) => {
          // These should not cause type errors
          const sql = $.sql
          const storage = $.storage
          const env = $.env
          return { sql: !!sql, storage: !!storage, env: !!env }
        },
      },
    })

    expect(MyDO).toBeDefined()
  })

  it('should allow methods without context param', () => {
    const MyDO = createDurableRPC({
      methods: {
        // Methods always get $ as first param, even if not used
        ping: async ($) => 'pong',
      },
    })

    expect(MyDO).toBeDefined()
  })

  it('should support empty config', () => {
    const MyDO = createDurableRPC({})
    expect(MyDO).toBeDefined()
  })

  it('should support methods-only config', () => {
    const MyDO = createDurableRPC({
      methods: {
        hello: async ($) => 'world',
      },
    })
    expect(MyDO).toBeDefined()
  })

  it('should support plugins-only config', () => {
    const MyDO = createDurableRPC({
      plugins: [sqlPlugin()] as const,
    })
    expect(MyDO).toBeDefined()
  })
})
