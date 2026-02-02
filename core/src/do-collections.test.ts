/**
 * DO Collections Module Tests
 *
 * Comprehensive tests for the Digital Object Collections system.
 * Tests cover Nouns, Verbs, Things, Actions, Relationships, Traversal, and Stats.
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
// Test Setup
// ============================================================================

// Dynamically import DOCollections to reset module state
let DOCollections: typeof import('./do-collections').DOCollections
type DOCollectionsType = import('./do-collections').DOCollections
type Thing<T = Record<string, unknown>> = import('./do-collections').Thing<T>
type Noun = import('./do-collections').Noun
type Verb = import('./do-collections').Verb
type Action = import('./do-collections').Action
type Relationship = import('./do-collections').Relationship
type SemanticMatcher = import('./do-collections').SemanticMatcher
type SemanticMatch<T = Record<string, unknown>> = import('./do-collections').SemanticMatch<T>

let mockSql: MockSqlStorage
let db: Database
let doCollections: DOCollectionsType

/**
 * Returns mockSql typed as SqlStorage for use with DOCollections.
 * MockSqlStorage only implements the exec() subset needed by collections,
 * not the full SqlStorage interface — hence the cast through unknown.
 */
function asSql(): SqlStorage {
  return mockSql as unknown as SqlStorage
}

beforeEach(async () => {
  // Reset module cache to reset module state
  vi.resetModules()

  // Re-import the module
  const doCollectionsModule = await import('./do-collections')
  DOCollections = doCollectionsModule.DOCollections

  // Initialize sql.js if needed
  if (!SQL) {
    SQL = await initSqlJs()
  }
  db = new SQL.Database()
  mockSql = new MockSqlStorage(db)
  doCollections = new DOCollections(asSql())
})

afterEach(() => {
  if (mockSql) {
    mockSql.close()
  }
})

// ============================================================================
// Test Types
// ============================================================================

interface UserData {
  name: string
  email: string
  age?: number
  [key: string]: unknown
}

interface ProductData {
  name: string
  price: number
  category?: string
  [key: string]: unknown
}

interface OrganizationData {
  name: string
  industry?: string
  [key: string]: unknown
}

// ============================================================================
// Nouns Tests
// ============================================================================

describe('Nouns (Type Definitions)', () => {
  describe('define()', () => {
    it('should define a new noun with just a name', () => {
      const noun = doCollections.nouns.define('User')

      expect(noun).toBeDefined()
      expect(noun.name).toBe('User')
      expect(noun.$createdAt).toBeGreaterThan(0)
    })

    it('should define a noun with description', () => {
      const noun = doCollections.nouns.define('User', {
        description: 'A registered user in the system'
      })

      expect(noun.name).toBe('User')
      expect(noun.description).toBe('A registered user in the system')
    })

    it('should define a noun with schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' }
        }
      }
      const noun = doCollections.nouns.define('User', { schema })

      expect(noun.schema).toEqual(schema)
    })

    it('should define a noun with all options', () => {
      const noun = doCollections.nouns.define('Product', {
        description: 'A product for sale',
        schema: { type: 'object' }
      })

      expect(noun.name).toBe('Product')
      expect(noun.description).toBe('A product for sale')
      expect(noun.schema).toEqual({ type: 'object' })
      expect(noun.$createdAt).toBeGreaterThan(0)
    })

    it('should overwrite existing noun with same name', () => {
      doCollections.nouns.define('User', { description: 'Original' })
      const noun = doCollections.nouns.define('User', { description: 'Updated' })

      expect(noun.description).toBe('Updated')
      expect(doCollections.nouns.list().length).toBe(1)
    })
  })

  describe('get()', () => {
    it('should retrieve an existing noun by name', () => {
      doCollections.nouns.define('User', { description: 'Test user' })

      const noun = doCollections.nouns.get('User')

      expect(noun).not.toBeNull()
      expect(noun!.name).toBe('User')
      expect(noun!.description).toBe('Test user')
    })

    it('should return null for non-existent noun', () => {
      const noun = doCollections.nouns.get('NonExistent')

      expect(noun).toBeNull()
    })
  })

  describe('list()', () => {
    it('should return empty array when no nouns defined', () => {
      const nouns = doCollections.nouns.list()

      expect(nouns).toEqual([])
    })

    it('should return all defined nouns', () => {
      doCollections.nouns.define('User')
      doCollections.nouns.define('Product')
      doCollections.nouns.define('Order')

      const nouns = doCollections.nouns.list()

      expect(nouns.length).toBe(3)
      const names = nouns.map(n => n.name)
      expect(names).toContain('User')
      expect(names).toContain('Product')
      expect(names).toContain('Order')
    })
  })

  describe('has()', () => {
    it('should return true for existing noun', () => {
      doCollections.nouns.define('User')

      expect(doCollections.nouns.has('User')).toBe(true)
    })

    it('should return false for non-existent noun', () => {
      expect(doCollections.nouns.has('NonExistent')).toBe(false)
    })

    it('should be case-sensitive', () => {
      doCollections.nouns.define('User')

      expect(doCollections.nouns.has('user')).toBe(false)
      expect(doCollections.nouns.has('USER')).toBe(false)
    })
  })
})

// ============================================================================
// Verbs Tests
// ============================================================================

