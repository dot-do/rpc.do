/**
 * expose() Tests
 *
 * Tests for the SDK-to-RPC wrapper factory
 */

import { describe, it, expect, vi } from 'vitest'
import { expose } from './expose'
import { RPCError } from './errors'

// Mock WorkerEntrypoint since we're not in a Cloudflare environment
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class MockWorkerEntrypoint<Env> {
    env: Env
    constructor() {
      this.env = {} as Env
    }
  }
}))

describe('expose()', () => {
  describe('simple SDK factory', () => {
    it('should create a WorkerEntrypoint class', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      expect(Worker).toBeDefined()
      expect(typeof Worker).toBe('function')
    })

    it('should expose rpc method on instances', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      const instance = new (Worker as any)()
      expect(typeof instance.rpc).toBe('function')
    })

    it('should lazily initialize SDK', () => {
      let initialized = false
      const factory = () => {
        initialized = true
        return { test: () => 'ok' }
      }

      const Worker = expose(factory)
      const instance = new (Worker as any)()

      expect(initialized).toBe(false)

      // Access sdk property to trigger initialization
      const _ = instance.sdk

      expect(initialized).toBe(true)
    })

    it('should navigate and call SDK methods via rpc()', async () => {
      const sdk = {
        users: {
          list: vi.fn(async () => [{ id: '1' }, { id: '2' }]),
          get: vi.fn(async (id: string) => ({ id, name: 'Test' }))
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      const result = await instance.rpc('users.list')
      expect(result).toEqual([{ id: '1' }, { id: '2' }])
      expect(sdk.users.list).toHaveBeenCalled()
    })

    it('should pass arguments to SDK methods', async () => {
      const sdk = {
        users: {
          get: vi.fn(async (id: string) => ({ id, name: 'User ' + id }))
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      const result = await instance.rpc('users.get', '123')
      expect(result).toEqual({ id: '123', name: 'User 123' })
      expect(sdk.users.get).toHaveBeenCalledWith('123')
    })

    it('should handle deeply nested paths', async () => {
      const sdk = {
        api: {
          v1: {
            users: {
              profile: {
                get: vi.fn(async () => ({ avatar: 'url' }))
              }
            }
          }
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      const result = await instance.rpc('api.v1.users.profile.get')
      expect(result).toEqual({ avatar: 'url' })
    })

    it('should handle async iterables (pagination)', async () => {
      async function* mockPaginator() {
        yield { id: '1' }
        yield { id: '2' }
        yield { id: '3' }
      }

      const sdk = {
        items: {
          list: () => mockPaginator()
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      const result = await instance.rpc('items.list')
      expect(result).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }])
    })

    it('should throw on invalid path', async () => {
      const sdk = {
        users: {}
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      await expect(instance.rpc('users.nonexistent.method')).rejects.toThrow(/Invalid path/)
    })

    it('should throw when path is not a function', async () => {
      const sdk = {
        config: {
          version: '1.0.0'
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      await expect(instance.rpc('config.version')).rejects.toThrow(/Not a function/)
    })

    it('should throw RPCError with INVALID_PATH code for invalid path', async () => {
      const sdk = {
        users: {}
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      try {
        await instance.rpc('users.nonexistent.method')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).code).toBe('INVALID_PATH')
      }
    })

    it('should throw RPCError with NOT_A_FUNCTION code when path is not a function', async () => {
      const sdk = {
        config: {
          version: '1.0.0'
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      try {
        await instance.rpc('config.version')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).code).toBe('NOT_A_FUNCTION')
      }
    })
  })

  describe('SDK with custom methods', () => {
    it('should support custom methods alongside SDK', async () => {
      const sdk = {
        api: {
          call: vi.fn(async () => ({ status: 'ok' }))
        }
      }

      const Worker = expose({
        sdk: () => sdk,
        methods: {
          customMethod: async function() {
            return { custom: true }
          }
        }
      })

      const instance = new (Worker as any)()

      // Custom method
      const customResult = await instance.rpc('customMethod')
      expect(customResult).toEqual({ custom: true })

      // SDK method still works
      const sdkResult = await instance.rpc('api.call')
      expect(sdkResult).toEqual({ status: 'ok' })
    })

    it('should provide sdk and env in custom method context', async () => {
      const sdk = {
        getData: vi.fn(async () => ({ data: 'from-sdk' }))
      }

      const Worker = expose({
        sdk: () => sdk,
        methods: {
          combined: async function() {
            // @ts-ignore - this is bound at runtime
            const sdkData = await this.sdk.getData()
            return { ...sdkData, enhanced: true }
          }
        }
      })

      const instance = new (Worker as any)()
      const result = await instance.rpc('combined')

      expect(result).toEqual({ data: 'from-sdk', enhanced: true })
    })
  })

  describe('multi-SDK setup', () => {
    it('should support multiple named SDKs', async () => {
      const cloudflare = {
        zones: {
          list: vi.fn(async () => [{ name: 'example.com' }])
        }
      }

      const github = {
        repos: {
          get: vi.fn(async () => ({ name: 'repo' }))
        }
      }

      const Worker = expose({
        sdks: {
          cf: () => cloudflare,
          gh: () => github
        }
      })

      const instance = new (Worker as any)()

      // Call cloudflare SDK
      const cfResult = await instance.rpc('cf.zones.list')
      expect(cfResult).toEqual([{ name: 'example.com' }])

      // Call github SDK
      const ghResult = await instance.rpc('gh.repos.get')
      expect(ghResult).toEqual({ name: 'repo' })
    })

    it('should lazily initialize individual SDKs', async () => {
      let cfInit = false
      let ghInit = false

      const Worker = expose({
        sdks: {
          cf: () => {
            cfInit = true
            return { test: () => 'cf' }
          },
          gh: () => {
            ghInit = true
            return { test: () => 'gh' }
          }
        }
      })

      const instance = new (Worker as any)()

      expect(cfInit).toBe(false)
      expect(ghInit).toBe(false)

      await instance.rpc('cf.test')
      expect(cfInit).toBe(true)
      expect(ghInit).toBe(false)

      await instance.rpc('gh.test')
      expect(ghInit).toBe(true)
    })

    it('should throw for unknown SDK in multi-SDK mode', async () => {
      const Worker = expose({
        sdks: {
          known: () => ({ test: () => 'ok' })
        }
      })

      const instance = new (Worker as any)()

      await expect(instance.rpc('unknown.test')).rejects.toThrow(/Unknown SDK/)
    })

    it('should throw for path without SDK method in multi-SDK mode', async () => {
      const Worker = expose({
        sdks: {
          cf: () => ({ test: () => 'ok' })
        }
      })

      const instance = new (Worker as any)()

      await expect(instance.rpc('cf')).rejects.toThrow(/Invalid path/)
    })

    it('should throw RPCError with UNKNOWN_SDK code for unknown SDK', async () => {
      const Worker = expose({
        sdks: {
          known: () => ({ test: () => 'ok' })
        }
      })

      const instance = new (Worker as any)()

      try {
        await instance.rpc('unknown.test')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).code).toBe('UNKNOWN_SDK')
      }
    })

    it('should throw RPCError with INVALID_PATH code for path without SDK method', async () => {
      const Worker = expose({
        sdks: {
          cf: () => ({ test: () => 'ok' })
        }
      })

      const instance = new (Worker as any)()

      try {
        await instance.rpc('cf')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).code).toBe('INVALID_PATH')
      }
    })
  })

  describe('error handling', () => {
    it('should propagate SDK method errors', async () => {
      const sdk = {
        fail: async () => {
          throw new Error('SDK error')
        }
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      await expect(instance.rpc('fail')).rejects.toThrow('SDK error')
    })

    it('should handle synchronous methods', async () => {
      const sdk = {
        sync: () => ({ result: 'sync' })
      }

      const Worker = expose(() => sdk)
      const instance = new (Worker as any)()

      const result = await instance.rpc('sync')
      expect(result).toEqual({ result: 'sync' })
    })
  })
})
