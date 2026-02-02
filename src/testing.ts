/**
 * rpc.do Testing Utilities
 *
 * Testing utilities for consumers of rpc.do:
 * - mockRPC: Create a mock RPC proxy from handler functions
 * - mockTransport: Create a transport that returns predefined responses
 * - TestServer: Simple HTTP server for integration tests
 */

import type { Transport, RpcProxy } from './index'
import { RPCError } from './errors'

// ============================================================================
// Mock RPC Proxy
// ============================================================================

/**
 * Handler type for mockRPC - allows any function type
 */
type MockHandlers<T extends object> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : T[K] extends object
    ? MockHandlers<T[K]>
    : never
}

/**
 * Create a mock RPC proxy that calls handler functions directly.
 *
 * This is useful for unit testing code that depends on RPC clients.
 * Handlers are called synchronously (no network), making tests fast and deterministic.
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   users: {
 *     get: (id: string) => { id: string; name: string }
 *     create: (data: { name: string }) => { id: string }
 *   }
 * }
 *
 * const mockClient = mockRPC<MyAPI>({
 *   users: {
 *     get: (id) => ({ id, name: 'Test User' }),
 *     create: (data) => ({ id: '123' }),
 *   }
 * })
 *
 * // Use in tests
 * const user = await mockClient.users.get('123')
 * expect(user.name).toBe('Test User')
 * ```
 *
 * @example
 * ```typescript
 * // With async handlers
 * const mockClient = mockRPC<MyAPI>({
 *   users: {
 *     get: async (id) => {
 *       await someAsyncCheck()
 *       return { id, name: 'Async User' }
 *     }
 *   }
 * })
 * ```
 */
export function mockRPC<T extends object>(handlers: MockHandlers<T>): RpcProxy<T> {
  return createMockProxy<T>(handlers, [])
}

/**
 * Internal: Create a proxy that navigates the handler tree
 */
function createMockProxy<T extends object>(handlers: unknown, path: string[]): RpcProxy<T> {
  return new Proxy((() => {}) as unknown as RpcProxy<T>, {
    get(_target, prop: string | symbol): unknown {
      // Handle special properties
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      if (prop === 'close') {
        return async () => {}
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      const newPath = [...path, prop]
      const handler = getNestedValue(handlers, newPath)

      if (typeof handler === 'function') {
        // Return a function that wraps the handler
        return (...args: unknown[]) => {
          try {
            const result = handler(...args)
            return Promise.resolve(result)
          } catch (error) {
            return Promise.reject(error)
          }
        }
      }

      if (handler !== undefined && typeof handler === 'object') {
        // Navigate deeper into the handler tree
        return createMockProxy<T>(handlers, newPath)
      }

      // No handler found - return a proxy that will throw on call
      return createMockProxy<T>(handlers, newPath)
    },

    apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
      const handler = getNestedValue(handlers, path)

      if (typeof handler === 'function') {
        try {
          const result = handler(...args)
          return Promise.resolve(result)
        } catch (error) {
          return Promise.reject(error)
        }
      }

      return Promise.reject(new RPCError(
        `No mock handler defined for method: ${path.join('.')}`,
        'MOCK_NOT_FOUND'
      ))
    }
  })
}

/**
 * Internal: Get a nested value from an object using a path array
 */