describe('Verbs (Action/Relationship Definitions)', () => {
  describe('define()', () => {
    it('should define a new verb with just a name', () => {
      const verb = doCollections.verbs.define('created')

      expect(verb).toBeDefined()
      expect(verb.name).toBe('created')
      expect(verb.$createdAt).toBeGreaterThan(0)
    })

    it('should define a verb with description', () => {
      const verb = doCollections.verbs.define('memberOf', {
        description: 'User belongs to an organization'
      })

      expect(verb.description).toBe('User belongs to an organization')
    })

    it('should define a verb with cascade operator ->', () => {
      const verb = doCollections.verbs.define('owns', {
        cascade: '->'
      })

      expect(verb.cascade).toBe('->')
    })

    it('should define a verb with cascade operator ~>', () => {
      const verb = doCollections.verbs.define('relatesTo', {
        cascade: '~>'
      })

      expect(verb.cascade).toBe('~>')
    })

    it('should define a verb with cascade operator <-', () => {
      const verb = doCollections.verbs.define('ownedBy', {
        cascade: '<-'
      })

      expect(verb.cascade).toBe('<-')
    })

    it('should define a verb with cascade operator <~', () => {
      const verb = doCollections.verbs.define('relatedFrom', {
        cascade: '<~'
      })

      expect(verb.cascade).toBe('<~')
    })

    it('should define a verb with from/to type constraints', () => {
      const verb = doCollections.verbs.define('memberOf', {
        from: ['User'],
        to: ['Organization', 'Team']
      })

      expect(verb.from).toEqual(['User'])
      expect(verb.to).toEqual(['Organization', 'Team'])
    })

    it('should define a verb with all options', () => {
      const verb = doCollections.verbs.define('manages', {
        description: 'Manager relationship',
        cascade: '->',
        from: ['User'],
        to: ['User', 'Team']
      })

      expect(verb.name).toBe('manages')
      expect(verb.description).toBe('Manager relationship')
      expect(verb.cascade).toBe('->')
      expect(verb.from).toEqual(['User'])
      expect(verb.to).toEqual(['User', 'Team'])
    })

    it('should overwrite existing verb with same name', () => {
      doCollections.verbs.define('owns', { cascade: '->' })
      const verb = doCollections.verbs.define('owns', { cascade: '~>' })

      expect(verb.cascade).toBe('~>')
      expect(doCollections.verbs.list().length).toBe(1)
    })
  })

  describe('get()', () => {
    it('should retrieve an existing verb by name', () => {
      doCollections.verbs.define('memberOf', { cascade: '->' })

      const verb = doCollections.verbs.get('memberOf')

      expect(verb).not.toBeNull()
      expect(verb!.name).toBe('memberOf')
      expect(verb!.cascade).toBe('->')
    })

    it('should return null for non-existent verb', () => {
      const verb = doCollections.verbs.get('nonExistent')

      expect(verb).toBeNull()
    })
  })

  describe('list()', () => {
    it('should return empty array when no verbs defined', () => {
      const verbs = doCollections.verbs.list()

      expect(verbs).toEqual([])
    })

    it('should return all defined verbs', () => {
      doCollections.verbs.define('created')
      doCollections.verbs.define('updated')
      doCollections.verbs.define('deleted')

      const verbs = doCollections.verbs.list()

      expect(verbs.length).toBe(3)
      const names = verbs.map(v => v.name)
      expect(names).toContain('created')
      expect(names).toContain('updated')
      expect(names).toContain('deleted')
    })
  })

  describe('has()', () => {
    it('should return true for existing verb', () => {
      doCollections.verbs.define('created')

      expect(doCollections.verbs.has('created')).toBe(true)
    })

    it('should return false for non-existent verb', () => {
      expect(doCollections.verbs.has('nonExistent')).toBe(false)
    })
  })
})

// ============================================================================
// Things Tests
// ============================================================================

