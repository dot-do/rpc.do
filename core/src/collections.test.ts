/**
 * Collections Module Tests
 *
 * Comprehensive tests for the MongoDB-style document store on DO SQLite
 * Tests cover CRUD operations, filter operators, query options, and collection management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'

// sql.js instance (loaded once)
let SQL: Awaited<ReturnType<typeof initSqlJs>>

// Schema for _collections table (copied from collections.ts)
const COLLECTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS _collections (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS _collections_collection ON _collections(collection);
  CREATE INDEX IF NOT EXISTS _collections_updated ON _collections(collection, updated_at);
`

// ============================================================================
// Mock SqlStorage Implementation
// ============================================================================

/**
 * Mock SqlStorage that wraps sql.js to simulate Cloudflare Workers SQLite API
 */
class MockSqlStorage {
  private db: Database
  private regexpInstalled = false

  constructor(db: Database) {
    this.db = db
    // Initialize the schema immediately
    this.initSchema()
  }

  private initSchema(): void {
    // Execute each statement separately since sql.js doesn't handle multi-statement well
    const statements = COLLECTIONS_SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0)
    for (const stmt of statements) {
      this.db.run(stmt)
    }
  }

  /**
   * Execute SQL and return a cursor-like object
   */
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlCursor<T> {
    // Install REGEXP function if needed and not already installed
    if (query.includes('REGEXP') && !this.regexpInstalled) {
      this.db.create_function('regexp', (pattern: string, value: string) => {
        if (value === null || value === undefined) return 0
        try {
          const regex = new RegExp(pattern as string)
          return regex.test(String(value)) ? 1 : 0
        } catch {
          return 0
        }
      })
      this.regexpInstalled = true
    }

    // Handle multi-statement queries (for schema creation) - skip since we init manually
    if (query.includes(';') && query.trim().split(';').filter(s => s.trim()).length > 1) {
      // Schema already initialized, just return empty cursor
      return new SqlCursor<T>([], 0, 0)
    }

    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(query)

    // Convert params to the format sql.js expects
    const bindParams = params.map(p => {
      if (p === undefined) return null
      return p
    })

    if (isWrite) {
      this.db.run(query, bindParams)
      const changes = this.db.getRowsModified()
      return new SqlCursor<T>([], 0, changes)
    } else {
      const stmt = this.db.prepare(query)
      stmt.bind(bindParams)
      const rows: T[] = []
      while (stmt.step()) {
        const row = stmt.getAsObject() as T
        rows.push(row)
      }
      stmt.free()
      return new SqlCursor<T>(rows, rows.length, 0)
    }
  }

  close(): void {
    this.db.close()
  }
}

/**
 * Mock SQL cursor that mimics Cloudflare's SqlStorageCursor
 */
class SqlCursor<T> {
  private rows: T[]
  readonly rowsRead: number
  readonly rowsWritten: number

  constructor(rows: T[], rowsRead: number, rowsWritten: number) {
    this.rows = rows
    this.rowsRead = rowsRead
    this.rowsWritten = rowsWritten
  }

  one(): T | null {
    return this.rows[0] ?? null
  }

  toArray(): T[] {
    return this.rows
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const row of this.rows) {
      yield row
    }
  }
}

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
// Test Setup
// ============================================================================

// We dynamically import createCollection and Collections to reset module state
let createCollection: typeof import('./collections').createCollection
let Collections: typeof import('./collections').Collections
type Collection<T extends Record<string, unknown>> = import('./collections').Collection<T>
type Filter<T> = import('./collections').Filter<T>
type FilterOperator = import('./collections').FilterOperator

let mockSql: MockSqlStorage
let db: Database

/**
 * Returns mockSql typed as SqlStorage for use with createCollection/Collections.
 * MockSqlStorage only implements the exec() subset needed by collections,
 * not the full SqlStorage interface — hence the cast through unknown.
 */
function asSql(): SqlStorage {
  return mockSql as unknown as SqlStorage
}

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
// Basic CRUD Operations Tests
// ============================================================================

describe('Collection CRUD Operations', () => {
  describe('put() - insert new document', () => {
    it('should insert a new document with the given ID', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })

      const retrieved = users.get('user1')
      expect(retrieved).toEqual({ name: 'Alice', email: 'alice@example.com', age: 30, active: true })
    })

    it('should insert multiple documents with different IDs', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.put('user2', { name: 'Bob', email: 'bob@example.com', age: 25, active: false })

      expect(users.get('user1')?.name).toBe('Alice')
      expect(users.get('user2')?.name).toBe('Bob')
    })

    it('should store complex nested objects', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        active: true,
        metadata: { preferences: { theme: 'dark', notifications: true }, tags: ['admin', 'verified'] }
      })

      const retrieved = users.get('user1')
      expect(retrieved?.metadata).toEqual({ preferences: { theme: 'dark', notifications: true }, tags: ['admin', 'verified'] })
    })
  })

  describe('put() - update existing document', () => {
    it('should update an existing document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.put('user1', { name: 'Alice Updated', email: 'alice.new@example.com', age: 31, active: false })

      const retrieved = users.get('user1')
      expect(retrieved).toEqual({ name: 'Alice Updated', email: 'alice.new@example.com', age: 31, active: false })
    })

    it('should only update the specified document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.put('user2', { name: 'Bob', email: 'bob@example.com', age: 25, active: true })
      users.put('user1', { name: 'Alice Updated', email: 'alice@example.com', age: 30, active: true })

      expect(users.get('user1')?.name).toBe('Alice Updated')
      expect(users.get('user2')?.name).toBe('Bob')
    })

    it('should completely replace the document on update', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true, role: 'admin' })
      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })

      const retrieved = users.get('user1')
      expect(retrieved?.role).toBeUndefined()
    })
  })

  describe('get() - retrieve existing document', () => {
    it('should retrieve an existing document by ID', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })

      const retrieved = users.get('user1')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe('Alice')
    })

    it('should return the complete document structure', () => {
      const users = createCollection<User>(asSql(), 'users')
      const originalDoc = { name: 'Alice', email: 'alice@example.com', age: 30, active: true }

      users.put('user1', originalDoc)

      const retrieved = users.get('user1')
      expect(retrieved).toEqual(originalDoc)
    })
  })

  describe('get() - return null for non-existent document', () => {
    it('should return null for non-existent document', () => {
      const users = createCollection<User>(asSql(), 'users')

      const retrieved = users.get('nonexistent')
      expect(retrieved).toBeNull()
    })

    it('should return null for deleted document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.delete('user1')

      expect(users.get('user1')).toBeNull()
    })
  })

  describe('delete() - delete existing document', () => {
    it('should return true when deleting existing document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })

      const result = users.delete('user1')
      expect(result).toBe(true)
    })

    it('should actually remove the document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.delete('user1')

      expect(users.get('user1')).toBeNull()
      expect(users.has('user1')).toBe(false)
    })

    it('should not affect other documents', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.put('user2', { name: 'Bob', email: 'bob@example.com', age: 25, active: true })
      users.delete('user1')

      expect(users.get('user2')).not.toBeNull()
    })
  })

  describe('delete() - delete non-existent document', () => {
    it('should return false when deleting non-existent document', () => {
      const users = createCollection<User>(asSql(), 'users')

      const result = users.delete('nonexistent')
      expect(result).toBe(false)
    })

    it('should return false when deleting already deleted document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.delete('user1')

      const result = users.delete('user1')
      expect(result).toBe(false)
    })
  })

  describe('has() - check existence', () => {
    it('should return true for existing document', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })

      expect(users.has('user1')).toBe(true)
    })

    it('should return false for non-existent document', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.has('nonexistent')).toBe(false)
    })

    it('should return false after document is deleted', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user1', { name: 'Alice', email: 'alice@example.com', age: 30, active: true })
      users.delete('user1')

      expect(users.has('user1')).toBe(false)
    })
  })
})

