/**
 * Tests for rpc.do React Integration Helpers
 *
 * Tests for getMethod, createQueryFn, createMutationFn, and error cases.
 * Uses mockRPC from ./testing for deterministic unit tests.
 */

import { describe, it, expect, vi } from 'vitest'
import { mockRPC } from './testing'
import { getMethod, createQueryFn, createMutationFn } from './react'
import type { RpcProxy } from './index'

// ============================================================================
// Shared Test API Types
// ============================================================================

interface TestAPI {
  users: {
    get: (id: string) => { id: string; name: string }
    create: (data: { name: string; email: string }) => { id: string }
    list: () => { id: string; name: string }[]
  }
  posts: {
    byUser: {
      list: (userId: string) => { id: string; title: string }[]
    }
  }
  health: () => { status: string }
  deep: {
    nested: {
      further: {
        method: (x: number) => number
      }
    }
  }
}

function createTestMock() {
  return mockRPC<TestAPI>({
    users: {
      get: (id) => ({ id, name: `User ${id}` }),
      create: (data) => ({ id: 'new-123' }),
      list: () => [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
    },
    posts: {
      byUser: {
        list: (userId) => [
          { id: 'p1', title: `Post by ${userId}` },
        ],
      },
    },
    health: () => ({ status: 'ok' }),
    deep: {
      nested: {
        further: {
          method: (x) => x * 2,
        },
      },
    },
  })
}

// ============================================================================
// getMethod Tests
// ============================================================================

describe('getMethod', () => {
  it('should resolve a single-segment path', () => {
    const rpc = createTestMock()
    const method = getMethod(rpc, 'health')

    expect(typeof method).toBe('function')
  })

  it('should resolve a two-segment dot-notation path', () => {
    const rpc = createTestMock()
    const method = getMethod(rpc, 'users.get')

    expect(typeof method).toBe('function')
  })

  it('should resolve a deeply nested dot-notation path', () => {
    const rpc = createTestMock()
    const method = getMethod(rpc, 'deep.nested.further.method')

    expect(typeof method).toBe('function')
  })

  it('should resolve a three-segment namespace path', () => {
    const rpc = createTestMock()
    const method = getMethod(rpc, 'posts.byUser.list')

    expect(typeof method).toBe('function')
  })

  it('should return a callable function that invokes the RPC method', async () => {
    const rpc = createTestMock()
    const getUser = getMethod(rpc, 'users.get')

    const result = await getUser('abc')
    expect(result).toEqual({ id: 'abc', name: 'User abc' })
  })

  it('should return a callable function for deeply nested methods', async () => {
    const rpc = createTestMock()
    const method = getMethod(rpc, 'deep.nested.further.method')

    const result = await method(21)
    expect(result).toBe(42)
  })

  it('should return a callable function for namespace paths', async () => {
    const rpc = createTestMock()
    const listPostsByUser = getMethod(rpc, 'posts.byUser.list')

    const result = await listPostsByUser('user-1')
    expect(result).toEqual([{ id: 'p1', title: 'Post by user-1' }])
  })

  it('should return a callable function for zero-arg methods', async () => {
    const rpc = createTestMock()
    const health = getMethod(rpc, 'health')

    const result = await health()
    expect(result).toEqual({ status: 'ok' })
  })
})

// ============================================================================
// createQueryFn Tests
// ============================================================================

describe('createQueryFn', () => {
  it('should create a query function from a simple path', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'users.get')

    const result = await queryFn('123')
    expect(result).toEqual({ id: '123', name: 'User 123' })
  })

  it('should create a query function from a nested path', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'posts.byUser.list')

    const result = await queryFn('user-42')
    expect(result).toEqual([{ id: 'p1', title: 'Post by user-42' }])
  })

  it('should create a query function from a deeply nested path', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'deep.nested.further.method')

    const result = await queryFn(5)
    expect(result).toBe(10)
  })

  it('should create a query function for zero-arg methods', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'users.list')

    const result = await queryFn()
    expect(result).toEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  it('should create a query function for top-level methods', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'health')

    const result = await queryFn()
    expect(result).toEqual({ status: 'ok' })
  })

  it('should pass arguments through to the RPC method correctly', async () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'users.create')

    const result = await queryFn({ name: 'Charlie', email: 'charlie@test.com' })
    expect(result).toEqual({ id: 'new-123' })
  })

  it('should propagate errors from the RPC method', async () => {
    interface FailAPI {
      fail: {
        method: () => never
      }
    }

    const rpc = mockRPC<FailAPI>({
      fail: {
        method: () => {
          throw new Error('RPC failure')
        },
      },
    })

    const queryFn = createQueryFn(rpc, 'fail.method')
    await expect(queryFn()).rejects.toThrow('RPC failure')
  })

  it('should apply transformError when provided', async () => {
    interface FailAPI {
      broken: {
        call: () => never
      }
    }

    const rpc = mockRPC<FailAPI>({
      broken: {
        call: () => {
          throw new Error('raw error')
        },
      },
    })

    const queryFn = createQueryFn(rpc, 'broken.call', {
      transformError: (err) => new Error(`Transformed: ${(err as Error).message}`),
    })

    await expect(queryFn()).rejects.toThrow('Transformed: raw error')
  })

  it('should not transform errors when transformError is not provided', async () => {
    interface FailAPI {
      broken: {
        call: () => never
      }
    }

    const rpc = mockRPC<FailAPI>({
      broken: {
        call: () => {
          throw new Error('original error')
        },
      },
    })

    const queryFn = createQueryFn(rpc, 'broken.call')
    await expect(queryFn()).rejects.toThrow('original error')
  })

  it('should return a function (not a promise)', () => {
    const rpc = createTestMock()
    const queryFn = createQueryFn(rpc, 'users.get')

    expect(typeof queryFn).toBe('function')
    // Should not be thenable itself
    expect((queryFn as any).then).toBeUndefined()
  })
})