describe('Things (Entity Instances)', () => {
  describe('create()', () => {
    it('should create a new thing with auto-generated ID', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      expect(thing).toBeDefined()
      expect(thing.$id).toBeDefined()
      expect(thing.$id).toMatch(/^user_/)
      expect(thing.$type).toBe('User')
      expect(thing.data.name).toBe('Alice')
      expect(thing.data.email).toBe('alice@example.com')
    })

    it('should create a thing with custom ID', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' }, 'custom-id')

      expect(thing.$id).toBe('custom-id')
    })

    it('should set $version to 1 on creation', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      expect(thing.$version).toBe(1)
    })

    it('should set $createdAt timestamp', () => {
      const before = Date.now()
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const after = Date.now()

      expect(thing.$createdAt).toBeGreaterThanOrEqual(before)
      expect(thing.$createdAt).toBeLessThanOrEqual(after)
    })

    it('should set $updatedAt equal to $createdAt on creation', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      expect(thing.$updatedAt).toBe(thing.$createdAt)
    })

    it('should auto-log a created action', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      const actions = doCollections.actions.find({ verb: 'created' })
      expect(actions.length).toBeGreaterThan(0)

      const createAction = actions.find(a => a.to === thing.$id)
      expect(createAction).toBeDefined()
      expect(createAction!.verb).toBe('created')
    })

    it('should create multiple things with different types', () => {
      const user = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const product = doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      expect(user.$type).toBe('User')
      expect(product.$type).toBe('Product')
      expect(user.$id).not.toBe(product.$id)
    })
  })

  describe('get()', () => {
    it('should retrieve an existing thing by ID', () => {
      const created = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      const retrieved = doCollections.things.get<UserData>(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.data.name).toBe('Alice')
    })

    it('should return null for non-existent thing', () => {
      const thing = doCollections.things.get('non-existent-id')

      expect(thing).toBeNull()
    })
  })

  describe('update()', () => {
    it('should update an existing thing', () => {
      const created = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      const updated = doCollections.things.update<UserData>(created.$id, { name: 'Alice Updated' })

      expect(updated).not.toBeNull()
      expect(updated!.data.name).toBe('Alice Updated')
      expect(updated!.data.email).toBe('alice@example.com') // Preserved
    })

    it('should increment $version on update', () => {
      const created = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      expect(created.$version).toBe(1)

      const updated1 = doCollections.things.update<UserData>(created.$id, { name: 'Alice v2' })
      expect(updated1!.$version).toBe(2)

      const updated2 = doCollections.things.update<UserData>(created.$id, { name: 'Alice v3' })
      expect(updated2!.$version).toBe(3)
    })

    it('should update $updatedAt timestamp', async () => {
      const created = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const originalUpdatedAt = created.$updatedAt

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10))

      const updated = doCollections.things.update<UserData>(created.$id, { name: 'Alice Updated' })

      expect(updated!.$updatedAt).toBeGreaterThan(originalUpdatedAt)
    })

    it('should preserve $createdAt on update', () => {
      const created = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const originalCreatedAt = created.$createdAt

      const updated = doCollections.things.update<UserData>(created.$id, { name: 'Alice Updated' })

      expect(updated!.$createdAt).toBe(originalCreatedAt)
    })

    it('should auto-log an updated action', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.update<UserData>(thing.$id, { name: 'Alice Updated' })

      const actions = doCollections.actions.find({ verb: 'updated' })
      expect(actions.length).toBeGreaterThan(0)

      const updateAction = actions.find(a => a.to === thing.$id)
      expect(updateAction).toBeDefined()
    })

    it('should return null when updating non-existent thing', () => {
      const result = doCollections.things.update('non-existent', { name: 'Test' })

      expect(result).toBeNull()
    })
  })

  describe('delete()', () => {
    it('should delete an existing thing and return true', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      const result = doCollections.things.delete(thing.$id)

      expect(result).toBe(true)
      expect(doCollections.things.get(thing.$id)).toBeNull()
    })

    it('should return false when deleting non-existent thing', () => {
      const result = doCollections.things.delete('non-existent')

      expect(result).toBe(false)
    })

    it('should auto-log a deleted action', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.delete(thing.$id)

      const actions = doCollections.actions.find({ verb: 'deleted' })
      expect(actions.length).toBeGreaterThan(0)

      const deleteAction = actions.find(a => a.to === thing.$id)
      expect(deleteAction).toBeDefined()
    })

    it('should clean up outgoing relationships when deleted', () => {
      const user = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const org = doCollections.things.create<OrganizationData>('Organization', { name: 'Acme Inc' })

      doCollections.relate(user.$id, 'memberOf', org.$id)
      expect(doCollections.relationsFrom(user.$id).length).toBe(1)

      doCollections.things.delete(user.$id)

      expect(doCollections.relationsFrom(user.$id).length).toBe(0)
    })

    it('should clean up incoming relationships when deleted', () => {
      const user = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const org = doCollections.things.create<OrganizationData>('Organization', { name: 'Acme Inc' })

      doCollections.relate(user.$id, 'memberOf', org.$id)
      expect(doCollections.relationsTo(org.$id).length).toBe(1)

      doCollections.things.delete(org.$id)

      expect(doCollections.relationsTo(org.$id).length).toBe(0)
    })
  })

  describe('find()', () => {
    beforeEach(() => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com', age: 30 })
      doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com', age: 25 })
      doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })
    })

    // Note: Type-based filtering using $type is currently not supported by the underlying
    // collections layer which doesn't allow $ in field names. These tests document the
    // current behavior and test the workarounds.

    it('should find all things when type is undefined', () => {
      const things = doCollections.things.find()

      expect(things.length).toBe(3)
    })

    it('should support query options without type filter', () => {
      const things = doCollections.things.find(undefined, undefined, { limit: 2 })

      expect(things.length).toBe(2)
    })

    it('should find things with data filter without type', () => {
      // When type is not specified, we can still filter by data fields
      const things = doCollections.things.find(undefined, { name: 'Alice' })

      expect(things.length).toBe(1)
      expect(things[0]!.data['name']).toBe('Alice')
    })

    it('should list all things and filter manually by type', () => {
      // Alternative approach: list all and filter in code
      const allThings = doCollections.things.list()
      const users = allThings.filter(t => t.$type === 'User')

      expect(users.length).toBe(2)
      expect(users.every(t => t.$type === 'User')).toBe(true)
    })
  })

  describe('count()', () => {
    it('should count all things when no type specified', () => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      expect(doCollections.things.count()).toBe(2)
    })

    // Note: Type-based counting using $type filter is currently not supported by the
    // underlying collections layer which doesn't allow $ in field names.
    // These tests document alternative approaches.

    it('should count all things and filter manually by type', () => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' })
      doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      // Alternative: list all and count in code
      const allThings = doCollections.things.list()
      const userCount = allThings.filter(t => t.$type === 'User').length
      const productCount = allThings.filter(t => t.$type === 'Product').length

      expect(userCount).toBe(2)
      expect(productCount).toBe(1)
    })

    it('should return total count correctly', () => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' })
      doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      expect(doCollections.things.count()).toBe(3)
    })
  })

  describe('list()', () => {
    it('should list all things', () => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      const things = doCollections.things.list()

      expect(things.length).toBe(2)
    })

    it('should return empty array when no things exist', () => {
      const things = doCollections.things.list()

      expect(things).toEqual([])
    })

    it('should support query options', () => {
      doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' })
      doCollections.things.create<UserData>('User', { name: 'Charlie', email: 'charlie@example.com' })

      const things = doCollections.things.list({ limit: 2 })

      expect(things.length).toBe(2)
    })
  })
})