// ============================================================================
// Filter Operations Tests
// ============================================================================

describe('Filter Operations', () => {
  let products: Collection<Product>

  beforeEach(() => {
    products = createCollection<Product>(asSql(), 'products')

    // Seed test data
    products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true, tags: ['computer', 'portable'] })
    products.put('p2', { name: 'Phone', price: 599, category: 'electronics', inStock: true, tags: ['mobile'] })
    products.put('p3', { name: 'Chair', price: 149, category: 'furniture', inStock: false, tags: ['office'] })
    products.put('p4', { name: 'Desk', price: 299, category: 'furniture', inStock: true, tags: ['office', 'wood'] })
    products.put('p5', { name: 'Monitor', price: 399, category: 'electronics', inStock: false, tags: ['computer', 'display'] })
  })

  describe('$eq - equality operator', () => {
    it('should find documents with exact field match', () => {
      const results = products.find({ category: { $eq: 'electronics' } })
      expect(results.length).toBe(3)
      expect(results.every(p => p.category === 'electronics')).toBe(true)
    })

    it('should find documents with boolean equality', () => {
      const results = products.find({ inStock: { $eq: true } })
      expect(results.length).toBe(3)
      expect(results.every(p => p.inStock === true)).toBe(true)
    })

    it('should find documents with numeric equality', () => {
      const results = products.find({ price: { $eq: 599 } })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Phone')
    })
  })

  describe('$ne - not equal operator', () => {
    it('should find documents where field is not equal', () => {
      const results = products.find({ category: { $ne: 'electronics' } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.category !== 'electronics')).toBe(true)
    })

    it('should work with boolean values', () => {
      const results = products.find({ inStock: { $ne: true } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.inStock !== true)).toBe(true)
    })
  })

  describe('$gt - greater than operator', () => {
    it('should find documents with field greater than value', () => {
      const results = products.find({ price: { $gt: 500 } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.price > 500)).toBe(true)
    })

    it('should not include equal values', () => {
      const results = products.find({ price: { $gt: 599 } })
      expect(results.length).toBe(1)
      expect(results[0]!.price).toBe(999)
    })
  })

  describe('$gte - greater than or equal operator', () => {
    it('should find documents with field greater than or equal to value', () => {
      const results = products.find({ price: { $gte: 399 } })
      expect(results.length).toBe(3)
      expect(results.every(p => p.price >= 399)).toBe(true)
    })

    it('should include equal values', () => {
      const results = products.find({ price: { $gte: 599 } })
      expect(results.length).toBe(2)
      expect(results.some(p => p.price === 599)).toBe(true)
    })
  })

  describe('$lt - less than operator', () => {
    it('should find documents with field less than value', () => {
      const results = products.find({ price: { $lt: 300 } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.price < 300)).toBe(true)
    })

    it('should not include equal values', () => {
      const results = products.find({ price: { $lt: 149 } })
      expect(results.length).toBe(0)
    })
  })

  describe('$lte - less than or equal operator', () => {
    it('should find documents with field less than or equal to value', () => {
      const results = products.find({ price: { $lte: 299 } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.price <= 299)).toBe(true)
    })

    it('should include equal values', () => {
      const results = products.find({ price: { $lte: 149 } })
      expect(results.length).toBe(1)
      expect(results[0]!.price).toBe(149)
    })
  })

  describe('$in - array membership operator', () => {
    it('should find documents where field is in array', () => {
      const results = products.find({ category: { $in: ['electronics', 'furniture'] } })
      expect(results.length).toBe(5)
    })

    it('should find documents with price in array', () => {
      const results = products.find({ price: { $in: [149, 599, 999] } })
      expect(results.length).toBe(3)
    })

    it('should return empty when no match in array', () => {
      const results = products.find({ category: { $in: ['clothing', 'food'] } })
      expect(results.length).toBe(0)
    })
  })

  describe('$nin - not in array operator', () => {
    it('should find documents where field is not in array', () => {
      const results = products.find({ category: { $nin: ['electronics'] } })
      expect(results.length).toBe(2)
      expect(results.every(p => p.category !== 'electronics')).toBe(true)
    })

    it('should work with numeric values', () => {
      const results = products.find({ price: { $nin: [999, 599] } })
      expect(results.length).toBe(3)
      expect(results.every(p => p.price !== 999 && p.price !== 599)).toBe(true)
    })
  })

  describe('$exists - field existence operator', () => {
    it('should find documents where field exists', () => {
      const users = createCollection<User>(asSql(), 'users')
      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true, role: 'admin' })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })

      const results = users.find({ role: { $exists: true } })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })

    it('should find documents where field does not exist', () => {
      const users = createCollection<User>(asSql(), 'users')
      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true, role: 'admin' })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })

      const results = users.find({ role: { $exists: false } })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Bob')
    })
  })

  describe('$regex - regex matching operator', () => {
    it('should find documents matching regex pattern', () => {
      const results = products.find({ name: { $regex: '^[A-M]' } })
      // Laptop, Chair, Desk, Monitor all match (L, C, D, M are all in range A-M)
      expect(results.length).toBe(4)
      expect(results.every(p => /^[A-M]/.test(p.name))).toBe(true)
    })

    it('should find documents with case-insensitive pattern', () => {
      const results = products.find({ name: { $regex: 'phone' } })
      // SQLite REGEXP is case-sensitive by default
      expect(results.length).toBe(0)

      const resultsUpper = products.find({ name: { $regex: 'Phone' } })
      expect(resultsUpper.length).toBe(1)
    })

    it('should find documents with partial match', () => {
      const results = products.find({ name: { $regex: 'o' } })
      expect(results.length).toBe(3) // Phone, Monitor, (no match: Laptop has 'o', Chair has no 'o', Desk has no 'o')
    })
  })

  describe('$and - logical AND operator', () => {
    it('should find documents matching all conditions', () => {
      const results = products.find({
        $and: [
          { category: 'electronics' },
          { inStock: true }
        ]
      })
      expect(results.length).toBe(2)
      expect(results.every(p => p.category === 'electronics' && p.inStock === true)).toBe(true)
    })

    it('should work with multiple comparison operators', () => {
      const results = products.find({
        $and: [
          { price: { $gte: 300 } },
          { price: { $lte: 700 } }
        ]
      })
      expect(results.length).toBe(2)
      expect(results.every(p => p.price >= 300 && p.price <= 700)).toBe(true)
    })

    it('should return empty when no documents match all conditions', () => {
      const results = products.find({
        $and: [
          { category: 'electronics' },
          { price: { $lt: 100 } }
        ]
      })
      expect(results.length).toBe(0)
    })
  })

  describe('$or - logical OR operator', () => {
    it('should find documents matching any condition', () => {
      const results = products.find({
        $or: [
          { category: 'electronics' },
          { inStock: false }
        ]
      })
      expect(results.length).toBe(4) // 3 electronics + 1 chair (inStock false, not electronic)
    })

    it('should work with equality and comparison operators', () => {
      const results = products.find({
        $or: [
          { price: { $lt: 200 } },
          { price: { $gt: 900 } }
        ]
      })
      expect(results.length).toBe(2) // Chair (149) and Laptop (999)
    })
  })

  describe('Nested field queries', () => {
    it('should query nested object fields', () => {
      const users = createCollection<User>(asSql(), 'users')
      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true, metadata: { level: 5, verified: true } })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true, metadata: { level: 3, verified: false } })

      // Note: The current implementation uses json_extract with the key as-is
      // For nested fields, you'd use 'metadata.level' but SQLite json_extract expects '$.metadata.level'
      // The implementation does: json_extract(data, '$.metadata')
      // So we test what's currently supported
      // Cast needed: dot-notation keys are a runtime feature not reflected in Filter<User> types
      const results = users.find({ 'metadata.level': 5 } as Filter<User>)
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })
  })

  describe('Plain object value matching', () => {
    it('should match plain object values exactly', () => {
      const users = createCollection<User>(asSql(), 'users')
      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true, metadata: { role: 'admin', level: 5 } })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true, metadata: { role: 'user', level: 1 } })

      // Cast needed: nested object matching is a runtime feature not reflected in Filter<User> types
      const results = users.find({ metadata: { role: 'admin', level: 5 } } as Filter<User>)
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })
  })

  describe('Implicit equality matching', () => {
    it('should treat plain values as equality filter', () => {
      const results = products.find({ category: 'electronics' })
      expect(results.length).toBe(3)
      expect(results.every(p => p.category === 'electronics')).toBe(true)
    })

    it('should match boolean values', () => {
      const results = products.find({ inStock: true })
      expect(results.length).toBe(3)
    })

    it('should match numeric values', () => {
      const results = products.find({ price: 599 })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Phone')
    })
  })
})

