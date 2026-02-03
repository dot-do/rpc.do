/**
 * Streaming Transport - SSE and WebSocket streaming support for rpc.do
 *
 * This module provides streaming capabilities for RPC methods that return
 * AsyncIterables/AsyncGenerators on the server side.
 *
 * ## Transport Options
 *
 * - **SSE (Server-Sent Events)**: Unidirectional server-to-client streaming over HTTP.
 *   Best for simple streaming use cases where client doesn't need to send data back.
 *
 * - **WebSocket**: Bidirectional streaming with full duplex communication.
 *   Best for subscriptions, real-time updates, and interactive streaming.
 *
 * @example SSE Streaming
 * ```typescript
 * import { sseStream } from 'rpc.do/transports/streaming'
 *
 * const stream = await sseStream('https://api.example.com/rpc/stream', {
 *   method: 'ai.generateStream',
 *   args: [{ prompt: 'Hello' }],
 * })
 *
 * for await (const chunk of stream) {
 *   console.log(chunk.text)
 * }
 * ```
 *
 * @example WebSocket Subscription
 * ```typescript
 * import { wsSubscribe } from 'rpc.do/transports/streaming'
 *
 * const subscription = await wsSubscribe('wss://api.example.com/rpc/ws', {
 *   topic: 'users:123',
 * })
 *
 * subscription.on('data', (event) => {
 *   console.log('User updated:', event)
 * })
 * ```
 */

import type { StreamResponse, Subscription, StreamOptions, SubscribeOptions } from '../types.js'
import { ConnectionError, RPCError } from '../errors.js'

// ============================================================================
// Internal Types
// ============================================================================

/**
 * SSE message types
 */
interface SSEMessage {
  /** Event type (data, error, end, heartbeat) */
  event?: string
  /** Message data (JSON stringified) */
  data: string
  /** Message ID for reconnection */
  id?: string
  /** Retry interval in ms */
  retry?: number
}

/**
 * WebSocket subscription message
 */
interface WSSubscriptionMessage {
  type: 'subscribe' | 'unsubscribe' | 'data' | 'error' | 'ack' | 'heartbeat'
  subscriptionId?: string
  topic?: string
  data?: unknown
  error?: { message: string; code?: string }
  filter?: Record<string, unknown>
}

// ============================================================================
// Stream ID Generation
// ============================================================================

let streamIdCounter = 0

function generateStreamId(): string {
  return `stream_${Date.now()}_${++streamIdCounter}`
}

// ============================================================================
// SSE Stream Implementation
// ============================================================================

/**
 * Options for SSE stream connection
 */
export interface SSEStreamOptions extends StreamOptions {
  /** HTTP method for the request (default: POST) */
  method?: 'GET' | 'POST'

  /** Additional headers */
  headers?: Record<string, string>

  /** Authentication token */
  auth?: string | (() => string | null | Promise<string | null>)

  /** Request body for POST requests */
  body?: unknown
}

/**
 * Internal SSE stream state
 */
interface SSEStreamState<T> {
  id: string
  closed: boolean
  buffer: T[]
  waitingResolvers: Array<{ resolve: (result: IteratorResult<T, void>) => void; reject: (error: Error) => void }>
  eventSource: EventSource | null
  lastEventId: string | null
  reconnectAttempts: number
  error: Error | null
}

/**
 * Create an SSE stream for consuming server-sent events
 *
 * @param url - The SSE endpoint URL
 * @param request - The RPC request to make
 * @param options - Stream configuration options
 * @returns A StreamResponse that can be consumed as an AsyncIterable
 *
 * @example
 * ```typescript
 * const stream = await sseStream('https://api.example.com/rpc/stream', {
 *   method: 'ai.generate',
 *   args: [{ prompt: 'Write a story' }],
 * })
 *
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.text)
 * }
 * ```
 */