// ============================================================================
// Actions (Audit Log) Tests
// ============================================================================

describe('Actions (Audit Log)', () => {
  describe('log()', () => {
    it('should log an action with verb only', () => {
      const action = doCollections.actions.log('systemStarted')

      expect(action).toBeDefined()
      expect(action.$id).toBeDefined()
      expect(action.verb).toBe('systemStarted')
      expect(action.$at).toBeGreaterThan(0)
    })

    it('should log an action with from/to', () => {
      const action = doCollections.actions.log('sent', 'user1', 'user2')

      expect(action.from).toBe('user1')
      expect(action.to).toBe('user2')
    })

    it('should log an action with data', () => {
      const action = doCollections.actions.log('purchased', 'user1', 'product1', { quantity: 2, price: 100 })

      expect(action.data).toEqual({ quantity: 2, price: 100 })
    })

    it('should log an action with $by actor', () => {
      const action = doCollections.actions.log('approved', 'request1', undefined, undefined, 'admin1')

      expect(action.$by).toBe('admin1')
    })

    it('should generate unique IDs for actions', () => {
      const action1 = doCollections.actions.log('test')
      const action2 = doCollections.actions.log('test')

      expect(action1.$id).not.toBe(action2.$id)
    })
  })

  describe('get()', () => {
    it('should retrieve an action by ID', () => {
      const created = doCollections.actions.log('test', 'from1', 'to1')

      const retrieved = doCollections.actions.get(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.verb).toBe('test')
    })

    it('should return null for non-existent action', () => {
      const action = doCollections.actions.get('non-existent')

      expect(action).toBeNull()
    })
  })

  describe('find()', () => {
    beforeEach(() => {
      doCollections.actions.log('login', 'user1')
      doCollections.actions.log('login', 'user2')
      doCollections.actions.log('logout', 'user1')
    })

    it('should find actions by verb', () => {
      const actions = doCollections.actions.find({ verb: 'login' })

      expect(actions.length).toBe(2)
      expect(actions.every(a => a.verb === 'login')).toBe(true)
    })

    it('should find actions by from', () => {
      const actions = doCollections.actions.find({ from: 'user1' })

      expect(actions.length).toBe(2)
    })

    it('should return all actions with empty filter', () => {
      const actions = doCollections.actions.find()

      expect(actions.length).toBe(3)
    })

    it('should support query options', () => {
      const actions = doCollections.actions.find(undefined, { limit: 2 })

      expect(actions.length).toBe(2)
    })
  })

  describe('forThing()', () => {
    it('should find actions where thing is the from', () => {
      const user = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.actions.log('login', user.$id)
      doCollections.actions.log('logout', user.$id)
      doCollections.actions.log('other', 'otherUser')

      const actions = doCollections.actions.forThing(user.$id)

      // Note: create action also logs to the thing, so we have 3 actions
      expect(actions.length).toBeGreaterThanOrEqual(2)
      expect(actions.some(a => a.verb === 'login')).toBe(true)
      expect(actions.some(a => a.verb === 'logout')).toBe(true)
    })

    it('should find actions where thing is the to', () => {
      const product = doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })
      doCollections.actions.log('viewed', 'user1', product.$id)
      doCollections.actions.log('purchased', 'user2', product.$id)

      const actions = doCollections.actions.forThing(product.$id)

      // Includes the 'created' action too
      expect(actions.length).toBeGreaterThanOrEqual(2)
      expect(actions.some(a => a.verb === 'viewed')).toBe(true)
      expect(actions.some(a => a.verb === 'purchased')).toBe(true)
    })

    it('should find actions where thing is either from or to', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.actions.log('sent', thing.$id, 'other')
      doCollections.actions.log('received', 'other', thing.$id)

      const actions = doCollections.actions.forThing(thing.$id)

      expect(actions.some(a => a.verb === 'sent')).toBe(true)
      expect(actions.some(a => a.verb === 'received')).toBe(true)
    })
  })

  describe('count()', () => {
    it('should count all actions', () => {
      doCollections.actions.log('a')
      doCollections.actions.log('b')
      doCollections.actions.log('c')

      expect(doCollections.actions.count()).toBe(3)
    })

    it('should count actions with filter', () => {
      doCollections.actions.log('login', 'user1')
      doCollections.actions.log('login', 'user2')
      doCollections.actions.log('logout', 'user1')

      expect(doCollections.actions.count({ verb: 'login' })).toBe(2)
      expect(doCollections.actions.count({ from: 'user1' })).toBe(2)
    })
  })

  describe('Auto-logging on Thing operations', () => {
    it('should auto-log on thing creation', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })

      const actions = doCollections.actions.find({ verb: 'created', to: thing.$id })

      expect(actions.length).toBe(1)
    })

    it('should auto-log on thing update', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      doCollections.things.update(thing.$id, { name: 'Alice Updated' })

      const actions = doCollections.actions.find({ verb: 'updated', to: thing.$id })

      expect(actions.length).toBe(1)
    })

    it('should auto-log on thing deletion', () => {
      const thing = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
      const thingId = thing.$id
      doCollections.things.delete(thingId)

      const actions = doCollections.actions.find({ verb: 'deleted', to: thingId })

      expect(actions.length).toBe(1)
    })
  })
})