function getNestedValue(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

// ============================================================================
// Mock Transport
// ============================================================================

/**
 * Response definition for mockTransport
 */
export type MockResponse =
  | { error: string | { message: string; code?: string; data?: unknown } }
  | ((...args: unknown[]) => unknown | Promise<unknown>)
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | unknown[]

/**
 * Create a mock transport that returns predefined responses.
 *
 * This is useful for testing transport-level behavior or when you need
 * more control over how responses are generated.
 *
 * @example
 * ```typescript
 * // Simple static responses
 * const transport = mockTransport({
 *   'users.get': { id: '123', name: 'Test User' },
 *   'users.list': [{ id: '1' }, { id: '2' }],
 * })
 *
 * const rpc = RPC(transport)
 * const user = await rpc.users.get('123')
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic responses based on arguments
 * const transport = mockTransport({
 *   'users.get': (id: string) => ({ id, name: `User ${id}` }),
 *   'counter.increment': (() => {
 *     let count = 0
 *     return () => ({ count: ++count })
 *   })(),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Error responses
 * const transport = mockTransport({
 *   'users.get': { error: 'User not found' },
 *   'auth.login': { error: { message: 'Invalid credentials', code: 'AUTH_FAILED' } },
 * })
 * ```
 */
export function mockTransport(
  responses: Record<string, MockResponse>,
  options?: MockTransportOptions
): Transport {
  const calls: MockTransportCall[] = []

  const transport: Transport & MockTransportExtras = {
    async call(method: string, args: unknown[]): Promise<unknown> {
      // Track the call
      const call: MockTransportCall = { method, args, timestamp: Date.now() }
      calls.push(call)

      // Look up the response
      const response = responses[method]

      if (response === undefined) {
        if (options?.throwOnMissing !== false) {
          throw new RPCError(
            `No mock response defined for method: ${method}`,
            'MOCK_NOT_FOUND'
          )
        }
        return undefined
      }

      // Handle function responses
      if (typeof response === 'function') {
        return response(...args)
      }

      // Handle error responses
      if (isErrorResponse(response)) {
        const errorVal = response.error
        if (typeof errorVal === 'string') {
          throw new RPCError(errorVal, 'MOCK_ERROR')
        }
        // Type narrowing for error object
        const errObj = errorVal as { message?: string; code?: string; data?: unknown }
        throw new RPCError(errObj.message ?? 'Unknown error', errObj.code ?? 'MOCK_ERROR', errObj.data)
      }

      // Return static response
      return response
    },

    close() {
      // No-op for mock transport
    },

    // Extra methods for test assertions
    getCalls(): MockTransportCall[] {
      return [...calls]
    },

    getCallsFor(method: string): MockTransportCall[] {
      return calls.filter(c => c.method === method)
    },

    getCallCount(method?: string): number {
      if (method) {
        return calls.filter(c => c.method === method).length
      }
      return calls.length
    },

    reset(): void {
      calls.length = 0
    }
  }

  return transport
}

/**
 * Options for mockTransport
 */
export interface MockTransportOptions {
  /** Throw error when calling a method without a response defined (default: true) */
  throwOnMissing?: boolean
}

/**
 * Record of a call made to the mock transport
 */
export interface MockTransportCall {
  method: string
  args: unknown[]
  timestamp: number
}

/**
 * Extended transport with testing helpers
 */
export interface MockTransportExtras {
  /** Get all calls made to this transport */
  getCalls(): MockTransportCall[]
  /** Get calls for a specific method */
  getCallsFor(method: string): MockTransportCall[]
  /** Get total call count (optionally for a specific method) */
  getCallCount(method?: string): number
  /** Reset call history */
  reset(): void
}

/**
 * Type guard for error responses
 */
function isErrorResponse(response: unknown): response is { error: unknown } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response
  )
}

// ============================================================================
// Test Server
// ============================================================================

/**
 * Simple HTTP server for integration tests.
 *
 * Uses Node.js built-in http module, so no additional dependencies required.
 * Works with Node.js 18+ (which is the minimum required version for rpc.do).
 *
 * @example
 * ```typescript
 * const server = new TestServer(async (req) => {
 *   const body = await req.json()
 *   return Response.json({ echo: body })
 * })
 *
 * await server.start()
 * console.log(`Server running at ${server.url}`)
 *
 * // Run your tests...
 *
 * await server.stop()
 * ```
 *
 * @example
 * ```typescript
 * // With rpc.do transport
 * import { RPC, http } from 'rpc.do'
 *
 * const server = new TestServer(async (req) => {
 *   // Handle capnweb HTTP batch protocol
 *   // ...
 * })
 *
 * await server.start()
 *
 * const rpc = RPC(http(server.url))
 * await rpc.test.method()
 *
 * await server.stop()
 * ```
 */
export class TestServer {
  private _handler: (req: Request) => Response | Promise<Response>
  private _server: unknown = null
  private _port: number = 0
  private _host: string = '127.0.0.1'

