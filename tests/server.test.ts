/**
 * Server WebSocket Handling Tests
 *
 * Tests for createRpcHandler() WebSocket functionality from src/server.ts
 * including:
 * - WebSocket upgrade handling
 * - WebSocket message dispatch
 * - WebSocket auth middleware
 * - Error scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRpcHandler, bearerAuth, type RpcDispatcher, type AuthMiddleware } from '../src/server'

// ============================================================================
// Mock WebSocket Classes for Cloudflare Workers
// ============================================================================

class MockWebSocket {
  private listeners: Map<string, Function[]> = new Map()
  public sentMessages: string[] = []
  public accepted: boolean = false

  accept() {
    this.accepted = true
  }

  addEventListener(type: string, handler: Function) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)!.push(handler)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {}

  // Test helper to simulate receiving a message
  simulateMessage(data: string) {
    const handlers = this.listeners.get('message') || []
    for (const handler of handlers) {
      handler({ data })
    }
  }
}

// Store last created WebSocketPair for test access
let lastClientSocket: MockWebSocket | null = null
let lastServerSocket: MockWebSocket | null = null

class MockWebSocketPair {
  0: MockWebSocket
  1: MockWebSocket

  constructor() {
    this[0] = new MockWebSocket()
    this[1] = new MockWebSocket()
    lastClientSocket = this[0]
    lastServerSocket = this[1]
  }

  *[Symbol.iterator]() {
    yield this[0]
    yield this[1]
  }
}

// ============================================================================
// Mock Cloudflare Workers Response (supports status 101 for WebSocket)
// ============================================================================

// Store original classes
let originalWebSocketPair: typeof WebSocketPair | undefined
let originalResponse: typeof Response

// Custom Response that supports Cloudflare Workers WebSocket upgrade (status 101)
class CloudflareResponse {
  public status: number
  public body: BodyInit | null
  public headers: Headers
  public webSocket: MockWebSocket | null

  constructor(body: BodyInit | null, init?: ResponseInit & { webSocket?: MockWebSocket }) {
    this.body = body
    this.status = init?.status ?? 200
    this.headers = new Headers(init?.headers)
    this.webSocket = init?.webSocket || null
  }

  json() {
    return Promise.resolve(JSON.parse(this.body as string))
  }

  static json(data: unknown, init?: ResponseInit) {
    return new CloudflareResponse(JSON.stringify(data), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string>),
      },
    })
  }
}

beforeEach(() => {
  originalWebSocketPair = (globalThis as any).WebSocketPair
  originalResponse = globalThis.Response
  ;(globalThis as any).WebSocketPair = MockWebSocketPair
  ;(globalThis as any).Response = CloudflareResponse
  lastClientSocket = null
  lastServerSocket = null
})

afterEach(() => {
  if (originalWebSocketPair !== undefined) {
    (globalThis as any).WebSocketPair = originalWebSocketPair
  } else {
    delete (globalThis as any).WebSocketPair
  }
  globalThis.Response = originalResponse
  lastClientSocket = null
  lastServerSocket = null
})

// ============================================================================
// Test Helpers
// ============================================================================

function createWebSocketUpgradeRequest(options: {
  url?: string
  headers?: Record<string, string>
} = {}): Request {
  const { url = 'https://rpc.do/api', headers = {} } = options

  return new Request(url, {
    method: 'GET',
    headers: {
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      ...headers,
    },
  })
}

// ============================================================================
// WebSocket Upgrade Handling Tests
// ============================================================================

describe('createRpcHandler - WebSocket Upgrade Handling', () => {
  it('should return status 101 for WebSocket upgrade', async () => {
    const dispatch = vi.fn().mockResolvedValue({ result: 'ok' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    const response = await handler(request)

    expect(response.status).toBe(101)
  })

  it('should create WebSocketPair correctly', async () => {
    const dispatch = vi.fn().mockResolvedValue({ result: 'ok' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    expect(lastClientSocket).not.toBeNull()
    expect(lastServerSocket).not.toBeNull()
  })

  it('should accept the server socket', async () => {
    const dispatch = vi.fn().mockResolvedValue({ result: 'ok' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    expect(lastServerSocket!.accepted).toBe(true)
  })

  it('should return client WebSocket in response', async () => {
    const dispatch = vi.fn().mockResolvedValue({ result: 'ok' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    const response = await handler(request)

    // The response should include the client WebSocket
    // In Cloudflare Workers, this is done via the webSocket property
    expect((response as any).webSocket).toBe(lastClientSocket)
  })

  it('should return null body for WebSocket response', async () => {
    const dispatch = vi.fn().mockResolvedValue({ result: 'ok' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    const response = await handler(request)

    expect(response.body).toBeNull()
  })
})

// ============================================================================
// WebSocket Message Dispatch Tests
// ============================================================================

describe('createRpcHandler - WebSocket Message Dispatch', () => {
  it('should parse incoming JSON messages', async () => {
    const dispatch = vi.fn().mockResolvedValue({ data: 'result' })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    // Simulate receiving a message
    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'users.find',
      args: [{ id: '123' }]
    }))

    // Allow async handlers to complete
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).toHaveBeenCalledWith(
      'users.find',
      [{ id: '123' }],
      expect.any(Object)
    )
  })

  it('should call dispatch with correct path, args, and context', async () => {
    const dispatch = vi.fn().mockResolvedValue('success')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 42,
      path: 'service.method',
      args: ['arg1', 'arg2', { nested: true }]
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).toHaveBeenCalledWith(
      'service.method',
      ['arg1', 'arg2', { nested: true }],
      {} // Empty context when no auth middleware
    )
  })

  it('should send response with matching id', async () => {
    const dispatch = vi.fn().mockResolvedValue({ success: true, data: [1, 2, 3] })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 123,
      path: 'test.method',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.id).toBe(123)
    expect(response.result).toEqual({ success: true, data: [1, 2, 3] })
  })

  it('should handle dispatch errors and send error response', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('Service unavailable'))
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 456,
      path: 'failing.method',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Service unavailable')
  })

  it('should default args to empty array when not provided', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'noargs.method'
      // No args field
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).toHaveBeenCalledWith('noargs.method', [], {})
  })

  it('should handle multiple concurrent messages', async () => {
    const dispatch = vi.fn().mockImplementation(async (path) => {
      return `result-${path}`
    })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    // Send multiple messages
    lastServerSocket!.simulateMessage(JSON.stringify({ id: 1, path: 'method1', args: [] }))
    lastServerSocket!.simulateMessage(JSON.stringify({ id: 2, path: 'method2', args: [] }))
    lastServerSocket!.simulateMessage(JSON.stringify({ id: 3, path: 'method3', args: [] }))

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(lastServerSocket!.sentMessages.length).toBe(3)

    const responses = lastServerSocket!.sentMessages.map(m => JSON.parse(m))
    expect(responses.find(r => r.id === 1)?.result).toBe('result-method1')
    expect(responses.find(r => r.id === 2)?.result).toBe('result-method2')
    expect(responses.find(r => r.id === 3)?.result).toBe('result-method3')
  })
})

// ============================================================================
// WebSocket Auth Middleware Tests
// ============================================================================

describe('createRpcHandler - WebSocket Auth Middleware', () => {
  it('should authenticate before accepting connection', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const auth: AuthMiddleware = vi.fn().mockResolvedValue({
      authorized: true,
      context: { user: { id: 'user123' } }
    })
    const handler = createRpcHandler({ dispatch, auth })

    const request = createWebSocketUpgradeRequest({
      headers: { Authorization: 'Bearer valid-token' }
    })
    const response = await handler(request)

    expect(auth).toHaveBeenCalledWith(request)
    expect(response.status).toBe(101)
    expect(lastServerSocket!.accepted).toBe(true)
  })

  it('should reject unauthorized WebSocket upgrades with 401', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const auth: AuthMiddleware = vi.fn().mockResolvedValue({
      authorized: false,
      error: 'Invalid token'
    })
    const handler = createRpcHandler({ dispatch, auth })

    const request = createWebSocketUpgradeRequest()
    const response = await handler(request)

    expect(response.status).toBe(401)
    // WebSocket should not be accepted
    expect(lastServerSocket).toBeNull()
  })

  it('should pass auth context to dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const auth: AuthMiddleware = vi.fn().mockResolvedValue({
      authorized: true,
      context: { token: 'abc123', user: { id: 'user1', role: 'admin' } }
    })
    const handler = createRpcHandler({ dispatch, auth })

    const request = createWebSocketUpgradeRequest({
      headers: { Authorization: 'Bearer abc123' }
    })
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'admin.action',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).toHaveBeenCalledWith(
      'admin.action',
      [],
      { token: 'abc123', user: { id: 'user1', role: 'admin' } }
    )
  })

  it('should use empty context when auth returns no context', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const auth: AuthMiddleware = vi.fn().mockResolvedValue({
      authorized: true
      // No context provided
    })
    const handler = createRpcHandler({ dispatch, auth })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'test.method',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).toHaveBeenCalledWith('test.method', [], {})
  })

  it('should work with bearerAuth middleware for WebSocket', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const validateToken = vi.fn().mockImplementation(async (token) => {
      if (token === 'valid-ws-token') {
        return { user: 'ws-user' }
      }
      return null
    })
    const auth = bearerAuth(validateToken)
    const handler = createRpcHandler({ dispatch, auth })

    // Test with valid token
    const validRequest = createWebSocketUpgradeRequest({
      headers: { Authorization: 'Bearer valid-ws-token' }
    })
    const validResponse = await handler(validRequest)
    expect(validResponse.status).toBe(101)

    // Reset mocks for next test
    lastClientSocket = null
    lastServerSocket = null

    // Test with invalid token
    const invalidRequest = createWebSocketUpgradeRequest({
      headers: { Authorization: 'Bearer invalid-token' }
    })
    const invalidResponse = await handler(invalidRequest)
    expect(invalidResponse.status).toBe(401)
  })

  it('should accept token via query parameter for WebSocket', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const validateToken = vi.fn().mockImplementation(async (token) => {
      if (token === 'query-token') {
        return { source: 'query' }
      }
      return null
    })
    const auth = bearerAuth(validateToken)
    const handler = createRpcHandler({ dispatch, auth })

    const request = createWebSocketUpgradeRequest({
      url: 'https://rpc.do/api?token=query-token'
    })
    const response = await handler(request)

    expect(response.status).toBe(101)
    expect(validateToken).toHaveBeenCalledWith('query-token')
  })
})

// ============================================================================
// Error Scenarios Tests
// ============================================================================

describe('createRpcHandler - WebSocket Error Scenarios', () => {
  it('should handle malformed JSON in WebSocket messages', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    // Send malformed JSON
    lastServerSocket!.simulateMessage('this is not valid json {{{')

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).not.toHaveBeenCalled()
    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toContain('Unexpected token')
  })

  it('should handle dispatch throwing errors', async () => {
    const dispatch = vi.fn().mockImplementation(() => {
      throw new Error('Synchronous error in dispatch')
    })
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'error.method',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Synchronous error in dispatch')
  })

  it('should include error message in response for async errors', async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error('Async dispatch failure'))
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 99,
      path: 'async.error',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Async dispatch failure')
  })

  it('should use generic error message for non-Error throws', async () => {
    const dispatch = vi.fn().mockRejectedValue('String error')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 'string.error',
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('RPC error')
  })

  it('should send error for invalid message format (missing path)', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    // Send message without path
    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      args: ['arg1']
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).not.toHaveBeenCalled()
    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Invalid message format')
  })

  it('should send error for invalid path type', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    // Send message with non-string path
    lastServerSocket!.simulateMessage(JSON.stringify({
      id: 1,
      path: 123,
      args: []
    }))

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).not.toHaveBeenCalled()
    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Invalid message format')
  })

  it('should handle empty JSON object', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage('{}')

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).not.toHaveBeenCalled()
    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Invalid message format')
  })

  it('should handle null message data', async () => {
    const dispatch = vi.fn().mockResolvedValue('result')
    const handler = createRpcHandler({ dispatch })

    const request = createWebSocketUpgradeRequest()
    await handler(request)

    lastServerSocket!.simulateMessage('null')

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(dispatch).not.toHaveBeenCalled()
    expect(lastServerSocket!.sentMessages.length).toBe(1)
    const response = JSON.parse(lastServerSocket!.sentMessages[0])
    expect(response.error).toBe('Invalid message format')
  })
})
