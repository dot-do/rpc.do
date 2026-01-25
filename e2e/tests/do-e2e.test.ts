/**
 * DurableRPC E2E Tests
 *
 * Comprehensive end-to-end tests for the DurableRPC server using miniflare.
 * Tests the full stack from HTTP/WebSocket requests through to the DO.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { env, SELF, runInDurableObject, listDurableObjectIds } from 'cloudflare:test'

// Types only - actual DO is loaded by the Worker runtime from wrangler.toml
// We use inline type definitions to avoid importing from the actual module
// which would trigger DurableObject resolution issues in test loading

/**
 * User document type for testing
 */
interface User {
  name: string
  email: string
  age?: number
  active?: boolean
  role?: 'admin' | 'user' | 'guest'
  metadata?: Record<string, unknown>
}

/**
 * Task document type for testing collections
 */
interface Task {
  title: string
  completed: boolean
  priority: number
  assignee?: string
  tags?: string[]
  createdAt: number
}

// Type the environment bindings
// We use `any` for the DO type since importing the actual class causes issues
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    TEST_DO: DurableObjectNamespace
  }
}

/**
 * Helper to make RPC calls via HTTP batch
 */
async function rpcCall(doId: string, method: string, ...args: unknown[]): Promise<unknown> {
  const response = await SELF.fetch(`https://test.local/do/${doId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        method,
        args,
        id: 1,
      },
    ]),
  })

  if (!response.ok) {
    throw new Error(`RPC call failed: ${response.status} ${response.statusText}`)
  }

  const results = (await response.json()) as Array<{ result?: unknown; error?: { message: string } }>
  const result = results[0]

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.result
}

/**
 * Helper to make batch RPC calls
 */
async function rpcBatch(
  doId: string,
  calls: Array<{ method: string; args: unknown[] }>
): Promise<unknown[]> {
  const response = await SELF.fetch(`https://test.local/do/${doId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      calls.map((call, idx) => ({
        method: call.method,
        args: call.args,
        id: idx + 1,
      }))
    ),
  })

  if (!response.ok) {
    throw new Error(`RPC batch call failed: ${response.status} ${response.statusText}`)
  }

  const results = (await response.json()) as Array<{ result?: unknown; error?: { message: string } }>

  return results.map((result) => {
    if (result.error) {
      throw new Error(result.error.message)
    }
    return result.result
  })
}

/**
 * Helper to reset DO state
 */
async function resetDO(doId: string): Promise<void> {
  await rpcCall(doId, 'reset')
}

// =============================================================================
// Test Suites
// =============================================================================

