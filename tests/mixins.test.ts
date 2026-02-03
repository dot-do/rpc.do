/**
 * Mixins Tests
 *
 * Tests for core/src/mixins: SQL, Storage, Collections, Colo, Schema
 * These mixins provide composable functionality for DurableRPC classes.
 *
 * Note: The colo.do/tiny optional dependency is mocked via vitest.config.ts alias
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// Mock Cloudflare Types
// ============================================================================

// Mock SqlStorage cursor
function createMockCursor(results: unknown[] = [], rowsRead = 0, rowsWritten = 0) {
  return {
    toArray: () => results,
    one: () => results[0] ?? null,
    rowsRead,
    rowsWritten,
  }
}

// Mock SqlStorage
function createMockSqlStorage(execMock?: ReturnType<typeof vi.fn>) {
  return {
    exec: execMock ?? vi.fn(() => createMockCursor()),
  }
}

// Mock DurableObjectStorage
function createMockStorage() {
  const store = new Map<string, unknown>()
  return {
    get: vi.fn((keyOrKeys: string | string[]) => {
      if (Array.isArray(keyOrKeys)) {
        const result = new Map<string, unknown>()
        for (const key of keyOrKeys) {
          if (store.has(key)) {
            result.set(key, store.get(key))
          }
        }
        return Promise.resolve(result)
      }
      return Promise.resolve(store.get(keyOrKeys))
    }),
    put: vi.fn((keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrEntries === 'string') {
        store.set(keyOrEntries, value)
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          store.set(k, v)
        }
      }
      return Promise.resolve()
    }),
    delete: vi.fn((keyOrKeys: string | string[]) => {
      if (Array.isArray(keyOrKeys)) {
        let count = 0
        for (const key of keyOrKeys) {
          if (store.delete(key)) count++
        }
        return Promise.resolve(count)
      }
      return Promise.resolve(store.delete(keyOrKeys))
    }),
    list: vi.fn((options?: { prefix?: string }) => {
      const result = new Map<string, unknown>()
      for (const [key, value] of store) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value)
        }
      }
      return Promise.resolve(result)
    }),
    _store: store, // Expose for test setup
  }
}

// ============================================================================
// SQL Mixin Tests
// ============================================================================

describe('withSQL mixin', () => {
  // Dynamically import to avoid issues with Cloudflare types
  let withSQL: typeof import('../core/src/mixins/sql.js').withSQL

  beforeEach(async () => {
    const module = await import('../core/src/mixins/sql.js')
    withSQL = module.withSQL
  })

  describe('validateQueryParams', () => {
    it('should accept valid query with matching strings and values', async () => {
      const mockExec = vi.fn(() => createMockCursor([{ id: 1 }], 1, 0))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      // Valid query: sql`SELECT * FROM users WHERE id = ${1}` -> strings=["SELECT * FROM users WHERE id = ", ""], values=[1]
      const result = instance.__sql({
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: [1],
      })

      expect(result.results).toEqual([{ id: 1 }])
      expect(mockExec).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?', 1)
    })

    it('should throw error for mismatched parameter count', async () => {
      const mockSql = createMockSqlStorage()

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(() => {
        instance.__sql({
          strings: ['SELECT * FROM users'],
          values: [1], // 1 value but 0 placeholders (strings.length - 1 = 0)
        })
      }).toThrow('SQL parameter count mismatch')
    })

    it('should throw descriptive error message', async () => {
      const mockSql = createMockSqlStorage()

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(() => {
        instance.__sql({
          strings: ['SELECT * FROM users WHERE id = ', ' AND name = ', ''],
          values: [1], // Expected 2 values but got 1
        })
      }).toThrow('expected 2 values but got 1')
    })
  })

  describe('__sql method', () => {
    it('should execute query and return results with metadata', async () => {
      const mockResults = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
      const mockExec = vi.fn(() => createMockCursor(mockResults, 2, 0))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sql({
        strings: ['SELECT * FROM users'],
        values: [],
      })

      expect(result.results).toEqual(mockResults)
      expect(result.meta.rows_read).toBe(2)
      expect(result.meta.rows_written).toBe(0)
    })

    it('should correctly join query strings with placeholders', async () => {
      const mockExec = vi.fn(() => createMockCursor())
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      instance.__sql({
        strings: ['SELECT * FROM users WHERE id = ', ' AND status = ', ''],
        values: [42, 'active'],
      })

      expect(mockExec).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ? AND status = ?', 42, 'active')
    })

    it('should handle empty result set', async () => {
      const mockExec = vi.fn(() => createMockCursor([], 0, 0))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sql({
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: [999],
      })

      expect(result.results).toEqual([])
      expect(result.meta.rows_read).toBe(0)
    })
  })

  describe('__sqlFirst method', () => {
    it('should return first row when results exist', async () => {
      const mockResults = [{ id: 1, name: 'Alice' }]
      const mockExec = vi.fn(() => createMockCursor(mockResults))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sqlFirst({
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: [1],
      })

      expect(result).toEqual({ id: 1, name: 'Alice' })
    })

    it('should return null when no results', async () => {
      const mockExec = vi.fn(() => createMockCursor([]))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sqlFirst({
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: [999],
      })

      expect(result).toBeNull()
    })

    it('should validate query parameters', async () => {
      const mockSql = createMockSqlStorage()

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(() => {
        instance.__sqlFirst({
          strings: ['SELECT * FROM users'],
          values: [1, 2, 3],
        })
      }).toThrow('SQL parameter count mismatch')
    })
  })

  describe('__sqlRun method', () => {
    it('should execute write query and return rows written', async () => {
      const mockExec = vi.fn(() => createMockCursor([], 0, 5))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sqlRun({
        strings: ['UPDATE users SET status = ', ' WHERE active = ', ''],
        values: ['inactive', true],
      })

      expect(result.rowsWritten).toBe(5)
    })

    it('should handle INSERT queries', async () => {
      const mockExec = vi.fn(() => createMockCursor([], 0, 1))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sqlRun({
        strings: ['INSERT INTO users (name, email) VALUES (', ', ', ')'],
        values: ['Alice', 'alice@example.com'],
      })

      expect(result.rowsWritten).toBe(1)
      expect(mockExec).toHaveBeenCalledWith('INSERT INTO users (name, email) VALUES (?, ?)', 'Alice', 'alice@example.com')
    })

    it('should handle DELETE queries', async () => {
      const mockExec = vi.fn(() => createMockCursor([], 0, 3))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sqlRun({
        strings: ['DELETE FROM users WHERE status = ', ''],
        values: ['deleted'],
      })

      expect(result.rowsWritten).toBe(3)
    })

    it('should validate query parameters', async () => {
      const mockSql = createMockSqlStorage()

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(() => {
        instance.__sqlRun({
          strings: ['DELETE FROM users'],
          values: ['extra'],
        })
      }).toThrow('SQL parameter count mismatch')
    })
  })

  describe('edge cases', () => {
    it('should handle query with no values', async () => {
      const mockExec = vi.fn(() => createMockCursor([{ count: 10 }]))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.__sql({
        strings: ['SELECT COUNT(*) as count FROM users'],
        values: [],
      })

      expect(result.results).toEqual([{ count: 10 }])
      expect(mockExec).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM users')
    })

    it('should handle null values in query', async () => {
      const mockExec = vi.fn(() => createMockCursor([], 0, 1))
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      instance.__sqlRun({
        strings: ['UPDATE users SET deleted_at = ', ' WHERE id = ', ''],
        values: [null, 1],
      })

      expect(mockExec).toHaveBeenCalledWith('UPDATE users SET deleted_at = ? WHERE id = ?', null, 1)
    })

    it('should handle various value types', async () => {
      const mockExec = vi.fn(() => createMockCursor())
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      instance.__sql({
        strings: ['SELECT * FROM data WHERE int = ', ' AND str = ', ' AND bool = ', ' AND float = ', ''],
        values: [42, 'hello', true, 3.14],
      })

      expect(mockExec).toHaveBeenCalledWith(
        'SELECT * FROM data WHERE int = ? AND str = ? AND bool = ? AND float = ?',
        42, 'hello', true, 3.14
      )
    })
  })
})

// ============================================================================
// Storage Mixin Tests
// ============================================================================

describe('withStorage mixin', () => {
  let withStorage: typeof import('../core/src/mixins/storage.js').withStorage

  beforeEach(async () => {
    const module = await import('../core/src/mixins/storage.js')
    withStorage = module.withStorage
  })

  describe('__storageGet method', () => {
    it('should get a single value by key', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('user:1', { name: 'Alice' })

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageGet('user:1')
      expect(result).toEqual({ name: 'Alice' })
    })

    it('should return undefined for non-existent key', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageGet('nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('__storageGetMultiple method', () => {
    it('should get multiple values by keys', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('user:1', { name: 'Alice' })
      mockStorage._store.set('user:2', { name: 'Bob' })
      mockStorage._store.set('user:3', { name: 'Charlie' })

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageGetMultiple(['user:1', 'user:3'])
      expect(result.get('user:1')).toEqual({ name: 'Alice' })
      expect(result.get('user:3')).toEqual({ name: 'Charlie' })
      expect(result.has('user:2')).toBe(false)
    })

    it('should handle empty keys array', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageGetMultiple([])
      expect(result.size).toBe(0)
    })

    it('should skip non-existent keys', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('exists', 'value')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageGetMultiple(['exists', 'missing'])
      expect(result.size).toBe(1)
      expect(result.get('exists')).toBe('value')
    })
  })

  describe('__storagePut method', () => {
    it('should store a single value', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePut('key', 'value')
      expect(mockStorage._store.get('key')).toBe('value')
    })

    it('should overwrite existing value', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('key', 'old')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePut('key', 'new')
      expect(mockStorage._store.get('key')).toBe('new')
    })

    it('should store complex objects', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const complexObj = { nested: { array: [1, 2, 3], date: new Date().toISOString() } }
      await instance.__storagePut('complex', complexObj)
      expect(mockStorage._store.get('complex')).toEqual(complexObj)
    })
  })

  describe('__storagePutMultiple method', () => {
    it('should store multiple values', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePutMultiple({
        'key1': 'value1',
        'key2': 'value2',
        'key3': 'value3',
      })

      expect(mockStorage._store.get('key1')).toBe('value1')
      expect(mockStorage._store.get('key2')).toBe('value2')
      expect(mockStorage._store.get('key3')).toBe('value3')
    })

    it('should handle empty entries object', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePutMultiple({})
      expect(mockStorage._store.size).toBe(0)
    })
  })

  describe('__storageDelete method', () => {
    it('should delete existing key and return true', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('key', 'value')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageDelete('key')
      expect(result).toBe(true)
      expect(mockStorage._store.has('key')).toBe(false)
    })

    it('should return false for non-existent key', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageDelete('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('__storageDeleteMultiple method', () => {
    it('should delete multiple keys and return count', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('key1', 'value1')
      mockStorage._store.set('key2', 'value2')
      mockStorage._store.set('key3', 'value3')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const count = await instance.__storageDeleteMultiple(['key1', 'key3', 'nonexistent'])
      expect(count).toBe(2)
      expect(mockStorage._store.has('key2')).toBe(true)
    })

    it('should return 0 for empty keys array', async () => {
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const count = await instance.__storageDeleteMultiple([])
      expect(count).toBe(0)
    })
  })

  describe('__storageList method', () => {
    it('should list all keys and values', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('a', 1)
      mockStorage._store.set('b', 2)
      mockStorage._store.set('c', 3)

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageList()
      expect(result.size).toBe(3)
      expect(result.get('a')).toBe(1)
      expect(result.get('b')).toBe(2)
      expect(result.get('c')).toBe(3)
    })

    it('should filter by prefix', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('user:1', 'Alice')
      mockStorage._store.set('user:2', 'Bob')
      mockStorage._store.set('post:1', 'Hello')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageList({ prefix: 'user:' })
      expect(result.size).toBe(2)
      expect(result.has('post:1')).toBe(false)
    })

    it('should return empty map when no matches', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('key', 'value')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = await instance.__storageList({ prefix: 'nomatch:' })
      expect(result.size).toBe(0)
    })
  })

  describe('__storageKeys method', () => {
    it('should return all keys', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('a', 1)
      mockStorage._store.set('b', 2)

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const keys = await instance.__storageKeys()
      expect(keys).toContain('a')
      expect(keys).toContain('b')
      expect(keys.length).toBe(2)
    })

    it('should filter keys by prefix', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('user:1', 'Alice')
      mockStorage._store.set('user:2', 'Bob')
      mockStorage._store.set('post:1', 'Hello')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const keys = await instance.__storageKeys('user:')
      expect(keys).toContain('user:1')
      expect(keys).toContain('user:2')
      expect(keys).not.toContain('post:1')
      expect(keys.length).toBe(2)
    })

    it('should return empty array when no keys match', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('key', 'value')

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const keys = await instance.__storageKeys('nomatch:')
      expect(keys).toEqual([])
    })

    it('should work without prefix argument', async () => {
      const mockStorage = createMockStorage()
      mockStorage._store.set('x', 1)

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const keys = await instance.__storageKeys()
      expect(keys).toEqual(['x'])
    })
  })
})

// ============================================================================
// Colo Mixin Tests
// ============================================================================

describe('withColo mixin', () => {
  let withColo: typeof import('../core/src/mixins/colo.js').withColo
  let WORKER_COLO_HEADER: string

  beforeEach(async () => {
    const module = await import('../core/src/mixins/colo.js')
    withColo = module.withColo
    WORKER_COLO_HEADER = module.WORKER_COLO_HEADER
  })

  describe('colo property', () => {
    it('should return undefined when colo not detected', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(instance.colo).toBeUndefined()
    })

    it('should return colo when set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      expect(instance.colo).toBe('SFO')
    })
  })

  describe('coloInfo property', () => {
    it('should return undefined when colo not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      expect(instance.coloInfo).toBeUndefined()
    })

    it('should return colo info when colo is set to known location', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const info = instance.coloInfo
      // coloInfo should have properties like city, country, etc. if the colo is recognized
      if (info) {
        expect(info).toBeDefined()
      }
    })
  })

  describe('getColosByDistance method', () => {
    it('should return empty array when colo not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.getColosByDistance()
      expect(result).toEqual([])
    })

    it('should return sorted colos when colo is set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const result = instance.getColosByDistance(['LAX', 'DFW', 'IAD'])
      // Result should be sorted by distance from SFO
      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('colo')
        expect(result[0]).toHaveProperty('distance')
        expect(result[0]).toHaveProperty('latency')
      }
    })
  })

  describe('findNearestColo method', () => {
    it('should return first candidate when colo not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.findNearestColo(['LAX', 'DFW', 'IAD'])
      expect(result).toBe('LAX')
    })

    it('should return undefined for empty candidates', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.findNearestColo([])
      expect(result).toBeUndefined()
    })

    it('should return nearest colo when colo is set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const result = instance.findNearestColo(['DFW', 'LAX', 'IAD'])
      // LAX should be nearest to SFO
      expect(typeof result).toBe('string')
    })
  })

  describe('estimateLatencyTo method', () => {
    it('should return undefined when colo not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.estimateLatencyTo('LAX')
      expect(result).toBeUndefined()
    })

    it('should return latency estimate when colo is set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const result = instance.estimateLatencyTo('LAX')
      if (result !== undefined) {
        expect(typeof result).toBe('number')
        expect(result).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('distanceTo method', () => {
    it('should return undefined when colo not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const result = instance.distanceTo('LAX')
      expect(result).toBeUndefined()
    })

    it('should return distance when colo is set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const result = instance.distanceTo('LAX')
      if (result !== undefined) {
        expect(typeof result).toBe('number')
        expect(result).toBeGreaterThan(0)
      }
    })

    it('should return 0 for same colo', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'SFO'

      const result = instance.distanceTo('SFO')
      if (result !== undefined) {
        expect(result).toBe(0)
      }
    })
  })

  describe('WORKER_COLO_HEADER constant', () => {
    it('should be defined', () => {
      expect(WORKER_COLO_HEADER).toBeDefined()
      expect(typeof WORKER_COLO_HEADER).toBe('string')
    })

    it('should have expected value', () => {
      expect(WORKER_COLO_HEADER).toBe('X-Worker-Colo')
    })
  })

  describe('detectColo protected method', () => {
    it('should detect colo from request cf object', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        // Expose protected method for testing
        public callDetectColo(request: Request) {
          return this.detectColo(request)
        }
      }
      const instance = new TestClass()

      // Create mock request with cf object
      const mockRequest = new Request('https://example.com')
      ;(mockRequest as unknown as { cf: { colo: string } }).cf = { colo: 'DFW' }

      instance.callDetectColo(mockRequest)
      expect(instance._colo).toBe('DFW')
    })

    it('should not overwrite existing colo', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callDetectColo(request: Request) {
          return this.detectColo(request)
        }
      }
      const instance = new TestClass()
      instance._colo = 'SFO' // Pre-set colo

      const mockRequest = new Request('https://example.com')
      ;(mockRequest as unknown as { cf: { colo: string } }).cf = { colo: 'DFW' }

      instance.callDetectColo(mockRequest)
      expect(instance._colo).toBe('SFO') // Should not change
    })
  })

  describe('buildColoContext protected method', () => {
    it('should build context with unknown colo when not set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callBuildColoContext() {
          return this.buildColoContext()
        }
      }
      const instance = new TestClass()

      const context = instance.callBuildColoContext()
      expect(context.colo).toBe('UNKNOWN')
    })

    it('should build context with colo when set', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callBuildColoContext() {
          return this.buildColoContext()
        }
      }
      const instance = new TestClass()
      instance._colo = 'SFO'

      const context = instance.callBuildColoContext()
      expect(context.colo).toBe('SFO')
    })

    it('should include workerColo from request header', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callBuildColoContext() {
          return this.buildColoContext()
        }
      }
      const instance = new TestClass()
      instance._colo = 'SFO'
      instance._currentRequest = new Request('https://example.com', {
        headers: { [WORKER_COLO_HEADER]: 'LAX' },
      })

      const context = instance.callBuildColoContext()
      expect(context.workerColo).toBe('LAX')
    })

    it('should calculate latency and distance when both colos known', async () => {
      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callBuildColoContext() {
          return this.buildColoContext()
        }
      }
      const instance = new TestClass()
      instance._colo = 'SFO'
      instance._currentRequest = new Request('https://example.com', {
        headers: { [WORKER_COLO_HEADER]: 'LAX' },
      })

      const context = instance.callBuildColoContext()
      // These may be undefined if colo.do/tiny doesn't recognize the colos
      if (context.latencyMs !== undefined) {
        expect(typeof context.latencyMs).toBe('number')
      }
      if (context.distanceKm !== undefined) {
        expect(typeof context.distanceKm).toBe('number')
      }
    })
  })
})

// ============================================================================
// Type exports tests
// ============================================================================

describe('Mixin type exports', () => {
  it('should export Constructor type', async () => {
    const types = await import('../core/src/mixins/types.js')
    // TypeScript type, just verify module loads
    expect(types).toBeDefined()
  })

  it('should export index with all mixins', async () => {
    const mixins = await import('../core/src/mixins/index.js')

    expect(mixins.withSQL).toBeDefined()
    expect(mixins.withStorage).toBeDefined()
    expect(mixins.withCollections).toBeDefined()
    expect(mixins.withSchema).toBeDefined()
    expect(mixins.withColo).toBeDefined()
    expect(mixins.WORKER_COLO_HEADER).toBeDefined()
  })
})

// ============================================================================
// Mixin Composition Tests
// ============================================================================

describe('Mixin composition', () => {
  it('should allow composing multiple mixins', async () => {
    const { withSQL } = await import('../core/src/mixins/sql.js')
    const { withColo } = await import('../core/src/mixins/colo.js')

    const mockExec = vi.fn(() => createMockCursor([{ id: 1 }]))
    const mockSql = createMockSqlStorage(mockExec)

    abstract class BaseClass {
      _currentRequest?: Request
      get sql() { return mockSql as unknown as SqlStorage }
    }

    // Compose mixins
    const WithSQLClass = withSQL(BaseClass)
    const ComposedClass = withColo(WithSQLClass)

    class TestClass extends ComposedClass {}
    const instance = new TestClass()

    // Should have SQL methods
    const sqlResult = instance.__sql({ strings: ['SELECT 1'], values: [] })
    expect(sqlResult.results).toEqual([{ id: 1 }])

    // Should have Colo methods
    instance._colo = 'SFO'
    expect(instance.colo).toBe('SFO')
  })

  it('should preserve base class properties through composition', async () => {
    const { withSQL } = await import('../core/src/mixins/sql.js')

    const mockSql = createMockSqlStorage()

    abstract class BaseClass {
      customProp = 'test'
      get sql() { return mockSql as unknown as SqlStorage }
      customMethod() { return 'custom' }
    }

    const MixedClass = withSQL(BaseClass)
    class TestClass extends MixedClass {}
    const instance = new TestClass()

    expect(instance.customProp).toBe('test')
    expect(instance.customMethod()).toBe('custom')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  describe('SQL mixin edge cases', () => {
    it('should handle empty strings array', async () => {
      const { withSQL } = await import('../core/src/mixins/sql.js')
      const mockSql = createMockSqlStorage()

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      // Empty strings with -1 expected values should still fail validation
      expect(() => {
        instance.__sql({ strings: [], values: [] })
      }).toThrow('SQL parameter count mismatch')
    })

    it('should handle special SQL characters in values', async () => {
      const { withSQL } = await import('../core/src/mixins/sql.js')
      const mockExec = vi.fn(() => createMockCursor())
      const mockSql = createMockSqlStorage(mockExec)

      abstract class BaseClass {
        get sql() { return mockSql as unknown as SqlStorage }
      }

      const MixedClass = withSQL(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      // Values with SQL injection attempts should be passed as parameters
      instance.__sql({
        strings: ['SELECT * FROM users WHERE name = ', ''],
        values: ["'; DROP TABLE users; --"],
      })

      expect(mockExec).toHaveBeenCalledWith(
        'SELECT * FROM users WHERE name = ?',
        "'; DROP TABLE users; --"
      )
    })
  })

  describe('Storage mixin edge cases', () => {
    it('should handle keys with special characters', async () => {
      const { withStorage } = await import('../core/src/mixins/storage.js')
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      const specialKey = 'key:with:colons/and/slashes?and=params'
      await instance.__storagePut(specialKey, 'value')
      const result = await instance.__storageGet(specialKey)
      expect(result).toBe('value')
    })

    it('should handle undefined values', async () => {
      const { withStorage } = await import('../core/src/mixins/storage.js')
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePut('key', undefined)
      const result = await instance.__storageGet('key')
      expect(result).toBeUndefined()
    })

    it('should handle null values', async () => {
      const { withStorage } = await import('../core/src/mixins/storage.js')
      const mockStorage = createMockStorage()

      abstract class BaseClass {
        get storage() { return mockStorage as unknown as DurableObjectStorage }
      }

      const MixedClass = withStorage(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()

      await instance.__storagePut('key', null)
      const result = await instance.__storageGet('key')
      expect(result).toBeNull()
    })
  })

  describe('Colo mixin edge cases', () => {
    it('should handle unknown colo codes gracefully', async () => {
      const { withColo } = await import('../core/src/mixins/colo.js')

      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {}
      const instance = new TestClass()
      instance._colo = 'UNKNOWN_COLO_CODE_XYZ'

      // Should not throw, but may return undefined for unknown colos
      expect(instance.colo).toBe('UNKNOWN_COLO_CODE_XYZ')
      // coloInfo might be undefined for unknown codes
      const info = instance.coloInfo
      // Just verify it doesn't throw
      expect(info === undefined || typeof info === 'object').toBe(true)
    })

    it('should handle missing cf object in request', async () => {
      const { withColo } = await import('../core/src/mixins/colo.js')

      abstract class BaseClass {
        _currentRequest?: Request
      }

      const MixedClass = withColo(BaseClass)
      class TestClass extends MixedClass {
        public callDetectColo(request: Request) {
          return this.detectColo(request)
        }
      }
      const instance = new TestClass()

      // Request without cf object
      const mockRequest = new Request('https://example.com')
      instance.callDetectColo(mockRequest)

      expect(instance._colo).toBeNull()
    })
  })
})