export async function sseStream<T>(
  url: string,
  request: { method: string; args: unknown[] },
  options: SSEStreamOptions = {}
): Promise<StreamResponse<T>> {
  const {
    bufferSize = 16,
    chunkTimeout = 30000,
    autoReconnect = true,
    maxReconnectAttempts = 3,
    onStart,
    onEnd,
    onError,
    onReconnect,
    method = 'POST',
    headers = {},
    auth,
  } = options

  const state: SSEStreamState<T> = {
    id: generateStreamId(),
    closed: false,
    buffer: [],
    waitingResolvers: [],
    eventSource: null,
    lastEventId: null,
    reconnectAttempts: 0,
    error: null,
  }

  // Get auth token if provided
  let authToken: string | null = null
  if (auth) {
    authToken = typeof auth === 'function' ? await auth() : auth
  }

  // Build the request URL with query params for GET or use POST body
  let requestUrl = url
  const requestHeaders: Record<string, string> = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...headers,
  }

  if (authToken) {
    requestHeaders['Authorization'] = `Bearer ${authToken}`
  }

  // For POST requests, we need to use fetch with streaming response
  // For GET requests, we can use EventSource (but it doesn't support custom headers well)
  // We'll use fetch for both to have consistent auth handling

  async function connect(): Promise<void> {
    if (state.closed) return

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          ...requestHeaders,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(request) } : {}),
      }

      // Add Last-Event-ID for reconnection
      if (state.lastEventId) {
        (fetchOptions.headers as Record<string, string>)['Last-Event-ID'] = state.lastEventId
      }

      const response = await fetch(requestUrl, fetchOptions)

      if (!response.ok) {
        throw new ConnectionError(
          `SSE connection failed: ${response.status} ${response.statusText}`,
          'CONNECTION_FAILED',
          response.status >= 500
        )
      }

      if (!response.body) {
        throw new ConnectionError('No response body for SSE stream', 'CONNECTION_FAILED', false)
      }

      onStart?.()
      state.reconnectAttempts = 0

      // Read the SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!state.closed) {
        const { done, value } = await reader.read()

        if (done) {
          handleStreamEnd()
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE messages from buffer
        const messages = parseSSEBuffer(buffer)
        buffer = messages.remaining

        for (const message of messages.messages) {
          handleSSEMessage(message)
        }
      }
    } catch (error) {
      handleStreamError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function parseSSEBuffer(buffer: string): { messages: SSEMessage[]; remaining: string } {
    const messages: SSEMessage[] = []
    const lines = buffer.split('\n')
    let currentMessage: Partial<SSEMessage> = {}
    let dataLines: string[] = []
    let i = 0

    for (; i < lines.length; i++) {
      const line = lines[i]

      // Empty line signals end of message
      if (line === '') {
        if (dataLines.length > 0 || currentMessage.event) {
          messages.push({
            event: currentMessage.event,
            data: dataLines.join('\n'),
            id: currentMessage.id,
            retry: currentMessage.retry,
          })
          currentMessage = {}
          dataLines = []
        }
        continue
      }

      // Check if this is the last line and incomplete (no newline at end)
      if (i === lines.length - 1 && !buffer.endsWith('\n')) {
        break
      }

      // Parse SSE field
      const colonIndex = line.indexOf(':')
      if (colonIndex === 0) {
        // Comment line, ignore
        continue
      }

      const field = colonIndex > 0 ? line.slice(0, colonIndex) : line
      const value = colonIndex > 0 ? line.slice(colonIndex + 1).trimStart() : ''

      switch (field) {
        case 'event':
          currentMessage.event = value
          break
        case 'data':
          dataLines.push(value)
          break
        case 'id':
          currentMessage.id = value
          break
        case 'retry':
          currentMessage.retry = parseInt(value, 10)
          break
      }
    }

    // Return remaining unparsed content
    const remaining = i < lines.length ? lines.slice(i).join('\n') : ''
    return { messages, remaining }
  }

  function handleSSEMessage(message: SSEMessage): void {
    if (state.closed) return

    // Update last event ID for reconnection
    if (message.id) {
      state.lastEventId = message.id
    }

    const eventType = message.event || 'data'

    switch (eventType) {
      case 'data': {
        try {
          const data = JSON.parse(message.data) as T
          enqueueData(data)
        } catch {
          // If data isn't JSON, pass as-is (for text streams)
          enqueueData(message.data as unknown as T)
        }
        break
      }

      case 'error': {
        try {
          const errorData = JSON.parse(message.data) as { message: string; code?: string }
          const error = new RPCError(errorData.message, errorData.code || 'STREAM_ERROR')
          handleStreamError(error)
        } catch {
          handleStreamError(new RPCError(message.data, 'STREAM_ERROR'))
        }
        break
      }

      case 'end': {
        handleStreamEnd()
        break
      }

      case 'heartbeat': {
        // Heartbeat received, connection is alive
        break
      }
    }
  }

  function enqueueData(data: T): void {
    // Check backpressure
    if (state.buffer.length >= bufferSize) {
      // Buffer full - oldest data will be lost if not consumed
      // In a real implementation, we might want to signal backpressure to server
    }

    // If there's a waiting consumer, resolve immediately
    const resolver = state.waitingResolvers.shift()
    if (resolver) {
      resolver.resolve({ value: data, done: false })
    } else {
      state.buffer.push(data)
    }
  }

  function handleStreamEnd(): void {
    if (state.closed) return

    state.closed = true
    onEnd?.()

    // Resolve all waiting consumers with done
    for (const resolver of state.waitingResolvers) {
      resolver.resolve({ value: undefined, done: true })
    }
    state.waitingResolvers.length = 0
  }

  function handleStreamError(error: Error): void {
    if (state.closed) return

    state.error = error
    onError?.(error)

    // Try to reconnect if enabled
    if (autoReconnect && state.reconnectAttempts < maxReconnectAttempts && isRetryableError(error)) {
      state.reconnectAttempts++
      onReconnect?.(state.reconnectAttempts)

      const backoff = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 30000)
      setTimeout(() => connect(), backoff)
      return
    }

    // Fatal error - close stream and reject all waiters
    state.closed = true

    for (const resolver of state.waitingResolvers) {
      resolver.reject(error)
    }
    state.waitingResolvers.length = 0
  }

  function isRetryableError(error: Error): boolean {
    if (error instanceof ConnectionError) {
      return error.retryable
    }
    // Network errors are generally retryable
    return error.message.includes('network') || error.message.includes('fetch')
  }

  // Start the connection
  const connectPromise = connect()

  // Create the StreamResponse
  const streamResponse: StreamResponse<T> = {
    id: state.id,

    get closed() {
      return state.closed
    },

    async next(): Promise<IteratorResult<T, void>> {
      if (state.closed) {
        if (state.error) {
          throw state.error
        }
        return { value: undefined, done: true }
      }

      // Return buffered data if available
      if (state.buffer.length > 0) {
        return { value: state.buffer.shift()!, done: false }
      }

      // Wait for next data
      return new Promise<IteratorResult<T, void>>((resolve, reject) => {
        // Set up timeout
        const timeoutId = setTimeout(() => {
          const index = state.waitingResolvers.findIndex((r) => r.resolve === resolve)
          if (index >= 0) {
            state.waitingResolvers.splice(index, 1)
          }
          reject(ConnectionError.requestTimeout(chunkTimeout))
        }, chunkTimeout)

        state.waitingResolvers.push({
          resolve: (result) => {
            clearTimeout(timeoutId)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timeoutId)
            reject(error)
          },
        })
      })
    },

    async close(): Promise<void> {
      if (state.closed) return

      state.closed = true

      // Resolve all waiters with done
      for (const resolver of state.waitingResolvers) {
        resolver.resolve({ value: undefined, done: true })
      }
      state.waitingResolvers.length = 0
    },

    [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
      return {
        next: () => streamResponse.next(),
        return: async () => {
          await streamResponse.close()
          return { value: undefined, done: true }
        },
      }
    },
  }

  // Wait for initial connection to establish
  await connectPromise

  return streamResponse
}