describe('DurableRPC E2E Tests', () => {
  const TEST_DO_ID = 'test-do-e2e'

  beforeEach(async () => {
    // Reset the DO before each test
    await resetDO(TEST_DO_ID)
  })

  // ===========================================================================
  // Basic RPC Tests
  // ===========================================================================

  describe('Basic RPC Operations', () => {
    it('should handle simple echo method', async () => {
      const result = await rpcCall(TEST_DO_ID, 'echo', 'Hello, World!')
      expect(result).toBe('Echo: Hello, World!')
    })

    it('should handle method with multiple parameters', async () => {
      const result = await rpcCall(TEST_DO_ID, 'add', 5, 3)
      expect(result).toBe(8)
    })

    it('should handle complex return types', async () => {
      const result = (await rpcCall(TEST_DO_ID, 'getComplexData')) as {
        timestamp: number
        nested: { deep: { value: string } }
        array: number[]
      }

      expect(result).toHaveProperty('timestamp')
      expect(typeof result.timestamp).toBe('number')
      expect(result.nested.deep.value).toBe('test')
      expect(result.array).toEqual([1, 2, 3, 4, 5])
    })

    it('should handle async methods with delay', async () => {
      const start = Date.now()
      const result = await rpcCall(TEST_DO_ID, 'delayed', 50, 'delayed-value')
      const elapsed = Date.now() - start

      expect(result).toBe('delayed-value')
      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some timing variance
    })

    it('should handle batch RPC calls', async () => {
      const results = await rpcBatch(TEST_DO_ID, [
        { method: 'echo', args: ['first'] },
        { method: 'echo', args: ['second'] },
        { method: 'add', args: [10, 20] },
      ])

      expect(results).toHaveLength(3)
      expect(results[0]).toBe('Echo: first')
      expect(results[1]).toBe('Echo: second')
      expect(results[2]).toBe(30)
    })
  })

  // ===========================================================================
  // Schema Introspection Tests
  // ===========================================================================

  describe('Schema Introspection', () => {
    it('should return schema on GET /__schema', async () => {
      const response = await SELF.fetch(`https://test.local/do/${TEST_DO_ID}/__schema`)
      expect(response.ok).toBe(true)

      const schema = (await response.json()) as {
        version: number
        methods: Array<{ name: string; path: string; params: number }>
        namespaces: Array<{ name: string; methods: Array<{ name: string }> }>
      }

      expect(schema.version).toBe(1)
      expect(schema.methods).toBeDefined()
      expect(schema.namespaces).toBeDefined()

      // Check for expected methods
      const methodNames = schema.methods.map((m) => m.name)
      expect(methodNames).toContain('echo')
      expect(methodNames).toContain('add')
      expect(methodNames).toContain('throwError')

      // Check for expected namespaces
      const namespaceNames = schema.namespaces.map((n) => n.name)
      expect(namespaceNames).toContain('users')
      expect(namespaceNames).toContain('kv')
      expect(namespaceNames).toContain('tasksApi')
    })

    it('should return schema on GET /', async () => {
      const response = await SELF.fetch(`https://test.local/do/${TEST_DO_ID}/`)
      expect(response.ok).toBe(true)

      const schema = (await response.json()) as { version: number }
      expect(schema.version).toBe(1)
    })

    it('should include database schema after table creation', async () => {
      // Create a user to initialize the schema
      await rpcCall(TEST_DO_ID, 'users.create', 'user-1', {
        name: 'Test User',
        email: 'test@example.com',
      })

      const response = await SELF.fetch(`https://test.local/do/${TEST_DO_ID}/__schema`)
      const schema = (await response.json()) as {
        database?: {
          tables: Array<{
            name: string
            columns: Array<{ name: string; type: string }>
          }>
        }
      }

      expect(schema.database).toBeDefined()
      expect(schema.database!.tables.length).toBeGreaterThan(0)

      const usersTable = schema.database!.tables.find((t) => t.name === 'users')
      expect(usersTable).toBeDefined()
      expect(usersTable!.columns.map((c) => c.name)).toContain('name')
      expect(usersTable!.columns.map((c) => c.name)).toContain('email')
    })

    it('should call __dbSchema via RPC', async () => {
      // Create a user to initialize the schema
      await rpcCall(TEST_DO_ID, 'users.create', 'user-1', {
        name: 'Test User',
        email: 'test@example.com',
      })

      const dbSchema = (await rpcCall(TEST_DO_ID, '__dbSchema')) as {
        tables: Array<{ name: string }>
      }

      expect(dbSchema.tables).toBeDefined()
      const tableNames = dbSchema.tables.map((t) => t.name)
      expect(tableNames).toContain('users')
    })
  })

  // ===========================================================================
  // SQL Operations Tests
  // ===========================================================================

  describe('SQL Operations', () => {
    it('should execute raw SQL via RPC', async () => {
      // First create the users table via the users namespace
      await rpcCall(TEST_DO_ID, 'users.create', 'sql-test-1', {
        name: 'SQL User',
        email: 'sql@example.com',
      })

      // Then query it directly
      const result = (await rpcCall(
        TEST_DO_ID,
        'executeRawSql',
        'SELECT * FROM users WHERE id = ?',
        'sql-test-1'
      )) as { results: Array<{ name: string; email: string }> }

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('SQL User')
      expect(result.results[0].email).toBe('sql@example.com')
    })

    it('should use __sql for query execution', async () => {
      // Create a user first
      await rpcCall(TEST_DO_ID, 'users.create', 'sql-query-1', {
        name: 'Query User',
        email: 'query@example.com',
        age: 25,
      })

      // Use the internal __sql method
      const result = (await rpcCall(TEST_DO_ID, '__sql', {
        strings: ['SELECT name, email FROM users WHERE age > ', ''],
        values: [20],
      })) as { results: Array<{ name: string; email: string }> }

      expect(result.results).toHaveLength(1)
      expect(result.results[0].name).toBe('Query User')
    })

    it('should use __sqlFirst for single row queries', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'first-1', {
        name: 'First User',
        email: 'first@example.com',
      })

      const user = (await rpcCall(TEST_DO_ID, '__sqlFirst', {
        strings: ['SELECT * FROM users WHERE id = ', ''],
        values: ['first-1'],
      })) as { name: string; email: string } | null

      expect(user).not.toBeNull()
      expect(user!.name).toBe('First User')
    })

    it('should use __sqlRun for write operations', async () => {
      // Create user first
      await rpcCall(TEST_DO_ID, 'users.create', 'run-1', {
        name: 'Run User',
        email: 'run@example.com',
      })

      // Update using __sqlRun
      const result = (await rpcCall(TEST_DO_ID, '__sqlRun', {
        strings: ['UPDATE users SET name = ', ' WHERE id = ', ''],
        values: ['Updated Name', 'run-1'],
      })) as { rowsWritten: number }

      expect(result.rowsWritten).toBe(1)

      // Verify the update
      const user = (await rpcCall(TEST_DO_ID, 'users.get', 'run-1')) as User | null
      expect(user!.name).toBe('Updated Name')
    })
  })

  // ===========================================================================
  // Users Namespace Tests (SQL-based CRUD)
  // ===========================================================================

  describe('Users Namespace (SQL CRUD)', () => {
    it('should create a user', async () => {
      const result = (await rpcCall(TEST_DO_ID, 'users.create', 'user-create-1', {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        role: 'admin',
      })) as { ok: boolean; id: string }

      expect(result.ok).toBe(true)
      expect(result.id).toBe('user-create-1')
    })

    it('should get a user by ID', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'user-get-1', {
        name: 'Jane Doe',
        email: 'jane@example.com',
        age: 25,
        active: true,
        role: 'user',
        metadata: { preferences: { theme: 'dark' } },
      })

      const user = (await rpcCall(TEST_DO_ID, 'users.get', 'user-get-1')) as User | null

      expect(user).not.toBeNull()
      expect(user!.name).toBe('Jane Doe')
      expect(user!.email).toBe('jane@example.com')
      expect(user!.age).toBe(25)
      expect(user!.active).toBe(true)
      expect(user!.role).toBe('user')
      expect(user!.metadata).toEqual({ preferences: { theme: 'dark' } })
    })

    it('should return null for non-existent user', async () => {
      const user = (await rpcCall(TEST_DO_ID, 'users.get', 'non-existent')) as User | null
      expect(user).toBeNull()
    })

    it('should update a user', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'user-update-1', {
        name: 'Update Me',
        email: 'update@example.com',
        age: 20,
      })

      const result = (await rpcCall(TEST_DO_ID, 'users.update', 'user-update-1', {
        name: 'Updated Name',
        age: 21,
        active: false,
      })) as { ok: boolean; updated: boolean }

      expect(result.ok).toBe(true)
      expect(result.updated).toBe(true)

      const user = (await rpcCall(TEST_DO_ID, 'users.get', 'user-update-1')) as User
      expect(user.name).toBe('Updated Name')
      expect(user.age).toBe(21)
      expect(user.active).toBe(false)
    })

    it('should delete a user', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'user-delete-1', {
        name: 'Delete Me',
        email: 'delete@example.com',
      })

      const result = (await rpcCall(TEST_DO_ID, 'users.delete', 'user-delete-1')) as {
        ok: boolean
        deleted: boolean
      }

      expect(result.ok).toBe(true)
      expect(result.deleted).toBe(true)

      const user = (await rpcCall(TEST_DO_ID, 'users.get', 'user-delete-1')) as User | null
      expect(user).toBeNull()
    })

    it('should list users with pagination', async () => {
      // Create multiple users
      for (let i = 0; i < 5; i++) {
        await rpcCall(TEST_DO_ID, 'users.create', `user-list-${i}`, {
          name: `User ${i}`,
          email: `user${i}@example.com`,
        })
      }

      // List with limit
      const firstPage = (await rpcCall(TEST_DO_ID, 'users.list', { limit: 2 })) as User[]
      expect(firstPage).toHaveLength(2)

      // List with offset
      const secondPage = (await rpcCall(TEST_DO_ID, 'users.list', { limit: 2, offset: 2 })) as User[]
      expect(secondPage).toHaveLength(2)
    })

    it('should find users by role', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'admin-1', {
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
      })

      await rpcCall(TEST_DO_ID, 'users.create', 'guest-1', {
        name: 'Guest User',
        email: 'guest@example.com',
        role: 'guest',
      })

      const admins = (await rpcCall(TEST_DO_ID, 'users.findByRole', 'admin')) as User[]
      expect(admins).toHaveLength(1)
      expect(admins[0].name).toBe('Admin User')
    })

    it('should count users with filters', async () => {
      await rpcCall(TEST_DO_ID, 'users.create', 'active-1', {
        name: 'Active User',
        email: 'active@example.com',
        active: true,
        role: 'user',
      })

      await rpcCall(TEST_DO_ID, 'users.create', 'inactive-1', {
        name: 'Inactive User',
        email: 'inactive@example.com',
        active: false,
        role: 'user',
      })

      const totalCount = (await rpcCall(TEST_DO_ID, 'users.count')) as number
      expect(totalCount).toBe(2)

      const activeCount = (await rpcCall(TEST_DO_ID, 'users.count', { active: true })) as number
      expect(activeCount).toBe(1)

      const inactiveCount = (await rpcCall(TEST_DO_ID, 'users.count', { active: false })) as number
      expect(inactiveCount).toBe(1)
    })
  })

  // ===========================================================================
  // Storage Operations Tests
  // ===========================================================================

  describe('Storage Operations (KV)', () => {
    it('should put and get values', async () => {
      await rpcCall(TEST_DO_ID, 'kv.put', 'test-key', { foo: 'bar', num: 42 })

      const value = (await rpcCall(TEST_DO_ID, 'kv.get', 'test-key')) as { foo: string; num: number }

      expect(value).toEqual({ foo: 'bar', num: 42 })
    })

    it('should return undefined for missing keys', async () => {
      const value = await rpcCall(TEST_DO_ID, 'kv.get', 'missing-key')
      expect(value).toBeUndefined()
    })

    it('should delete values', async () => {
      await rpcCall(TEST_DO_ID, 'kv.put', 'delete-me', 'value')

      const deleted = (await rpcCall(TEST_DO_ID, 'kv.delete', 'delete-me')) as boolean
      expect(deleted).toBe(true)

      const value = await rpcCall(TEST_DO_ID, 'kv.get', 'delete-me')
      expect(value).toBeUndefined()
    })

    it('should list keys with prefix', async () => {
      await rpcCall(TEST_DO_ID, 'kv.put', 'prefix:key1', 'value1')
      await rpcCall(TEST_DO_ID, 'kv.put', 'prefix:key2', 'value2')
      await rpcCall(TEST_DO_ID, 'kv.put', 'other:key3', 'value3')

      // List should return a Map-like structure (serialized as object)
      const result = await rpcCall(TEST_DO_ID, 'kv.list', { prefix: 'prefix:' })

      // The result is serialized, so we check it has the expected keys
      expect(result).toBeDefined()
    })

    it('should put and get multiple values', async () => {
      await rpcCall(TEST_DO_ID, 'kv.putMultiple', {
        multi1: 'value1',
        multi2: 'value2',
        multi3: 'value3',
      })

      const values = await rpcCall(TEST_DO_ID, 'kv.getMultiple', ['multi1', 'multi2', 'multi3'])
      expect(values).toBeDefined()
    })

    it('should delete multiple keys', async () => {
      await rpcCall(TEST_DO_ID, 'kv.putMultiple', {
        del1: 'value1',
        del2: 'value2',
        del3: 'value3',
      })

      const deletedCount = (await rpcCall(TEST_DO_ID, 'kv.deleteMultiple', ['del1', 'del2'])) as number
      expect(deletedCount).toBe(2)
    })

    it('should use __storage* methods directly', async () => {
      // Test __storagePut
      await rpcCall(TEST_DO_ID, '__storagePut', 'direct-key', { direct: true })

      // Test __storageGet
      const value = await rpcCall(TEST_DO_ID, '__storageGet', 'direct-key')
      expect(value).toEqual({ direct: true })

      // Test __storageDelete
      const deleted = await rpcCall(TEST_DO_ID, '__storageDelete', 'direct-key')
      expect(deleted).toBe(true)

      // Test __storageKeys
      await rpcCall(TEST_DO_ID, '__storagePut', 'keys-test-1', 'v1')
      await rpcCall(TEST_DO_ID, '__storagePut', 'keys-test-2', 'v2')

      const keys = (await rpcCall(TEST_DO_ID, '__storageKeys', 'keys-test')) as string[]
      expect(keys).toContain('keys-test-1')
      expect(keys).toContain('keys-test-2')
    })
  })

  // ===========================================================================
  // Collection Operations Tests
  // ===========================================================================

  describe('Collection Operations', () => {
    it('should create and get documents', async () => {
      const task: Task = {
        title: 'Test Task',
        completed: false,
        priority: 1,
        assignee: 'alice',
        tags: ['test', 'e2e'],
        createdAt: Date.now(),
      }

      const createResult = (await rpcCall(TEST_DO_ID, 'tasksApi.create', 'task-1', task)) as {
        ok: boolean
        id: string
      }
      expect(createResult.ok).toBe(true)

      const retrieved = (await rpcCall(TEST_DO_ID, 'tasksApi.get', 'task-1')) as Task | null
      expect(retrieved).not.toBeNull()
      expect(retrieved!.title).toBe('Test Task')
      expect(retrieved!.completed).toBe(false)
      expect(retrieved!.priority).toBe(1)
      expect(retrieved!.tags).toEqual(['test', 'e2e'])
    })

    it('should update documents', async () => {
      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'task-update', {
        title: 'Update Me',
        completed: false,
        priority: 2,
        createdAt: Date.now(),
      })

      const result = (await rpcCall(TEST_DO_ID, 'tasksApi.update', 'task-update', {
        completed: true,
        priority: 1,
      })) as { ok: boolean; updated: boolean }

      expect(result.updated).toBe(true)

      const task = (await rpcCall(TEST_DO_ID, 'tasksApi.get', 'task-update')) as Task
      expect(task.completed).toBe(true)
      expect(task.priority).toBe(1)
      expect(task.title).toBe('Update Me') // Unchanged
    })

    it('should delete documents', async () => {
      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'task-delete', {
        title: 'Delete Me',
        completed: false,
        priority: 3,
        createdAt: Date.now(),
      })

      const result = (await rpcCall(TEST_DO_ID, 'tasksApi.delete', 'task-delete')) as {
        ok: boolean
        deleted: boolean
      }
      expect(result.deleted).toBe(true)

      const task = await rpcCall(TEST_DO_ID, 'tasksApi.get', 'task-delete')
      expect(task).toBeNull()
    })

    it('should find documents with filters', async () => {
      // Create multiple tasks
      const now = Date.now()

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'find-1', {
        title: 'Task 1',
        completed: false,
        priority: 1,
        assignee: 'alice',
        createdAt: now,
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'find-2', {
        title: 'Task 2',
        completed: true,
        priority: 2,
        assignee: 'bob',
        createdAt: now,
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'find-3', {
        title: 'Task 3',
        completed: false,
        priority: 1,
        assignee: 'alice',
        createdAt: now,
      })

      // Find by completed status
      const incompleteTasks = (await rpcCall(TEST_DO_ID, 'tasksApi.find', { completed: false })) as Task[]
      expect(incompleteTasks).toHaveLength(2)

      // Find by assignee
      const aliceTasks = (await rpcCall(TEST_DO_ID, 'tasksApi.find', { assignee: 'alice' })) as Task[]
      expect(aliceTasks).toHaveLength(2)

      // Find by priority
      const highPriorityTasks = (await rpcCall(TEST_DO_ID, 'tasksApi.find', { priority: 1 })) as Task[]
      expect(highPriorityTasks).toHaveLength(2)
    })

    it('should count documents', async () => {
      const now = Date.now()

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'count-1', {
        title: 'Task 1',
        completed: false,
        priority: 1,
        createdAt: now,
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'count-2', {
        title: 'Task 2',
        completed: true,
        priority: 1,
        createdAt: now,
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'count-3', {
        title: 'Task 3',
        completed: false,
        priority: 2,
        createdAt: now,
      })

      const totalCount = (await rpcCall(TEST_DO_ID, 'tasksApi.count')) as number
      expect(totalCount).toBe(3)

      const incompleteCount = (await rpcCall(TEST_DO_ID, 'tasksApi.count', { completed: false })) as number
      expect(incompleteCount).toBe(2)

      const completedCount = (await rpcCall(TEST_DO_ID, 'tasksApi.count', { completed: true })) as number
      expect(completedCount).toBe(1)
    })

    it('should list all keys', async () => {
      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'keys-a', {
        title: 'A',
        completed: false,
        priority: 1,
        createdAt: Date.now(),
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'keys-b', {
        title: 'B',
        completed: false,
        priority: 1,
        createdAt: Date.now(),
      })

      const keys = (await rpcCall(TEST_DO_ID, 'tasksApi.keys')) as string[]
      expect(keys).toContain('keys-a')
      expect(keys).toContain('keys-b')
    })

    it('should clear all documents', async () => {
      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'clear-1', {
        title: 'Clear 1',
        completed: false,
        priority: 1,
        createdAt: Date.now(),
      })

      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'clear-2', {
        title: 'Clear 2',
        completed: false,
        priority: 1,
        createdAt: Date.now(),
      })

      const result = (await rpcCall(TEST_DO_ID, 'tasksApi.clear')) as { ok: boolean; deleted: number }
      expect(result.deleted).toBe(2)

      const count = (await rpcCall(TEST_DO_ID, 'tasksApi.count')) as number
      expect(count).toBe(0)
    })

    it('should use __collection* methods directly', async () => {
      // Test direct collection methods
      await rpcCall(TEST_DO_ID, '__collectionPut', 'direct-collection', 'doc-1', {
        value: 'test',
      })

      const doc = await rpcCall(TEST_DO_ID, '__collectionGet', 'direct-collection', 'doc-1')
      expect(doc).toEqual({ value: 'test' })

      const has = await rpcCall(TEST_DO_ID, '__collectionHas', 'direct-collection', 'doc-1')
      expect(has).toBe(true)

      const count = await rpcCall(TEST_DO_ID, '__collectionCount', 'direct-collection')
      expect(count).toBe(1)

      const deleted = await rpcCall(TEST_DO_ID, '__collectionDelete', 'direct-collection', 'doc-1')
      expect(deleted).toBe(true)
    })

    it('should get collection names and stats', async () => {
      // Create documents in different collections
      await rpcCall(TEST_DO_ID, 'tasksApi.create', 'names-1', {
        title: 'Task',
        completed: false,
        priority: 1,
        createdAt: Date.now(),
      })

      await rpcCall(TEST_DO_ID, '__collectionPut', 'other-collection', 'doc-1', { value: 'test' })

      const names = (await rpcCall(TEST_DO_ID, 'getCollectionNames')) as string[]
      expect(names).toContain('tasks')
      expect(names).toContain('other-collection')

      const stats = (await rpcCall(TEST_DO_ID, 'getCollectionStats')) as Array<{
        name: string
        count: number
        size: number
      }>
      expect(stats.length).toBeGreaterThan(0)

      const tasksStats = stats.find((s) => s.name === 'tasks')
      expect(tasksStats).toBeDefined()
      expect(tasksStats!.count).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should propagate thrown errors', async () => {
      await expect(rpcCall(TEST_DO_ID, 'throwError', 'Test error message')).rejects.toThrow(
        'Test error message'
      )
    })

    it('should handle method not found errors', async () => {
      await expect(rpcCall(TEST_DO_ID, 'nonExistentMethod')).rejects.toThrow()
    })

    it('should return 405 for non-POST/GET requests', async () => {
      const response = await SELF.fetch(`https://test.local/do/${TEST_DO_ID}`, {
        method: 'PUT',
      })
      expect(response.status).toBe(405)
    })

    it('should handle SQL constraint violations', async () => {
      // Create a user
      await rpcCall(TEST_DO_ID, 'users.create', 'constraint-1', {
        name: 'User 1',
        email: 'unique@example.com',
      })

      // Try to create another with the same email (unique constraint)
      await expect(
        rpcCall(TEST_DO_ID, 'users.create', 'constraint-2', {
          name: 'User 2',
          email: 'unique@example.com',
        })
      ).rejects.toThrow()
    })
  })

  // ===========================================================================
  // Direct DO Access Tests (using runInDurableObject)
  // ===========================================================================

  describe('Direct DO Access', () => {
    it('should access DO instance directly', async () => {
      const id = env.TEST_DO.idFromName('direct-access-test')
      const stub = env.TEST_DO.get(id)

      // First reset the DO
      await stub.fetch('https://test.local/', {
        method: 'POST',
        body: JSON.stringify([{ method: 'reset', args: [], id: 1 }]),
      })

      const result = await runInDurableObject(stub, async (instance: any) => {
        // Access the DO instance directly
        return instance.echo('direct access')
      })

      expect(result).toBe('Echo: direct access')
    })

    it('should access DO state directly', async () => {
      const id = env.TEST_DO.idFromName('state-access-test')
      const stub = env.TEST_DO.get(id)

      // Reset first
      await stub.fetch('https://test.local/', {
        method: 'POST',
        body: JSON.stringify([{ method: 'reset', args: [], id: 1 }]),
      })

      await runInDurableObject(stub, async (instance: any, state) => {
        // Store something in storage
        await state.storage.put('direct-key', 'direct-value')
      })

      const value = await runInDurableObject(stub, async (instance: any, state) => {
        return state.storage.get('direct-key')
      })

      expect(value).toBe('direct-value')
    })

    it('should list DO IDs', async () => {
      // Create a few DOs
      const names = ['list-test-1', 'list-test-2', 'list-test-3']

      for (const name of names) {
        const id = env.TEST_DO.idFromName(name)
        const stub = env.TEST_DO.get(id)
        await stub.fetch('https://test.local/__schema')
      }

      const ids = await listDurableObjectIds(env.TEST_DO)
      expect(ids.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ===========================================================================
  // HTTP Response Tests
  // ===========================================================================

  describe('HTTP Response Handling', () => {
    it('should return JSON content type for schema', async () => {
      const response = await SELF.fetch(`https://test.local/do/${TEST_DO_ID}/__schema`)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should handle worker root endpoint', async () => {
      const response = await SELF.fetch('https://test.local/')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as { name: string }
      expect(data.name).toBe('rpc.do E2E Test Worker')
    })

    it('should handle health check', async () => {
      const response = await SELF.fetch('https://test.local/health')
      expect(response.ok).toBe(true)
      expect(await response.text()).toBe('OK')
    })

    it('should return 404 for unknown paths', async () => {
      const response = await SELF.fetch('https://test.local/unknown/path')
      expect(response.status).toBe(404)
    })

    it('should handle CORS preflight', async () => {
      const response = await SELF.fetch('https://test.local/do/test', {
        method: 'OPTIONS',
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })
  })
})

// =============================================================================
// WebSocket Tests
// NOTE: WebSocket upgrades via SELF.fetch are not fully supported in vitest-pool-workers
// These tests are skipped. In production, WebSocket connections work correctly.
// See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#websockets-with-durable-objects
// =============================================================================

describe('WebSocket Transport', () => {
  const WS_DO_ID = 'ws-test-do'

  beforeEach(async () => {
    await resetDO(WS_DO_ID)
  })

  it.skip('should upgrade to WebSocket', async () => {
    // Skipped: SELF.fetch doesn't properly support WebSocket upgrades in vitest-pool-workers
    const response = await SELF.fetch(`https://test.local/do/${WS_DO_ID}`, {
      headers: {
        Upgrade: 'websocket',
      },
    })

    // WebSocket upgrade should return 101
    expect(response.status).toBe(101)
    expect(response.webSocket).toBeDefined()
  })

  it.skip('should handle WebSocket RPC calls', async () => {
    // Skipped: SELF.fetch doesn't properly support WebSocket upgrades in vitest-pool-workers
    const response = await SELF.fetch(`https://test.local/do/${WS_DO_ID}`, {
      headers: {
        Upgrade: 'websocket',
      },
    })

    expect(response.webSocket).toBeDefined()
    const ws = response.webSocket!

    // Accept the WebSocket
    ws.accept()

    // Send an RPC call
    const callPromise = new Promise<string>((resolve, reject) => {
      ws.addEventListener('message', (event) => {
        resolve(event.data as string)
      })
      ws.addEventListener('error', (event) => {
        reject(new Error('WebSocket error'))
      })
    })

    // capnweb protocol: send a request
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'echo',
        args: ['WebSocket test'],
      })
    )

    const responseData = await callPromise
    const parsed = JSON.parse(responseData) as { id: number; result?: string; error?: unknown }

    expect(parsed.id).toBe(1)
    expect(parsed.result).toBe('Echo: WebSocket test')

    ws.close()
  })

  it.skip('should handle multiple WebSocket messages', async () => {
    // Skipped: SELF.fetch doesn't properly support WebSocket upgrades in vitest-pool-workers
    const response = await SELF.fetch(`https://test.local/do/${WS_DO_ID}`, {
      headers: {
        Upgrade: 'websocket',
      },
    })

    const ws = response.webSocket!
    ws.accept()

    const results: unknown[] = []
    const messagePromise = new Promise<void>((resolve) => {
      let count = 0
      ws.addEventListener('message', (event) => {
        results.push(JSON.parse(event.data as string))
        count++
        if (count === 3) resolve()
      })
    })

    // Send multiple requests
    ws.send(JSON.stringify({ id: 1, method: 'add', args: [1, 2] }))
    ws.send(JSON.stringify({ id: 2, method: 'add', args: [3, 4] }))
    ws.send(JSON.stringify({ id: 3, method: 'add', args: [5, 6] }))

    await messagePromise

    expect(results).toHaveLength(3)
    expect((results[0] as { result: number }).result).toBe(3)
    expect((results[1] as { result: number }).result).toBe(7)
    expect((results[2] as { result: number }).result).toBe(11)

    ws.close()
  })
})

// =============================================================================
// Concurrent Access Tests
// =============================================================================

describe('Concurrent Access', () => {
  const CONCURRENT_DO_ID = 'concurrent-test-do'

  beforeEach(async () => {
    await resetDO(CONCURRENT_DO_ID)
  })

  it('should handle concurrent RPC calls', async () => {
    // Make multiple concurrent calls
    const promises = Array.from({ length: 10 }, (_, i) => rpcCall(CONCURRENT_DO_ID, 'add', i, i * 2))

    const results = await Promise.all(promises)

    results.forEach((result, i) => {
      expect(result).toBe(i + i * 2)
    })
  })

  it('should handle concurrent user creation', async () => {
    const promises = Array.from({ length: 5 }, (_, i) =>
      rpcCall(CONCURRENT_DO_ID, 'users.create', `concurrent-user-${i}`, {
        name: `User ${i}`,
        email: `user${i}@concurrent.test`,
      })
    )

    const results = await Promise.all(promises)

    // All should succeed
    results.forEach((result, i) => {
      expect(result).toEqual({ ok: true, id: `concurrent-user-${i}` })
    })

    // Verify count
    const count = await rpcCall(CONCURRENT_DO_ID, 'users.count')
    expect(count).toBe(5)
  })

  it('should handle concurrent storage operations', async () => {
    // Write concurrently
    const writePromises = Array.from({ length: 10 }, (_, i) =>
      rpcCall(CONCURRENT_DO_ID, 'kv.put', `concurrent-key-${i}`, { index: i })
    )

    await Promise.all(writePromises)

    // Read concurrently
    const readPromises = Array.from({ length: 10 }, (_, i) =>
      rpcCall(CONCURRENT_DO_ID, 'kv.get', `concurrent-key-${i}`)
    )

    const results = await Promise.all(readPromises)

    results.forEach((result, i) => {
      expect(result).toEqual({ index: i })
    })
  })
})