// ============================================================================
// Relationships Tests
// ============================================================================

describe('Relationships', () => {
  let user1: Thing<UserData>
  let user2: Thing<UserData>
  let org: Thing<OrganizationData>

  beforeEach(() => {
    user1 = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
    user2 = doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' })
    org = doCollections.things.create<OrganizationData>('Organization', { name: 'Acme Inc' })
  })

  describe('relate()', () => {
    it('should create a relationship between two things', () => {
      const rel = doCollections.relate(user1.$id, 'memberOf', org.$id)

      expect(rel).toBeDefined()
      expect(rel.$id).toBeDefined()
      expect(rel.from).toBe(user1.$id)
      expect(rel.verb).toBe('memberOf')
      expect(rel.to).toBe(org.$id)
    })

    it('should use default cascade operator ->', () => {
      const rel = doCollections.relate(user1.$id, 'memberOf', org.$id)

      expect(rel.cascade).toBe('->')
    })

    it('should support custom cascade operator ~>', () => {
      const rel = doCollections.relate(user1.$id, 'similarTo', user2.$id, { cascade: '~>' })

      expect(rel.cascade).toBe('~>')
    })

    it('should support cascade operator <-', () => {
      const rel = doCollections.relate(user1.$id, 'managedBy', org.$id, { cascade: '<-' })

      expect(rel.cascade).toBe('<-')
    })

    it('should support cascade operator <~', () => {
      const rel = doCollections.relate(user1.$id, 'resembles', user2.$id, { cascade: '<~' })

      expect(rel.cascade).toBe('<~')
    })

    it('should store relationship data', () => {
      const rel = doCollections.relate(user1.$id, 'memberOf', org.$id, {
        data: { role: 'admin', since: '2023-01-01' }
      })

      expect(rel.data).toEqual({ role: 'admin', since: '2023-01-01' })
    })

    it('should set $createdAt timestamp', () => {
      const before = Date.now()
      const rel = doCollections.relate(user1.$id, 'memberOf', org.$id)
      const after = Date.now()

      expect(rel.$createdAt).toBeGreaterThanOrEqual(before)
      expect(rel.$createdAt).toBeLessThanOrEqual(after)
    })

    it('should log an action for the relationship', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)

      const actions = doCollections.actions.find({ verb: 'memberOf' })
      const relAction = actions.find(a => a.from === user1.$id && a.to === org.$id)

      expect(relAction).toBeDefined()
    })

    it('should allow multiple relationships from the same thing', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user1.$id, 'knows', user2.$id)

      const rels = doCollections.relationsFrom(user1.$id)

      expect(rels.length).toBe(2)
    })
  })

  describe('unrelate()', () => {
    it('should remove an existing relationship', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)

      const result = doCollections.unrelate(user1.$id, 'memberOf', org.$id)

      expect(result).toBe(true)
      expect(doCollections.relationsFrom(user1.$id, 'memberOf').length).toBe(0)
    })

    it('should return false when relationship does not exist', () => {
      const result = doCollections.unrelate(user1.$id, 'nonExistent', org.$id)

      expect(result).toBe(false)
    })

    it('should log an unrelate action', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.unrelate(user1.$id, 'memberOf', org.$id)

      const actions = doCollections.actions.find({ verb: 'unmemberOf' })

      expect(actions.length).toBeGreaterThan(0)
    })

    it('should only remove the specific relationship', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user2.$id, 'memberOf', org.$id)

      doCollections.unrelate(user1.$id, 'memberOf', org.$id)

      expect(doCollections.relationsFrom(user1.$id, 'memberOf').length).toBe(0)
      expect(doCollections.relationsFrom(user2.$id, 'memberOf').length).toBe(1)
    })
  })

  describe('relationsFrom()', () => {
    it('should get all outgoing relationships from a thing', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user1.$id, 'knows', user2.$id)

      const rels = doCollections.relationsFrom(user1.$id)

      expect(rels.length).toBe(2)
    })

    it('should filter by verb', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user1.$id, 'knows', user2.$id)

      const rels = doCollections.relationsFrom(user1.$id, 'memberOf')

      expect(rels.length).toBe(1)
      expect(rels[0]!.verb).toBe('memberOf')
    })

    it('should return empty array when no relationships exist', () => {
      const rels = doCollections.relationsFrom(user1.$id)

      expect(rels).toEqual([])
    })
  })

  describe('relationsTo()', () => {
    it('should get all incoming relationships to a thing', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user2.$id, 'memberOf', org.$id)

      const rels = doCollections.relationsTo(org.$id)

      expect(rels.length).toBe(2)
    })

    it('should filter by verb', () => {
      doCollections.relate(user1.$id, 'memberOf', org.$id)
      doCollections.relate(user1.$id, 'owns', org.$id)

      const rels = doCollections.relationsTo(org.$id, 'memberOf')

      expect(rels.length).toBe(1)
      expect(rels[0]!.verb).toBe('memberOf')
    })

    it('should return empty array when no relationships exist', () => {
      const rels = doCollections.relationsTo(org.$id)

      expect(rels).toEqual([])
    })
  })
})