// ============================================================================
// WebSocket Subscription Implementation
// ============================================================================

/**
 * Options for WebSocket subscription
 */
export interface WSSubscribeOptions extends SubscribeOptions, StreamOptions {
  /** Authentication token */
  auth?: string | (() => string | null | Promise<string | null>)

  /** WebSocket protocols */
  protocols?: string | string[]
}

/**
 * Internal subscription state
 */
interface WSSubscriptionState<T> {
  id: string
  topic: string
  active: boolean
  paused: boolean
  buffer: T[]
  waitingResolvers: Array<{ resolve: (result: IteratorResult<T, void>) => void; reject: (error: Error) => void }>
  ws: WebSocket | null
  reconnectAttempts: number
  error: Error | null
  handlers: {
    data: Set<(data: T) => void>
    error: Set<(error: Error) => void>
    end: Set<() => void>
    reconnect: Set<(attempt: number) => void>
  }
}

/**
 * Create a WebSocket subscription for real-time updates
 *
 * @param url - The WebSocket endpoint URL
 * @param topic - The topic/channel to subscribe to
 * @param options - Subscription configuration options
 * @returns A Subscription that can receive real-time updates
 *
 * @example
 * ```typescript
 * const subscription = await wsSubscribe('wss://api.example.com/rpc/ws', 'users:123', {
 *   filter: { event: 'update' },
 * })
 *
 * subscription.on('data', (event) => {
 *   console.log('User updated:', event)
 * })
 *
 * // Later: unsubscribe
 * await subscription.unsubscribe()
 * ```
 */
