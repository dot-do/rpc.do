/**
 * Shared Mock Utilities for Tests
 *
 * This module provides reusable mock implementations for testing.
 * WebSocket mocks are imported from the shared core/__testutils__ utilities.
 */

// Re-export WebSocket mocks from shared core utilities
export {
  MockWebSocket,
  MockWebSocketPair,
  createMockWebSocket,
  installMockWebSocket,
  restoreMockWebSocket,
  type MockWebSocketGlobal,
} from '../../core/src/__testutils__'

// ============================================================================
// HTTP Mock Factory Functions
// ============================================================================

/**
 * Creates a mock Response object.
 */
export function createMockResponse(
  body: unknown,
  status: number = 200,
  options: {
    headers?: Record<string, string>
    statusText?: string
  } = {}
): Response {
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body)
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...options.headers,
  })

  return new Response(responseBody, {
    status,
    statusText: options.statusText || 'OK',
    headers,
  })
}

/**
 * Creates a mock Request object.
 */
export function createMockRequest(
  url: string = 'https://test.example.com/rpc',
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): Request {
  const requestInit: RequestInit = {
    method: options.method || 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      ...options.headers,
    }),
  }

  if (options.body !== undefined) {
    requestInit.body =
      typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  }

  return new Request(url, requestInit)
}