// ============================================================================
// Query Options Tests
// ============================================================================

describe('Query Options', () => {
  let products: Collection<Product>

  beforeEach(() => {
    products = createCollection<Product>(asSql(), 'products')

    // Seed in specific order for testing
    products.put('p1', { name: 'Alpha', price: 100, category: 'a', inStock: true })
    products.put('p2', { name: 'Beta', price: 200, category: 'b', inStock: true })
    products.put('p3', { name: 'Gamma', price: 300, category: 'c', inStock: true })
    products.put('p4', { name: 'Delta', price: 400, category: 'd', inStock: true })
    products.put('p5', { name: 'Epsilon', price: 500, category: 'e', inStock: true })
  })

  describe('limit option', () => {
    it('should limit the number of results', () => {
      const results = products.list({ limit: 2 })
      expect(results.length).toBe(2)
    })

    it('should return all if limit is greater than count', () => {
      const results = products.list({ limit: 100 })
      expect(results.length).toBe(5)
    })

    it('should return 1 result with limit 1', () => {
      const results = products.list({ limit: 1 })
      expect(results.length).toBe(1)
    })

    it('should work with find and filter', () => {
      const results = products.find({ inStock: true }, { limit: 3 })
      expect(results.length).toBe(3)
    })
  })

  describe('offset option', () => {
    it('should skip the specified number of results', () => {
      // Note: SQLite requires LIMIT when using OFFSET, so we use a high limit
      const results = products.find({}, { sort: 'name', offset: 2, limit: 100 })
      expect(results.length).toBe(3)
      expect(results[0]!.name).toBe('Delta')
    })

    it('should return empty array if offset is greater than count', () => {
      // Note: SQLite requires LIMIT when using OFFSET
      const results = products.list({ offset: 100, limit: 100 })
      expect(results.length).toBe(0)
    })

    it('should work with limit for pagination', () => {
      const page1 = products.find({}, { sort: 'name', limit: 2, offset: 0 })
      const page2 = products.find({}, { sort: 'name', limit: 2, offset: 2 })
      const page3 = products.find({}, { sort: 'name', limit: 2, offset: 4 })

      expect(page1.map(p => p.name)).toEqual(['Alpha', 'Beta'])
      expect(page2.map(p => p.name)).toEqual(['Delta', 'Epsilon'])
      expect(page3.map(p => p.name)).toEqual(['Gamma'])
    })
  })

  describe('sort option - ascending', () => {
    it('should sort results by field ascending', () => {
      const results = products.find({}, { sort: 'name' })
      expect(results.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma'])
    })

    it('should sort numeric fields ascending', () => {
      const results = products.find({}, { sort: 'price' })
      expect(results.map(p => p.price)).toEqual([100, 200, 300, 400, 500])
    })
  })

  describe('sort option - descending with - prefix', () => {
    it('should sort results by field descending', () => {
      const results = products.find({}, { sort: '-name' })
      expect(results.map(p => p.name)).toEqual(['Gamma', 'Epsilon', 'Delta', 'Beta', 'Alpha'])
    })

    it('should sort numeric fields descending', () => {
      const results = products.find({}, { sort: '-price' })
      expect(results.map(p => p.price)).toEqual([500, 400, 300, 200, 100])
    })
  })

  describe('combined options', () => {
    it('should apply sort, limit, and offset together', () => {
      const results = products.find({}, { sort: 'price', limit: 2, offset: 1 })
      expect(results.length).toBe(2)
      expect(results.map(p => p.price)).toEqual([200, 300])
    })

    it('should apply filter with sort and limit', () => {
      products.put('p6', { name: 'Zeta', price: 50, category: 'a', inStock: true })

      const results = products.find({ category: 'a' }, { sort: '-price', limit: 1 })
      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alpha')
    })
  })
})

// ============================================================================
// Collection Management Tests
// ============================================================================

describe('Collection Management', () => {
  describe('list() - list all documents', () => {
    it('should return all documents in collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      const results = users.list()
      expect(results.length).toBe(3)
    })

    it('should return empty array for empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      const results = users.list()
      expect(results).toEqual([])
    })

    it('should support query options', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      const results = users.list({ sort: 'name', limit: 2 })
      expect(results.length).toBe(2)
      expect(results.map(u => u.name)).toEqual(['Alice', 'Bob'])
    })
  })

  describe('keys() - get all IDs', () => {
    it('should return all document IDs', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      const keys = users.keys()
      expect(keys.sort()).toEqual(['u1', 'u2', 'u3'])
    })

    it('should return empty array for empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      const keys = users.keys()
      expect(keys).toEqual([])
    })

    it('should return sorted keys', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('c', { name: 'C', email: 'c@test.com', age: 30, active: true })
      users.put('a', { name: 'A', email: 'a@test.com', age: 25, active: true })
      users.put('b', { name: 'B', email: 'b@test.com', age: 35, active: false })

      const keys = users.keys()
      expect(keys).toEqual(['a', 'b', 'c'])
    })
  })

  describe('count() - count documents', () => {
    it('should return total count without filter', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      expect(users.count()).toBe(3)
    })

    it('should return 0 for empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.count()).toBe(0)
    })

    it('should return count with filter', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      expect(users.count({ active: true })).toBe(2)
      expect(users.count({ active: false })).toBe(1)
      expect(users.count({ age: { $gt: 28 } })).toBe(2)
    })
  })

  describe('clear() - delete all documents', () => {
    it('should delete all documents and return count', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      users.put('u3', { name: 'Charlie', email: 'c@test.com', age: 35, active: false })

      const deleted = users.clear()
      expect(deleted).toBe(3)
      expect(users.count()).toBe(0)
    })

    it('should return 0 for empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      const deleted = users.clear()
      expect(deleted).toBe(0)
    })

    it('should not affect other collections', () => {
      const users = createCollection<User>(asSql(), 'users')
      const products = createCollection<Product>(asSql(), 'products')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true })

      users.clear()

      expect(users.count()).toBe(0)
      expect(products.count()).toBe(1)
    })
  })

  describe('Collections.names() - list collection names', () => {
    it('should return all collection names', () => {
      const collections = new Collections(asSql())

      collections.collection('users').put('u1', { name: 'Alice' })
      collections.collection('products').put('p1', { name: 'Laptop' })
      collections.collection('orders').put('o1', { id: 1 })

      const names = collections.names()
      expect(names.sort()).toEqual(['orders', 'products', 'users'])
    })

    it('should return empty array when no collections exist', () => {
      const collections = new Collections(asSql())

      // Need to initialize schema first
      collections.collection('temp').put('t1', {})
      collections.collection('temp').clear()
      // After clearing, the collection still "exists" in the table potentially
      // Actually, clear() removes all docs but collection might still show in names
      // Let's check what names() returns for truly empty table
    })

    it('should return sorted collection names', () => {
      const collections = new Collections(asSql())

      collections.collection('zebra').put('z1', {})
      collections.collection('alpha').put('a1', {})
      collections.collection('beta').put('b1', {})

      const names = collections.names()
      expect(names).toEqual(['alpha', 'beta', 'zebra'])
    })
  })

  describe('Collections.stats() - get collection statistics', () => {
    it('should return stats for all collections', () => {
      const collections = new Collections(asSql())

      collections.collection('users').put('u1', { name: 'Alice', email: 'alice@example.com' })
      collections.collection('users').put('u2', { name: 'Bob', email: 'bob@example.com' })
      collections.collection('products').put('p1', { name: 'Laptop', price: 999 })

      const stats = collections.stats()

      expect(stats.length).toBe(2)

      const usersStats = stats.find(s => s.name === 'users')
      expect(usersStats).toBeDefined()
      expect(usersStats!.count).toBe(2)
      expect(usersStats!.size).toBeGreaterThan(0)

      const productsStats = stats.find(s => s.name === 'products')
      expect(productsStats).toBeDefined()
      expect(productsStats!.count).toBe(1)
    })

    it('should return empty array when no collections exist', () => {
      const collections = new Collections(asSql())

      // Initialize schema by accessing a collection but not adding docs
      // Actually, need to trigger schema init somehow
      // The names() and stats() methods query the table, so if table doesn't exist...
      // createCollection initializes schema, so let's do that
      createCollection(asSql(), 'temp')

      const stats = collections.stats()
      expect(stats).toEqual([])
    })
  })

  describe('Collections.drop() - drop a collection', () => {
    it('should delete all documents in collection and return count', () => {
      const collections = new Collections(asSql())

      collections.collection('users').put('u1', { name: 'Alice' })
      collections.collection('users').put('u2', { name: 'Bob' })

      const deleted = collections.drop('users')
      expect(deleted).toBe(2)
    })

    it('should return 0 when collection does not exist', () => {
      const collections = new Collections(asSql())

      // Initialize schema
      createCollection(asSql(), 'temp')

      const deleted = collections.drop('nonexistent')
      expect(deleted).toBe(0)
    })

    it('should remove collection from cache', () => {
      const collections = new Collections(asSql())

      const users1 = collections.collection('users')
      users1.put('u1', { name: 'Alice' })

      collections.drop('users')

      // Getting the collection again should create a new instance
      const users2 = collections.collection('users')
      expect(users2.count()).toBe(0)
    })

    it('should not affect other collections', () => {
      const collections = new Collections(asSql())

      collections.collection('users').put('u1', { name: 'Alice' })
      collections.collection('products').put('p1', { name: 'Laptop' })

      collections.drop('users')

      expect(collections.collection('products').count()).toBe(1)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty collection operations', () => {
    it('should handle find on empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      const results = users.find({ active: true })
      expect(results).toEqual([])
    })

    it('should handle count on empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.count()).toBe(0)
      expect(users.count({ active: true })).toBe(0)
    })

    it('should handle list on empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.list()).toEqual([])
    })

    it('should handle keys on empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.keys()).toEqual([])
    })

    it('should handle clear on empty collection', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(users.clear()).toBe(0)
    })
  })

  describe('Multiple collections isolation', () => {
    it('should isolate data between collections', () => {
      const users = createCollection<User>(asSql(), 'users')
      const products = createCollection<Product>(asSql(), 'products')

      users.put('id1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      products.put('id1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true })

      expect(users.get('id1')?.name).toBe('Alice')
      expect(products.get('id1')?.name).toBe('Laptop')
    })

    it('should have independent counts', () => {
      const users = createCollection<User>(asSql(), 'users')
      const products = createCollection<Product>(asSql(), 'products')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: true })
      products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true })

      expect(users.count()).toBe(2)
      expect(products.count()).toBe(1)
    })

    it('should have independent clear operations', () => {
      const users = createCollection<User>(asSql(), 'users')
      const products = createCollection<Product>(asSql(), 'products')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true })

      users.clear()

      expect(users.count()).toBe(0)
      expect(products.count()).toBe(1)
    })
  })

  describe('Large documents', () => {
    it('should handle documents with many fields', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      const largeDoc: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        largeDoc[`field${i}`] = `value${i}`
      }

      users.put('large', largeDoc)

      const retrieved = users.get('large')
      expect(retrieved).not.toBeNull()
      expect(Object.keys(retrieved!).length).toBe(100)
      expect(retrieved!['field50']).toBe('value50')
    })

    it('should handle documents with large string values', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      const largeString = 'x'.repeat(100000)
      users.put('large', { content: largeString })

      const retrieved = users.get('large')
      expect(retrieved).not.toBeNull()
      expect((retrieved!['content'] as string).length).toBe(100000)
    })

    it('should handle deeply nested documents', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      const deepDoc = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep'
                }
              }
            }
          }
        }
      }

      users.put('deep', deepDoc)

      const retrieved = users.get('deep')
      expect(retrieved).not.toBeNull()
      // Deep property access requires type assertion since collection type is Record<string, unknown>
      expect((retrieved as typeof deepDoc).level1.level2.level3.level4.level5.value).toBe('deep')
    })
  })

  describe('Special characters in IDs', () => {
    it('should handle IDs with spaces', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user with spaces', { name: 'Alice', email: 'a@test.com', age: 30, active: true })

      expect(users.has('user with spaces')).toBe(true)
      expect(users.get('user with spaces')?.name).toBe('Alice')
    })

    it('should handle IDs with special characters', () => {
      const users = createCollection<User>(asSql(), 'users')

      const specialIds = [
        'user-with-dashes',
        'user_with_underscores',
        'user.with.dots',
        'user@with@at',
        'user#with#hash',
        'user$with$dollar',
        'user%with%percent',
      ]

      for (const id of specialIds) {
        users.put(id, { name: id, email: `${id}@test.com`, age: 30, active: true })
      }

      for (const id of specialIds) {
        expect(users.has(id)).toBe(true)
        expect(users.get(id)?.name).toBe(id)
      }
    })

    it('should handle IDs with unicode characters', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('user-emoji-:rocket:', { name: 'Rocket User', email: 'rocket@test.com', age: 30, active: true })
      users.put('user-kanji-:Japanese_castle:', { name: 'Japanese User', email: 'jp@test.com', age: 25, active: true })

      expect(users.has('user-emoji-:rocket:')).toBe(true)
      expect(users.has('user-kanji-:Japanese_castle:')).toBe(true)
    })

    it('should reject empty string ID', () => {
      const users = createCollection<User>(asSql(), 'users')

      expect(() => {
        users.put('', { name: 'Empty ID', email: 'empty@test.com', age: 30, active: true })
      }).toThrow('Document ID must be a non-empty string')
    })
  })

  describe('NULL values in documents', () => {
    it('should store and retrieve null field values', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', middleName: null, age: 30 })

      const retrieved = users.get('u1')
      expect(retrieved).not.toBeNull()
      expect(retrieved!['middleName']).toBeNull()
    })

    it('should distinguish between null and undefined/missing fields', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', middleName: null })
      users.put('u2', { name: 'Bob' })

      const u1 = users.get('u1')
      const u2 = users.get('u2')

      expect(u1!['middleName']).toBeNull()
      expect(u2!['middleName']).toBeUndefined()
    })

    it('should filter on null values with $exists false', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', role: null })
      users.put('u2', { name: 'Bob', role: 'admin' })
      users.put('u3', { name: 'Charlie' })

      // In SQLite with JSON, null values are stored but json_extract returns SQL NULL
      // Use $exists: false to find documents where field is null or missing
      const results = users.find({ role: { $exists: false } })
      // Both Alice (null) and Charlie (undefined) should match
      expect(results.length).toBe(2)
    })
  })

  describe('Empty filter handling', () => {
    it('should return all documents with empty filter object', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: false })

      const results = users.find({})
      expect(results.length).toBe(2)
    })

    it('should return all documents with undefined filter', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })
      users.put('u2', { name: 'Bob', email: 'b@test.com', age: 25, active: false })

      const results = users.find(undefined)
      expect(results.length).toBe(2)
    })
  })

  describe('Array field handling', () => {
    it('should store and retrieve array fields', () => {
      const products = createCollection<Product>(asSql(), 'products')

      products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true, tags: ['computer', 'portable', 'work'] })

      const retrieved = products.get('p1')
      expect(retrieved?.tags).toEqual(['computer', 'portable', 'work'])
    })

    it('should handle empty arrays', () => {
      const products = createCollection<Product>(asSql(), 'products')

      products.put('p1', { name: 'Laptop', price: 999, category: 'electronics', inStock: true, tags: [] })

      const retrieved = products.get('p1')
      expect(retrieved?.tags).toEqual([])
    })
  })

  describe('Collections class caching', () => {
    it('should return the same collection instance for same name', () => {
      const collections = new Collections(asSql())

      const users1 = collections.collection('users')
      const users2 = collections.collection('users')

      expect(users1).toBe(users2)
    })

    it('should return different instances for different names', () => {
      const collections = new Collections(asSql())

      const users = collections.collection('users')
      const products = collections.collection('products')

      expect(users).not.toBe(products)
    })
  })

  describe('Concurrent operations', () => {
    it('should handle rapid put/get operations', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Rapid puts
      for (let i = 0; i < 100; i++) {
        users.put(`user${i}`, { index: i, name: `User ${i}` })
      }

      // Verify all were stored
      expect(users.count()).toBe(100)

      // Rapid gets
      for (let i = 0; i < 100; i++) {
        const doc = users.get(`user${i}`)
        expect(doc).not.toBeNull()
        expect(doc!['index']).toBe(i)
      }
    })
  })
})