// ============================================================================
// createMutationFn Tests
// ============================================================================

describe('createMutationFn', () => {
  it('should create a mutation function from a simple path', async () => {
    const rpc = createTestMock()
    const mutationFn = createMutationFn(rpc, 'users.create')

    const result = await mutationFn({ name: 'Dave', email: 'dave@test.com' })
    expect(result).toEqual({ id: 'new-123' })
  })

  it('should create a mutation function from a nested path', async () => {
    const rpc = createTestMock()
    const mutationFn = createMutationFn(rpc, 'posts.byUser.list')

    const result = await mutationFn('user-99')
    expect(result).toEqual([{ id: 'p1', title: 'Post by user-99' }])
  })

  it('should create a mutation function from a deeply nested path', async () => {
    const rpc = createTestMock()
    const mutationFn = createMutationFn(rpc, 'deep.nested.further.method')

    const result = await mutationFn(7)
    expect(result).toBe(14)
  })

  it('should call onMutate before the RPC method', async () => {
    const rpc = createTestMock()
    const callOrder: string[] = []

    interface OrderAPI {
      action: {
        run: (input: string) => string
      }
    }

    const orderedRpc = mockRPC<OrderAPI>({
      action: {
        run: (input) => {
          callOrder.push('rpc')
          return `result-${input}`
        },
      },
    })

    const mutationFn = createMutationFn(orderedRpc, 'action.run', {
      onMutate: async () => {
        callOrder.push('onMutate')
      },
    })

    const result = await mutationFn('test')

    expect(callOrder).toEqual(['onMutate', 'rpc'])
    expect(result).toBe('result-test')
  })

  it('should pass the args array to onMutate', async () => {
    const rpc = createTestMock()
    let capturedArgs: unknown = null

    const mutationFn = createMutationFn(rpc, 'users.get', {
      onMutate: (args) => {
        capturedArgs = args
      },
    })

    await mutationFn('user-xyz')

    // onMutate receives the args array (all arguments passed to the wrapper)
    expect(capturedArgs).toEqual(['user-xyz'])
  })

  it('should apply transformError when provided', async () => {
    interface FailAPI {
      broken: {
        mutate: () => never
      }
    }

    const rpc = mockRPC<FailAPI>({
      broken: {
        mutate: () => {
          throw new Error('mutation error')
        },
      },
    })

    const mutationFn = createMutationFn(rpc, 'broken.mutate', {
      transformError: (err) => new Error(`Mutate failed: ${(err as Error).message}`),
    })

    await expect(mutationFn()).rejects.toThrow('Mutate failed: mutation error')
  })

  it('should propagate errors without transformError', async () => {
    interface FailAPI {
      broken: {
        mutate: () => never
      }
    }

    const rpc = mockRPC<FailAPI>({
      broken: {
        mutate: () => {
          throw new Error('raw mutation error')
        },
      },
    })

    const mutationFn = createMutationFn(rpc, 'broken.mutate')
    await expect(mutationFn()).rejects.toThrow('raw mutation error')
  })

  it('should apply transformError when onMutate throws', async () => {
    const rpc = createTestMock()

    const mutationFn = createMutationFn(rpc, 'users.get', {
      onMutate: () => {
        throw new Error('onMutate failure')
      },
      transformError: (err) => new Error(`Caught: ${(err as Error).message}`),
    })

    await expect(mutationFn('any')).rejects.toThrow('Caught: onMutate failure')
  })

  it('should propagate onMutate errors without transformError', async () => {
    const rpc = createTestMock()

    const mutationFn = createMutationFn(rpc, 'users.get', {
      onMutate: () => {
        throw new Error('onMutate boom')
      },
    })

    await expect(mutationFn('any')).rejects.toThrow('onMutate boom')
  })

  it('should support async onMutate', async () => {
    const rpc = createTestMock()
    let mutateCompleted = false

    const mutationFn = createMutationFn(rpc, 'users.get', {
      onMutate: async () => {
        await new Promise((r) => setTimeout(r, 10))
        mutateCompleted = true
      },
    })

    await mutationFn('123')
    expect(mutateCompleted).toBe(true)
  })

  it('should return a function (not a promise)', () => {
    const rpc = createTestMock()
    const mutationFn = createMutationFn(rpc, 'users.create')

    expect(typeof mutationFn).toBe('function')
    expect((mutationFn as any).then).toBeUndefined()
  })
})

