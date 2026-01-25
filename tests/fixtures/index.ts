/**
 * Test Fixtures
 *
 * Re-exports all test utilities for convenient importing.
 */

export {
  // MockWebSocket class
  MockWebSocket,

  // MockWebSocketPair for server-side testing
  MockWebSocketPair,

  // Factory functions
  createMockWebSocket,
  createMockResponse,
  createMockRequest,

  // Global WebSocket mock helpers
  installMockWebSocket,
  restoreMockWebSocket,

  // Types
  type MockWebSocketGlobal,
} from './mocks'
