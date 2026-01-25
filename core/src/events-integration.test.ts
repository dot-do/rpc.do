/**
 * Events Integration Tests
 *
 * Tests for the @dotdo/events integration with @dotdo/rpc.
 * Uses mocks for @dotdo/events to test the integration without requiring the actual package.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'

// sql.js instance (loaded once)
let SQL: Awaited<ReturnType<typeof initSqlJs>>

// =============================================================================
// Mock EventEmitter
// =============================================================================

/**
 * Mock EventEmitter that captures emitted events for testing
 */
class MockEventEmitter {
  private batch: Array<{ type: string; [key: string]: unknown }> = []
  private identity: { id: string; name?: string; colo?: string }
  private options: {
    cdc: boolean
    trackPrevious: boolean
    endpoint: string
  }
  public handleAlarmCalled = false
  public enrichFromRequestCalled = false
  public persistBatchCalled = false

  constructor(
    private ctx: { id: { toString(): string; name?: string } },
    private env: Record<string, unknown>,
    options: { cdc?: boolean; trackPrevious?: boolean; endpoint?: string } = {}
  ) {
    this.identity = {
      id: ctx.id.toString(),
      name: ctx.id.name,
    }
    this.options = {
      cdc: options.cdc ?? false,
      trackPrevious: options.trackPrevious ?? false,
      endpoint: options.endpoint ?? 'https://events.do/ingest',
    }
  }

  emit(event: { type: string; [key: string]: unknown }): void {
    this.batch.push({
      ...event,
      ts: new Date().toISOString(),
      do: this.identity,
    })
  }

  emitChange(
    type: 'insert' | 'update' | 'delete',
    collection: string,
    docId: string,
    doc?: Record<string, unknown>,
    prev?: Record<string, unknown>
  ): void {
    if (!this.options.cdc) return

    this.emit({
      type: `collection.${type}`,
      collection,
      docId,
      doc,
      prev: this.options.trackPrevious ? prev : undefined,
    })
  }

  async flush(): Promise<void> {
    // Mock: In real implementation, this would send to events.do
    this.batch = []
  }

  async handleAlarm(): Promise<void> {
    this.handleAlarmCalled = true
  }

  enrichFromRequest(request: Request): void {
    this.enrichFromRequestCalled = true
  }

  async persistBatch(): Promise<void> {
    this.persistBatchCalled = true
  }

  // Test helpers
  get pendingEvents(): Array<{ type: string; [key: string]: unknown }> {
    return [...this.batch]
  }

  clearEvents(): void {
    this.batch = []
  }
}

// =============================================================================
// Mock CDCCollection
// =============================================================================

/**
 * Mock Collection interface (same as @dotdo/rpc collections)
 */
interface MockCollection<T> {
  get(id: string): T | null
  put(id: string, doc: T): void
  delete(id: string): boolean
  has(id: string): boolean
  find(filter?: Record<string, unknown>): T[]
  count(filter?: Record<string, unknown>): number
  list(): T[]
  keys(): string[]
  clear(): number
}

/**
 * Mock CDCCollection that wraps a collection with event emission
 */
class MockCDCCollection<T extends Record<string, unknown>> {
  constructor(
    private collection: MockCollection<T>,
    private emitter: MockEventEmitter,
    private name: string
  ) {}

  get(id: string): T | null {
    return this.collection.get(id)
  }

  put(id: string, doc: T): void {
    const prev = this.collection.get(id)
    this.collection.put(id, doc)

    if (prev) {
      this.emitter.emitChange('update', this.name, id, doc as Record<string, unknown>, prev as Record<string, unknown>)
    } else {
      this.emitter.emitChange('insert', this.name, id, doc as Record<string, unknown>)
    }
  }

  delete(id: string): boolean {
    const prev = this.collection.get(id)
    const deleted = this.collection.delete(id)

    if (deleted && prev) {
      this.emitter.emitChange('delete', this.name, id, undefined, prev as Record<string, unknown>)
    }

    return deleted
  }

  has(id: string): boolean {
    return this.collection.has(id)
  }