export async function wsSubscribe<T>(
  url: string,
  topic: string,
  options: WSSubscribeOptions = {}
): Promise<Subscription<T>> {
  const {
    bufferSize = 100,
    autoReconnect = true,
    maxReconnectAttempts = 3,
    onStart,
    onEnd,
    onError,
    onReconnect,
    auth,
    protocols,
    filter,
    startFrom,
    includeHistory = false,
  } = options

  const state: WSSubscriptionState<T> = {
    id: generateStreamId(),
    topic,
    active: false,
    paused: false,
    buffer: [],
    waitingResolvers: [],
    ws: null,
    reconnectAttempts: 0,
    error: null,
    handlers: {
      data: new Set(),
      error: new Set(),
      end: new Set(),
      reconnect: new Set(),
    },
  }

  // Get auth token if provided
  let authToken: string | null = null
  if (auth) {
    authToken = typeof auth === 'function' ? await auth() : auth
  }

  async function connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // Convert http(s) to ws(s)
        const wsUrl = url.replace(/^http/, 'ws')
        state.ws = new WebSocket(wsUrl, protocols)

        const connectionTimeout = setTimeout(() => {
          if (state.ws?.readyState !== WebSocket.OPEN) {
            state.ws?.close()
            reject(ConnectionError.timeout(30000))
          }
        }, 30000)

        state.ws.onopen = () => {
          clearTimeout(connectionTimeout)

          // Send auth if provided
          if (authToken) {
            state.ws?.send(JSON.stringify({ type: 'auth', token: authToken }))
          }

          // Send subscribe message
          const subscribeMessage: WSSubscriptionMessage = {
            type: 'subscribe',
            subscriptionId: state.id,
            topic,
            filter,
            ...(startFrom !== undefined ? { startFrom } : {}),
            ...(includeHistory ? { includeHistory } : {}),
          }
          state.ws?.send(JSON.stringify(subscribeMessage))
        }

        state.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string) as WSSubscriptionMessage

            switch (message.type) {
              case 'ack': {
                // Subscription confirmed
                if (message.subscriptionId === state.id) {
                  state.active = true
                  state.reconnectAttempts = 0
                  onStart?.()
                  resolve()
                }
                break
              }

              case 'data': {
                if (message.subscriptionId === state.id && !state.paused) {
                  handleData(message.data as T)
                }
                break
              }

              case 'error': {
                if (message.subscriptionId === state.id || !message.subscriptionId) {
                  const error = new RPCError(
                    message.error?.message || 'Subscription error',
                    message.error?.code || 'SUBSCRIPTION_ERROR'
                  )
                  handleError(error)
                  if (!state.active) {
                    reject(error)
                  }
                }
                break
              }

              case 'heartbeat': {
                // Keep-alive received
                break
              }
            }
          } catch {
            // Ignore parse errors
          }
        }

        state.ws.onerror = () => {
          clearTimeout(connectionTimeout)
          const error = ConnectionError.connectionLost('WebSocket error')

          if (!state.active) {
            reject(error)
          } else {
            handleError(error)
          }
        }

        state.ws.onclose = (event) => {
          clearTimeout(connectionTimeout)

          if (state.active && !event.wasClean && autoReconnect && state.reconnectAttempts < maxReconnectAttempts) {
            // Attempt reconnection
            state.reconnectAttempts++
            onReconnect?.(state.reconnectAttempts)

            for (const handler of state.handlers.reconnect) {
              handler(state.reconnectAttempts)
            }

            const backoff = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 30000)
            setTimeout(() => connect().catch(() => {}), backoff)
          } else if (state.active) {
            handleEnd()
          } else if (!state.active) {
            reject(ConnectionError.connectionLost(`WebSocket closed: ${event.code}`))
          }
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  function handleData(data: T): void {
    // Emit to listeners
    for (const handler of state.handlers.data) {
      try {
        handler(data)
      } catch {
        // Ignore handler errors
      }
    }

    // Resolve waiting iterator
    const resolver = state.waitingResolvers.shift()
    if (resolver) {
      resolver.resolve({ value: data, done: false })
    } else if (state.buffer.length < bufferSize) {
      state.buffer.push(data)
    }
    // If buffer is full, drop oldest (or could emit backpressure)
    else {
      state.buffer.shift()
      state.buffer.push(data)
    }
  }

  function handleError(error: Error): void {
    state.error = error
    onError?.(error)

    for (const handler of state.handlers.error) {
      try {
        handler(error)
      } catch {
        // Ignore handler errors
      }
    }

    // Reject waiting resolvers
    for (const resolver of state.waitingResolvers) {
      resolver.reject(error)
    }
    state.waitingResolvers.length = 0
  }

  function handleEnd(): void {
    state.active = false
    onEnd?.()

    for (const handler of state.handlers.end) {
      try {
        handler()
      } catch {
        // Ignore handler errors
      }
    }

    // Resolve waiting resolvers with done
    for (const resolver of state.waitingResolvers) {
      resolver.resolve({ value: undefined, done: true })
    }
    state.waitingResolvers.length = 0
  }

  // Connect and wait for subscription acknowledgment
  await connect()

  // Create the Subscription
  const subscription: Subscription<T> = {
    id: state.id,
    topic: state.topic,

    get active() {
      return state.active
    },

    on(event: 'data' | 'error' | 'end' | 'reconnect', handler: (...args: unknown[]) => void): void {
      switch (event) {
        case 'data':
          state.handlers.data.add(handler as (data: T) => void)
          break
        case 'error':
          state.handlers.error.add(handler as (error: Error) => void)
          break
        case 'end':
          state.handlers.end.add(handler as () => void)
          break
        case 'reconnect':
          state.handlers.reconnect.add(handler as (attempt: number) => void)
          break
      }
    },

    off(event: 'data' | 'error' | 'end' | 'reconnect', handler: (...args: unknown[]) => void): void {
      switch (event) {
        case 'data':
          state.handlers.data.delete(handler as (data: T) => void)
          break
        case 'error':
          state.handlers.error.delete(handler as (error: Error) => void)
          break
        case 'end':
          state.handlers.end.delete(handler as () => void)
          break
        case 'reconnect':
          state.handlers.reconnect.delete(handler as (attempt: number) => void)
          break
      }
    },

    async unsubscribe(): Promise<void> {
      if (!state.active) return

      state.active = false

      // Send unsubscribe message
      if (state.ws?.readyState === WebSocket.OPEN) {
        const unsubscribeMessage: WSSubscriptionMessage = {
          type: 'unsubscribe',
          subscriptionId: state.id,
          topic: state.topic,
        }
        state.ws.send(JSON.stringify(unsubscribeMessage))
        state.ws.close(1000, 'Unsubscribed')
      }

      handleEnd()
    },

    pause(): void {
      state.paused = true
    },

    resume(): void {
      state.paused = false
    },

    async next(): Promise<IteratorResult<T, void>> {
      if (!state.active && state.buffer.length === 0) {
        if (state.error) {
          throw state.error
        }
        return { value: undefined, done: true }
      }

      // Return buffered data if available
      if (state.buffer.length > 0) {
        return { value: state.buffer.shift()!, done: false }
      }

      // Wait for next data
      return new Promise<IteratorResult<T, void>>((resolve, reject) => {
        state.waitingResolvers.push({ resolve, reject })
      })
    },

    [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
      return {
        next: () => subscription.next(),
        return: async () => {
          await subscription.unsubscribe()
          return { value: undefined, done: true }
        },
      }
    },
  }

  return subscription
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a stream helper that wraps an AsyncIterable with StreamResponse interface
 *
 * @param iterable - Any AsyncIterable to wrap
 * @param options - Stream options
 * @returns A StreamResponse wrapping the iterable
 *
 * @example
 * ```typescript
 * // Wrap any async iterable
 * async function* myGenerator() {
 *   yield 1
 *   yield 2
 *   yield 3
 * }
 *
 * const stream = wrapAsyncIterable(myGenerator())
 * for await (const value of stream) {
 *   console.log(value)
 * }
 * ```
 */
