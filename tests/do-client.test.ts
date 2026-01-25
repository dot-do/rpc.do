/**
 * DO Client Integration Tests
 *
 * Tests for createDOClient() from src/do-client.ts including:
 * - Remote SQL operations (all, first, run, raw, template interpolation)
 * - Remote storage operations (get, put, delete, list, keys)
 * - Remote collection operations (MongoDB-style document store)
 * - Schema operations (dbSchema, schema)
 * - Connection management (close)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDOClient } from '../src/do-client'
import type { Transport } from '../src/index'

// ============================================================================
// Mock Transport Factory
// ============================================================================

interface MockTransportCall {
  method: string
  args: unknown[]
}

function createMockTransport() {
  const calls: MockTransportCall[] = []
  const responses: Map<string, unknown> = new Map()

  const transport: Transport & {
    calls: MockTransportCall[]
    setResponse: (method: string, response: unknown) => void
    setErrorResponse: (method: string, error: Error) => void
    closed: boolean
  } = {
    calls,
    closed: false,

    async call(method: string, args: unknown[]): Promise<unknown> {
      calls.push({ method, args })

      if (responses.has(`error:${method}`)) {
        throw responses.get(`error:${method}`)
      }

      if (responses.has(method)) {
        return responses.get(method)
      }

      // Default responses based on method
      return getDefaultResponse(method)
    },

    close() {
      transport.closed = true
    },

    setResponse(method: string, response: unknown) {
      responses.set(method, response)
    },

    setErrorResponse(method: string, error: Error) {
      responses.set(`error:${method}`, error)
    },
  }

  return transport
}

function getDefaultResponse(method: string): unknown {
  // SQL methods
  if (method === '__sql') {
    return { results: [], meta: { rows_read: 0, rows_written: 0 } }
  }
  if (method === '__sqlFirst') {
    return null
  }
  if (method === '__sqlRun') {
    return { rowsWritten: 0 }
  }

  // Storage methods
  if (method === '__storageGet') {
    return undefined
  }
  if (method === '__storageGetMultiple') {
    return {}
  }
  if (method === '__storagePut' || method === '__storagePutMultiple') {
    return undefined
  }
  if (method === '__storageDelete') {
    return true
  }
  if (method === '__storageDeleteMultiple') {
    return 0
  }
  if (method === '__storageList') {
    return {}
  }
  if (method === '__storageKeys') {
    return []
  }

  // Collection methods
  if (method === '__collectionGet') {
    return null
  }
  if (method === '__collectionPut') {
    return undefined
  }
  if (method === '__collectionDelete') {
    return false
  }
  if (method === '__collectionHas') {
    return false
  }
  if (method === '__collectionFind' || method === '__collectionList') {
    return []
  }
  if (method === '__collectionCount' || method === '__collectionClear') {
    return 0
  }
  if (method === '__collectionKeys' || method === '__collectionNames') {
    return []
  }
  if (method === '__collectionStats') {
    return []
  }

  // Schema methods
  if (method === '__dbSchema') {
    return { tables: [], version: 1 }
  }
  if (method === '__schema') {
    return { version: 1, methods: [], namespaces: [] }
  }

  return null
}

// ============================================================================
// Remote SQL Operations Tests
// ============================================================================

describe('createDOClient - Remote SQL Operations', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  describe('$.sql`SELECT...`.all()', () => {
    it('should execute query and return array of rows', async () => {
      const mockResults = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]
      transport.setResponse('__sql', {
        results: mockResults,
        meta: { rows_read: 2, rows_written: 0 },
      })

      const $ = createDOClient(transport)
      const results = await $.sql`SELECT * FROM users`.all()

      expect(results).toEqual(mockResults)
      expect(transport.calls).toHaveLength(1)
      expect(transport.calls[0].method).toBe('__sql')
    })

    it('should return empty array when no rows found', async () => {
      transport.setResponse('__sql', {
        results: [],
        meta: { rows_read: 0, rows_written: 0 },
      })

      const $ = createDOClient(transport)
      const results = await $.sql`SELECT * FROM users WHERE id = 999`.all()

      expect(results).toEqual([])
    })

    it('should handle typed results', async () => {
      interface User {
        id: number
        name: string
        active: boolean
      }

      transport.setResponse('__sql', {
        results: [{ id: 1, name: 'Alice', active: true }],
        meta: { rows_read: 1, rows_written: 0 },
      })

      const $ = createDOClient(transport)
      const results = await $.sql<User>`SELECT * FROM users`.all()

      expect(results[0].name).toBe('Alice')
      expect(results[0].active).toBe(true)
    })
  })

  describe('$.sql`SELECT...`.first()', () => {
    it('should return single row when found', async () => {
      const mockRow = { id: 1, name: 'Alice' }
      transport.setResponse('__sqlFirst', mockRow)

      const $ = createDOClient(transport)
      const result = await $.sql`SELECT * FROM users WHERE id = 1`.first()

      expect(result).toEqual(mockRow)
      expect(transport.calls[0].method).toBe('__sqlFirst')
    })

    it('should return null when no row found', async () => {
      transport.setResponse('__sqlFirst', null)

      const $ = createDOClient(transport)
      const result = await $.sql`SELECT * FROM users WHERE id = 999`.first()

      expect(result).toBeNull()
    })
  })

  describe('$.sql`SELECT...`.run()', () => {
    it('should return rowsWritten for INSERT', async () => {
      transport.setResponse('__sqlRun', { rowsWritten: 1 })

      const $ = createDOClient(transport)
      const result = await $.sql`INSERT INTO users (name) VALUES ('Alice')`.run()

      expect(result).toEqual({ rowsWritten: 1 })
      expect(transport.calls[0].method).toBe('__sqlRun')
    })

    it('should return rowsWritten for UPDATE', async () => {
      transport.setResponse('__sqlRun', { rowsWritten: 5 })

      const $ = createDOClient(transport)
      const result = await $.sql`UPDATE users SET active = 1`.run()

      expect(result).toEqual({ rowsWritten: 5 })
    })

    it('should return rowsWritten for DELETE', async () => {
      transport.setResponse('__sqlRun', { rowsWritten: 3 })

      const $ = createDOClient(transport)
      const result = await $.sql`DELETE FROM users WHERE active = 0`.run()

      expect(result).toEqual({ rowsWritten: 3 })
    })

    it('should return zero rowsWritten when no rows affected', async () => {
      transport.setResponse('__sqlRun', { rowsWritten: 0 })

      const $ = createDOClient(transport)
      const result = await $.sql`DELETE FROM users WHERE id = 999`.run()

      expect(result).toEqual({ rowsWritten: 0 })
    })
  })

  describe('$.sql`SELECT...`.raw()', () => {
    it('should return full result with metadata', async () => {
      const mockResult = {
        results: [{ id: 1, name: 'Alice' }],
        meta: { rows_read: 100, rows_written: 0 },
      }
      transport.setResponse('__sql', mockResult)

      const $ = createDOClient(transport)
      const result = await $.sql`SELECT * FROM users LIMIT 1`.raw()

      expect(result).toEqual(mockResult)
      expect(result.results).toHaveLength(1)
      expect(result.meta.rows_read).toBe(100)
      expect(result.meta.rows_written).toBe(0)
    })
  })

  describe('Template interpolation', () => {
    it('should interpolate single value', async () => {
      const $ = createDOClient(transport)
      const userId = 123
      await $.sql`SELECT * FROM users WHERE id = ${userId}`.all()

      expect(transport.calls[0].args[0]).toEqual({
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: [123],
      })
    })

    it('should interpolate multiple values', async () => {
      const $ = createDOClient(transport)
      const name = 'Alice'
      const active = true
      const limit = 10
      await $.sql`SELECT * FROM users WHERE name = ${name} AND active = ${active} LIMIT ${limit}`.all()

      expect(transport.calls[0].args[0]).toEqual({
        strings: ['SELECT * FROM users WHERE name = ', ' AND active = ', ' LIMIT ', ''],
        values: ['Alice', true, 10],
      })
    })

    it('should handle no interpolations', async () => {
      const $ = createDOClient(transport)
      await $.sql`SELECT * FROM users`.all()

      expect(transport.calls[0].args[0]).toEqual({
        strings: ['SELECT * FROM users'],
        values: [],
      })
    })

    it('should interpolate complex values', async () => {
      const $ = createDOClient(transport)
      const data = JSON.stringify({ name: 'Alice' })
      const now = new Date('2024-01-01')
      await $.sql`INSERT INTO logs (data, created_at) VALUES (${data}, ${now})`.run()

      expect(transport.calls[0].args[0].values).toEqual([data, now])
    })

    it('should handle null and undefined values', async () => {
      const $ = createDOClient(transport)
      const nullValue = null
      const undefinedValue = undefined
      await $.sql`UPDATE users SET nullable = ${nullValue}, optional = ${undefinedValue}`.run()

      expect(transport.calls[0].args[0].values).toEqual([null, undefined])
    })
  })

  describe('SQL error handling', () => {
    it('should propagate errors from all()', async () => {
      transport.setErrorResponse('__sql', new Error('SQL syntax error'))

      const $ = createDOClient(transport)

      await expect($.sql`SELECT * FORM users`.all()).rejects.toThrow('SQL syntax error')
    })

    it('should propagate errors from first()', async () => {
      transport.setErrorResponse('__sqlFirst', new Error('Table not found'))

      const $ = createDOClient(transport)

      await expect($.sql`SELECT * FROM nonexistent`.first()).rejects.toThrow('Table not found')
    })

    it('should propagate errors from run()', async () => {
      transport.setErrorResponse('__sqlRun', new Error('Foreign key constraint'))

      const $ = createDOClient(transport)

      await expect($.sql`INSERT INTO orders (user_id) VALUES (999)`.run()).rejects.toThrow(
        'Foreign key constraint'
      )
    })
  })
})

// ============================================================================
// Remote Storage Operations Tests
// ============================================================================

describe('createDOClient - Remote Storage Operations', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  describe('$.storage.get(key)', () => {
    it('should get single key value', async () => {
      transport.setResponse('__storageGet', { setting: 'value' })

      const $ = createDOClient(transport)
      const value = await $.storage.get('config')

      expect(value).toEqual({ setting: 'value' })
      expect(transport.calls[0]).toEqual({
        method: '__storageGet',
        args: ['config'],
      })
    })

    it('should return undefined for missing key', async () => {
      transport.setResponse('__storageGet', undefined)

      const $ = createDOClient(transport)
      const value = await $.storage.get('nonexistent')

      expect(value).toBeUndefined()
    })

    it('should handle typed values', async () => {
      interface Config {
        theme: string
        limit: number
      }

      transport.setResponse('__storageGet', { theme: 'dark', limit: 100 })

      const $ = createDOClient(transport)
      const value = await $.storage.get<Config>('config')

      expect(value?.theme).toBe('dark')
      expect(value?.limit).toBe(100)
    })
  })

  describe('$.storage.get([keys])', () => {
    it('should get multiple keys and return Map', async () => {
      transport.setResponse('__storageGetMultiple', {
        key1: 'value1',
        key2: 'value2',
      })

      const $ = createDOClient(transport)
      const result = await $.storage.get(['key1', 'key2'])

      expect(result).toBeInstanceOf(Map)
      expect(result.get('key1')).toBe('value1')
      expect(result.get('key2')).toBe('value2')
      expect(transport.calls[0]).toEqual({
        method: '__storageGetMultiple',
        args: [['key1', 'key2']],
      })
    })

    it('should return Map with only found keys', async () => {
      transport.setResponse('__storageGetMultiple', {
        key1: 'value1',
      })

      const $ = createDOClient(transport)
      const result = await $.storage.get(['key1', 'key2', 'key3'])

      expect(result.size).toBe(1)
      expect(result.has('key1')).toBe(true)
      expect(result.has('key2')).toBe(false)
    })

    it('should return empty Map when no keys found', async () => {
      transport.setResponse('__storageGetMultiple', {})

      const $ = createDOClient(transport)
      const result = await $.storage.get(['a', 'b', 'c'])

      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })
  })

  describe('$.storage.put(key, value)', () => {
    it('should put single key-value pair', async () => {
      const $ = createDOClient(transport)
      await $.storage.put('myKey', { data: 'test' })

      expect(transport.calls[0]).toEqual({
        method: '__storagePut',
        args: ['myKey', { data: 'test' }],
      })
    })

    it('should put primitive values', async () => {
      const $ = createDOClient(transport)

      await $.storage.put('string', 'hello')
      await $.storage.put('number', 42)
      await $.storage.put('boolean', true)
      await $.storage.put('null', null)

      expect(transport.calls[0].args).toEqual(['string', 'hello'])
      expect(transport.calls[1].args).toEqual(['number', 42])
      expect(transport.calls[2].args).toEqual(['boolean', true])
      expect(transport.calls[3].args).toEqual(['null', null])
    })
  })

  describe('$.storage.put(entries)', () => {
    it('should put multiple entries at once', async () => {
      const $ = createDOClient(transport)
      const entries = {
        key1: 'value1',
        key2: { nested: true },
        key3: 123,
      }
      await $.storage.put(entries)

      expect(transport.calls[0]).toEqual({
        method: '__storagePutMultiple',
        args: [entries],
      })
    })

    it('should handle empty entries object', async () => {
      const $ = createDOClient(transport)
      await $.storage.put({})

      expect(transport.calls[0]).toEqual({
        method: '__storagePutMultiple',
        args: [{}],
      })
    })
  })

  describe('$.storage.delete(key)', () => {
    it('should delete single key and return true when deleted', async () => {
      transport.setResponse('__storageDelete', true)

      const $ = createDOClient(transport)
      const result = await $.storage.delete('myKey')

      expect(result).toBe(true)
      expect(transport.calls[0]).toEqual({
        method: '__storageDelete',
        args: ['myKey'],
      })
    })

    it('should return false when key did not exist', async () => {
      transport.setResponse('__storageDelete', false)

      const $ = createDOClient(transport)
      const result = await $.storage.delete('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('$.storage.delete([keys])', () => {
    it('should delete multiple keys and return count', async () => {
      transport.setResponse('__storageDeleteMultiple', 3)

      const $ = createDOClient(transport)
      const result = await $.storage.delete(['key1', 'key2', 'key3'])

      expect(result).toBe(3)
      expect(transport.calls[0]).toEqual({
        method: '__storageDeleteMultiple',
        args: [['key1', 'key2', 'key3']],
      })
    })

    it('should return zero when no keys deleted', async () => {
      transport.setResponse('__storageDeleteMultiple', 0)

      const $ = createDOClient(transport)
      const result = await $.storage.delete(['nonexistent1', 'nonexistent2'])

      expect(result).toBe(0)
    })
  })

  describe('$.storage.list({ prefix, limit })', () => {
    it('should list with prefix and return Map', async () => {
      transport.setResponse('__storageList', {
        'user:1': { name: 'Alice' },
        'user:2': { name: 'Bob' },
      })

      const $ = createDOClient(transport)
      const result = await $.storage.list({ prefix: 'user:' })

      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(2)
      expect(result.get('user:1')).toEqual({ name: 'Alice' })
      expect(transport.calls[0]).toEqual({
        method: '__storageList',
        args: [{ prefix: 'user:' }],
      })
    })

    it('should list with limit', async () => {
      transport.setResponse('__storageList', {
        'key1': 'value1',
      })

      const $ = createDOClient(transport)
      await $.storage.list({ limit: 1 })

      expect(transport.calls[0]).toEqual({
        method: '__storageList',
        args: [{ limit: 1 }],
      })
    })

    it('should list with all options', async () => {
      const $ = createDOClient(transport)
      await $.storage.list({
        prefix: 'data:',
        limit: 100,
        start: 'data:a',
        end: 'data:z',
      })

      expect(transport.calls[0]).toEqual({
        method: '__storageList',
        args: [{
          prefix: 'data:',
          limit: 100,
          start: 'data:a',
          end: 'data:z',
        }],
      })
    })

    it('should list without options', async () => {
      transport.setResponse('__storageList', {
        'a': 1,
        'b': 2,
      })

      const $ = createDOClient(transport)
      const result = await $.storage.list()

      expect(result.size).toBe(2)
      expect(transport.calls[0]).toEqual({
        method: '__storageList',
        args: [undefined],
      })
    })
  })

  describe('$.storage.keys(prefix)', () => {
    it('should list keys with prefix', async () => {
      transport.setResponse('__storageKeys', ['user:1', 'user:2', 'user:3'])

      const $ = createDOClient(transport)
      const keys = await $.storage.keys('user:')

      expect(keys).toEqual(['user:1', 'user:2', 'user:3'])
      expect(transport.calls[0]).toEqual({
        method: '__storageKeys',
        args: ['user:'],
      })
    })

    it('should list all keys without prefix', async () => {
      transport.setResponse('__storageKeys', ['a', 'b', 'c'])

      const $ = createDOClient(transport)
      const keys = await $.storage.keys()

      expect(keys).toEqual(['a', 'b', 'c'])
      expect(transport.calls[0]).toEqual({
        method: '__storageKeys',
        args: [undefined],
      })
    })

    it('should return empty array when no keys match', async () => {
      transport.setResponse('__storageKeys', [])

      const $ = createDOClient(transport)
      const keys = await $.storage.keys('nonexistent:')

      expect(keys).toEqual([])
    })
  })

  describe('Storage error handling', () => {
    it('should propagate errors from get', async () => {
      transport.setErrorResponse('__storageGet', new Error('Storage unavailable'))

      const $ = createDOClient(transport)

      await expect($.storage.get('key')).rejects.toThrow('Storage unavailable')
    })

    it('should propagate errors from put', async () => {
      transport.setErrorResponse('__storagePut', new Error('Storage quota exceeded'))

      const $ = createDOClient(transport)

      await expect($.storage.put('key', 'value')).rejects.toThrow('Storage quota exceeded')
    })
  })
})

// ============================================================================
// Remote Collection Operations Tests
// ============================================================================

describe('createDOClient - Remote Collection Operations', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  describe("$.collection('name').get(id)", () => {
    it('should get document by id', async () => {
      const mockDoc = { id: 'user-1', name: 'Alice', age: 30 }
      transport.setResponse('__collectionGet', mockDoc)

      const $ = createDOClient(transport)
      const doc = await $.collection('users').get('user-1')

      expect(doc).toEqual(mockDoc)
      expect(transport.calls[0]).toEqual({
        method: '__collectionGet',
        args: ['users', 'user-1'],
      })
    })

    it('should return null for missing document', async () => {
      transport.setResponse('__collectionGet', null)

      const $ = createDOClient(transport)
      const doc = await $.collection('users').get('nonexistent')

      expect(doc).toBeNull()
    })

    it('should handle typed collections', async () => {
      interface User {
        id: string
        name: string
        email: string
      }

      transport.setResponse('__collectionGet', {
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
      })

      const $ = createDOClient(transport)
      const doc = await $.collection<User>('users').get('1')

      expect(doc?.email).toBe('alice@example.com')
    })
  })

  describe("$.collection('name').put(id, doc)", () => {
    it('should put document with id', async () => {
      const $ = createDOClient(transport)
      const doc = { name: 'Alice', active: true }
      await $.collection('users').put('user-1', doc)

      expect(transport.calls[0]).toEqual({
        method: '__collectionPut',
        args: ['users', 'user-1', doc],
      })
    })

    it('should update existing document', async () => {
      const $ = createDOClient(transport)
      await $.collection('users').put('existing', { name: 'Updated' })

      expect(transport.calls[0]).toEqual({
        method: '__collectionPut',
        args: ['users', 'existing', { name: 'Updated' }],
      })
    })
  })

  describe("$.collection('name').delete(id)", () => {
    it('should delete document and return true when deleted', async () => {
      transport.setResponse('__collectionDelete', true)

      const $ = createDOClient(transport)
      const result = await $.collection('users').delete('user-1')

      expect(result).toBe(true)
      expect(transport.calls[0]).toEqual({
        method: '__collectionDelete',
        args: ['users', 'user-1'],
      })
    })

    it('should return false when document did not exist', async () => {
      transport.setResponse('__collectionDelete', false)

      const $ = createDOClient(transport)
      const result = await $.collection('users').delete('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe("$.collection('name').has(id)", () => {
    it('should return true when document exists', async () => {
      transport.setResponse('__collectionHas', true)

      const $ = createDOClient(transport)
      const exists = await $.collection('users').has('user-1')

      expect(exists).toBe(true)
      expect(transport.calls[0]).toEqual({
        method: '__collectionHas',
        args: ['users', 'user-1'],
      })
    })

    it('should return false when document does not exist', async () => {
      transport.setResponse('__collectionHas', false)

      const $ = createDOClient(transport)
      const exists = await $.collection('users').has('nonexistent')

      expect(exists).toBe(false)
    })
  })

  describe("$.collection('name').find(filter, options)", () => {
    it('should find documents matching filter', async () => {
      const mockDocs = [
        { id: '1', name: 'Alice', active: true },
        { id: '2', name: 'Bob', active: true },
      ]
      transport.setResponse('__collectionFind', mockDocs)

      const $ = createDOClient(transport)
      const docs = await $.collection('users').find({ active: true })

      expect(docs).toEqual(mockDocs)
      expect(transport.calls[0]).toEqual({
        method: '__collectionFind',
        args: ['users', { active: true }, undefined],
      })
    })

    it('should find with complex filter operators', async () => {
      const $ = createDOClient(transport)
      await $.collection('users').find({
        age: { $gte: 18 },
        role: { $in: ['admin', 'moderator'] },
        deletedAt: { $exists: false },
      })

      expect(transport.calls[0].args[1]).toEqual({
        age: { $gte: 18 },
        role: { $in: ['admin', 'moderator'] },
        deletedAt: { $exists: false },
      })
    })

    it('should find with $and/$or operators', async () => {
      const $ = createDOClient(transport)
      await $.collection('users').find({
        $or: [{ role: 'admin' }, { level: { $gte: 10 } }],
        $and: [{ active: true }, { verified: true }],
      })

      expect(transport.calls[0].args[1]).toEqual({
        $or: [{ role: 'admin' }, { level: { $gte: 10 } }],
        $and: [{ active: true }, { verified: true }],
      })
    })

    it('should find with options (limit, offset, sort)', async () => {
      const $ = createDOClient(transport)
      await $.collection('users').find(
        { active: true },
        { limit: 10, offset: 20, sort: '-createdAt' }
      )

      expect(transport.calls[0]).toEqual({
        method: '__collectionFind',
        args: ['users', { active: true }, { limit: 10, offset: 20, sort: '-createdAt' }],
      })
    })

    it('should find all documents without filter', async () => {
      transport.setResponse('__collectionFind', [{ id: '1' }, { id: '2' }])

      const $ = createDOClient(transport)
      const docs = await $.collection('users').find()

      expect(docs).toHaveLength(2)
      expect(transport.calls[0].args[1]).toBeUndefined()
    })
  })

  describe("$.collection('name').count(filter)", () => {
    it('should count documents matching filter', async () => {
      transport.setResponse('__collectionCount', 42)

      const $ = createDOClient(transport)
      const count = await $.collection('users').count({ active: true })

      expect(count).toBe(42)
      expect(transport.calls[0]).toEqual({
        method: '__collectionCount',
        args: ['users', { active: true }],
      })
    })

    it('should count all documents without filter', async () => {
      transport.setResponse('__collectionCount', 100)

      const $ = createDOClient(transport)
      const count = await $.collection('users').count()

      expect(count).toBe(100)
      expect(transport.calls[0].args[1]).toBeUndefined()
    })
  })

  describe("$.collection('name').list(options)", () => {
    it('should list documents with options', async () => {
      const mockDocs = [{ id: '1' }, { id: '2' }]
      transport.setResponse('__collectionList', mockDocs)

      const $ = createDOClient(transport)
      const docs = await $.collection('users').list({ limit: 10, sort: 'name' })

      expect(docs).toEqual(mockDocs)
      expect(transport.calls[0]).toEqual({
        method: '__collectionList',
        args: ['users', { limit: 10, sort: 'name' }],
      })
    })

    it('should list all documents without options', async () => {
      transport.setResponse('__collectionList', [])

      const $ = createDOClient(transport)
      await $.collection('users').list()

      expect(transport.calls[0]).toEqual({
        method: '__collectionList',
        args: ['users', undefined],
      })
    })
  })

  describe("$.collection('name').keys()", () => {
    it('should return all document IDs', async () => {
      transport.setResponse('__collectionKeys', ['user-1', 'user-2', 'user-3'])

      const $ = createDOClient(transport)
      const keys = await $.collection('users').keys()

      expect(keys).toEqual(['user-1', 'user-2', 'user-3'])
      expect(transport.calls[0]).toEqual({
        method: '__collectionKeys',
        args: ['users'],
      })
    })

    it('should return empty array for empty collection', async () => {
      transport.setResponse('__collectionKeys', [])

      const $ = createDOClient(transport)
      const keys = await $.collection('empty').keys()

      expect(keys).toEqual([])
    })
  })

  describe("$.collection('name').clear()", () => {
    it('should clear collection and return deleted count', async () => {
      transport.setResponse('__collectionClear', 15)

      const $ = createDOClient(transport)
      const count = await $.collection('users').clear()

      expect(count).toBe(15)
      expect(transport.calls[0]).toEqual({
        method: '__collectionClear',
        args: ['users'],
      })
    })

    it('should return zero for already empty collection', async () => {
      transport.setResponse('__collectionClear', 0)

      const $ = createDOClient(transport)
      const count = await $.collection('empty').clear()

      expect(count).toBe(0)
    })
  })

  describe('$.collection.names()', () => {
    it('should return all collection names', async () => {
      transport.setResponse('__collectionNames', ['users', 'posts', 'comments'])

      const $ = createDOClient(transport)
      const names = await $.collection.names()

      expect(names).toEqual(['users', 'posts', 'comments'])
      expect(transport.calls[0]).toEqual({
        method: '__collectionNames',
        args: [],
      })
    })

    it('should return empty array when no collections exist', async () => {
      transport.setResponse('__collectionNames', [])

      const $ = createDOClient(transport)
      const names = await $.collection.names()

      expect(names).toEqual([])
    })
  })

  describe('$.collection.stats()', () => {
    it('should return stats for all collections', async () => {
      const mockStats = [
        { name: 'users', count: 100, size: 50000 },
        { name: 'posts', count: 500, size: 200000 },
      ]
      transport.setResponse('__collectionStats', mockStats)

      const $ = createDOClient(transport)
      const stats = await $.collection.stats()

      expect(stats).toEqual(mockStats)
      expect(transport.calls[0]).toEqual({
        method: '__collectionStats',
        args: [],
      })
    })

    it('should return empty array when no collections exist', async () => {
      transport.setResponse('__collectionStats', [])

      const $ = createDOClient(transport)
      const stats = await $.collection.stats()

      expect(stats).toEqual([])
    })
  })

  describe('Collection error handling', () => {
    it('should propagate errors from collection operations', async () => {
      transport.setErrorResponse('__collectionGet', new Error('Collection not found'))

      const $ = createDOClient(transport)

      await expect($.collection('nonexistent').get('id')).rejects.toThrow('Collection not found')
    })

    it('should handle validation errors', async () => {
      transport.setErrorResponse('__collectionPut', new Error('Invalid document format'))

      const $ = createDOClient(transport)

      await expect($.collection('users').put('id', {} as any)).rejects.toThrow(
        'Invalid document format'
      )
    })
  })
})

// ============================================================================
// Schema Operations Tests
// ============================================================================

describe('createDOClient - Schema Operations', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  describe('$.dbSchema()', () => {
    it('should return database schema', async () => {
      const mockSchema = {
        tables: [
          {
            name: 'users',
            columns: [
              { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
              { name: 'name', type: 'TEXT', nullable: false, primaryKey: false },
              { name: 'email', type: 'TEXT', nullable: true, primaryKey: false },
            ],
            indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
          },
        ],
        version: 1,
      }
      transport.setResponse('__dbSchema', mockSchema)

      const $ = createDOClient(transport)
      const schema = await $.dbSchema()

      expect(schema).toEqual(mockSchema)
      expect(transport.calls[0]).toEqual({
        method: '__dbSchema',
        args: [],
      })
    })

    it('should return empty tables array when no tables exist', async () => {
      transport.setResponse('__dbSchema', { tables: [], version: 1 })

      const $ = createDOClient(transport)
      const schema = await $.dbSchema()

      expect(schema.tables).toEqual([])
    })
  })

  describe('$.schema()', () => {
    it('should return full RPC schema', async () => {
      const mockSchema = {
        version: 1,
        methods: [
          { name: 'hello', path: 'hello', params: 1 },
          { name: 'goodbye', path: 'goodbye', params: 0 },
        ],
        namespaces: [
          {
            name: 'users',
            methods: [
              { name: 'create', path: 'users.create', params: 1 },
              { name: 'get', path: 'users.get', params: 1 },
            ],
          },
        ],
        database: {
          tables: [{ name: 'users', columns: [], indexes: [] }],
        },
        storageKeys: ['config', 'settings'],
        colo: 'LAX',
      }
      transport.setResponse('__schema', mockSchema)

      const $ = createDOClient(transport)
      const schema = await $.schema()

      expect(schema).toEqual(mockSchema)
      expect(transport.calls[0]).toEqual({
        method: '__schema',
        args: [],
      })
    })

    it('should return minimal schema', async () => {
      transport.setResponse('__schema', {
        version: 1,
        methods: [],
        namespaces: [],
      })

      const $ = createDOClient(transport)
      const schema = await $.schema()

      expect(schema.version).toBe(1)
      expect(schema.methods).toEqual([])
      expect(schema.namespaces).toEqual([])
    })
  })
})

// ============================================================================
// Connection Management Tests
// ============================================================================

describe('createDOClient - Connection Management', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  describe('$.close()', () => {
    it('should close the transport connection', async () => {
      const $ = createDOClient(transport)
      await $.close()

      expect(transport.closed).toBe(true)
    })

    it('should be safe to call close multiple times', async () => {
      const $ = createDOClient(transport)
      await $.close()
      await $.close()
      await $.close()

      expect(transport.closed).toBe(true)
    })
  })
})

// ============================================================================
// Transport Factory Tests
// ============================================================================

describe('createDOClient - Transport Factory', () => {
  it('should accept a transport factory function', async () => {
    const mockTransport = createMockTransport()
    mockTransport.setResponse('__dbSchema', { tables: [], version: 1 })
    mockTransport.setResponse('__storageGet', 'test-value')

    const factory = () => mockTransport
    const $ = createDOClient(factory)

    // First call an async method to initialize the transport
    await $.dbSchema()

    // Now sync methods like storage should work
    const value = await $.storage.get('key')

    expect(value).toBe('test-value')
  })

  it('should accept an async transport factory', async () => {
    const mockTransport = createMockTransport()
    mockTransport.setResponse('__schema', { version: 1, methods: [], namespaces: [] })
    mockTransport.setResponse('__collectionGet', { id: '1' })

    const asyncFactory = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return mockTransport
    }

    const $ = createDOClient(asyncFactory)

    // First call an async method to initialize the transport
    await $.schema()

    // Now collection methods should work
    const doc = await $.collection('test').get('1')

    expect(doc).toEqual({ id: '1' })
  })

  it('should cache the transport after first call', async () => {
    let factoryCallCount = 0
    const mockTransport = createMockTransport()
    mockTransport.setResponse('__dbSchema', { tables: [], version: 1 })

    const factory = () => {
      factoryCallCount++
      return mockTransport
    }

    const $ = createDOClient(factory)

    // Initialize transport first
    await $.dbSchema()

    // Then make multiple storage calls
    await $.storage.get('a')
    await $.storage.get('b')
    await $.storage.get('c')

    // Factory should only be called once
    expect(factoryCallCount).toBe(1)
  })

  it('should throw if sync method used before transport initialized', () => {
    const factory = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return createMockTransport()
    }

    const $ = createDOClient(factory)

    // sql is accessed synchronously but transport is async
    expect(() => $.sql`SELECT 1`.all()).toThrow('Transport not initialized')
  })

  it('should work with direct transport (no factory)', async () => {
    const mockTransport = createMockTransport()
    mockTransport.setResponse('__storageGet', 'direct-value')

    // Direct transport (not a factory)
    const $ = createDOClient(mockTransport)

    // Sync methods should work immediately
    const value = await $.storage.get('key')

    expect(value).toBe('direct-value')
  })
})

// ============================================================================
// Custom RPC Methods Tests
// ============================================================================

describe('createDOClient - Custom RPC Methods', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  it('should call custom top-level method', async () => {
    transport.setResponse('hello', 'world')

    const $ = createDOClient<{ hello: () => string }>(transport)
    const result = await $.hello()

    expect(result).toBe('world')
    expect(transport.calls[0]).toEqual({
      method: 'hello',
      args: [],
    })
  })

  it('should call nested custom method', async () => {
    transport.setResponse('users.create', { id: 'new-user' })

    const $ = createDOClient<{
      users: { create: (data: { name: string }) => { id: string } }
    }>(transport)
    const result = await $.users.create({ name: 'Alice' })

    expect(result).toEqual({ id: 'new-user' })
    expect(transport.calls[0]).toEqual({
      method: 'users.create',
      args: [{ name: 'Alice' }],
    })
  })

  it('should call deeply nested custom method', async () => {
    transport.setResponse('api.v1.users.list', [])

    const $ = createDOClient(transport)
    // @ts-expect-error - testing dynamic access
    const result = await $.api.v1.users.list()

    expect(result).toEqual([])
    expect(transport.calls[0]).toEqual({
      method: 'api.v1.users.list',
      args: [],
    })
  })

  it('should pass multiple arguments to custom method', async () => {
    transport.setResponse('math.add', 15)

    const $ = createDOClient(transport)
    // @ts-expect-error - testing dynamic access
    const result = await $.math.add(5, 10)

    expect(result).toBe(15)
    expect(transport.calls[0]).toEqual({
      method: 'math.add',
      args: [5, 10],
    })
  })

  it('should not be thennable when just accessing property', async () => {
    const $ = createDOClient(transport)

    // Accessing a property should not trigger a call
    const users = $.users

    // Only calling should trigger transport
    expect(transport.calls).toHaveLength(0)

    // But it should not be a promise
    expect(users.then).toBeUndefined()
  })
})

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe('createDOClient - Edge Cases', () => {
  let transport: ReturnType<typeof createMockTransport>

  beforeEach(() => {
    transport = createMockTransport()
  })

  it('should handle undefined result from transport', async () => {
    transport.setResponse('__storageGet', undefined)

    const $ = createDOClient(transport)
    const value = await $.storage.get('key')

    expect(value).toBeUndefined()
  })

  it('should handle null result from transport', async () => {
    transport.setResponse('__collectionGet', null)

    const $ = createDOClient(transport)
    const doc = await $.collection('test').get('id')

    expect(doc).toBeNull()
  })

  it('should handle empty string key', async () => {
    transport.setResponse('__storageGet', 'empty-key-value')

    const $ = createDOClient(transport)
    const value = await $.storage.get('')

    expect(value).toBe('empty-key-value')
    expect(transport.calls[0].args[0]).toBe('')
  })

  it('should handle special characters in keys', async () => {
    const specialKey = 'key:with/special\\chars?and=query&params#hash'
    transport.setResponse('__storageGet', 'special-value')

    const $ = createDOClient(transport)
    await $.storage.get(specialKey)

    expect(transport.calls[0].args[0]).toBe(specialKey)
  })

  it('should handle unicode in collection names and values', async () => {
    const unicodeDoc = { name: '??????', city: '??????' }
    transport.setResponse('__collectionGet', unicodeDoc)

    const $ = createDOClient(transport)
    const doc = await $.collection('??????').get('id')

    expect(doc).toEqual(unicodeDoc)
    expect(transport.calls[0].args[0]).toBe('??????')
  })

  it('should handle large result sets', async () => {
    const largeResults = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      data: 'x'.repeat(100),
    }))
    transport.setResponse('__sql', {
      results: largeResults,
      meta: { rows_read: 10000, rows_written: 0 },
    })

    const $ = createDOClient(transport)
    const results = await $.sql`SELECT * FROM big_table`.all()

    expect(results).toHaveLength(10000)
  })

  it('should preserve prototype chain for Map results', async () => {
    transport.setResponse('__storageList', { a: 1, b: 2 })

    const $ = createDOClient(transport)
    const result = await $.storage.list()

    expect(result instanceof Map).toBe(true)
    expect(typeof result.get).toBe('function')
    expect(typeof result.set).toBe('function')
    expect(typeof result.has).toBe('function')
  })

  it('should handle concurrent operations', async () => {
    transport.setResponse('__storageGet', 'value')
    transport.setResponse('__collectionGet', { id: '1' })
    transport.setResponse('__sql', { results: [], meta: { rows_read: 0, rows_written: 0 } })

    const $ = createDOClient(transport)

    // Execute multiple operations concurrently
    const [storageResult, collectionResult, sqlResult] = await Promise.all([
      $.storage.get('key'),
      $.collection('test').get('1'),
      $.sql`SELECT 1`.all(),
    ])

    expect(storageResult).toBe('value')
    expect(collectionResult).toEqual({ id: '1' })
    expect(sqlResult).toEqual([])
    expect(transport.calls).toHaveLength(3)
  })
})