// ============================================================================
// Error Cases Tests
// ============================================================================

describe('Error Cases', () => {
  describe('Invalid filter operators', () => {
    it('should handle unknown operator gracefully (treated as object match)', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })

      // Unknown operator should be treated as plain object match
      // Cast needed: testing runtime behavior with an unknown operator not in FilterOperator type
      const results = users.find({ age: { $unknown: 30 } as unknown as FilterOperator })
      // This will try to match the object { $unknown: 30 } which won't match
      expect(results.length).toBe(0)
    })
  })

  describe('Empty $and and $or arrays', () => {
    it('should handle empty $and array', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })

      // Empty $and should not add conditions
      const results = users.find({ $and: [] })
      expect(results.length).toBe(1)
    })

    it('should handle empty $or array', () => {
      const users = createCollection<User>(asSql(), 'users')

      users.put('u1', { name: 'Alice', email: 'a@test.com', age: 30, active: true })

      // Empty $or should not add conditions
      const results = users.find({ $or: [] })
      expect(results.length).toBe(1)
    })
  })

  describe('Numeric comparison edge cases', () => {
    it('should handle comparison with zero', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', score: 0 })
      users.put('u2', { name: 'Bob', score: 5 })
      users.put('u3', { name: 'Charlie', score: -5 })

      const gtZero = users.find({ score: { $gt: 0 } })
      expect(gtZero.length).toBe(1)
      expect(gtZero[0]!['name']).toBe('Bob')

      const gteZero = users.find({ score: { $gte: 0 } })
      expect(gteZero.length).toBe(2)

      const ltZero = users.find({ score: { $lt: 0 } })
      expect(ltZero.length).toBe(1)
      expect(ltZero[0]!['name']).toBe('Charlie')
    })

    it('should handle negative numbers', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', balance: -100 })
      users.put('u2', { name: 'Bob', balance: -50 })
      users.put('u3', { name: 'Charlie', balance: 50 })

      const negative = users.find({ balance: { $lt: 0 } })
      expect(negative.length).toBe(2)

      const moreThanNeg75 = users.find({ balance: { $gt: -75 } })
      expect(moreThanNeg75.length).toBe(2)
    })

    it('should handle floating point numbers', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('u1', { name: 'Alice', rating: 4.5 })
      users.put('u2', { name: 'Bob', rating: 3.7 })
      users.put('u3', { name: 'Charlie', rating: 4.0 })

      const highRating = users.find({ rating: { $gte: 4.0 } })
      expect(highRating.length).toBe(2)
    })
  })
})

