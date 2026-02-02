/**
 * expose() Tests
 *
 * Tests for the SDK-to-RpcTarget wrapper factory.
 * Uses real @dotdo/capnweb/server RpcTarget (only mocks cloudflare:workers).
 */

import { describe, it, expect, vi } from 'vitest'
import { RpcTarget } from '@dotdo/capnweb/server'
import { expose } from './expose'

// Mock WorkerEntrypoint since we're not in a Cloudflare Workers environment
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class MockWorkerEntrypoint<Env> {
    env: Env
    constructor() {
      this.env = {} as Env
    }
  }
}))

/**
 * Type for instances created by expose() — includes the dynamically-added
 * getRpcTarget method that TypeScript can't infer from the return type.
 */
interface ExposedWorkerInstance {
  getRpcTarget(): RpcTarget & Record<string, unknown>
}

/** Instantiate an exposed worker class with proper typing */
function createInstance(Worker: ReturnType<typeof expose>): ExposedWorkerInstance {
  return new (Worker as unknown as new () => ExposedWorkerInstance)()
}

describe('expose()', () => {
  describe('simple SDK factory', () => {
    it('should create a WorkerEntrypoint class', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      expect(Worker).toBeDefined()
      expect(typeof Worker).toBe('function')
    })

    it('should expose getRpcTarget method on instances', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      const instance = createInstance(Worker)
      expect(typeof instance.getRpcTarget).toBe('function')
    })

    it('should return a real RpcTarget', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()
      expect(target).toBeInstanceOf(RpcTarget)
    })

    it('should lazily initialize SDK (not until getRpcTarget is called)', () => {
      let initialized = false
      const factory = () => {
        initialized = true
        return { test: () => 'ok' }
      }

      const Worker = expose(factory)
      const instance = createInstance(Worker)

      expect(initialized).toBe(false)

      instance.getRpcTarget()

      expect(initialized).toBe(true)
    })

    it('should expose SDK methods as properties on the RpcTarget', () => {
      const sdk = {
        greet: (name: string) => `Hello, ${name}!`,
        add: (a: number, b: number) => a + b,
      }

      const Worker = expose(() => sdk)
      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(typeof target.greet).toBe('function')
      expect(typeof target.add).toBe('function')
      expect(target.greet('world')).toBe('Hello, world!')
      expect(target.add(2, 3)).toBe(5)
    })

    it('should expose nested namespace methods', () => {
      const sdk = {
        users: {
          list: vi.fn(() => [{ id: '1' }, { id: '2' }]),
          get: vi.fn((id: string) => ({ id, name: 'Test' })),
        }
      }

      const Worker = expose(() => sdk)
      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(target.users).toBeDefined()
      expect(typeof target.users.list).toBe('function')
      expect(typeof target.users.get).toBe('function')

      expect(target.users.list()).toEqual([{ id: '1' }, { id: '2' }])
      expect(target.users.get('123')).toEqual({ id: '123', name: 'Test' })
    })

    it('should skip private properties (starting with _)', () => {
      const sdk = {
        publicMethod: () => 'public',
        _privateMethod: () => 'private',
      }

      const Worker = expose(() => sdk)
      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(typeof target.publicMethod).toBe('function')
      expect(target._privateMethod).toBeUndefined()
    })

    it('should cache the RpcTarget on repeated calls', () => {
      let factoryCallCount = 0
      const Worker = expose(() => {
        factoryCallCount++
        return { test: () => 'ok' }
      })
      const instance = createInstance(Worker)

      const target1 = instance.getRpcTarget()
      const target2 = instance.getRpcTarget()

      expect(target1).toBe(target2)
      expect(factoryCallCount).toBe(1)
    })
  })

  describe('SDK with custom methods', () => {
    it('should add custom methods alongside SDK methods on the target', () => {
      const sdk = {
        apiCall: vi.fn(() => ({ status: 'ok' }))
      }

      const Worker = expose({
        sdk: () => sdk,
        methods: {
          customMethod() {
            return { custom: true }
          }
        } as Record<string, (...args: unknown[]) => unknown>
      })

      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(typeof target.customMethod).toBe('function')
      expect(target.customMethod()).toEqual({ custom: true })

      expect(typeof target.apiCall).toBe('function')
      expect(target.apiCall()).toEqual({ status: 'ok' })
    })

    it('should provide sdk and env in custom method context', () => {
      const sdk = {
        getData: vi.fn(() => ({ data: 'from-sdk' }))
      }

      const Worker = expose({
        sdk: () => sdk,
        methods: {
          combined(this: { sdk: typeof sdk }) {
            const sdkData = this.sdk.getData()
            return { ...sdkData, enhanced: true }
          }
        } as Record<string, (...args: unknown[]) => unknown>
      })

      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(target.combined()).toEqual({ data: 'from-sdk', enhanced: true })
    })
  })

  describe('multi-SDK setup', () => {
    it('should create sub-targets for each named SDK', () => {
      const cloudflare = {
        zones: {
          list: vi.fn(() => [{ name: 'example.com' }])
        }
      }

      const github = {
        repos: {
          get: vi.fn(() => ({ name: 'repo' }))
        }
      }

      const Worker = expose({
        sdks: {
          cf: () => cloudflare,
          gh: () => github,
        }
      })

      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(target.cf).toBeDefined()
      expect(target.gh).toBeDefined()
      expect(target.cf).toBeInstanceOf(RpcTarget)
      expect(target.gh).toBeInstanceOf(RpcTarget)

      expect(target.cf.zones).toBeDefined()
      expect(typeof target.cf.zones.list).toBe('function')
      expect(target.cf.zones.list()).toEqual([{ name: 'example.com' }])

      expect(target.gh.repos).toBeDefined()
      expect(typeof target.gh.repos.get).toBe('function')
      expect(target.gh.repos.get()).toEqual({ name: 'repo' })
    })

    it('should add custom methods alongside SDK sub-targets', () => {
      const Worker = expose({
        sdks: {
          api: () => ({ call: () => 'api-result' })
        },
        methods: {
          healthCheck: function() {
            return { ok: true }
          }
        }
      })

      const instance = createInstance(Worker)
      const target = instance.getRpcTarget()

      expect(typeof target.healthCheck).toBe('function')
      expect(target.healthCheck()).toEqual({ ok: true })
      expect(target.api).toBeDefined()
    })
  })

  describe('class name', () => {
    it('should set class name to ExposedSDKWorker', () => {
      const Worker = expose(() => ({ test: () => 'ok' }))
      expect(Worker.name).toBe('ExposedSDKWorker')
    })
  })
})