export function wrapAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  _options: StreamOptions = {}
): StreamResponse<T> {
  const id = generateStreamId()
  let closed = false
  let iterator: AsyncIterator<T> | null = null

  const getIterator = (): AsyncIterator<T> => {
    if (!iterator) {
      iterator = iterable[Symbol.asyncIterator]()
    }
    return iterator
  }

  const streamResponse: StreamResponse<T> = {
    id,

    get closed() {
      return closed
    },

    async next(): Promise<IteratorResult<T, void>> {
      if (closed) {
        return { value: undefined, done: true }
      }

      try {
        const result = await getIterator().next()
        if (result.done) {
          closed = true
        }
        return result as IteratorResult<T, void>
      } catch (error) {
        closed = true
        throw error
      }
    },

    async close(): Promise<void> {
      if (closed) return

      closed = true

      // Call return on the iterator if available
      if (iterator?.return) {
        await iterator.return(undefined)
      }
    },

    [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
      return {
        next: () => streamResponse.next(),
        return: async () => {
          await streamResponse.close()
          return { value: undefined, done: true }
        },
      }
    },
  }

  return streamResponse
}

/**
 * Collect all values from a stream into an array
 *
 * @param stream - The stream to collect from
 * @returns Promise resolving to array of all values
 *
 * @example
 * ```typescript
 * const stream = await $.ai.generateStream({ prompt: 'Hello' })
 * const chunks = await collectStream(stream)
 * const fullText = chunks.map(c => c.text).join('')
 * ```
 */