  constructor(handler: (req: Request) => Response | Promise<Response>) {
    this._handler = handler
  }

  /**
   * Start the server on a random available port
   */
  async start(port?: number): Promise<void> {
    // Dynamic import to avoid bundling Node.js modules in browser contexts
    const http = await import('node:http')

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          // Convert Node.js request to Web Request
          const chunks: Buffer[] = []
          for await (const chunk of req as AsyncIterable<Buffer>) {
            chunks.push(chunk)
          }
          const body = Buffer.concat(chunks)

          const protocol = 'http'
          const host = req.headers.host || `${this._host}:${this._port}`
          const url = `${protocol}://${host}${req.url || '/'}`

          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (value) {
              if (Array.isArray(value)) {
                value.forEach(v => headers.append(key, v))
              } else {
                headers.set(key, value)
              }
            }
          }

          // Build request init, ensuring body is only set when present
          const requestInit: RequestInit = {
            method: req.method ?? 'GET',
            headers,
          }
          if (body.length > 0) {
            requestInit.body = body
          }
          const request = new Request(url, requestInit)

          // Call the handler
          const response = await this._handler(request)

          // Convert Web Response to Node.js response
          res.statusCode = response.status

          response.headers.forEach((value, key) => {
            res.setHeader(key, value)
          })

          const responseBody = await response.arrayBuffer()
          res.end(Buffer.from(responseBody))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
          }))
        }
      })

      server.on('error', reject)

      server.listen(port || 0, this._host, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          this._port = addr.port
        }
        this._server = server
        resolve()
      })
    })
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._server) {
        resolve()
        return
      }

      // Type assertion for Node.js http.Server
      const server = this._server as {
        close: (callback?: (err?: Error) => void) => void
      }

      server.close((err?: Error) => {
        if (err) {
          reject(err)
        } else {
          this._server = null
          resolve()
        }
      })
    })
  }

  /**
   * Get the server URL
   */
  get url(): string {
    if (!this._server) {
      throw new Error('Server not started. Call start() first.')
    }
    return `http://${this._host}:${this._port}`
  }

  /**
   * Get the server port
   */
  get port(): number {
    return this._port
  }

  /**
   * Check if server is running
   */
  get isRunning(): boolean {
    return this._server !== null
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for a condition to be true
 *
 * @example
 * ```typescript
 * await waitFor(() => mockTransport.getCallCount() > 0)
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = options?.timeout ?? 5000
  const interval = options?.interval ?? 50
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`waitFor timeout after ${timeout}ms`)
}

/**
 * Create a deferred promise for testing async flows
 *
 * @example
 * ```typescript
 * const { promise, resolve, reject } = deferred<string>()
 *
 * // In handler
 * mockTransport({
 *   'async.method': () => promise
 * })
 *
 * // In test
 * const resultPromise = rpc.async.method()
 * resolve('result')
 * await expect(resultPromise).resolves.toBe('result')
 * ```
 */
export function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

/**
 * Create a spy function that tracks calls
 *
 * @example
 * ```typescript
 * const spy = createSpy<(x: number) => number>((x) => x * 2)
 *
 * spy(5)
 * spy(10)
 *
 * expect(spy.calls).toEqual([[5], [10]])
 * expect(spy.results).toEqual([10, 20])
 * ```
 */
export function createSpy<T extends (...args: unknown[]) => unknown>(
  impl?: T
): T & {
  calls: Parameters<T>[]
  results: ReturnType<T>[]
  reset: () => void
} {
  const calls: Parameters<T>[] = []
  const results: ReturnType<T>[] = []

  const spy = ((...args: Parameters<T>): ReturnType<T> => {
    calls.push(args)
    const result = impl?.(...args) as ReturnType<T>
    results.push(result)
    return result
  }) as T & {
    calls: Parameters<T>[]
    results: ReturnType<T>[]
    reset: () => void
  }

  spy.calls = calls
  spy.results = results
  spy.reset = () => {
    calls.length = 0
    results.length = 0
  }

  return spy
}