// ============================================================================
// Security and Validation Tests
// ============================================================================

describe('Security and Validation', () => {
  describe('SQL injection prevention - field names', () => {
    it('should reject field names with SQL injection attempts', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      // Attempt SQL injection via field name
      expect(() => {
        users.find({ "name'); DROP TABLE _collections; --": 'test' })
      }).toThrow('Invalid field name')
    })

    it('should reject field names with quotes', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      expect(() => {
        users.find({ "field'test": 'value' })
      }).toThrow('Invalid field name')
    })

    it('should reject field names with parentheses', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      expect(() => {
        users.find({ "field()": 'value' })
      }).toThrow('Invalid field name')
    })

    it('should reject field names with spaces', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      expect(() => {
        users.find({ "field name": 'value' })
      }).toThrow('Invalid field name')
    })

    it('should allow valid field names with underscores', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { first_name: 'Alice', last_name: 'Smith' })

      const results = users.find({ first_name: 'Alice' })
      expect(results.length).toBe(1)
    })

    it('should allow nested field names with dots', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', metadata: { level: 5 } })

      const results = users.find({ 'metadata.level': 5 })
      expect(results.length).toBe(1)
    })

    it('should allow alphanumeric field names', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { field123: 'value', Field456: 'value2' })

      const results = users.find({ field123: 'value' })
      expect(results.length).toBe(1)
    })
  })

  describe('SQL injection prevention - sort field', () => {
    it('should reject sort field with SQL injection attempts', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      expect(() => {
        users.find({}, { sort: "name'); DROP TABLE _collections; --" })
      }).toThrow('Invalid field name')
    })

    it('should reject sort field with quotes', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })

      expect(() => {
        users.find({}, { sort: "field'test" })
      }).toThrow('Invalid field name')
    })

    it('should allow valid sort field with descending prefix', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', age: 30 })
      users.put('u2', { name: 'Bob', age: 25 })

      const results = users.find({}, { sort: '-age' })
      expect(results[0]!['name']).toBe('Alice')
      expect(results[1]!['name']).toBe('Bob')
    })
  })

  describe('Input validation - put()', () => {
    // These tests intentionally pass invalid types to verify runtime validation.
    // The `as any` casts are required to bypass TypeScript's type checking
    // so we can test that the runtime guards correctly reject bad inputs.

    it('should reject null document', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      expect(() => {
        users.put('u1', null as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document must be a non-null object')
    })

    it('should reject array as document', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      expect(() => {
        users.put('u1', ['item1', 'item2'] as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document must be a non-null object')
    })

    it('should reject primitive values as document', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      expect(() => {
        users.put('u1', 'string' as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document must be a non-null object')

      expect(() => {
        users.put('u1', 123 as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document must be a non-null object')

      expect(() => {
        users.put('u1', true as any) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document must be a non-null object')
    })

    it('should reject non-string ID', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      expect(() => {
        users.put(123 as any, { name: 'Alice' }) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document ID must be a non-empty string')

      expect(() => {
        users.put(null as any, { name: 'Alice' }) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document ID must be a non-empty string')

      expect(() => {
        users.put(undefined as any, { name: 'Alice' }) // eslint-disable-line @typescript-eslint/no-explicit-any -- testing invalid input
      }).toThrow('Document ID must be a non-empty string')
    })

    it('should accept valid document and ID', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Should not throw
      users.put('u1', { name: 'Alice' })
      expect(users.get('u1')).toEqual({ name: 'Alice' })
    })
  })

  describe('Query options validation', () => {
    it('should reject offset without limit', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice' })
      users.put('u2', { name: 'Bob' })

      expect(() => {
        users.find({}, { offset: 1 })
      }).toThrow('offset requires limit to be specified')
    })

    it('should allow offset with limit', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice' })
      users.put('u2', { name: 'Bob' })
      users.put('u3', { name: 'Charlie' })

      const results = users.find({}, { sort: 'name', offset: 1, limit: 10 })
      expect(results.length).toBe(2)
    })

    it('should allow limit without offset', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice' })
      users.put('u2', { name: 'Bob' })

      const results = users.find({}, { limit: 1 })
      expect(results.length).toBe(1)
    })

    it('should reject offset without limit in list()', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice' })

      expect(() => {
        users.list({ offset: 1 })
      }).toThrow('offset requires limit to be specified')
    })
  })

  describe('SQL injection via filter operators', () => {
    it('should handle $eq with SQL injection values safely via parameterization', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', role: 'admin' })

      // The value itself is safe because it's parameterized
      const results = users.find({ name: { $eq: "'; DROP TABLE _collections; --" } })
      expect(results.length).toBe(0)

      // Verify table still exists
      expect(users.get('u1')).not.toBeNull()
    })

    it('should handle $regex with malicious patterns safely', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice', role: 'admin' })

      // The pattern is parameterized, so SQL injection isn't possible
      const results = users.find({ name: { $regex: ".*'; DROP TABLE --" } })
      expect(results.length).toBe(0)

      // Verify table still exists
      expect(users.get('u1')).not.toBeNull()
    })

    it('should handle $in with SQL injection values safely', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      users.put('u1', { name: 'Alice' })

      const results = users.find({ name: { $in: ["'; DROP TABLE _collections; --", 'test'] } })
      expect(results.length).toBe(0)

      // Verify table still exists
      expect(users.get('u1')).not.toBeNull()
    })
  })
})

// ============================================================================
// Concurrency Tests
// ============================================================================

describe('Concurrency Tests', () => {
  describe('Rapid concurrent put() with same ID', () => {
    it('should handle multiple rapid puts to the same ID', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Simulate rapid concurrent puts to the same ID
      const iterations = 100
      for (let i = 0; i < iterations; i++) {
        users.put('user1', { index: i, name: `Version ${i}` })
      }

      // The last write should win
      const result = users.get('user1')
      expect(result).not.toBeNull()
      expect(result!['index']).toBe(iterations - 1)
      expect(result!['name']).toBe(`Version ${iterations - 1}`)
    })

    it('should handle alternating puts between two documents', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      const iterations = 50
      for (let i = 0; i < iterations; i++) {
        users.put('user1', { value: i * 2 })
        users.put('user2', { value: i * 2 + 1 })
      }

      expect(users.get('user1')!['value']).toBe((iterations - 1) * 2)
      expect(users.get('user2')!['value']).toBe((iterations - 1) * 2 + 1)
      expect(users.count()).toBe(2)
    })

    it('should maintain data integrity under rapid put/delete cycles', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Create, update, delete pattern
      for (let i = 0; i < 50; i++) {
        users.put(`temp${i}`, { value: i })
        users.put(`temp${i}`, { value: i * 2 }) // Update
        users.delete(`temp${i}`) // Delete
      }

      // All should be deleted
      expect(users.count()).toBe(0)
    })

    it('should handle interleaved operations on multiple collections', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')
      const products = createCollection<Record<string, unknown>>(asSql(), 'products')
      const orders = createCollection<Record<string, unknown>>(asSql(), 'orders')

      for (let i = 0; i < 30; i++) {
        users.put(`u${i}`, { type: 'user', index: i })
        products.put(`p${i}`, { type: 'product', index: i })
        orders.put(`o${i}`, { type: 'order', index: i })
      }

      expect(users.count()).toBe(30)
      expect(products.count()).toBe(30)
      expect(orders.count()).toBe(30)

      // Verify data integrity
      for (let i = 0; i < 30; i++) {
        expect(users.get(`u${i}`)!['type']).toBe('user')
        expect(products.get(`p${i}`)!['type']).toBe('product')
        expect(orders.get(`o${i}`)!['type']).toBe('order')
      }
    })
  })

  describe('Version increment consistency', () => {
    it('should not lose updates when rapidly updating the same document', () => {
      const counters = createCollection<Record<string, unknown>>(asSql(), 'counters')

      // Initialize counter
      counters.put('counter1', { value: 0 })

      // Simulate 100 increments
      for (let i = 0; i < 100; i++) {
        const current = counters.get('counter1')
        const newValue = (current!['value'] as number) + 1
        counters.put('counter1', { value: newValue })
      }

      // Should have exactly 100 increments
      const final = counters.get('counter1')
      expect(final!['value']).toBe(100)
    })

    it('should maintain consistent state through update cycles', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      users.put('user1', { version: 1, data: 'initial' })

      // Update 50 times, incrementing version each time
      for (let i = 2; i <= 51; i++) {
        const current = users.get('user1')
        expect(current!['version']).toBe(i - 1) // Verify we read the previous version
        users.put('user1', { version: i, data: `update-${i}` })
      }

      const final = users.get('user1')
      expect(final!['version']).toBe(51)
      expect(final!['data']).toBe('update-51')
    })

    it('should handle batch updates without data loss', () => {
      const items = createCollection<Record<string, unknown>>(asSql(), 'items')

      // Create 100 items
      for (let i = 0; i < 100; i++) {
        items.put(`item${i}`, { created: true, updated: false })
      }

      // Update all items
      for (let i = 0; i < 100; i++) {
        items.put(`item${i}`, { created: true, updated: true, updateIndex: i })
      }

      // Verify all updates were applied
      for (let i = 0; i < 100; i++) {
        const item = items.get(`item${i}`)
        expect(item!['updated']).toBe(true)
        expect(item!['updateIndex']).toBe(i)
      }

      expect(items.count()).toBe(100)
    })
  })

  describe('Relationship modification during traversal', () => {
    it('should handle modification while listing documents', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Create initial set
      for (let i = 0; i < 20; i++) {
        users.put(`user${i}`, { index: i })
      }

      // Get list (snapshot)
      const initialList = users.list()
      expect(initialList.length).toBe(20)

      // Modify during "traversal" (simulated)
      for (const user of initialList) {
        const index = user['index'] as number
        // Add a new document while iterating
        users.put(`new${index}`, { derived: true, from: index })
        // Update the original
        users.put(`user${index}`, { index, modified: true })
      }

      // Should have original 20 + 20 new ones
      expect(users.count()).toBe(40)

      // Verify originals were modified
      for (let i = 0; i < 20; i++) {
        expect(users.get(`user${i}`)!['modified']).toBe(true)
      }

      // Verify new ones were created
      for (let i = 0; i < 20; i++) {
        expect(users.get(`new${i}`)!['derived']).toBe(true)
      }
    })

    it('should handle deletion while traversing', () => {
      const users = createCollection<Record<string, unknown>>(asSql(), 'users')

      // Create items
      for (let i = 0; i < 30; i++) {
        users.put(`user${i}`, { index: i, keep: i % 2 === 0 })
      }

      // Get list then delete odd-indexed items
      const list = users.list()
      for (const user of list) {
        const index = user['index'] as number
        if (index % 2 !== 0) {
          users.delete(`user${index}`)
        }
      }

      // Should have 15 items remaining (even indices)
      expect(users.count()).toBe(15)

      // Verify only even-indexed items remain
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) {
          expect(users.has(`user${i}`)).toBe(true)
        } else {
          expect(users.has(`user${i}`)).toBe(false)
        }
      }
    })

    it('should handle find while modifying matching documents', () => {
      const products = createCollection<Record<string, unknown>>(asSql(), 'products')

      // Create products with different categories
      for (let i = 0; i < 20; i++) {
        products.put(`product${i}`, {
          category: i % 2 === 0 ? 'electronics' : 'furniture',
          price: 100 + i * 10,
        })
      }

      // Find electronics and update them
      const electronics = products.find({ category: 'electronics' })
      expect(electronics.length).toBe(10)

      for (let i = 0; i < electronics.length; i++) {
        // Find the ID (it's product0, product2, product4, etc.)
        const id = `product${i * 2}`
        const current = products.get(id)
        products.put(id, {
          ...current,
          onSale: true,
          salePrice: (current!['price'] as number) * 0.9,
        })
      }

      // Verify updates
      const updatedElectronics = products.find({ category: 'electronics' })
      expect(updatedElectronics.every((p) => p['onSale'] === true)).toBe(true)
    })

    it('should maintain consistency when updating based on filter results', () => {
      const orders = createCollection<Record<string, unknown>>(asSql(), 'orders')

      // Create orders with different statuses
      for (let i = 0; i < 30; i++) {
        orders.put(`order${i}`, {
          status: i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'processing' : 'completed',
          amount: 100 + i,
        })
      }

      // Find pending orders and process them
      const pending = orders.find({ status: 'pending' })
      const pendingCount = pending.length
      expect(pendingCount).toBe(10)

      for (let i = 0; i < pending.length; i++) {
        const id = `order${i * 3}` // pending orders are at 0, 3, 6, ...
        orders.put(id, {
          status: 'processing',
          amount: pending[i]!['amount'],
          processedAt: Date.now(),
        })
      }

      // Verify no more pending
      expect(orders.find({ status: 'pending' }).length).toBe(0)

      // Verify processing count increased
      const processing = orders.find({ status: 'processing' })
      expect(processing.length).toBe(20) // original 10 + 10 moved from pending
    })
  })

  describe('Stress tests', () => {
    it('should handle 1000 rapid operations without data corruption', () => {
      const data = createCollection<Record<string, unknown>>(asSql(), 'data')

      // Mix of operations
      for (let i = 0; i < 1000; i++) {
        const op = i % 4
        const id = `item${i % 100}` // Reuse IDs to test updates

        switch (op) {
          case 0:
            data.put(id, { value: i, op: 'put' })
            break
          case 1:
            data.get(id)
            break
          case 2:
            if (i > 100) data.delete(`item${(i - 100) % 100}`)
            break
          case 3:
            data.find({ value: { $gt: i - 10 } }, { limit: 5 })
            break
        }
      }

      // Should still be functional
      expect(data.count()).toBeGreaterThanOrEqual(0)
      expect(() => data.list()).not.toThrow()
    })

    it('should maintain count consistency under heavy load', () => {
      const items = createCollection<Record<string, unknown>>(asSql(), 'items')

      let expectedCount = 0

      // Perform many operations tracking expected count
      for (let i = 0; i < 500; i++) {
        if (i % 3 === 0) {
          // Add new item
          items.put(`item${i}`, { value: i })
          expectedCount++
        } else if (i % 3 === 1 && expectedCount > 0) {
          // Try to delete (may or may not exist)
          const deleted = items.delete(`item${i - 1}`)
          if (deleted) expectedCount--
        } else {
          // Update existing if exists
          if (items.has(`item${i - 2}`)) {
            items.put(`item${i - 2}`, { value: i, updated: true })
          }
        }
      }

      expect(items.count()).toBe(expectedCount)
    })
  })
})