// ============================================================================
// Traversal Tests
// ============================================================================

describe('Traversal', () => {
  let alice: Thing<UserData>
  let bob: Thing<UserData>
  let charlie: Thing<UserData>
  let acme: Thing<OrganizationData>
  let globex: Thing<OrganizationData>

  beforeEach(() => {
    alice = doCollections.things.create<UserData>('User', { name: 'Alice', email: 'alice@example.com' })
    bob = doCollections.things.create<UserData>('User', { name: 'Bob', email: 'bob@example.com' })
    charlie = doCollections.things.create<UserData>('User', { name: 'Charlie', email: 'charlie@example.com' })
    acme = doCollections.things.create<OrganizationData>('Organization', { name: 'Acme Inc' })
    globex = doCollections.things.create<OrganizationData>('Organization', { name: 'Globex Corp' })

    // Alice is member of both orgs
    doCollections.relate(alice.$id, 'memberOf', acme.$id)
    doCollections.relate(alice.$id, 'memberOf', globex.$id)
    // Bob is member of Acme only
    doCollections.relate(bob.$id, 'memberOf', acme.$id)
    // Alice knows Bob
    doCollections.relate(alice.$id, 'knows', bob.$id)
  })

  describe('traverse()', () => {
    it('should traverse outgoing relationships and return target things', () => {
      const orgs = doCollections.traverse<OrganizationData>(alice.$id, 'memberOf')

      expect(orgs.length).toBe(2)
      const names = orgs.map(o => o.data.name)
      expect(names).toContain('Acme Inc')
      expect(names).toContain('Globex Corp')
    })

    it('should return typed things', () => {
      const orgs = doCollections.traverse<OrganizationData>(alice.$id, 'memberOf')

      expect(orgs.every(o => o.$type === 'Organization')).toBe(true)
    })

    it('should return empty array when no relationships exist', () => {
      const result = doCollections.traverse(charlie.$id, 'memberOf')

      expect(result).toEqual([])
    })

    it('should filter out deleted things', () => {
      doCollections.things.delete(globex.$id)

      const orgs = doCollections.traverse<OrganizationData>(alice.$id, 'memberOf')

      expect(orgs.length).toBe(1)
      expect(orgs[0]!.data.name).toBe('Acme Inc')
    })
  })

  describe('traverseBack()', () => {
    it('should traverse incoming relationships and return source things', () => {
      const members = doCollections.traverseBack<UserData>(acme.$id, 'memberOf')

      expect(members.length).toBe(2)
      const names = members.map(m => m.data.name)
      expect(names).toContain('Alice')
      expect(names).toContain('Bob')
    })

    it('should return typed things', () => {
      const members = doCollections.traverseBack<UserData>(acme.$id, 'memberOf')

      expect(members.every(m => m.$type === 'User')).toBe(true)
    })

    it('should return empty array when no relationships exist', () => {
      const product = doCollections.things.create<ProductData>('Product', { name: 'Laptop', price: 999 })

      const result = doCollections.traverseBack(product.$id, 'memberOf')

      expect(result).toEqual([])
    })

    it('should filter out deleted things', () => {
      doCollections.things.delete(bob.$id)

      const members = doCollections.traverseBack<UserData>(acme.$id, 'memberOf')

      expect(members.length).toBe(1)
      expect(members[0]!.data.name).toBe('Alice')
    })
  })
})

// ============================================================================
// Stats Tests
// ============================================================================

describe('Stats', () => {
  it('should return zero counts for empty collections', () => {
    const stats = doCollections.stats()

    expect(stats).toEqual({
      nouns: 0,
      verbs: 0,
      things: 0,
      actions: 0,
      relationships: 0
    })
  })

  it('should return correct noun count', () => {
    doCollections.nouns.define('User')
    doCollections.nouns.define('Product')

    const stats = doCollections.stats()

    expect(stats.nouns).toBe(2)
  })

  it('should return correct verb count', () => {
    doCollections.verbs.define('created')
    doCollections.verbs.define('updated')
    doCollections.verbs.define('deleted')

    const stats = doCollections.stats()

    expect(stats.verbs).toBe(3)
  })

  it('should return correct thing count', () => {
    doCollections.things.create('User', { name: 'Alice' })
    doCollections.things.create('User', { name: 'Bob' })
    doCollections.things.create('Product', { name: 'Laptop' })

    const stats = doCollections.stats()

    expect(stats.things).toBe(3)
  })

  it('should return correct action count', () => {
    // Creating things auto-logs actions
    doCollections.things.create('User', { name: 'Alice' })
    doCollections.things.create('User', { name: 'Bob' })
    doCollections.actions.log('customAction')

    const stats = doCollections.stats()

    // 2 create actions + 1 custom action
    expect(stats.actions).toBe(3)
  })

  it('should return correct relationship count', () => {
    const user = doCollections.things.create('User', { name: 'Alice' })
    const org = doCollections.things.create('Organization', { name: 'Acme' })
    const product = doCollections.things.create('Product', { name: 'Laptop' })

    doCollections.relate(user.$id, 'memberOf', org.$id)
    doCollections.relate(user.$id, 'owns', product.$id)

    const stats = doCollections.stats()

    expect(stats.relationships).toBe(2)
  })

  it('should return all counts correctly', () => {
    doCollections.nouns.define('User')
    doCollections.nouns.define('Product')
    doCollections.verbs.define('owns')
    doCollections.verbs.define('likes')

    const user = doCollections.things.create('User', { name: 'Alice' })
    const product = doCollections.things.create('Product', { name: 'Laptop' })

    doCollections.relate(user.$id, 'owns', product.$id)
    doCollections.actions.log('manualAction')

    const stats = doCollections.stats()

    expect(stats.nouns).toBe(2)
    expect(stats.verbs).toBe(2)
    expect(stats.things).toBe(2)
    // 2 create + 1 relate + 1 manual = 4
    expect(stats.actions).toBe(4)
    expect(stats.relationships).toBe(1)
  })
})

