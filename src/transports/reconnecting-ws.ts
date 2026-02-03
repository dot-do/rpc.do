/**
 * ReconnectingWebSocketTransport - capnweb RpcTransport with resilience features
 *
 * A WebSocket transport implementing capnweb's RpcTransport interface with:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat ping/pong for connection health
 * - First-message authentication (token not in URL)
 * - Message queuing during disconnection
 * - Event callbacks for connection state changes
 *
 * ## Security: First-Message Authentication
 *
 * This transport implements first-message authentication where the auth token
 * is sent as the first message after WebSocket connection, NOT in the URL.
 *
 * **Why this is more secure:**
 * - URL query parameters are logged by proxies, load balancers, servers
 * - Browser history and referrer headers can expose URL params
 * - First-message auth keeps tokens out of URLs entirely
 *
 * **IMPORTANT: TLS/WSS is required**
 * - Always use `wss://` in production
 * - By default, sending tokens over `ws://` is BLOCKED
 * - Set `allowInsecureAuth: true` for local development only
 *
 * @example
 * ```typescript
 * import { ReconnectingWebSocketTransport } from 'rpc.do/transports/reconnecting-ws'
 * import { RpcSession } from '@dotdo/capnweb'
 * import { oauthProvider } from 'rpc.do/auth'
 *
 * const transport = new ReconnectingWebSocketTransport('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
 * })
 *
 * const session = new RpcSession(transport, localMain)
 * ```
 */

import type { RpcTransport } from '@dotdo/capnweb'
import { ConnectionError } from '../errors.js'
import type { AuthProvider } from '../auth.js'
import { loadCapnweb } from '../capnweb-loader.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Connection state machine
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

/**
 * Behavior when the message queue is full
 * - 'error': Throw a ConnectionError with code 'QUEUE_FULL' (default)
 * - 'drop-oldest': Drop the oldest message in the queue to make room
 * - 'drop-newest': Drop the incoming message (don't add to queue)
 */
export type QueueFullBehavior = 'error' | 'drop-oldest' | 'drop-newest'

/**
 * Event handlers for connection lifecycle
 */
export interface ConnectionEventHandlers {
  /** Called when connection is established */
  onConnect?: () => void
  /** Called when connection is lost */
  onDisconnect?: (reason: string) => void
  /** Called when attempting to reconnect */
  onReconnecting?: (attempt: number, maxAttempts: number) => void
  /** Called on any error */
  onError?: (error: Error) => void
}

/**
 * Options for ReconnectingWebSocketTransport
 */
export interface ReconnectingWebSocketOptions extends ConnectionEventHandlers {
  /**
   * Auth provider for first-message authentication
   * Can be from oauth.do, static token, or custom provider
   */
  auth?: AuthProvider

  /**
   * Whether to automatically reconnect on disconnect
   * @default true
   */
  autoReconnect?: boolean

  /**
   * Maximum number of reconnection attempts
   * @default Infinity
   */
  maxReconnectAttempts?: number

  /**
   * Initial backoff delay in ms
   * @default 1000
   */
  reconnectBackoff?: number

  /**
   * Maximum backoff delay in ms
   * @default 30000
   */
  maxReconnectBackoff?: number

  /**
   * Backoff multiplier for exponential backoff
   * @default 2
   */
  backoffMultiplier?: number

  /**
   * Heartbeat interval in ms (0 to disable)
   * @default 30000
   */
  heartbeatInterval?: number

  /**
   * Heartbeat timeout in ms
   * @default 5000
   */
  heartbeatTimeout?: number

  /**
   * Allow sending auth tokens over insecure ws:// connections
   * WARNING: Only use for local development
   * @default false
   */
  allowInsecureAuth?: boolean

  /**
   * Maximum number of messages to queue while disconnected
   * @default 1000
   */
  maxQueueSize?: number

  /**
   * Behavior when the message queue is full
   * - 'error': Throw a ConnectionError with code 'QUEUE_FULL' (default)
   * - 'drop-oldest': Drop the oldest message in the queue to make room
   * - 'drop-newest': Drop the incoming message (don't add to queue)
   * @default 'error'
   */
  queueFullBehavior?: QueueFullBehavior

