/**
 * Performance Benchmark Tests for @dotdo/rpc Core
 *
 * Tests collection operations, SQL performance, and memory stability
 * for the core DO server package.
 *
 * Uses sql.js in-memory database to measure framework overhead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import { MockSqlStorage } from './__testutils__'

// ============================================================================
// Performance Utilities
// ============================================================================

/**
 * Measure execution time of a sync or async operation
 */
function measureTime<T>(fn: () => T): { result: T; duration: number } {
  const start = Date.now()
  const result = fn()
  const duration = Date.now() - start
  return { result, duration }
}

/**
 * Measure execution time of an async operation
 */
async function measureTimeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now()
  const result = await fn()
  const duration = Date.now() - start
  return { result, duration }
}

/**
 * Get memory usage snapshot (Node.js only)
 */
function getMemoryUsage(): number | null {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed
  }
  return null
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(2)} MB`
}

// ============================================================================
// Test Setup
// ============================================================================

let SQL: Awaited<ReturnType<typeof initSqlJs>>
let db: Database
let mockSql: MockSqlStorage

// We dynamically import createCollection and Collections to reset module state
let createCollection: typeof import('./collections').createCollection
let Collections: typeof import('./collections').Collections
type Collection<T extends Record<string, unknown>> = import('./collections').Collection<T>

beforeEach(async () => {
  // Reset module cache to reset the schemaInitialized flag
  vi.resetModules()

  // Re-import the module
  const collectionsModule = await import('./collections')
  createCollection = collectionsModule.createCollection
  Collections = collectionsModule.Collections

  // Initialize sql.js if needed
  if (!SQL) {
    SQL = await initSqlJs()
  }
  db = new SQL.Database()
  mockSql = new MockSqlStorage(db)
})

afterEach(() => {
  if (mockSql) {
    mockSql.close()
  }
})

// ============================================================================
// Test Types
// ============================================================================

interface User {
  name: string
  email: string
  age: number
  active: boolean
  role?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

interface Product {
  name: string
  price: number
  category: string
  inStock: boolean
  tags?: string[]
  [key: string]: unknown
}

// ============================================================================
// Performance Benchmarks
// ============================================================================

describe('Performance Benchmarks', () => {
  describe('Collection Write Performance', () => {
    it('should handle 10K put() operations under 2s', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const operationCount = 10000

      const { duration } = measureTime(() => {
        for (let i = 0; i < operationCount; i++) {
          collection.put(`user${i}`, {
            name: `User ${i}`,
            email: `user${i}@example.com`,
            age: 20 + (i % 50),
            active: i % 2 === 0,
          })
        }
      })

      console.log(`  10K put() operations completed in ${duration}ms (${(operationCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Verify all records were inserted
      expect(collection.count()).toBe(operationCount)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle 5K update operations efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 1000
      const updateCount = 5000

      // Insert initial records
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 25,
          active: true,
        })
      }

      // Perform updates (updating same records multiple times)
      const { duration } = measureTime(() => {
        for (let i = 0; i < updateCount; i++) {
          const id = `user${i % recordCount}`
          collection.put(id, {
            name: `Updated User ${i}`,
            email: `updated${i}@example.com`,
            age: 25 + (i % 30),
            active: i % 3 !== 0,
          })
        }
      })

      console.log(`  5K update operations completed in ${duration}ms (${(updateCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle 5K delete operations efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 5000

      // Insert records
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 25,
          active: true,
        })
      }

      // Delete all records
      const { duration } = measureTime(() => {
        for (let i = 0; i < recordCount; i++) {
          collection.delete(`user${i}`)
        }
      })

      console.log(`  5K delete operations completed in ${duration}ms (${(recordCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Verify all deleted
      expect(collection.count()).toBe(0)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })
  })

  describe('Collection Read Performance', () => {
    it('should handle 10K get() operations under 1s', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 1000

      // Insert records
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 25,
          active: true,
        })
      }

      // Perform reads (10 reads per record)
      const readCount = 10000
      const { duration } = measureTime(() => {
        for (let i = 0; i < readCount; i++) {
          const id = `user${i % recordCount}`
          collection.get(id)
        }
      })

      console.log(`  10K get() operations completed in ${duration}ms (${(readCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Should complete in under 1 second
      expect(duration).toBeLessThan(1000)
    })

    it('should handle find() with filter on 5K records efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 5000

      // Insert records with varied data
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 20 + (i % 50),
          active: i % 2 === 0,
          role: i % 3 === 0 ? 'admin' : 'user',
        })
      }

      // Perform various filter queries
      const queries = 100
      const { duration } = measureTime(() => {
        for (let i = 0; i < queries; i++) {
          // Different query patterns
          switch (i % 5) {
            case 0:
              collection.find({ active: true })
              break
            case 1:
              collection.find({ age: { $gt: 40 } })
              break
            case 2:
              collection.find({ role: 'admin' })
              break
            case 3:
              collection.find({ age: { $gte: 30, $lte: 40 } })
              break
            case 4:
              collection.find({ $and: [{ active: true }, { role: 'admin' }] })
              break
          }
        }
      })

      console.log(`  100 find() queries on 5K records completed in ${duration}ms (${(queries / duration * 1000).toFixed(1)} queries/sec)`)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle list() with pagination on 5K records efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 5000
      const pageSize = 50

      // Insert records
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 25,
          active: true,
        })
      }

      // Paginate through all records
      const { duration } = measureTime(() => {
        let offset = 0
        while (offset < recordCount) {
          collection.list({ limit: pageSize, offset, sort: 'name' })
          offset += pageSize
        }
      })

      const pageCount = Math.ceil(recordCount / pageSize)
      console.log(`  Paginated through ${recordCount} records in ${pageCount} pages in ${duration}ms`)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })
  })

  describe('Collection Mixed Workload', () => {
    it('should handle mixed read/write workload efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const operationCount = 5000

      // 70% reads, 20% writes, 10% deletes
      const { duration } = measureTime(() => {
        for (let i = 0; i < operationCount; i++) {
          const op = i % 10
          const id = `user${i % 1000}`

          if (op < 7) {
            // Read
            collection.get(id)
          } else if (op < 9) {
            // Write/Update
            collection.put(id, {
              name: `User ${i}`,
              email: `user${i}@example.com`,
              age: 25 + (i % 30),
              active: true,
            })
          } else {
            // Delete (with potential re-insert)
            collection.delete(id)
          }
        }
      })

      console.log(`  5K mixed operations completed in ${duration}ms (${(operationCount / duration * 1000).toFixed(0)} ops/sec)`)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })

    it('should handle concurrent collection access efficiently', () => {
      const collections = new Collections(mockSql as unknown as SqlStorage)
      const operationCount = 3000
      const collectionNames = ['users', 'products', 'orders', 'logs', 'events']

      // Operate across multiple collections
      const { duration } = measureTime(() => {
        for (let i = 0; i < operationCount; i++) {
          const collName = collectionNames[i % collectionNames.length]!
          const coll = collections.collection<Record<string, unknown>>(collName)
          const op = i % 3

          if (op === 0) {
            coll.put(`item${i}`, { data: `value${i}`, index: i })
          } else if (op === 1) {
            coll.get(`item${i % 500}`)
          } else {
            coll.find({ index: { $gt: i - 10 } }, { limit: 5 })
          }
        }
      })

      console.log(`  3K operations across ${collectionNames.length} collections in ${duration}ms`)

      // Should complete in under 2 seconds
      expect(duration).toBeLessThan(2000)
    })
  })

  describe('Memory Stability', () => {
    it('should not significantly increase memory over 1000 collection operations', () => {
      const initialMemory = getMemoryUsage()
      if (initialMemory === null) {
        console.log('  Skipping memory test - memory API not available')
        return
      }

      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const operationCount = 1000

      // Perform many operations with varied data sizes
      for (let i = 0; i < operationCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 25,
          active: true,
          metadata: {
            data: 'x'.repeat(100),
            tags: ['tag1', 'tag2', 'tag3'],
            nested: { level: i, value: `nested${i}` },
          },
        })
      }

      // Read and filter operations
      for (let i = 0; i < 500; i++) {
        collection.get(`user${i % operationCount}`)
        collection.find({ age: { $gt: 20 } }, { limit: 10 })
      }

      // Delete half
      for (let i = 0; i < operationCount / 2; i++) {
        collection.delete(`user${i}`)
      }

      // Force GC if available
      if (typeof global !== 'undefined' && (global as any).gc) {
        ;(global as any).gc()
      }

      const finalMemory = getMemoryUsage()!
      const memoryIncrease = finalMemory - initialMemory
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024)

      console.log(`  Initial memory: ${formatBytes(initialMemory)}`)
      console.log(`  Final memory: ${formatBytes(finalMemory)}`)
      console.log(`  Memory increase: ${formatBytes(memoryIncrease)}`)

      // Memory increase should be reasonable (under 50MB)
      expect(memoryIncreaseMB).toBeLessThan(50)
    })

    it('should not leak memory with collection create/drop cycles', () => {
      const initialMemory = getMemoryUsage()
      if (initialMemory === null) {
        console.log('  Skipping memory test - memory API not available')
        return
      }

      const collections = new Collections(mockSql as unknown as SqlStorage)
      const cycles = 50

      for (let i = 0; i < cycles; i++) {
        const collName = `temp_collection_${i}`
        const coll = collections.collection(collName)

        // Add some data
        for (let j = 0; j < 100; j++) {
          coll.put(`item${j}`, { value: j, cycle: i })
        }

        // Drop the collection
        collections.drop(collName)
      }

      // Force GC if available
      if (typeof global !== 'undefined' && (global as any).gc) {
        ;(global as any).gc()
      }

      const finalMemory = getMemoryUsage()!
      const memoryIncrease = finalMemory - initialMemory
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024)

      console.log(`  Memory increase after ${cycles} create/drop cycles: ${formatBytes(memoryIncrease)}`)

      // Should not leak significantly (under 30MB for 50 cycles)
      expect(memoryIncreaseMB).toBeLessThan(30)
    })
  })

  describe('Large Document Handling', () => {
    it('should handle large documents efficiently', () => {
      const collection = createCollection<Record<string, unknown>>(mockSql as unknown as SqlStorage, 'docs')
      const docCount = 100

      // Create documents with varying sizes
      const { duration: writeDuration } = measureTime(() => {
        for (let i = 0; i < docCount; i++) {
          const size = 1000 + (i * 100) // 1KB to 11KB per doc
          collection.put(`doc${i}`, {
            content: 'x'.repeat(size),
            metadata: {
              size,
              index: i,
              tags: Array.from({ length: 20 }, (_, j) => `tag${j}`),
            },
          })
        }
      })

      console.log(`  100 large documents (1KB-11KB) written in ${writeDuration}ms`)

      // Read all documents
      const { duration: readDuration } = measureTime(() => {
        for (let i = 0; i < docCount; i++) {
          collection.get(`doc${i}`)
        }
      })

      console.log(`  100 large documents read in ${readDuration}ms`)

      // Should complete in reasonable time
      expect(writeDuration).toBeLessThan(2000)
      expect(readDuration).toBeLessThan(1000)
    })

    it('should handle deeply nested documents', () => {
      const collection = createCollection<Record<string, unknown>>(mockSql as unknown as SqlStorage, 'nested')
      const docCount = 500

      // Create deeply nested documents
      const createNestedDoc = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' }
        return { level: depth, child: createNestedDoc(depth - 1) }
      }

      const { duration: writeDuration } = measureTime(() => {
        for (let i = 0; i < docCount; i++) {
          const depth = 5 + (i % 5) // 5-9 levels deep
          collection.put(`doc${i}`, createNestedDoc(depth))
        }
      })

      console.log(`  ${docCount} deeply nested documents written in ${writeDuration}ms`)

      // Read and verify
      const { duration: readDuration } = measureTime(() => {
        for (let i = 0; i < docCount; i++) {
          const doc = collection.get(`doc${i}`)
          expect(doc).not.toBeNull()
        }
      })

      console.log(`  ${docCount} deeply nested documents read in ${readDuration}ms`)

      expect(writeDuration).toBeLessThan(2000)
      expect(readDuration).toBeLessThan(1000)
    })
  })

  describe('Query Performance', () => {
    it('should handle complex filters on large dataset', () => {
      const collection = createCollection<Product>(mockSql as unknown as SqlStorage, 'products')
      const recordCount = 3000

      // Insert diverse data
      const categories = ['electronics', 'clothing', 'food', 'furniture', 'toys']
      for (let i = 0; i < recordCount; i++) {
        collection.put(`product${i}`, {
          name: `Product ${i}`,
          price: 10 + (i % 1000),
          category: categories[i % categories.length]!,
          inStock: i % 3 !== 0,
          tags: Array.from({ length: 3 }, (_, j) => `tag${(i + j) % 10}`),
        })
      }

      // Complex query benchmarks
      const queryCount = 50
      const { duration } = measureTime(() => {
        for (let q = 0; q < queryCount; q++) {
          // Various complex queries
          collection.find({
            $and: [
              { category: categories[q % categories.length] },
              { price: { $gte: 100, $lte: 500 } },
              { inStock: true },
            ],
          }, { limit: 20, sort: '-price' })
        }
      })

      console.log(`  ${queryCount} complex queries on ${recordCount} records in ${duration}ms`)

      // Should complete efficiently
      expect(duration).toBeLessThan(3000)
    })

    it('should handle $or queries efficiently', () => {
      const collection = createCollection<User>(mockSql as unknown as SqlStorage, 'users')
      const recordCount = 2000

      // Insert data
      for (let i = 0; i < recordCount; i++) {
        collection.put(`user${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
          age: 18 + (i % 60),
          active: i % 2 === 0,
          role: i % 4 === 0 ? 'admin' : i % 4 === 1 ? 'moderator' : 'user',
        })
      }

      // $or queries
      const queryCount = 50
      const { duration } = measureTime(() => {
        for (let q = 0; q < queryCount; q++) {
          collection.find({
            $or: [
              { role: 'admin' },
              { age: { $gt: 60 } },
              { $and: [{ active: true }, { age: { $lt: 25 } }] },
            ],
          })
        }
      })

      console.log(`  ${queryCount} $or queries on ${recordCount} records in ${duration}ms`)

      expect(duration).toBeLessThan(3000)
    })
  })

  describe('Stress Testing', () => {
    it('should survive high-volume operations', () => {
      const collection = createCollection<Record<string, unknown>>(mockSql as unknown as SqlStorage, 'stress')
      const totalOps = 10000

      // Mix of operations
      const { duration } = measureTime(() => {
        for (let i = 0; i < totalOps; i++) {
          const op = i % 10
          const id = `item${i % 2000}` // Reuse IDs

          switch (op) {
            case 0:
            case 1:
            case 2:
            case 3:
              // 40% writes
              collection.put(id, { value: i, timestamp: Date.now() })
              break
            case 4:
            case 5:
            case 6:
              // 30% reads
              collection.get(id)
              break
            case 7:
            case 8:
              // 20% finds
              collection.find({ value: { $gt: i - 100 } }, { limit: 10 })
              break
            case 9:
              // 10% deletes
              collection.delete(id)
              break
          }
        }
      })

      const opsPerSec = (totalOps / duration) * 1000

      console.log(`  ${totalOps} stress ops completed in ${duration}ms (${opsPerSec.toFixed(0)} ops/sec)`)

      // Should maintain reasonable throughput
      expect(opsPerSec).toBeGreaterThan(1000)
    })

    it('should maintain data integrity under stress', () => {
      const collection = createCollection<{ counter: number }>(mockSql as unknown as SqlStorage, 'counters')
      const recordCount = 100
      const incrementsPerRecord = 50

      // Initialize counters
      for (let i = 0; i < recordCount; i++) {
        collection.put(`counter${i}`, { counter: 0 })
      }

      // Increment counters many times
      for (let round = 0; round < incrementsPerRecord; round++) {
        for (let i = 0; i < recordCount; i++) {
          const current = collection.get(`counter${i}`)
          if (current) {
            collection.put(`counter${i}`, { counter: current.counter + 1 })
          }
        }
      }

      // Verify all counters have correct value
      let correctCount = 0
      for (let i = 0; i < recordCount; i++) {
        const final = collection.get(`counter${i}`)
        if (final?.counter === incrementsPerRecord) {
          correctCount++
        }
      }

      console.log(`  ${correctCount}/${recordCount} counters have correct value after ${recordCount * incrementsPerRecord} increments`)

      expect(correctCount).toBe(recordCount)
    })
  })
})