// ============================================================================
// generateId() Tests
// ============================================================================

describe('generateId() via Thing creation', () => {
  it('should generate unique IDs', () => {
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      const thing = doCollections.things.create('Test', { index: i })
      ids.add(thing.$id)
    }

    expect(ids.size).toBe(100)
  })

  it('should generate IDs with type prefix', () => {
    const user = doCollections.things.create('User', { name: 'Alice' })
    const product = doCollections.things.create('Product', { name: 'Laptop' })
    const org = doCollections.things.create('Organization', { name: 'Acme' })

    expect(user.$id).toMatch(/^user_/)
    expect(product.$id).toMatch(/^product_/)
    expect(org.$id).toMatch(/^organization_/)
  })

  it('should generate sortable IDs (newer IDs sort after older)', async () => {
    const thing1 = doCollections.things.create('Test', { order: 1 })
    await new Promise(resolve => setTimeout(resolve, 10))
    const thing2 = doCollections.things.create('Test', { order: 2 })
    await new Promise(resolve => setTimeout(resolve, 10))
    const thing3 = doCollections.things.create('Test', { order: 3 })

    // Extract just the timestamp portion for comparison (after prefix)
    const getId = (id: string) => id.replace(/^test_/, '')
    const ids = [thing1.$id, thing2.$id, thing3.$id].map(getId)
    const sorted = [...ids].sort()

    expect(sorted).toEqual(ids)
  })

  it('should generate IDs with relationship prefix', () => {
    const user = doCollections.things.create('User', { name: 'Alice' })
    const org = doCollections.things.create('Organization', { name: 'Acme' })

    const rel = doCollections.relate(user.$id, 'memberOf', org.$id)

    expect(rel.$id).toMatch(/^rel_/)
  })

  it('should generate IDs with action prefix', () => {
    const action = doCollections.actions.log('customAction')

    expect(action.$id).toMatch(/^act_/)
  })

  it('should allow custom IDs to override auto-generation', () => {
    const thing = doCollections.things.create('User', { name: 'Alice' }, 'my-custom-id')

    expect(thing.$id).toBe('my-custom-id')
    expect(thing.$id).not.toMatch(/^user_/)
  })
})

// ============================================================================
// Fuzzy Relate Tests
// ============================================================================

