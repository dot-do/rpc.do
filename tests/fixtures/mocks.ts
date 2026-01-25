/**
 * Shared Mock Utilities for WebSocket Tests
 *
 * This module provides reusable mock implementations for testing
 * WebSocket-based transports without requiring real network connections.
 */

// ============================================================================
// MockWebSocket
// ============================================================================

/**
 * Mock WebSocket implementation for testing.
 *
 * Provides full WebSocket API simulation with test helper methods
 * to simulate connection events.
 */
export class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState: number = MockWebSocket.CONNECTING
  private listeners: Map<string, Function[]> = new Map()

  /** All messages sent through this WebSocket */
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, handler: Function): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)!.push(handler)
  }

  removeEventListener(type: string, handler: Function): void {
    const handlers = this.listeners.get(type)
    if (handlers) {
      const index = handlers.indexOf(handler)
      if (index !== -1) handlers.splice(index, 1)
    }
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSING
    this.readyState = MockWebSocket.CLOSED
    const event = { code: code ?? 1000, reason: reason ?? '' }
    this.triggerEvent('close', event)
  }

  dispatchEvent(event: Event): boolean {
    const handlers = this.listeners.get(event.type) || []
    for (const handler of handlers) {
      handler(event)
    }
    return true
  }

  // ============================================================================
  // Test Helper Methods
  // ============================================================================

  /**
   * Simulate the WebSocket connection opening.
   * Transitions state from CONNECTING to OPEN and triggers 'open' event.
   */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.triggerEvent('open', undefined)
  }

  /**
   * Simulate receiving a message.
   * Automatically JSON stringifies the data.
   */
  simulateMessage(data: unknown): void {
    this.triggerEvent('message', { data: JSON.stringify(data) })
  }

  /**
   * Simulate receiving a raw message without JSON stringification.
   */
  simulateRawMessage(data: string): void {
    this.triggerEvent('message', { data })
  }

  /**
   * Simulate the WebSocket connection closing.
   */
  simulateClose(code: number = 1000, reason: string = ''): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.triggerEvent('close', { code, reason })
  }

  /**
   * Simulate a WebSocket error.
   */
  simulateError(error: Event = new Event('error')): void {
    this.triggerEvent('error', error)
  }

  /**
   * Get all registered listeners for a given event type.
   */
  getListeners(type: string): Function[] {
    return this.listeners.get(type) || []
  }

  /**
   * Clear all sent messages.
   */
  clearSentMessages(): void {
    this.sentMessages = []
  }

  private triggerEvent(type: string, event: unknown): void {
    const handlers = this.listeners.get(type) || []
    for (const handler of handlers) {
      handler(event)
    }
  }
}

// ============================================================================
// MockWebSocketPair
// ============================================================================

/**
 * Creates a pair of connected MockWebSockets for testing server-side code.
 *
 * Messages sent on one socket are received on the other.
 */
export class MockWebSocketPair {
  readonly client: MockWebSocket
  readonly server: MockWebSocket

  constructor(url: string = 'wss://test.example.com') {
    this.client = new MockWebSocket(url)
    this.server = new MockWebSocket(url)

    // Wire up message passing
    this.wireMessagePassing()
  }

  private wireMessagePassing(): void {
    // Override send to forward messages to the other side
    const originalClientSend = this.client.send.bind(this.client)
    const originalServerSend = this.server.send.bind(this.server)

    this.client.send = (data: string) => {
      originalClientSend(data)
      // Deliver to server
      if (this.server.readyState === MockWebSocket.OPEN) {
        this.server.simulateRawMessage(data)
      }
    }

    this.server.send = (data: string) => {
      originalServerSend(data)
      // Deliver to client
      if (this.client.readyState === MockWebSocket.OPEN) {
        this.client.simulateRawMessage(data)
      }
    }
  }

  /**
   * Open both sides of the connection.
   */
  connect(): void {
    this.client.simulateOpen()
    this.server.simulateOpen()
  }

  /**
   * Close both sides of the connection.
   */
  close(code: number = 1000, reason: string = ''): void {
    this.client.simulateClose(code, reason)
    this.server.simulateClose(code, reason)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a MockWebSocket instance.
 */
export function createMockWebSocket(url: string = 'wss://test.example.com'): MockWebSocket {
  return new MockWebSocket(url)
}

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

// ============================================================================
// Test Setup Helpers
// ============================================================================

/**
 * State for global WebSocket mock.
 */
export interface MockWebSocketGlobal {
  lastCreatedWebSocket: MockWebSocket | null
  originalWebSocket: typeof WebSocket | undefined
}

/**
 * Install MockWebSocket as the global WebSocket.
 * Returns state object for accessing created WebSocket instances.
 */
export function installMockWebSocket(): MockWebSocketGlobal {
  const state: MockWebSocketGlobal = {
    lastCreatedWebSocket: null,
    originalWebSocket: globalThis.WebSocket,
  }

  ;(globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      state.lastCreatedWebSocket = this
    }
  }

  return state
}

/**
 * Restore the original global WebSocket.
 */
export function restoreMockWebSocket(state: MockWebSocketGlobal): void {
  if (state.originalWebSocket) {
    globalThis.WebSocket = state.originalWebSocket
  }
  state.lastCreatedWebSocket = null
}