  /**
   * Timeout in ms for ensureConnected to wait for a connection
   * If the connection is not established within this time, the promise is rejected
   * @default 30000
   */
  connectionTimeout?: number

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
}

/**
 * Pending receive entry
 */
interface PendingReceive {
  resolve: (message: string) => void
  reject: (error: Error) => void
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RECONNECT_BACKOFF = 1000
const DEFAULT_MAX_RECONNECT_BACKOFF = 30000
const DEFAULT_BACKOFF_MULTIPLIER = 2
const DEFAULT_HEARTBEAT_INTERVAL = 30000
const DEFAULT_HEARTBEAT_TIMEOUT = 5000
const DEFAULT_MAX_QUEUE_SIZE = 1000
const DEFAULT_CONNECTION_TIMEOUT = 30000

// ============================================================================
// ReconnectingWebSocketTransport
// ============================================================================

/**
 * WebSocket transport with reconnection, heartbeat, and first-message auth
 * Implements capnweb's RpcTransport interface
 */
export class ReconnectingWebSocketTransport implements RpcTransport {
  private url: string
  private options: Omit<Required<Omit<ReconnectingWebSocketOptions, keyof ConnectionEventHandlers | 'auth'>>, never> & ConnectionEventHandlers & { auth?: AuthProvider }
  private ws: WebSocket | null = null
  private state: ConnectionState = 'disconnected'

  // Message queues
  private messageQueue: string[] = []
  private receiveQueue: PendingReceive[] = []
  private sendQueue: string[] = []

  // Reconnection state
  private reconnectAttempts = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private currentBackoff: number

  // Heartbeat state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatPending = false
  private lastPongTime = 0

  // Auth state
  private authSent = false

  // Bound handler references (created once, reused across reconnections)
  private readonly boundHandleMessage: (event: MessageEvent) => void
  private readonly boundHandleClose: (event: CloseEvent) => void
  private readonly boundHandleError: (event: Event) => void

  constructor(url: string, options: ReconnectingWebSocketOptions = {}) {
    this.url = url
    this.currentBackoff = options.reconnectBackoff ?? DEFAULT_RECONNECT_BACKOFF

    // Create bound handlers once for reuse across reconnections (Bug fix: rpc.do-4o6)
    this.boundHandleMessage = this.handleMessage.bind(this)
    this.boundHandleClose = this.handleClose.bind(this)
    this.boundHandleError = this.handleError.bind(this)

    // Build options object, only adding defined values to satisfy exactOptionalPropertyTypes
    const opts: typeof this.options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      reconnectBackoff: options.reconnectBackoff ?? DEFAULT_RECONNECT_BACKOFF,
      maxReconnectBackoff: options.maxReconnectBackoff ?? DEFAULT_MAX_RECONNECT_BACKOFF,
      backoffMultiplier: options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER,
      heartbeatInterval: options.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTimeout: options.heartbeatTimeout ?? DEFAULT_HEARTBEAT_TIMEOUT,
      allowInsecureAuth: options.allowInsecureAuth ?? false,
      maxQueueSize: options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      queueFullBehavior: options.queueFullBehavior ?? 'error',
      connectionTimeout: options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      debug: options.debug ?? false,
    }
    // Only add optional properties if they are defined
    if (options.auth !== undefined) opts.auth = options.auth
    if (options.onConnect !== undefined) opts.onConnect = options.onConnect
    if (options.onDisconnect !== undefined) opts.onDisconnect = options.onDisconnect
    if (options.onReconnecting !== undefined) opts.onReconnecting = options.onReconnecting
    if (options.onError !== undefined) opts.onError = options.onError
    this.options = opts
  }

  // ==========================================================================
  // RpcTransport Interface
  // ==========================================================================

