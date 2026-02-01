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
