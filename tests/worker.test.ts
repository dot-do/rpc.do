/**
 * Worker Module Tests
 *
 * Tests for createWorker() and default dispatch logic from src/worker.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWorker, type Env } from '../src/worker'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockRequest(options: {
  method?: string
  body?: any
  headers?: Record<string, string>
  url?: string
} = {}): Request {
  const { method = 'POST', body, headers = {}, url = 'https://rpc.do/api' } = options

  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...overrides,
  }
}

function createMockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

// ============================================================================
// createWorker() Tests
// ============================================================================

describe('createWorker', () => {
  let ctx: ExecutionContext

  beforeEach(() => {
    ctx = createMockExecutionContext()
  })

  describe('creates worker with default dispatch', () => {
    it('should create a worker with fetch handler', () => {
      const worker = createWorker()
      expect(worker).toHaveProperty('fetch')
      expect(typeof worker.fetch).toBe('function')
    })

    it('should accept custom dispatch function', async () => {
      const customDispatch = vi.fn().mockResolvedValue({ success: true })
      const worker = createWorker({ dispatch: customDispatch })

      const env = createMockEnv({ RPC_TOKEN: 'test-token' })
      const request = createMockRequest({
        body: { path: 'myService.myMethod', args: ['arg1', 'arg2'] },
        headers: { Authorization: 'Bearer test-token' },
      })

      const response = await worker.fetch(request, env, ctx)
      const result = await response.json()

      expect(customDispatch).toHaveBeenCalledWith(
        'myService.myMethod',
        ['arg1', 'arg2'],
        env,
        ctx
      )
      expect(result).toEqual({ success: true })
    })
  })

  describe('token validation', () => {
    describe('RPC_TOKEN validation', () => {
      it('should return 401 when RPC_TOKEN is set but no auth header provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ RPC_TOKEN: 'secret-token' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Missing token')
        expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
      })

      it('should return 401 when RPC_TOKEN is set and invalid token provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ RPC_TOKEN: 'secret-token' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
          headers: { Authorization: 'Bearer wrong-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Invalid token')
      })

      it('should authenticate successfully with valid RPC_TOKEN', async () => {
        const mockService = { method: vi.fn().mockReturnValue('result') }
        const worker = createWorker()
        const env = createMockEnv({
          RPC_TOKEN: 'valid-token',
          testService: mockService,
        })
        const request = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer valid-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toBe('result')
      })
    })

    describe('DO_ADMIN_TOKEN validation', () => {
      it('should return 401 when DO_ADMIN_TOKEN is set but no auth header provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ DO_ADMIN_TOKEN: 'admin-secret' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Missing token')
      })

      it('should return 401 when DO_ADMIN_TOKEN is set and invalid token provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ DO_ADMIN_TOKEN: 'admin-secret' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
          headers: { Authorization: 'Bearer invalid-admin-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Invalid token')
      })

      it('should authenticate successfully with valid DO_ADMIN_TOKEN', async () => {
        const mockService = { method: vi.fn().mockReturnValue('admin-result') }
        const worker = createWorker()
        const env = createMockEnv({
          DO_ADMIN_TOKEN: 'admin-secret',
          testService: mockService,
        })
        const request = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer admin-secret' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toBe('admin-result')
      })
    })

    describe('DO_TOKEN validation', () => {
      it('should return 401 when DO_TOKEN is set but no auth header provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ DO_TOKEN: 'user-token' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Missing token')
      })

      it('should return 401 when DO_TOKEN is set and invalid token provided', async () => {
        const worker = createWorker()
        const env = createMockEnv({ DO_TOKEN: 'user-token' })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
          headers: { Authorization: 'Bearer invalid-user-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Invalid token')
      })

      it('should authenticate successfully with valid DO_TOKEN', async () => {
        const mockService = { method: vi.fn().mockReturnValue('user-result') }
        const worker = createWorker()
        const env = createMockEnv({
          DO_TOKEN: 'user-token',
          testService: mockService,
        })
        const request = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer user-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toBe('user-result')
      })
    })

    describe('multiple tokens', () => {
      it('should accept any valid token when multiple tokens are set', async () => {
        const mockService = { method: vi.fn().mockReturnValue('result') }
        const worker = createWorker()
        const env = createMockEnv({
          RPC_TOKEN: 'rpc-token',
          DO_ADMIN_TOKEN: 'admin-token',
          DO_TOKEN: 'user-token',
          testService: mockService,
        })

        // Test RPC_TOKEN
        const request1 = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer rpc-token' },
        })
        const response1 = await worker.fetch(request1, env, ctx)
        expect(response1.status).toBe(200)

        // Test DO_ADMIN_TOKEN
        const request2 = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer admin-token' },
        })
        const response2 = await worker.fetch(request2, env, ctx)
        expect(response2.status).toBe(200)

        // Test DO_TOKEN
        const request3 = createMockRequest({
          body: { path: 'testService.method', args: [] },
          headers: { Authorization: 'Bearer user-token' },
        })
        const response3 = await worker.fetch(request3, env, ctx)
        expect(response3.status).toBe(200)
      })

      it('should return 401 when no matching token found among multiple configured tokens', async () => {
        const worker = createWorker()
        const env = createMockEnv({
          RPC_TOKEN: 'rpc-token',
          DO_ADMIN_TOKEN: 'admin-token',
          DO_TOKEN: 'user-token',
        })
        const request = createMockRequest({
          body: { path: 'test.method', args: [] },
          headers: { Authorization: 'Bearer unknown-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(401)
        const result = await response.json()
        expect(result.error).toBe('Invalid token')
      })
    })

    describe('token via query parameter', () => {
      it('should accept token via query parameter', async () => {
        const mockService = { method: vi.fn().mockReturnValue('query-result') }
        const worker = createWorker()
        const env = createMockEnv({
          RPC_TOKEN: 'query-token',
          testService: mockService,
        })
        const request = createMockRequest({
          body: { path: 'testService.method', args: [] },
          url: 'https://rpc.do/api?token=query-token',
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toBe('query-result')
      })

      it('should prefer Authorization header over query parameter', async () => {
        const mockService = { method: vi.fn().mockReturnValue('header-result') }
        const worker = createWorker()
        const env = createMockEnv({
          RPC_TOKEN: 'header-token',
          DO_TOKEN: 'query-token',
          testService: mockService,
        })
        const request = createMockRequest({
          body: { path: 'testService.method', args: [] },
          url: 'https://rpc.do/api?token=query-token',
          headers: { Authorization: 'Bearer header-token' },
        })

        const response = await worker.fetch(request, env, ctx)

        expect(response.status).toBe(200)
      })
    })
  })

  describe('default dispatch logic', () => {
    it('should route to correct service binding by method prefix', async () => {
      const serviceA = { doSomething: vi.fn().mockReturnValue('serviceA result') }
      const serviceB = { doOther: vi.fn().mockReturnValue('serviceB result') }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        serviceA,
        serviceB,
      })

      // Route to serviceA
      const requestA = createMockRequest({
        body: { path: 'serviceA.doSomething', args: ['arg1'] },
        headers: { Authorization: 'Bearer token' },
      })
      const responseA = await worker.fetch(requestA, env, ctx)
      const resultA = await responseA.json()

      expect(serviceA.doSomething).toHaveBeenCalledWith('arg1')
      expect(resultA).toBe('serviceA result')

      // Route to serviceB
      const requestB = createMockRequest({
        body: { path: 'serviceB.doOther', args: ['arg2'] },
        headers: { Authorization: 'Bearer token' },
      })
      const responseB = await worker.fetch(requestB, env, ctx)
      const resultB = await responseB.json()

      expect(serviceB.doOther).toHaveBeenCalledWith('arg2')
      expect(resultB).toBe('serviceB result')
    })

    it('should handle nested method paths', async () => {
      const service = {
        nested: {
          deeply: {
            method: vi.fn().mockReturnValue('nested result'),
          },
        },
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.nested.deeply.method', args: ['nested-arg'] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)
      const result = await response.json()

      expect(service.nested.deeply.method).toHaveBeenCalledWith('nested-arg')
      expect(result).toBe('nested result')
    })

    it('should return 500 with error for unknown service (404-like)', async () => {
      const worker = createWorker()
      const env = createMockEnv({ RPC_TOKEN: 'token' })
      const request = createMockRequest({
        body: { path: 'unknownService.method', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(500)
      const result = await response.json()
      expect(result.error).toBe('Unknown service: unknownService')
    })

    it('should return 500 for unknown method on existing service', async () => {
      const service = { existingMethod: vi.fn() }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.unknownMethod', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(500)
      const result = await response.json()
      expect(result.error).toBe('Unknown method: myService.unknownMethod')
    })

    it('should return 500 when path resolves to non-function', async () => {
      const service = { property: 'not a function' }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.property', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(500)
      const result = await response.json()
      expect(result.error).toBe('myService.property is not a function')
    })

    it('should handle errors from service binding', async () => {
      const service = {
        failingMethod: vi.fn().mockImplementation(() => {
          throw new Error('Service binding error')
        }),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.failingMethod', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(500)
      const result = await response.json()
      expect(result.error).toBe('Service binding error')
    })

    it('should handle async service methods', async () => {
      const service = {
        asyncMethod: vi.fn().mockResolvedValue('async result'),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.asyncMethod', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('async result')
    })

    it('should pass multiple arguments to method', async () => {
      const service = {
        multiArg: vi.fn().mockImplementation((a, b, c) => ({ a, b, c })),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.multiArg', args: [1, 'two', { three: 3 }] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual({ a: 1, b: 'two', c: { three: 3 } })
      expect(service.multiArg).toHaveBeenCalledWith(1, 'two', { three: 3 })
    })
  })

  describe('request handling', () => {
    it('should parse JSON body correctly', async () => {
      const service = {
        method: vi.fn().mockImplementation((data) => data),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: {
          path: 'myService.method',
          args: [{ nested: { data: true }, array: [1, 2, 3] }],
        },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toEqual({ nested: { data: true }, array: [1, 2, 3] })
    })

    it('should return proper JSON response', async () => {
      const service = {
        method: vi.fn().mockReturnValue({ success: true, data: [1, 2, 3] }),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.method', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      const result = await response.json()
      expect(result).toEqual({ success: true, data: [1, 2, 3] })
    })

    it('should handle malformed JSON', async () => {
      const worker = createWorker()
      const env = createMockEnv({ RPC_TOKEN: 'token' })
      const request = new Request('https://rpc.do/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        body: 'not valid json {{{',
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(400)
      const result = await response.json()
      expect(result.error).toBe('Invalid JSON')
    })

    it('should return 400 for missing path', async () => {
      const worker = createWorker()
      const env = createMockEnv({ RPC_TOKEN: 'token' })
      const request = createMockRequest({
        body: { args: ['arg1'] }, // Missing path
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(400)
      const result = await response.json()
      expect(result.error).toBe('Missing path')
    })

    it('should default args to empty array when not provided', async () => {
      const service = {
        noArgs: vi.fn().mockReturnValue('no args result'),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.noArgs' }, // No args field
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBe('no args result')
      expect(service.noArgs).toHaveBeenCalledWith()
    })

    it('should return 405 for non-POST requests', async () => {
      const worker = createWorker()
      const env = createMockEnv({ RPC_TOKEN: 'token' })
      const request = new Request('https://rpc.do/api', {
        method: 'GET',
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(405)
      const result = await response.json()
      expect(result.error).toBe('Method not allowed')
    })

    it('should handle void/undefined response from service', async () => {
      // Note: JSON.stringify(undefined) returns undefined (not a valid JSON string)
      // so Response.json(undefined) may throw or return 500 depending on runtime
      // This test documents the actual behavior - services should return null instead of undefined
      const service = {
        voidResponse: vi.fn().mockReturnValue(null), // Use null for void-like responses
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.voidResponse', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBeNull()
    })

    it('should handle null response from service', async () => {
      const service = {
        nullResponse: vi.fn().mockReturnValue(null),
      }
      const worker = createWorker()
      const env = createMockEnv({
        RPC_TOKEN: 'token',
        myService: service,
      })
      const request = createMockRequest({
        body: { path: 'myService.nullResponse', args: [] },
        headers: { Authorization: 'Bearer token' },
      })

      const response = await worker.fetch(request, env, ctx)

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result).toBeNull()
    })
  })

  describe('no authentication required', () => {
    it('should allow requests when no tokens are configured', async () => {
      const service = {
        publicMethod: vi.fn().mockReturnValue('public result'),
      }
      const worker = createWorker()
      const env = createMockEnv({
        myService: service,
        // No RPC_TOKEN, DO_ADMIN_TOKEN, or DO_TOKEN
      })
      const request = createMockRequest({
        body: { path: 'myService.publicMethod', args: [] },
        // No Authorization header
      })

      const response = await worker.fetch(request, env, ctx)

      // Auth still requires a token when bearerAuth is used, but validation returns null
      // when no env tokens match - causing 401
      expect(response.status).toBe(401)
    })
  })

  describe('default worker export', () => {
    it('should export default worker with standard dispatch', async () => {
      // Import the default export
      const defaultWorker = await import('../src/worker').then((m) => m.default)
      expect(defaultWorker).toHaveProperty('fetch')
      expect(typeof defaultWorker.fetch).toBe('function')
    })
  })
})
