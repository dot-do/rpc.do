/**
 * Streaming Transport Tests
 *
 * Tests for SSE and WebSocket streaming functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  wrapAsyncIterable,
  collectStream,
  takeFromStream,
  mapStream,
  filterStream,
} from './streaming'
import type { StreamResponse, StreamOptions } from '../types'

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('wrapAsyncIterable', () => {
  it('should wrap an async generator as StreamResponse', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
    }

    const stream = wrapAsyncIterable(generator())

    expect(stream.id).toBeDefined()
    expect(stream.id).toMatch(/^stream_/)
    expect(stream.closed).toBe(false)
  })

  it('should iterate using for await...of', async () => {
    async function* generator(): AsyncGenerator<string, void, undefined> {
      yield 'hello'
      yield 'world'
    }

    const stream = wrapAsyncIterable(generator())
    const results: string[] = []

    for await (const value of stream) {
      results.push(value)
    }

    expect(results).toEqual(['hello', 'world'])
    expect(stream.closed).toBe(true)
  })

  it('should support manual iteration with next()', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
    }

    const stream = wrapAsyncIterable(generator())

    const first = await stream.next()
    expect(first).toEqual({ value: 1, done: false })

    const second = await stream.next()
    expect(second).toEqual({ value: 2, done: false })

    const third = await stream.next()
    expect(third).toEqual({ value: undefined, done: true })
  })

  it('should close the stream', async () => {
    let cleanedUp = false

    async function* generator(): AsyncGenerator<number, void, undefined> {
      try {
        yield 1
        yield 2
        yield 3
      } finally {
        cleanedUp = true
      }
    }

    const stream = wrapAsyncIterable(generator())

    await stream.next() // Get first value
    await stream.close()

    expect(stream.closed).toBe(true)
    expect(cleanedUp).toBe(true)
  })

  it('should return done after close', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
    }

    const stream = wrapAsyncIterable(generator())
    await stream.close()

    const result = await stream.next()
    expect(result).toEqual({ value: undefined, done: true })
  })

  it('should handle errors from generator', async () => {
    const error = new Error('Generator error')

    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      throw error
    }

    const stream = wrapAsyncIterable(generator())

    await stream.next() // First value is ok
    await expect(stream.next()).rejects.toThrow('Generator error')
    expect(stream.closed).toBe(true)
  })
})

describe('collectStream', () => {
  it('should collect all values from a stream', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
    }

    const results = await collectStream(generator())
    expect(results).toEqual([1, 2, 3])
  })

  it('should return empty array for empty stream', async () => {
    async function* generator(): AsyncGenerator<never, void, undefined> {
      // Empty generator
    }

    const results = await collectStream(generator())
    expect(results).toEqual([])
  })

  it('should work with StreamResponse', async () => {
    async function* generator(): AsyncGenerator<string, void, undefined> {
      yield 'a'
      yield 'b'
    }

    const stream = wrapAsyncIterable(generator())
    const results = await collectStream(stream)

    expect(results).toEqual(['a', 'b'])
  })
})

describe('takeFromStream', () => {
  it('should take first N values', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    const stream = wrapAsyncIterable(generator())
    const results = await takeFromStream(stream, 3)

    expect(results).toEqual([1, 2, 3])
  })

  it('should take all values if count exceeds stream length', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
    }

    const stream = wrapAsyncIterable(generator())
    const results = await takeFromStream(stream, 10)

    expect(results).toEqual([1, 2])
  })

  it('should return empty array for count 0', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
    }

    const stream = wrapAsyncIterable(generator())
    const results = await takeFromStream(stream, 0)

    expect(results).toEqual([])
  })
})

describe('mapStream', () => {
  it('should map values synchronously', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
    }

    const doubled = mapStream(generator(), (x) => x * 2)
    const results = await collectStream(doubled)

    expect(results).toEqual([2, 4, 6])
  })

  it('should map values asynchronously', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
    }

    const mapped = mapStream(generator(), async (x) => {
      await new Promise((r) => setTimeout(r, 1))
      return x.toString()
    })

    const results = await collectStream(mapped)
    expect(results).toEqual(['1', '2'])
  })

  it('should transform objects', async () => {
    interface Input {
      text: string
    }

    async function* generator(): AsyncGenerator<Input, void, undefined> {
      yield { text: 'hello' }
      yield { text: 'world' }
    }

    const lengths = mapStream(generator(), (item) => item.text.length)
    const results = await collectStream(lengths)

    expect(results).toEqual([5, 5])
  })
})

describe('filterStream', () => {
  it('should filter values synchronously', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    const evens = filterStream(generator(), (x) => x % 2 === 0)
    const results = await collectStream(evens)

    expect(results).toEqual([2, 4])
  })

  it('should filter values asynchronously', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
    }

    const filtered = filterStream(generator(), async (x) => {
      await new Promise((r) => setTimeout(r, 1))
      return x > 1
    })

    const results = await collectStream(filtered)
    expect(results).toEqual([2, 3])
  })

  it('should return empty for all filtered out', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
    }

    const filtered = filterStream(generator(), () => false)
    const results = await collectStream(filtered)

    expect(results).toEqual([])
  })

  it('should filter objects by property', async () => {
    interface Event {
      type: string
      data: unknown
    }

    async function* generator(): AsyncGenerator<Event, void, undefined> {
      yield { type: 'click', data: 1 }
      yield { type: 'hover', data: 2 }
      yield { type: 'click', data: 3 }
    }

    const clicks = filterStream(generator(), (event) => event.type === 'click')
    const results = await collectStream(clicks)

    expect(results).toEqual([
      { type: 'click', data: 1 },
      { type: 'click', data: 3 },
    ])
  })
})

// ============================================================================
// Stream Composition Tests
// ============================================================================

describe('Stream composition', () => {
  it('should chain map and filter', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
      yield 2
      yield 3
      yield 4
      yield 5
    }

    // Filter evens, then double them
    const evens = filterStream(generator(), (x) => x % 2 === 0)
    const doubled = mapStream(evens, (x) => x * 2)
    const results = await collectStream(doubled)

    expect(results).toEqual([4, 8])
  })

  it('should handle complex transformations', async () => {
    interface User {
      id: number
      name: string
      active: boolean
    }

    async function* users(): AsyncGenerator<User, void, undefined> {
      yield { id: 1, name: 'Alice', active: true }
      yield { id: 2, name: 'Bob', active: false }
      yield { id: 3, name: 'Charlie', active: true }
    }

    // Get names of active users
    const activeUsers = filterStream(users(), (u) => u.active)
    const names = mapStream(activeUsers, (u) => u.name)
    const results = await collectStream(names)

    expect(results).toEqual(['Alice', 'Charlie'])
  })
})

// ============================================================================
// Type Tests
// ============================================================================

describe('Type definitions', () => {
  it('should have correct StreamResponse type', () => {
    // This test verifies the type shape at compile time
    const mockStream: StreamResponse<string> = {
      id: 'test',
      closed: false,
      next: async () => ({ value: 'test', done: false }),
      close: async () => {},
      [Symbol.asyncIterator]: function (): AsyncIterator<string, void, undefined> {
        return {
          next: () => this.next(),
        }
      },
    }

    expect(mockStream.id).toBe('test')
    expect(mockStream.closed).toBe(false)
  })

  it('should have correct StreamOptions type', () => {
    const options: StreamOptions = {
      bufferSize: 16,
      chunkTimeout: 30000,
      autoReconnect: true,
      maxReconnectAttempts: 3,
      onStart: () => {},
      onEnd: () => {},
      onError: () => {},
      onReconnect: () => {},
    }

    expect(options.bufferSize).toBe(16)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Stream with DOClient integration', () => {
  it('should simulate streaming RPC response', async () => {
    // Simulate what the DOClient.stream() method would receive
    async function* mockServerStream(): AsyncGenerator<{ text: string }, void, undefined> {
      yield { text: 'Hello' }
      yield { text: ' ' }
      yield { text: 'World' }
    }

    const stream = wrapAsyncIterable(mockServerStream())

    // Collect text chunks
    const chunks: string[] = []
    for await (const chunk of stream) {
      chunks.push(chunk.text)
    }

    expect(chunks.join('')).toBe('Hello World')
  })

  it('should handle large streams efficiently', async () => {
    const count = 1000

    async function* largeStream(): AsyncGenerator<number, void, undefined> {
      for (let i = 0; i < count; i++) {
        yield i
      }
    }

    const stream = wrapAsyncIterable(largeStream())

    let received = 0
    for await (const _value of stream) {
      received++
    }

    expect(received).toBe(count)
  })

  it('should support early termination', async () => {
    let generated = 0

    async function* infiniteStream(): AsyncGenerator<number, void, undefined> {
      while (true) {
        generated++
        yield generated
      }
    }

    const stream = wrapAsyncIterable(infiniteStream())

    // Take only 5 values
    const results = await takeFromStream(stream, 5)

    expect(results).toEqual([1, 2, 3, 4, 5])
    // Note: generated will be at least 5, possibly more due to async buffering
    expect(generated).toBeGreaterThanOrEqual(5)

    // Close the stream to stop the generator
    await stream.close()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  it('should handle empty generators', async () => {
    async function* empty(): AsyncGenerator<never, void, undefined> {}

    const stream = wrapAsyncIterable(empty())
    const result = await stream.next()

    expect(result).toEqual({ value: undefined, done: true })
    expect(stream.closed).toBe(true)
  })

  it('should handle generators that throw immediately', async () => {
    async function* throwing(): AsyncGenerator<never, void, undefined> {
      throw new Error('Immediate error')
    }

    const stream = wrapAsyncIterable(throwing())

    await expect(stream.next()).rejects.toThrow('Immediate error')
    expect(stream.closed).toBe(true)
  })

  it('should handle multiple close calls', async () => {
    async function* generator(): AsyncGenerator<number, void, undefined> {
      yield 1
    }

    const stream = wrapAsyncIterable(generator())

    // Multiple close calls should be safe
    await stream.close()
    await stream.close()
    await stream.close()

    expect(stream.closed).toBe(true)
  })

  it('should handle sequential next() calls on slow stream', async () => {
    async function* slowGenerator(): AsyncGenerator<number, void, undefined> {
      await new Promise((r) => setTimeout(r, 10))
      yield 1
      await new Promise((r) => setTimeout(r, 10))
      yield 2
    }

    const stream = wrapAsyncIterable(slowGenerator())

    const result1 = await stream.next()
    const result2 = await stream.next()
    const result3 = await stream.next()

    expect(result1.value).toBe(1)
    expect(result2.value).toBe(2)
    expect(result3.done).toBe(true)
  })

  it('should handle undefined and null values', async () => {
    async function* generator(): AsyncGenerator<unknown, void, undefined> {
      yield undefined
      yield null
      yield 0
      yield ''
      yield false
    }

    const results = await collectStream(generator())
    expect(results).toEqual([undefined, null, 0, '', false])
  })
})
