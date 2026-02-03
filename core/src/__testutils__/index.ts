/**
 * Test Utilities for @dotdo/rpc
 *
 * This module exports all shared test utilities including mocks,
 * test helpers, and common test fixtures.
 */

// SQL Storage Mocks
export { MockSqlStorage, SqlCursor, COLLECTIONS_SCHEMA } from './mocks/sql'

// WebSocket Mocks
export {
  MockWebSocket,
  MockWebSocketPair,
  createMockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket,
  type MockWebSocketGlobal,
} from './mocks/websocket'

// ============================================================================
// Factory Functions for Test Mocks
// ============================================================================

/**
 * Creates a simple mock SqlStorage for tests that don't need full SQL functionality
 */
export function createMockSqlStorage(): SqlStorage {
  const data = new Map<string, unknown[]>()

  return {
    exec(query: string, ...params: unknown[]) {
      return {
        toArray: () => [],
        one: () => null,
        rowsRead: 0,
        rowsWritten: 0,
        *[Symbol.iterator]() {},
      }
    },
  } as unknown as SqlStorage
}

/**
 * Creates a mock DurableObjectStorage for tests
 */
export function createMockStorage(): DurableObjectStorage {
  const data = new Map<string, unknown>()

  return {
    get: async <T>(keyOrKeys: string | string[]) => {
      if (Array.isArray(keyOrKeys)) {
        const result = new Map<string, T>()
        for (const key of keyOrKeys) {
          if (data.has(key)) {
            result.set(key, data.get(key) as T)
          }
        }
        return result
      }
      return data.get(keyOrKeys) as T | undefined
    },
    put: async <T>(keyOrEntries: string | Record<string, T>, value?: T) => {
      if (typeof keyOrEntries === 'string') {
        data.set(keyOrEntries, value)
      } else {
        for (const [k, v] of Object.entries(keyOrEntries)) {
          data.set(k, v)
        }
      }
    },
    delete: async (keyOrKeys: string | string[]) => {
      if (Array.isArray(keyOrKeys)) {
        let count = 0
        for (const key of keyOrKeys) {
          if (data.delete(key)) count++
        }
        return count
      }
      return data.delete(keyOrKeys)
    },
    list: async <T>(options?: DurableObjectListOptions) => {
      const result = new Map<string, T>()
      const prefix = options?.prefix ?? ''
      for (const [key, value] of data) {
        if (key.startsWith(prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    },
    getAlarm: async () => null,
    setAlarm: async () => {},
    deleteAlarm: async () => {},
    sync: async () => {},
    transaction: async <T>(closure: () => Promise<T>) => closure(),
    transactionSync: <T>(closure: () => T) => closure(),
  } as unknown as DurableObjectStorage
}

/**
 * Creates a mock DurableObjectState for tests
 */
export function createMockDurableObjectState(options: {
  sql?: SqlStorage
  storage?: DurableObjectStorage
  id?: DurableObjectId
} = {}): DurableObjectState {
  const sql = options.sql ?? createMockSqlStorage()
  const storage = options.storage ?? createMockStorage()

  // Attach sql to storage
  const storageWithSql = Object.assign(storage, { sql })

  const webSockets: WebSocket[] = []

  return {
    id: options.id ?? { toString: () => 'test-id', equals: () => false, name: 'test' } as DurableObjectId,
    storage: storageWithSql,
    getWebSockets: () => webSockets,
    acceptWebSocket: (ws: WebSocket) => {
      webSockets.push(ws)
    },
    getTags: () => [],
    waitUntil: () => {},
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
  } as unknown as DurableObjectState
}