  /**
   * Send a message to the server
   * Queues if not connected, sends immediately if connected
   */
  async send(message: string): Promise<void> {
    // Ensure connection is established
    await this.ensureConnected()

    if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message)
      this.log('Sent:', message.slice(0, 100))
    } else {
      // Enforce queue size limit (Bug fix: rpc.do-zt0) with backpressure handling (rpc.do-n0z)
      const shouldQueue = this.enforceSendQueueLimit()
      if (shouldQueue) {
        this.sendQueue.push(message)
        this.log('Queued for send:', message.slice(0, 100))
      }
    }
  }

  /**
   * Receive a message from the server
   * Returns a promise that resolves when a message is available
   */
  receive(): Promise<string> {
    // If there's a queued message, return it immediately
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!)
    }

    // If closed, reject
    if (this.state === 'closed') {
      return Promise.reject(ConnectionError.connectionLost('Transport is closed'))
    }

    // Wait for a message
    return new Promise<string>((resolve, reject) => {
      this.receiveQueue.push({ resolve, reject })
    })
  }

  /**
   * Abort the transport
   */
  abort(reason: unknown): void {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.log('Aborting:', error.message)
    this.close(error)
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Ensure the WebSocket is connected
   */
  private async ensureConnected(): Promise<void> {
    if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.state === 'closed') {
      throw ConnectionError.connectionLost('Transport is closed')
    }

    if (this.state === 'connecting' || this.state === 'reconnecting') {
      // Wait for connection with timeout (Bug fix: rpc.do-82f)
      return new Promise((resolve, reject) => {
        const timeout = this.options.connectionTimeout
        const startTime = Date.now()
        const checkConnection = () => {
          if (this.state === 'connected') {
            resolve()
          } else if (this.state === 'closed') {
            reject(ConnectionError.connectionLost('Transport is closed'))
          } else if (Date.now() - startTime >= timeout) {
            reject(ConnectionError.timeout(timeout))
          } else {
            setTimeout(checkConnection, 50)
          }
        }
        checkConnection()
      })
    }

    // Start connection
    await this.connect()
  }

  /**
   * Connect to the WebSocket server
   */
  private async connect(): Promise<void> {
    if (this.state === 'connecting' || this.state === 'connected') {
      return
    }

    this.state = 'connecting'
    this.log('Connecting to', this.url)

    return new Promise<void>((resolve, reject) => {
      try {
        // Convert http(s) to ws(s)
        const wsUrl = this.url.replace(/^http/, 'ws')
        this.ws = new WebSocket(wsUrl)

        const onOpen = async () => {
          this.log('WebSocket opened')
          cleanup()

          try {
            // Send auth as first message if configured
            await this.sendAuth()

            this.state = 'connected'
            this.reconnectAttempts = 0
            this.currentBackoff = this.options.reconnectBackoff
            this.authSent = true

            // Start heartbeat
            this.startHeartbeat()

            // Flush send queue
            this.flushSendQueue()

            this.options.onConnect?.()
            resolve()
          } catch (authError) {
            this.log('Auth failed:', authError)
            this.ws?.close(4001, 'Auth failed')
            reject(authError)
          }
        }

        const onError = (event: Event) => {
          this.log('WebSocket error:', event)
          cleanup()
          const error = ConnectionError.connectionLost('WebSocket connection failed')
          this.options.onError?.(error)
          reject(error)
        }

        const onClose = (event: CloseEvent) => {
          this.log('WebSocket closed:', event.code, event.reason)
          cleanup()
          reject(ConnectionError.connectionLost(`WebSocket closed: ${event.code}`))
        }

        const cleanup = () => {
          this.ws?.removeEventListener('open', onOpen)
          this.ws?.removeEventListener('error', onError)
          this.ws?.removeEventListener('close', onClose)
        }

        this.ws.addEventListener('open', onOpen)
        this.ws.addEventListener('error', onError)
        this.ws.addEventListener('close', onClose)

        // Set up permanent handlers using stored bound references (Bug fix: rpc.do-4o6)
        this.ws.addEventListener('message', this.boundHandleMessage)
        this.ws.addEventListener('close', this.boundHandleClose)
        this.ws.addEventListener('error', this.boundHandleError)
      } catch (error) {
        this.state = 'disconnected'
        reject(error)
      }
    })
  }

  /**
   * Send auth token as first message
   */
  private async sendAuth(): Promise<void> {
    if (!this.options.auth) return

    const token = await this.options.auth()
    if (!token) return

    // Security check: block auth over insecure connections
    if (!this.options.allowInsecureAuth && this.url.startsWith('ws://')) {
      throw ConnectionError.insecureConnection()
    }

    // Send auth message
    this.ws?.send(JSON.stringify({
      type: 'auth',
      token,
    }))
    this.log('Sent auth token')
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: MessageEvent): void {
    const data = typeof event.data === 'string' ? event.data : String(event.data)
    this.log('Received:', data.slice(0, 100))

    // Check for heartbeat pong
    try {
      const msg = JSON.parse(data)
      // Validate pong message structure (Bug fix: rpc.do-ucy)
      // Ensure msg is a valid object with type === 'pong' before processing
      if (this.isValidPongMessage(msg)) {
        this.heartbeatPending = false
        this.lastPongTime = Date.now()
        return
      }
    } catch {
      // Not JSON, treat as regular message
    }

    // If there's a pending receive, resolve it
    const pending = this.receiveQueue.shift()
    if (pending) {
      pending.resolve(data)
      return
    }

    // Otherwise queue the message (enforce limit: rpc.do-zt0) with backpressure handling (rpc.do-n0z)
    try {
      const shouldQueue = this.enforceMessageQueueLimit()
      if (shouldQueue) {
        this.messageQueue.push(data)
      }
    } catch (error) {
      // For 'error' behavior, we log and emit the error since handleMessage is sync
      // The message is dropped in this case
      this.log('Message queue full, message dropped:', error)
      this.options.onError?.(error as Error)
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    this.log('Connection closed:', event.code, event.reason)
    this.stopHeartbeat()

    // Check if this was an explicit close() call (state would be 'closed')
    const wasExplicitClose = this.state === 'closed'
    const wasConnected = this.state === 'connected'

    // Only update state if not explicitly closed
    if (!wasExplicitClose) {
      this.state = 'disconnected'
    }
    this.ws = null
    this.authSent = false

    this.options.onDisconnect?.(event.reason || `Code: ${event.code}`)

    // Attempt reconnection if enabled and not explicitly closed
    if (!wasExplicitClose && wasConnected && this.options.autoReconnect) {
      this.scheduleReconnect()
    } else if (!wasExplicitClose) {
      // Reject all pending receives (unless already done by close())
      this.rejectPendingReceives(ConnectionError.connectionLost('Connection closed'))
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError(event: Event): void {
    this.log('Connection error:', event)
    const error = ConnectionError.connectionLost('WebSocket error')
    this.options.onError?.(error)
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.state === 'closed') return
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached')
      this.rejectPendingReceives(ConnectionError.reconnectFailed(this.reconnectAttempts))
      return
    }

    this.state = 'reconnecting'
    this.reconnectAttempts++
    this.options.onReconnecting?.(this.reconnectAttempts, this.options.maxReconnectAttempts)

    this.log(`Reconnecting in ${this.currentBackoff}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // Increase backoff for next attempt
        this.currentBackoff = Math.min(
          this.currentBackoff * this.options.backoffMultiplier,
          this.options.maxReconnectBackoff
        )
        this.scheduleReconnect()
      }
    }, this.currentBackoff)
  }

  /**
   * Flush queued messages after reconnection
   */
  private flushSendQueue(): void {
    while (this.sendQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const message = this.sendQueue.shift()!
      this.ws.send(message)
      this.log('Flushed queued message')
    }
  }

  /**
   * Reject all pending receive promises
   */
  private rejectPendingReceives(error: Error): void {
    while (this.receiveQueue.length > 0) {
      const pending = this.receiveQueue.shift()!
      pending.reject(error)
    }
  }

  /**
   * Shared helper to enforce queue size limit based on queueFullBehavior
   * @param queue - The queue array to check and potentially modify
   * @param maxSize - Maximum allowed queue size
   * @param behavior - The QueueFullBehavior to apply when queue is full
   * @param queueName - Name of the queue for logging and error messages ('send' or 'receive')
   * @returns true if the message should be added, false if it should be dropped
   * @throws ConnectionError if behavior is 'error' and queue is full
   */
  private enforceQueueLimit(
    queue: string[],
    maxSize: number,
    behavior: QueueFullBehavior,
    queueName: 'send' | 'receive'
  ): boolean {
    if (queue.length < maxSize) {
      return true // Queue has room
    }

    switch (behavior) {
      case 'error':
        throw ConnectionError.queueFull(queueName, maxSize)

      case 'drop-oldest':
        queue.shift()
        this.log(`${queueName} queue full, dropped oldest message (drop-oldest behavior)`)
        return true // Make room and allow the new message

      case 'drop-newest':
        this.log(`${queueName} queue full, dropping incoming message (drop-newest behavior)`)
        return false // Don't add the new message

      default:
        // Exhaustive check - should never happen
        throw ConnectionError.queueFull(queueName, maxSize)
    }
  }

  /**
   * Enforce message queue size limit based on queueFullBehavior
   * @returns true if the message should be added, false if it should be dropped
   * @throws ConnectionError if queueFullBehavior is 'error' and queue is full
   */
  private enforceMessageQueueLimit(): boolean {
    return this.enforceQueueLimit(
      this.messageQueue,
      this.options.maxQueueSize,
      this.options.queueFullBehavior,
      'receive'
    )
  }

  /**
   * Enforce send queue size limit based on queueFullBehavior
   * @returns true if the message should be added, false if it should be dropped
   * @throws ConnectionError if queueFullBehavior is 'error' and queue is full
   */
  private enforceSendQueueLimit(): boolean {
    return this.enforceQueueLimit(
      this.sendQueue,
      this.options.maxQueueSize,
      this.options.queueFullBehavior,
      'send'
    )
  }

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.options.heartbeatInterval <= 0) return

    this.stopHeartbeat()
    this.lastPongTime = Date.now()

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, this.options.heartbeatInterval)
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.heartbeatPending = false
  }

  /**
   * Send heartbeat ping
   */
  private sendHeartbeat(): void {
    if (this.state !== 'connected' || !this.ws) return

    // Check if last heartbeat timed out
    if (this.heartbeatPending) {
      const timeSinceLastPong = Date.now() - this.lastPongTime
      if (timeSinceLastPong > this.options.heartbeatTimeout + this.options.heartbeatInterval) {
        this.log('Heartbeat timeout')
        this.options.onError?.(ConnectionError.heartbeatTimeout())
        this.ws.close(4002, 'Heartbeat timeout')
        return
      }
    }

    this.heartbeatPending = true
    this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }))
    this.log('Sent heartbeat ping')
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Close the transport
   */
  close(error?: Error): void {
    if (this.state === 'closed') return

    this.log('Closing transport')
    this.state = 'closed'

    // Clear timers
    this.stopHeartbeat()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close(1000, 'Transport closed')
      } catch {
        // Ignore close errors
      }
      this.ws = null
    }

    // Reject pending receives
    const closeError = error ?? ConnectionError.connectionLost('Transport closed')
    this.rejectPendingReceives(closeError)

    // Clear queues
    this.messageQueue.length = 0
    this.sendQueue.length = 0
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Get the current depth of the message queues
   *
   * Useful for monitoring backpressure and implementing custom flow control.
   *
   * @returns Object with send and receive queue depths
   *
   * @example
   * ```typescript
   * const depth = transport.getQueueDepth()
   * console.log(`Send queue: ${depth.send}/${depth.maxSize}`)
   * console.log(`Receive queue: ${depth.receive}/${depth.maxSize}`)
   *
   * // Implement custom backpressure
   * if (depth.send > depth.maxSize * 0.8) {
   *   console.warn('Send queue is 80% full, consider slowing down')
   * }
   * ```
   */
  getQueueDepth(): { send: number; receive: number; maxSize: number } {
    return {
      send: this.sendQueue.length,
      receive: this.messageQueue.length,
      maxSize: this.options.maxQueueSize,
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[ReconnectingWS]', ...args)
    }
  }

  /**
   * Validate pong message structure (Bug fix: rpc.do-ucy)
   *
   * Ensures the parsed message is a valid pong message with proper structure.
   * This guards against malformed messages that could cause unexpected behavior.
   *
   * @param msg - The parsed JSON message to validate
   * @returns true if msg is a valid pong message, false otherwise
   */
  private isValidPongMessage(msg: unknown): boolean {
    // Check that msg is a non-null object
    if (typeof msg !== 'object' || msg === null) {
      this.log('Invalid pong: not an object')
      return false
    }

    // Check that msg has a 'type' property
    if (!('type' in msg)) {
      return false
    }

    // Check that type is exactly 'pong'
    const typedMsg = msg as { type: unknown }
    if (typedMsg.type !== 'pong') {
      return false
    }

    return true
  }
}

/**
 * Create a reconnecting WebSocket transport
 *
 * @example
 * ```typescript
 * import { reconnectingWs } from 'rpc.do/transports/reconnecting-ws'
 * import { RpcSession } from '@dotdo/capnweb'
 * import { oauthProvider } from 'rpc.do/auth'
 *
 * const transport = reconnectingWs('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   onConnect: () => console.log('Connected!'),
 * })
 *
 * const session = new RpcSession(transport)
 * ```
 */
export function reconnectingWs(
  url: string,
  options?: ReconnectingWebSocketOptions
): ReconnectingWebSocketTransport {
  return new ReconnectingWebSocketTransport(url, options)
}

// ============================================================================
// Convenience: Bidirectional RPC Session
// ============================================================================

/**
 * Options for creating an RPC session
 */
export interface RpcSessionOptions extends ReconnectingWebSocketOptions {
  /**
   * Local RPC target to expose to the server (for bidirectional RPC)
   * The server can call methods on this target
   */
  localMain?: unknown
}

/**
 * Create a bidirectional RPC session with reconnection support
 *
 * This is the recommended way to connect to a capnweb RPC server.
 * Combines ReconnectingWebSocketTransport with capnweb's RpcSession.
 *
 * @example
 * ```typescript
 * import { createRpcSession } from 'rpc.do/transports/reconnecting-ws'
 * import { oauthProvider } from 'rpc.do/auth'
 *
 * // Unidirectional: client calls server
 * const { session, api } = await createRpcSession<ServerAPI>('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 * })
 * await api.users.get('123')
 *
 * // Bidirectional: client and server can call each other
 * const clientHandler = {
 *   notify: (message: string) => console.log('Server says:', message),
 *   onUpdate: (data: unknown) => updateUI(data),
 * }
 *
 * const { session, api } = await createRpcSession<ServerAPI>('wss://api.example.com/rpc', {
 *   auth: oauthProvider(),
 *   localMain: clientHandler,  // Server can call clientHandler methods
 * })
 *
 * // Subscribe to updates - server will call clientHandler.onUpdate()
 * await api.subscribe('updates')
 * ```
 */
export async function createRpcSession<T = unknown>(
  url: string,
  options: RpcSessionOptions = {}
): Promise<{
  transport: ReconnectingWebSocketTransport
  session: unknown
  api: T
}> {
  const { localMain, ...transportOptions } = options

  // Create transport
  const transport = new ReconnectingWebSocketTransport(url, transportOptions)

  // Load capnweb via centralized loader
  const capnwebModule = await loadCapnweb()

  // Create session with optional local target for bidirectional RPC
  const session = new capnwebModule.RpcSession(transport, localMain)

  // Get remote API stub
  const api = session.getRemoteMain() as T

  return { transport, session, api }
}