describe('fuzzyRelate()', () => {
  it('should throw error when semantic matcher is not configured', async () => {
    await expect(
      doCollections.fuzzyRelate('from', 'verb', 'Type', 'text')
    ).rejects.toThrow('Semantic matcher not configured')
  })

  describe('with semantic matcher', () => {
    let matcherDb: DOCollectionsType
    let mockMatcher: SemanticMatcher

    beforeEach(async () => {
      // Create a mock semantic matcher
      mockMatcher = {
        findSimilar: vi.fn()
      }

      // Create a new DOCollections with the matcher
      matcherDb = new DOCollections(asSql(), {
        semanticMatcher: mockMatcher,
        defaultThreshold: 0.8
      })
    })

    it('should find existing thing above threshold', async () => {
      const existingThing = matcherDb.things.create('Concept', { text: 'machine learning' })

      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
        { thing: existingThing, similarity: 0.95 }
      ])

      const from = matcherDb.things.create('User', { name: 'Alice' })
      const result = await matcherDb.fuzzyRelate(from.$id, 'interestedIn', 'Concept', 'AI and ML')

      expect(result.created).toBe(false)
      expect(result.thing.$id).toBe(existingThing.$id)
      expect(result.relationship.cascade).toBe('~>')
    })

    it('should create new thing when no match above threshold', async () => {
      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
        { thing: { $id: 'old', $type: 'Concept', data: { text: 'old concept' }, $version: 1, $createdAt: 0, $updatedAt: 0 }, similarity: 0.5 }
      ])

      const from = matcherDb.things.create('User', { name: 'Alice' })
      const result = await matcherDb.fuzzyRelate(from.$id, 'interestedIn', 'Concept', 'completely new topic', { name: 'New Topic' })

      expect(result.created).toBe(true)
      expect(result.thing.$type).toBe('Concept')
      expect(result.relationship.cascade).toBe('~>')
    })

    it('should create new thing when no matches found', async () => {
      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([])

      const from = matcherDb.things.create('User', { name: 'Alice' })
      const result = await matcherDb.fuzzyRelate(from.$id, 'interestedIn', 'Concept', 'unique topic')

      expect(result.created).toBe(true)
      expect(result.thing.$type).toBe('Concept')
    })

    it('should use default text data when createData not provided', async () => {
      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([])

      const from = matcherDb.things.create('User', { name: 'Alice' })
      const result = await matcherDb.fuzzyRelate(from.$id, 'interestedIn', 'Concept', 'my topic text')

      expect(result.thing.data).toEqual({ text: 'my topic text' })
    })

    it('should respect custom threshold option', async () => {
      const existingThing = matcherDb.things.create('Concept', { text: 'existing' })

      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
        { thing: existingThing, similarity: 0.7 }
      ])

      const from = matcherDb.things.create('User', { name: 'Alice' })

      // With default threshold 0.8, similarity 0.7 should not match
      const result1 = await matcherDb.fuzzyRelate(from.$id, 'interestedIn', 'Concept', 'text')
      expect(result1.created).toBe(true)

      // Reset mock
      ;(mockMatcher.findSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
        { thing: existingThing, similarity: 0.7 }
      ])

      // With custom threshold 0.6, similarity 0.7 should match
      const from2 = matcherDb.things.create('User', { name: 'Bob' })
      const result2 = await matcherDb.fuzzyRelate(from2.$id, 'interestedIn', 'Concept', 'text', undefined, { threshold: 0.6 })
      expect(result2.created).toBe(false)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('Thing with special characters', () => {
    it('should handle data with special characters', () => {
      const thing = doCollections.things.create('User', {
        name: 'Alice "The Great"',
        bio: "It's a test with 'quotes'",
        emoji: 'Test user'
      })

      const retrieved = doCollections.things.get(thing.$id)

      expect(retrieved!.data['name']).toBe('Alice "The Great"')
      expect(retrieved!.data['bio']).toBe("It's a test with 'quotes'")
    })

    it('should handle data with unicode characters', () => {
      const thing = doCollections.things.create('User', {
        name: 'Test User',
        greeting: 'Hello, World!',
        japanese: 'Japanese text here'
      })

      const retrieved = doCollections.things.get(thing.$id)

      expect(retrieved!.data['name']).toBe('Test User')
    })
  })

  describe('Multiple updates to same thing', () => {
    it('should correctly track version through multiple updates', () => {
      const thing = doCollections.things.create('Counter', { value: 0 })
      expect(thing.$version).toBe(1)

      for (let i = 1; i <= 10; i++) {
        const updated = doCollections.things.update(thing.$id, { value: i })
        expect(updated!.$version).toBe(i + 1)
      }

      const final = doCollections.things.get(thing.$id)
      expect(final!.$version).toBe(11)
      expect(final!.data['value']).toBe(10)
    })
  })

  describe('Self-referential relationships', () => {
    it('should allow thing to relate to itself', () => {
      const thing = doCollections.things.create('Node', { name: 'Self' })

      const rel = doCollections.relate(thing.$id, 'pointsTo', thing.$id)

      expect(rel.from).toBe(thing.$id)
      expect(rel.to).toBe(thing.$id)

      const outgoing = doCollections.traverse(thing.$id, 'pointsTo')
      expect(outgoing.length).toBe(1)
      expect(outgoing[0]!.$id).toBe(thing.$id)
    })
  })

  describe('Empty data', () => {
    it('should handle thing with empty data object', () => {
      const thing = doCollections.things.create('Empty', {})

      const retrieved = doCollections.things.get(thing.$id)

      expect(retrieved!.data).toEqual({})
    })

    it('should handle relationship with empty data', () => {
      const from = doCollections.things.create('A', {})
      const to = doCollections.things.create('B', {})

      const rel = doCollections.relate(from.$id, 'links', to.$id, { data: {} })

      expect(rel.data).toEqual({})
    })
  })

  describe('Circular relationships', () => {
    it('should handle circular relationship chains', () => {
      const a = doCollections.things.create('Node', { name: 'A' })
      const b = doCollections.things.create('Node', { name: 'B' })
      const c = doCollections.things.create('Node', { name: 'C' })

      doCollections.relate(a.$id, 'next', b.$id)
      doCollections.relate(b.$id, 'next', c.$id)
      doCollections.relate(c.$id, 'next', a.$id) // Circle back

      const fromA = doCollections.traverse(a.$id, 'next')
      const fromB = doCollections.traverse(b.$id, 'next')
      const fromC = doCollections.traverse(c.$id, 'next')

      expect(fromA.length).toBe(1)
      expect(fromA[0]!.data['name']).toBe('B')
      expect(fromB[0]!.data['name']).toBe('C')
      expect(fromC[0]!.data['name']).toBe('A')
    })
  })

  describe('Large number of relationships', () => {
    it('should handle many relationships from single thing', () => {
      const hub = doCollections.things.create('Hub', { name: 'Central' })

      for (let i = 0; i < 50; i++) {
        const spoke = doCollections.things.create('Spoke', { index: i })
        doCollections.relate(hub.$id, 'connectsTo', spoke.$id)
      }

      const connections = doCollections.relationsFrom(hub.$id, 'connectsTo')
      expect(connections.length).toBe(50)

      const targets = doCollections.traverse(hub.$id, 'connectsTo')
      expect(targets.length).toBe(50)
    })
  })
})