  find(filter?: Record<string, unknown>): T[] {
    return this.collection.find(filter)
  }

  count(filter?: Record<string, unknown>): number {
    return this.collection.count(filter)
  }

  list(): T[] {
    return this.collection.list()
  }

  keys(): string[] {
    return this.collection.keys()
  }

  clear(): number {
    const keys = this.keys()
    const count = this.collection.clear()

    for (const id of keys) {
      this.emitter.emitChange('delete', this.name, id)
    }

    return count
  }
}

// =============================================================================
// Mock DurableRPC Context
// =============================================================================

// Schema for _collections table
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
`

/**
 * Simple in-memory collection for testing
 */
class InMemoryCollection<T extends Record<string, unknown>> implements MockCollection<T> {
  private data = new Map<string, T>()

  get(id: string): T | null {
    return this.data.get(id) ?? null
  }

  put(id: string, doc: T): void {
    this.data.set(id, doc)
  }

  delete(id: string): boolean {
    return this.data.delete(id)
  }

  has(id: string): boolean {
    return this.data.has(id)
  }

  find(filter?: Record<string, unknown>): T[] {
    if (!filter || Object.keys(filter).length === 0) {
      return Array.from(this.data.values())
    }
    return Array.from(this.data.values()).filter(doc => {
      return Object.entries(filter).every(([key, value]) => doc[key] === value)
    })
  }

  count(filter?: Record<string, unknown>): number {
    return this.find(filter).length
  }

  list(): T[] {
    return Array.from(this.data.values())
  }

  keys(): string[] {
    return Array.from(this.data.keys()).sort()
  }

  clear(): number {
    const count = this.data.size
    this.data.clear()
    return count
  }
}

// =============================================================================
// Test Types
// =============================================================================

interface User {
  name: string
  email: string
  active: boolean
}

interface Order {
  userId: string
  total: number
  status: 'pending' | 'paid' | 'shipped'
}

// =============================================================================
// Tests
// =============================================================================

describe('Events Integration', () => {
  let mockCtx: {
    id: { toString(): string; name?: string }
    storage: { get: any; put: any; delete: any; setAlarm: any; getAlarm: any }
  }
  let mockEnv: Record<string, unknown>
  let events: MockEventEmitter

  beforeEach(() => {
    mockCtx = {
      id: {
        toString: () => 'test-do-id-123',
        name: 'test-do',
      },
      storage: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        setAlarm: vi.fn(),
        getAlarm: vi.fn(),
      },
    }
    mockEnv = {}
    events = new MockEventEmitter(mockCtx, mockEnv, { cdc: true, trackPrevious: true })
  })

  describe('EventEmitter', () => {
    it('should emit custom events with DO identity', () => {
      events.emit({ type: 'custom.event', data: 123 })

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('custom.event')
      expect(pending[0].data).toBe(123)
      expect((pending[0].do as any).id).toBe('test-do-id-123')
      expect((pending[0].do as any).name).toBe('test-do')
    })

    it('should emit multiple events in batch', () => {
      events.emit({ type: 'event1' })
      events.emit({ type: 'event2' })
      events.emit({ type: 'event3' })

      expect(events.pendingEvents.length).toBe(3)
      expect(events.pendingEvents.map(e => e.type)).toEqual(['event1', 'event2', 'event3'])
    })

    it('should clear events on flush', async () => {
      events.emit({ type: 'event1' })
      events.emit({ type: 'event2' })

      expect(events.pendingEvents.length).toBe(2)

      await events.flush()

      expect(events.pendingEvents.length).toBe(0)
    })

    it('should support handleAlarm for retry', async () => {
      expect(events.handleAlarmCalled).toBe(false)

      await events.handleAlarm()

      expect(events.handleAlarmCalled).toBe(true)
    })

    it('should support enrichFromRequest', () => {
      const mockRequest = new Request('https://example.com')

      expect(events.enrichFromRequestCalled).toBe(false)

      events.enrichFromRequest(mockRequest)

      expect(events.enrichFromRequestCalled).toBe(true)
    })

    it('should support persistBatch for hibernation', async () => {
      expect(events.persistBatchCalled).toBe(false)

      await events.persistBatch()

      expect(events.persistBatchCalled).toBe(true)
    })
  })

  describe('CDC Events', () => {
    it('should emit insert CDC event when cdc is enabled', () => {
      events.emitChange('insert', 'users', 'user-123', { name: 'Alice', email: 'alice@test.com' })

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.insert')
      expect(pending[0].collection).toBe('users')
      expect(pending[0].docId).toBe('user-123')
      expect(pending[0].doc).toEqual({ name: 'Alice', email: 'alice@test.com' })
    })

    it('should emit update CDC event with previous doc when trackPrevious is enabled', () => {
      events.emitChange(
        'update',
        'users',
        'user-123',
        { name: 'Alice Updated', email: 'alice@test.com' },
        { name: 'Alice', email: 'alice@test.com' }
      )

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.update')
      expect(pending[0].doc).toEqual({ name: 'Alice Updated', email: 'alice@test.com' })
      expect(pending[0].prev).toEqual({ name: 'Alice', email: 'alice@test.com' })
    })

    it('should emit delete CDC event', () => {
      events.emitChange('delete', 'users', 'user-123', undefined, { name: 'Alice', email: 'alice@test.com' })

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.delete')
      expect(pending[0].docId).toBe('user-123')
      expect(pending[0].prev).toEqual({ name: 'Alice', email: 'alice@test.com' })
    })

    it('should not emit CDC events when cdc is disabled', () => {
      const eventsNoCdc = new MockEventEmitter(mockCtx, mockEnv, { cdc: false })

      eventsNoCdc.emitChange('insert', 'users', 'user-123', { name: 'Alice' })

      expect(eventsNoCdc.pendingEvents.length).toBe(0)
    })

    it('should not include prev when trackPrevious is disabled', () => {
      const eventsNoPrev = new MockEventEmitter(mockCtx, mockEnv, { cdc: true, trackPrevious: false })

      eventsNoPrev.emitChange(
        'update',
        'users',
        'user-123',
        { name: 'Alice Updated' },
        { name: 'Alice' }
      )

      const pending = eventsNoPrev.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].prev).toBeUndefined()
    })
  })

  describe('CDCCollection', () => {
    let collection: InMemoryCollection<User>
    let cdcCollection: MockCDCCollection<User>

    beforeEach(() => {
      events.clearEvents()
      collection = new InMemoryCollection<User>()
      cdcCollection = new MockCDCCollection(collection, events, 'users')
    })

    it('should emit insert event on put for new document', () => {
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.insert')
      expect(pending[0].collection).toBe('users')
      expect(pending[0].docId).toBe('user-1')
    })

    it('should emit update event on put for existing document', () => {
      // First put - insert
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      events.clearEvents()

      // Second put - update
      cdcCollection.put('user-1', { name: 'Alice Updated', email: 'alice@test.com', active: true })

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.update')
      expect(pending[0].prev).toEqual({ name: 'Alice', email: 'alice@test.com', active: true })
    })

    it('should emit delete event on delete', () => {
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      events.clearEvents()

      cdcCollection.delete('user-1')

      const pending = events.pendingEvents
      expect(pending.length).toBe(1)
      expect(pending[0].type).toBe('collection.delete')
      expect(pending[0].docId).toBe('user-1')
    })

    it('should not emit delete event for non-existent document', () => {
      const deleted = cdcCollection.delete('non-existent')

      expect(deleted).toBe(false)
      expect(events.pendingEvents.length).toBe(0)
    })

    it('should emit delete events for each document on clear', () => {
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      cdcCollection.put('user-2', { name: 'Bob', email: 'bob@test.com', active: true })
      events.clearEvents()

      cdcCollection.clear()

      const pending = events.pendingEvents
      expect(pending.length).toBe(2)
      expect(pending.every(e => e.type === 'collection.delete')).toBe(true)
    })

    it('should not emit events for read operations', () => {
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      events.clearEvents()

      cdcCollection.get('user-1')
      cdcCollection.has('user-1')
      cdcCollection.find({ active: true })
      cdcCollection.count()
      cdcCollection.list()
      cdcCollection.keys()

      expect(events.pendingEvents.length).toBe(0)
    })

    it('should preserve normal collection functionality', () => {
      cdcCollection.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      cdcCollection.put('user-2', { name: 'Bob', email: 'bob@test.com', active: false })

      expect(cdcCollection.get('user-1')?.name).toBe('Alice')
      expect(cdcCollection.has('user-1')).toBe(true)
      expect(cdcCollection.count()).toBe(2)
      expect(cdcCollection.count({ active: true })).toBe(1)
      expect(cdcCollection.keys()).toEqual(['user-1', 'user-2'])
    })
  })

  describe('Integration Scenario', () => {
    it('should handle a complete user lifecycle with events', () => {
      const collection = new InMemoryCollection<User>()
      const users = new MockCDCCollection(collection, events, 'users')

      // 1. Create user
      users.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })
      events.emit({ type: 'user.registered', userId: 'user-1' })

      // 2. Update user
      users.put('user-1', { name: 'Alice Smith', email: 'alice@test.com', active: true })

      // 3. Deactivate user
      users.put('user-1', { name: 'Alice Smith', email: 'alice@test.com', active: false })
      events.emit({ type: 'user.deactivated', userId: 'user-1' })

      // 4. Delete user
      users.delete('user-1')

      // Verify all events
      const pending = events.pendingEvents
      expect(pending.length).toBe(6)

      expect(pending[0].type).toBe('collection.insert')
      expect(pending[1].type).toBe('user.registered')
      expect(pending[2].type).toBe('collection.update')
      expect(pending[3].type).toBe('collection.update')
      expect(pending[4].type).toBe('user.deactivated')
      expect(pending[5].type).toBe('collection.delete')
    })

    it('should handle order workflow with multiple collections', () => {
      const usersCollection = new InMemoryCollection<User>()
      const ordersCollection = new InMemoryCollection<Order>()
      const users = new MockCDCCollection(usersCollection, events, 'users')
      const orders = new MockCDCCollection(ordersCollection, events, 'orders')

      // Create user
      users.put('user-1', { name: 'Alice', email: 'alice@test.com', active: true })

      // Create order
      orders.put('order-1', { userId: 'user-1', total: 99.99, status: 'pending' })
      events.emit({ type: 'order.created', orderId: 'order-1', total: 99.99 })

      // Update order status
      orders.put('order-1', { userId: 'user-1', total: 99.99, status: 'paid' })
      events.emit({ type: 'order.paid', orderId: 'order-1' })

      // Verify events from both collections
      const pending = events.pendingEvents
      expect(pending.length).toBe(5)

      // Verify collection isolation
      const userEvents = pending.filter(e => e.collection === 'users')
      const orderEvents = pending.filter(e => e.collection === 'orders')
      expect(userEvents.length).toBe(1)
      expect(orderEvents.length).toBe(2)
    })
  })
})

describe('createEventEmitter factory', () => {
  it('should be importable from @dotdo/rpc/events', async () => {
    // This test verifies the module structure
    // In real usage, this would import from the built module
    const { createEventEmitter, EventEmitter, CDCCollection } = await import('./events-integration.js')

    expect(typeof createEventEmitter).toBe('function')
    expect(typeof EventEmitter).toBe('function')
    expect(typeof CDCCollection).toBe('function')
  })

  it('should create EventEmitter with provided context', async () => {
    const { createEventEmitter } = await import('./events-integration.js')

    const mockCtx = {
      id: { toString: () => 'test-id', name: 'test-name' },
      storage: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
        setAlarm: async () => {},
        getAlarm: async () => null,
      },
    } as unknown as DurableObjectState

    const mockEnv = {}

    const emitter = createEventEmitter({ ctx: mockCtx, env: mockEnv }, { cdc: true })

    expect(emitter).toBeDefined()
    expect(typeof emitter.emit).toBe('function')
    expect(typeof emitter.emitChange).toBe('function')
    expect(typeof emitter.flush).toBe('function')
    expect(typeof emitter.handleAlarm).toBe('function')
  })
})
