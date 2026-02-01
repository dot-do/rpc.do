/**
 * Server-side Middleware Tests
 *
 * Tests for the server-side middleware functionality in @dotdo/rpc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  type ServerMiddleware,
  type MiddlewareContext,
  runOnRequest,
  runOnResponse,
  runOnError,
  wrapWithMiddleware,
  serverLoggingMiddleware,
  serverTimingMiddleware,
} from './middleware.js'

describe('Server Middleware', () => {
  describe('runOnRequest', () => {
    it('should call onRequest hooks in order', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onRequest: () => { calls.push('first') } },
        { onRequest: () => { calls.push('second') } },
        { onRequest: () => { calls.push('third') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnRequest(middleware, 'test.method', ['arg1'], ctx)

      expect(calls).toEqual(['first', 'second', 'third'])
    })

    it('should pass method, args, and context to hooks', async () => {
      const receivedArgs: Array<{ method: string; args: unknown[]; ctx: MiddlewareContext }> = []
      const middleware: ServerMiddleware[] = [
        {
          onRequest: (method, args, ctx) => {
            receivedArgs.push({ method, args, ctx })
          },
        },
      ]

      const ctx: MiddlewareContext = { env: { foo: 'bar' } }
      await runOnRequest(middleware, 'users.get', ['id-123'], ctx)

      expect(receivedArgs).toHaveLength(1)
      expect(receivedArgs[0]!.method).toBe('users.get')
      expect(receivedArgs[0]!.args).toEqual(['id-123'])
      expect(receivedArgs[0]!.ctx.env).toEqual({ foo: 'bar' })
    })

    it('should stop and throw if middleware throws', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onRequest: () => { calls.push('first') } },
        { onRequest: () => { throw new Error('Auth failed') } },
        { onRequest: () => { calls.push('third') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await expect(runOnRequest(middleware, 'test', [], ctx)).rejects.toThrow('Auth failed')
      expect(calls).toEqual(['first']) // 'third' should not be called
    })

    it('should handle async hooks', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onRequest: async () => { await delay(5); calls.push('async1') } },
        { onRequest: () => { calls.push('sync') } },
        { onRequest: async () => { await delay(5); calls.push('async2') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnRequest(middleware, 'test', [], ctx)

      expect(calls).toEqual(['async1', 'sync', 'async2'])
    })

    it('should skip middleware without onRequest', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onRequest: () => { calls.push('first') } },
        { onResponse: () => { calls.push('response') } },
        { onRequest: () => { calls.push('second') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnRequest(middleware, 'test', [], ctx)

      expect(calls).toEqual(['first', 'second'])
    })
  })

  describe('runOnResponse', () => {
    it('should call onResponse hooks in order', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onResponse: () => { calls.push('first') } },
        { onResponse: () => { calls.push('second') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnResponse(middleware, 'test', { result: 'value' }, ctx)

      expect(calls).toEqual(['first', 'second'])
    })

    it('should not throw if middleware throws (logs instead)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onResponse: () => { calls.push('first') } },
        { onResponse: () => { throw new Error('Oops') } },
        { onResponse: () => { calls.push('third') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await expect(runOnResponse(middleware, 'test', 'result', ctx)).resolves.toBeUndefined()
      expect(calls).toEqual(['first', 'third']) // Third should still be called
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should pass result to hooks', async () => {
      let receivedResult: unknown
      const middleware: ServerMiddleware[] = [
        { onResponse: (_method, result) => { receivedResult = result } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnResponse(middleware, 'test', { data: [1, 2, 3] }, ctx)

      expect(receivedResult).toEqual({ data: [1, 2, 3] })
    })
  })

  describe('runOnError', () => {
    it('should call onError hooks in reverse order', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onError: () => { calls.push('first') } },
        { onError: () => { calls.push('second') } },
        { onError: () => { calls.push('third') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await runOnError(middleware, 'test', new Error('Test'), ctx)

      expect(calls).toEqual(['third', 'second', 'first']) // Reverse order!
    })

    it('should not throw if middleware throws (logs instead)', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        { onError: () => { calls.push('first') } },
        { onError: () => { throw new Error('Handler error') } },
        { onError: () => { calls.push('third') } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      await expect(runOnError(middleware, 'test', new Error('Original'), ctx)).resolves.toBeUndefined()
      expect(calls).toEqual(['third', 'first']) // Both should still be called
      expect(consoleError).toHaveBeenCalled()

      consoleError.mockRestore()
    })

    it('should pass error to hooks', async () => {
      let receivedError: unknown
      const middleware: ServerMiddleware[] = [
        { onError: (_method, error) => { receivedError = error } },
      ]

      const ctx: MiddlewareContext = { env: {} }
      const err = new Error('Something went wrong')
      await runOnError(middleware, 'test', err, ctx)

      expect(receivedError).toBe(err)
    })
  })

  describe('wrapWithMiddleware', () => {
    it('should return original function when no middleware', () => {
      const fn = vi.fn(() => 'result')
      const wrapped = wrapWithMiddleware('test', fn, [], () => ({ env: {} }))

      expect(wrapped).toBe(fn)
    })

    it('should call onRequest before and onResponse after', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        {
          onRequest: () => { calls.push('onRequest') },
          onResponse: () => { calls.push('onResponse') },
        },
      ]

      const fn = vi.fn(() => {
        calls.push('fn')
        return 'result'
      })

      const wrapped = wrapWithMiddleware('test', fn, middleware, () => ({ env: {} }))
      await wrapped('arg1')

      expect(calls).toEqual(['onRequest', 'fn', 'onResponse'])
    })

    it('should call onError on function throw', async () => {
      const calls: string[] = []
      let caughtError: unknown
      const middleware: ServerMiddleware[] = [
        {
          onRequest: () => { calls.push('onRequest') },
          onResponse: () => { calls.push('onResponse') },
          onError: (_method, err) => {
            calls.push('onError')
            caughtError = err
          },
        },
      ]

      const fn = vi.fn(() => {
        calls.push('fn')
        throw new Error('Function error')
      })

      const wrapped = wrapWithMiddleware('test', fn, middleware, () => ({ env: {} }))

      await expect(wrapped()).rejects.toThrow('Function error')
      expect(calls).toEqual(['onRequest', 'fn', 'onError']) // No onResponse
      expect(caughtError).toBeInstanceOf(Error)
    })

    it('should reject if onRequest throws (auth middleware pattern)', async () => {
      const middleware: ServerMiddleware[] = [
        { onRequest: () => { throw new Error('Unauthorized') } },
      ]

      const fn = vi.fn(() => 'result')
      const wrapped = wrapWithMiddleware('test', fn, middleware, () => ({ env: {} }))

      await expect(wrapped()).rejects.toThrow('Unauthorized')
      expect(fn).not.toHaveBeenCalled()
    })

    it('should handle async functions', async () => {
      const calls: string[] = []
      const middleware: ServerMiddleware[] = [
        {
          onRequest: () => { calls.push('onRequest') },
          onResponse: () => { calls.push('onResponse') },
        },
      ]

      const fn = vi.fn(async () => {
        calls.push('fn-start')
        await delay(10)
        calls.push('fn-end')
        return 'async-result'
      })

      const wrapped = wrapWithMiddleware('test', fn, middleware, () => ({ env: {} }))
      const result = await wrapped()

      expect(result).toBe('async-result')
      expect(calls).toEqual(['onRequest', 'fn-start', 'fn-end', 'onResponse'])
    })

    it('should provide context from getContext function', async () => {
      let receivedCtx: MiddlewareContext | undefined
      const middleware: ServerMiddleware[] = [
        { onRequest: (_method, _args, ctx) => { receivedCtx = ctx } },
      ]

      const fn = vi.fn(() => 'result')
      const mockRequest = new Request('https://example.com')
      const wrapped = wrapWithMiddleware('test', fn, middleware, () => ({
        env: { API_KEY: 'secret' },
        request: mockRequest,
      }))

      await wrapped()

      expect(receivedCtx!.env).toEqual({ API_KEY: 'secret' })
      expect(receivedCtx!.request).toBe(mockRequest)
    })
  })

  describe('serverLoggingMiddleware', () => {
    it('should log requests with args by default', async () => {
      const log = vi.fn()
      const error = vi.fn()
      const mw = serverLoggingMiddleware({ log, error })

      mw.onRequest!('users.get', ['id-123'], { env: {} })

      expect(log).toHaveBeenCalledWith('[RPC] users.get called with:', ['id-123'])
    })

    it('should log requests without args when logArgs is false', async () => {
      const log = vi.fn()
      const mw = serverLoggingMiddleware({ log, logArgs: false })

      mw.onRequest!('users.get', ['id-123'], { env: {} })

      expect(log).toHaveBeenCalledWith('[RPC] users.get called')
    })

    it('should log responses with result by default', async () => {
      const log = vi.fn()
      const mw = serverLoggingMiddleware({ log })

      mw.onResponse!('users.get', { id: '123', name: 'John' }, { env: {} })

      expect(log).toHaveBeenCalledWith('[RPC] users.get returned:', { id: '123', name: 'John' })
    })

    it('should log responses without result when logResult is false', async () => {
      const log = vi.fn()
      const mw = serverLoggingMiddleware({ log, logResult: false })

      mw.onResponse!('users.get', { id: '123' }, { env: {} })

      expect(log).toHaveBeenCalledWith('[RPC] users.get completed')
    })

    it('should log errors', async () => {
      const error = vi.fn()
      const mw = serverLoggingMiddleware({ error })

      const err = new Error('Database error')
      mw.onError!('users.get', err, { env: {} })

      expect(error).toHaveBeenCalledWith('[RPC] users.get failed:', err)
    })

    it('should use custom prefix', async () => {
      const log = vi.fn()
      const mw = serverLoggingMiddleware({ log, prefix: '[MyDO]' })

      mw.onRequest!('test', [], { env: {} })

      expect(log).toHaveBeenCalledWith('[MyDO] test called with:', [])
    })
  })

  describe('serverTimingMiddleware', () => {
    it('should log timing above threshold', async () => {
      const log = vi.fn()
      const mw = serverTimingMiddleware({ log, threshold: 0 })

      mw.onRequest!('test', [], { env: {} })
      await delay(10)
      mw.onResponse!('test', 'result', { env: {} })

      expect(log).toHaveBeenCalled()
      expect(log.mock.calls[0]![0]).toMatch(/\[RPC Timing\] test took \d+\.\d+ms/)
    })

    it('should not log timing below threshold', async () => {
      const log = vi.fn()
      const mw = serverTimingMiddleware({ log, threshold: 1000 })

      mw.onRequest!('test', [], { env: {} })
      mw.onResponse!('test', 'result', { env: {} })

      expect(log).not.toHaveBeenCalled()
    })

    it('should call onTiming callback', async () => {
      const onTiming = vi.fn()
      const mw = serverTimingMiddleware({ onTiming })

      mw.onRequest!('test', [], { env: {} })
      await delay(5)
      mw.onResponse!('test', 'result', { env: {} })

      expect(onTiming).toHaveBeenCalledWith('test', expect.any(Number))
      expect(onTiming.mock.calls[0]![1]).toBeGreaterThanOrEqual(5)
    })

    it('should track timing on error', async () => {
      const log = vi.fn()
      const mw = serverTimingMiddleware({ log, threshold: 0 })

      mw.onRequest!('test', [], { env: {} })
      await delay(5)
      mw.onError!('test', new Error('Oops'), { env: {} })

      expect(log).toHaveBeenCalled()
      expect(log.mock.calls[0]![0]).toMatch(/\[RPC Timing\] test failed after \d+\.\d+ms/)
    })

    it('should use custom prefix', async () => {
      const log = vi.fn()
      const mw = serverTimingMiddleware({ log, prefix: '[Perf]', threshold: 0 })

      mw.onRequest!('test', [], { env: {} })
      mw.onResponse!('test', 'result', { env: {} })

      expect(log.mock.calls[0]![0]).toMatch(/\[Perf\] test took/)
    })
  })

  describe('Integration: Multiple Middleware', () => {
    it('should work with multiple middleware chained', async () => {
      const calls: string[] = []
      const timings: Array<{ method: string; duration: number }> = []

      const loggingMw = serverLoggingMiddleware({
        log: (msg) => calls.push(`log: ${msg}`),
        error: (msg) => calls.push(`error: ${msg}`),
        logArgs: false,
        logResult: false,
      })

      const timingMw = serverTimingMiddleware({
        log: () => {}, // silent
        onTiming: (method, duration) => {
          timings.push({ method, duration })
          calls.push(`timing: ${method}`)
        },
      })

      const middleware = [loggingMw, timingMw]

      const fn = vi.fn(async (x: number) => {
        await delay(5)
        return x * 2
      })

      const wrapped = wrapWithMiddleware('multiply', fn, middleware, () => ({ env: {} }))
      const result = await wrapped(21)

      expect(result).toBe(42)
      expect(calls).toContain('log: [RPC] multiply called')
      expect(calls).toContain('timing: multiply')
      expect(calls).toContain('log: [RPC] multiply completed')
      expect(timings[0]!.method).toBe('multiply')
      // Timing should be at least a few ms (test uses delay(5))
      expect(timings[0]!.duration).toBeGreaterThan(0)
    })

    it('should work with auth middleware that rejects', async () => {
      const calls: string[] = []

      const authMw: ServerMiddleware = {
        onRequest: async (_method, _args, ctx) => {
          calls.push('auth-check')
          if (!ctx.request?.headers.get('Authorization')) {
            throw new Error('Unauthorized')
          }
        },
      }

      const loggingMw: ServerMiddleware = {
        onRequest: () => { calls.push('logging') },
        onError: () => { calls.push('error-logged') },
      }

      const middleware = [loggingMw, authMw]

      const fn = vi.fn(() => 'secret-data')
      const wrapped = wrapWithMiddleware('getData', fn, middleware, () => ({
        env: {},
        request: new Request('https://example.com'), // No auth header
      }))

      await expect(wrapped()).rejects.toThrow('Unauthorized')
      expect(fn).not.toHaveBeenCalled()
      // onRequest hooks are called in order until one throws
      expect(calls).toContain('logging')
      expect(calls).toContain('auth-check')
      // Note: onError is only called when the actual method throws, not onRequest
      // This is intentional - auth rejection should not trigger onError handlers
    })

    it('should call onError when the actual method throws', async () => {
      const calls: string[] = []

      const loggingMw: ServerMiddleware = {
        onRequest: () => { calls.push('logging-request') },
        onResponse: () => { calls.push('logging-response') },
        onError: () => { calls.push('logging-error') },
      }

      const middleware = [loggingMw]

      const fn = vi.fn(() => {
        calls.push('fn')
        throw new Error('Method failed')
      })

      const wrapped = wrapWithMiddleware('getData', fn, middleware, () => ({ env: {} }))

      await expect(wrapped()).rejects.toThrow('Method failed')
      expect(calls).toEqual(['logging-request', 'fn', 'logging-error'])
    })
  })
})

// Helper function
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