export async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = []
  for await (const value of stream) {
    results.push(value)
  }
  return results
}

/**
 * Take the first N values from a stream
 *
 * @param stream - The stream to take from
 * @param count - Number of values to take
 * @returns Promise resolving to array of up to N values
 *
 * @example
 * ```typescript
 * const stream = await $.events.subscribe('all')
 * const first10 = await takeFromStream(stream, 10)
 * ```
 */
export async function takeFromStream<T>(stream: StreamResponse<T>, count: number): Promise<T[]> {
  const results: T[] = []

  for (let i = 0; i < count; i++) {
    const { value, done } = await stream.next()
    if (done) break
    results.push(value)
  }

  return results
}

/**
 * Map values from a stream
 *
 * @param stream - The source stream
 * @param fn - Mapping function
 * @returns A new stream with mapped values
 *
 * @example
 * ```typescript
 * const stream = await $.ai.generateStream({ prompt: 'Hello' })
 * const textStream = mapStream(stream, chunk => chunk.text)
 *
 * for await (const text of textStream) {
 *   process.stdout.write(text)
 * }
 * ```
 */
export function mapStream<T, U>(
  stream: AsyncIterable<T>,
  fn: (value: T) => U | Promise<U>
): AsyncIterable<U> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<U, void, undefined> {
      for await (const value of stream) {
        yield await fn(value)
      }
    },
  }
}

/**
 * Filter values from a stream
 *
 * @param stream - The source stream
 * @param predicate - Filter predicate
 * @returns A new stream with filtered values
 *
 * @example
 * ```typescript
 * const subscription = await $.events.subscribe('all')
 * const errors = filterStream(subscription, event => event.type === 'error')
 *
 * for await (const error of errors) {
 *   console.error('Error event:', error)
 * }
 * ```
 */
export function filterStream<T>(
  stream: AsyncIterable<T>,
  predicate: (value: T) => boolean | Promise<boolean>
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
      for await (const value of stream) {
        if (await predicate(value)) {
          yield value
        }
      }
    },
  }
}