// ============================================================================
// Error Cases
// ============================================================================

describe('error cases', () => {
  describe('getMethod with invalid paths', () => {
    it('should handle accessing a path on a missing namespace', () => {
      // Create a mock with no handlers for the path we will access
      interface SparseAPI {
        existing: {
          method: () => string
        }
        missing: {
          deep: {
            method: () => string
          }
        }
      }

      const rpc = mockRPC<SparseAPI>({
        existing: {
          method: () => 'works',
        },
      })

      // getMethod navigates via proxy properties, so it returns whatever
      // the proxy returns. The mock proxy always returns something (another proxy)
      // for missing paths -- the error surfaces when you try to call the method.
      const method = getMethod(rpc, 'missing.deep.method')
      // The returned value is a proxy that will reject on invocation
      expect(method).toBeDefined()
    })
  })

  describe('createQueryFn with non-function path', () => {
    it('should throw when the path resolves to a non-function value on a plain object', () => {
      // Using a plain object (not a proxy) to test the non-function guard
      const plainObj = {
        config: {
          value: 42,
        },
      } as unknown as RpcProxy<{ config: { value: () => number } }>

      expect(() => {
        createQueryFn(plainObj, 'config.value' as any)
      }).toThrow('does not resolve to a method')
    })
  })

  describe('createMutationFn with non-function path', () => {
    it('should throw when the path resolves to a non-function value on a plain object', () => {
      const plainObj = {
        config: {
          setting: 'hello',
        },
      } as unknown as RpcProxy<{ config: { setting: () => string } }>

      expect(() => {
        createMutationFn(plainObj, 'config.setting' as any)
      }).toThrow('does not resolve to a method')
    })
  })

  describe('getMethod with null/undefined in path', () => {
    it('should throw Invalid RPC path when traversal hits null', () => {
      const rpc = {
        level1: null,
      } as unknown as RpcProxy<{ level1: { level2: { method: () => void } } }>

      expect(() => {
        getMethod(rpc, 'level1.level2.method' as any)
      }).toThrow('Invalid RPC path: level1.level2.method')
    })

    it('should throw Invalid RPC path when traversal hits undefined', () => {
      const rpc = {
        level1: undefined,
      } as unknown as RpcProxy<{ level1: { level2: { method: () => void } } }>

      expect(() => {
        getMethod(rpc, 'level1.level2.method' as any)
      }).toThrow('Invalid RPC path: level1.level2.method')
    })
  })

  describe('RPC method errors propagate correctly', () => {
    it('should propagate errors through createQueryFn', async () => {
      interface ErrorAPI {
        service: {
          fail: () => never
        }
      }

      const rpc = mockRPC<ErrorAPI>({
        service: {
          fail: () => {
            throw new Error('Service unavailable')
          },
        },
      })

      const queryFn = createQueryFn(rpc, 'service.fail')
      await expect(queryFn()).rejects.toThrow('Service unavailable')
    })

    it('should propagate errors through createMutationFn', async () => {
      interface ErrorAPI {
        service: {
          fail: () => never
        }
      }

      const rpc = mockRPC<ErrorAPI>({
        service: {
          fail: () => {
            throw new Error('Mutation failed')
          },
        },
      })

      const mutationFn = createMutationFn(rpc, 'service.fail')
      await expect(mutationFn()).rejects.toThrow('Mutation failed')
    })
  })

  describe('transformError receives the original error', () => {
    it('should pass the original error object to transformError in createQueryFn', async () => {
      interface ErrorAPI {
        broken: {
          query: () => never
        }
      }

      const originalError = new Error('original')
      let receivedError: unknown = null

      const rpc = mockRPC<ErrorAPI>({
        broken: {
          query: () => {
            throw originalError
          },
        },
      })

      const queryFn = createQueryFn(rpc, 'broken.query', {
        transformError: (err) => {
          receivedError = err
          return new Error('transformed')
        },
      })

      await expect(queryFn()).rejects.toThrow('transformed')
      expect(receivedError).toBe(originalError)
    })

    it('should pass the original error object to transformError in createMutationFn', async () => {
      interface ErrorAPI {
        broken: {
          mutate: () => never
        }
      }

      const originalError = new Error('original mutation error')
      let receivedError: unknown = null

      const rpc = mockRPC<ErrorAPI>({
        broken: {
          mutate: () => {
            throw originalError
          },
        },
      })

      const mutationFn = createMutationFn(rpc, 'broken.mutate', {
        transformError: (err) => {
          receivedError = err
          return new Error('transformed mutation')
        },
      })

      await expect(mutationFn()).rejects.toThrow('transformed mutation')
      expect(receivedError).toBe(originalError)
    })
  })
})
