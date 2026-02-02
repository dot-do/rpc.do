/**
 * E2E Tests for DurableRPC
 *
 * Tests the REAL @dotdo/rpc implementation using vitest-pool-workers.
 * Uses the actual RPC client to communicate with DurableRPC.
 */

import { env, SELF, runInDurableObject } from 'cloudflare:test'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TestDO } from '../src/index'

/** Shape of the RPC schema response from GET /do/:name */
interface RpcSchemaResponse {
  version: number
  methods: Array<{ name: string; [key: string]: unknown }>
  namespaces: Array<{ name: string; methods: Array<{ name: string; [key: string]: unknown }>; [key: string]: unknown }>
  database?: { tables: unknown[] }
  [key: string]: unknown
}

describe('DurableRPC E2E Tests', () => {
  // ============================================================================
  // Schema Introspection (GET request)
  // ============================================================================

  describe('Schema', () => {
    it('GET / returns schema', async () => {
      const response = await SELF.fetch('http://localhost/do/test')
      expect(response.status).toBe(200)

      const schema = await response.json() as RpcSchemaResponse
      expect(schema.version).toBe(1)
      expect(schema.methods).toBeDefined()
      expect(schema.namespaces).toBeDefined()
    })

    it('schema includes user-defined methods', async () => {
      const response = await SELF.fetch('http://localhost/do/test')
      const schema = await response.json() as RpcSchemaResponse

      // Check for echo method
      const echoMethod = schema.methods.find((m) => m.name === 'echo')
      expect(echoMethod).toBeDefined()

      // Check for users namespace
      const usersNs = schema.namespaces.find((n) => n.name === 'users')
      expect(usersNs).toBeDefined()
      expect(usersNs!.methods.some((m) => m.name === 'create')).toBe(true)

      // Check for tasks namespace (collection-backed)
      const tasksNs = schema.namespaces.find((n) => n.name === 'tasks')
      expect(tasksNs).toBeDefined()
    })
  })

  // ============================================================================
  // RPC Client Tests
  // ============================================================================

  // Note: HTTP RPC Client tests are skipped in vitest-pool-workers because:
  // 1. capnweb http transport uses global fetch which doesn't route through SELF.fetch
  // 2. capnweb uses a specific text-based protocol format for HTTP batching
  //
  // True E2E tests of the RPC client should be run against a deployed worker.
  // The tests below use runInDurableObject which validates the REAL DurableRPC
  // implementation directly, which is the primary goal of this test suite.

  // ============================================================================
  // Direct DO Access (runInDurableObject) - Tests core functionality
  // ============================================================================

  describe('Direct DO Access', () => {
    it('can access DO directly', async () => {
      const id = env.TEST_DO.idFromName('direct-test')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        return instance.echo('direct access works')
      })

      expect(result).toBe('direct access works')
    })

    it('add method works', async () => {
      const id = env.TEST_DO.idFromName('direct-test')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        return instance.add(10, 20)
      })

      expect(result).toBe(30)
    })

    it('can use SQL directly', async () => {
      const id = env.TEST_DO.idFromName('direct-sql-test')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        instance.sql.exec(`CREATE TABLE IF NOT EXISTS direct_test (id TEXT PRIMARY KEY, value TEXT)`)
        instance.sql.exec(`INSERT OR REPLACE INTO direct_test (id, value) VALUES ('key1', 'value1')`)
        const rows = instance.sql.exec<{ id: string; value: string }>(`SELECT * FROM direct_test`).toArray()
        return rows
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ id: 'key1', value: 'value1' })
    })

    it('can use collections directly', async () => {
      const id = env.TEST_DO.idFromName('direct-coll-test')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ name: string }>('direct-items')
        coll.put('item1', { name: 'Test Item' })
        return coll.get('item1')
      })

      expect(result).toEqual({ name: 'Test Item' })
    })

    it('collection find works', async () => {
      const id = env.TEST_DO.idFromName('direct-coll-find')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ name: string; active: boolean }>('findtest')
        coll.put('a', { name: 'Alice', active: true })
        coll.put('b', { name: 'Bob', active: false })
        coll.put('c', { name: 'Charlie', active: true })
        return coll.find({ active: true })
      })

      expect(result).toHaveLength(2)
      result.forEach((item: any) => expect(item.active).toBe(true))
    })

    it('collection count works', async () => {
      const id = env.TEST_DO.idFromName('direct-coll-count')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ val: number }>('counttest')
        coll.put('1', { val: 1 })
        coll.put('2', { val: 2 })
        coll.put('3', { val: 3 })
        return coll.count()
      })

      expect(result).toBe(3)
    })

    it('users namespace works (SQL)', async () => {
      const id = env.TEST_DO.idFromName('direct-users')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        // Create user
        const created = instance.users.create('u1', {
          name: 'Test User',
          email: 'test@example.com',
          role: 'admin'
        })

        // Get user
        const user = instance.users.get('u1')

        // List users
        const users = instance.users.list()

        // Count users
        const count = instance.users.count()

        return { created, user, users, count }
      })

      expect(result.created).toEqual({ ok: true, id: 'u1' })
      expect(result.user).toMatchObject({ name: 'Test User', email: 'test@example.com' })
      expect(result.users.length).toBeGreaterThan(0)
      expect(result.count).toBeGreaterThan(0)
    })

    it('tasks namespace works (collections)', async () => {
      const id = env.TEST_DO.idFromName('direct-tasks')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        // Create task
        const created = instance.tasks.create('t1', {
          title: 'Test Task',
          completed: false,
          priority: 1,
        })

        // Get task
        const task = instance.tasks.get('t1')

        // Find incomplete tasks
        const incomplete = instance.tasks.find({ completed: false })

        // Count tasks
        const count = instance.tasks.count()

        // Get keys
        const keys = instance.tasks.keys()

        return { created, task, incomplete, count, keys }
      })

      expect(result.created).toEqual({ ok: true, id: 't1' })
      expect(result.task).toMatchObject({ title: 'Test Task', completed: false })
      expect(result.incomplete.length).toBeGreaterThan(0)
      expect(result.count).toBeGreaterThan(0)
      expect(result.keys).toContain('t1')
    })

    it('kv namespace works (storage)', async () => {
      const id = env.TEST_DO.idFromName('direct-kv')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        // Put
        await instance.kv.put('key1', { data: 'value1' })

        // Get
        const value = await instance.kv.get('key1')

        // List
        const list = await instance.kv.list({ prefix: 'key' })

        // Delete
        const deleted = await instance.kv.delete('key1')

        // Verify deleted
        const afterDelete = await instance.kv.get('key1')

        return { value, list: Array.from(list.entries()), deleted, afterDelete }
      })

      expect(result.value).toEqual({ data: 'value1' })
      expect(result.list.length).toBeGreaterThan(0)
      expect(result.deleted).toBe(true)
      expect(result.afterDelete).toBeUndefined()
    })
  })

  // ============================================================================
  // Internal RPC Methods via HTTP
  // ============================================================================

  describe('Internal RPC Methods', () => {
    it('__dbSchema returns database schema', async () => {
      // First create some tables via direct access
      const id = env.TEST_DO.idFromName('schema-test')
      const stub = env.TEST_DO.get(id)

      await runInDurableObject(stub, async (instance: TestDO) => {
        // Trigger schema init
        instance.users.create('schema-user', { name: 'Test', email: 'schema@test.com' })
      })

      // Now test via HTTP
      const response = await SELF.fetch('http://localhost/do/schema-test')
      const schema = await response.json() as RpcSchemaResponse

      expect(schema.database).toBeDefined()
      expect(schema.database!.tables).toBeDefined()
      expect(Array.isArray(schema.database!.tables)).toBe(true)
    })
  })

  // ============================================================================
  // Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    it('throwError propagates error in direct access', async () => {
      const id = env.TEST_DO.idFromName('error-test')
      const stub = env.TEST_DO.get(id)

      await expect(
        runInDurableObject(stub, async (instance: TestDO) => {
          instance.throwError('intentional error')
        })
      ).rejects.toThrow('intentional error')
    })
  })

  // ============================================================================
  // Collection Filter Operators
  // ============================================================================

  describe('Collection Filters', () => {
    it('$eq filter', async () => {
      const id = env.TEST_DO.idFromName('filter-eq')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ status: string }>('eq-test')
        coll.put('a', { status: 'active' })
        coll.put('b', { status: 'inactive' })
        return coll.find({ status: { $eq: 'active' } })
      })

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('active')
    })

    it('$gt filter', async () => {
      const id = env.TEST_DO.idFromName('filter-gt')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ value: number }>('gt-test')
        coll.put('a', { value: 10 })
        coll.put('b', { value: 20 })
        coll.put('c', { value: 30 })
        return coll.find({ value: { $gt: 15 } })
      })

      expect(result).toHaveLength(2)
      result.forEach((item: any) => expect(item.value).toBeGreaterThan(15))
    })

    it('$in filter', async () => {
      const id = env.TEST_DO.idFromName('filter-in')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ type: string }>('in-test')
        coll.put('a', { type: 'foo' })
        coll.put('b', { type: 'bar' })
        coll.put('c', { type: 'baz' })
        return coll.find({ type: { $in: ['foo', 'bar'] } })
      })

      expect(result).toHaveLength(2)
    })

    it('$and filter', async () => {
      const id = env.TEST_DO.idFromName('filter-and')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ a: number; b: number }>('and-test')
        coll.put('1', { a: 1, b: 1 })
        coll.put('2', { a: 1, b: 2 })
        coll.put('3', { a: 2, b: 1 })
        return coll.find({ $and: [{ a: 1 }, { b: 1 }] })
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ a: 1, b: 1 })
    })

    it('$or filter', async () => {
      const id = env.TEST_DO.idFromName('filter-or')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ val: number }>('or-test')
        coll.put('1', { val: 1 })
        coll.put('2', { val: 2 })
        coll.put('3', { val: 3 })
        return coll.find({ $or: [{ val: 1 }, { val: 3 }] })
      })

      expect(result).toHaveLength(2)
    })
  })

  // ============================================================================
  // Query Options
  // ============================================================================

  describe('Query Options', () => {
    it('limit', async () => {
      const id = env.TEST_DO.idFromName('opt-limit')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ i: number }>('limit-test')
        for (let i = 0; i < 10; i++) {
          coll.put(`item-${i}`, { i })
        }
        return coll.list({ limit: 3 })
      })

      expect(result).toHaveLength(3)
    })

    it('sort ascending', async () => {
      const id = env.TEST_DO.idFromName('opt-sort-asc')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ num: number }>('sort-asc-test')
        coll.put('c', { num: 30 })
        coll.put('a', { num: 10 })
        coll.put('b', { num: 20 })
        return coll.list({ sort: 'num' })
      })

      expect(result[0].num).toBe(10)
      expect(result[1].num).toBe(20)
      expect(result[2].num).toBe(30)
    })

    it('sort descending', async () => {
      const id = env.TEST_DO.idFromName('opt-sort-desc')
      const stub = env.TEST_DO.get(id)

      const result = await runInDurableObject(stub, async (instance: TestDO) => {
        const coll = instance.collection<{ num: number }>('sort-desc-test')
        coll.put('c', { num: 30 })
        coll.put('a', { num: 10 })
        coll.put('b', { num: 20 })
        return coll.list({ sort: '-num' })
      })

      expect(result[0].num).toBe(30)
      expect(result[1].num).toBe(20)
      expect(result[2].num).toBe(10)
    })
  })
})
