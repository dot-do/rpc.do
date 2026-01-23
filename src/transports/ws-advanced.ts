/**
 * Advanced WebSocket Transport
 *
 * A robust WebSocket transport for rpc.do with production-ready features:
 * - Automatic reconnection with exponential backoff (1s -> 30s max)
 * - Heartbeat ping-pong every 30 seconds for connection health
 * - Connection state machine: disconnected -> connecting -> connected -> reconnecting -> closed
 * - First-message authentication (token not in URL for security)
 * - Comprehensive event handlers: onConnect, onDisconnect, onReconnecting, onError
 *
 * ## Security: First-Message Authentication
 *
 * This transport implements first-message authentication where the auth token
 * is sent as the first message after the WebSocket connection is established,
 * rather than in the URL query parameters.
 *
 * **Why this is more secure than URL params:**
 * - URL query parameters are often logged by proxies, load balancers, and servers
 * - Browser history and referrer headers can expose URL params
 * - Server access logs typically record full URLs including query strings
 * - First-message auth keeps tokens out of URLs entirely
 *
 * **IMPORTANT: TLS/WSS is required for security**
 * - The token is sent encrypted over the WebSocket connection
 * - Always use `wss://` endpoints in production, never `ws://`
 * - Without TLS, the token can be intercepted in transit
 * - By default, sending tokens over `ws://` is BLOCKED with a ConnectionError
 * - For local development only, set `allowInsecureAuth: true` to override
 *
 * @example
 * ```typescript
 * import { wsAdvanced } from 'rpc.do/transports/ws-advanced'
 * import { RPC } from 'rpc.do'
 *
 * const transport = wsAdvanced('wss://api.example.com/rpc', {
 *   token: 'your-auth-token',
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
 *   onError: (error) => console.error('Error:', error)
 * })
 *
 * const rpc = RPC(transport)
 * await rpc.some.method({ arg: 'value' })
 * ```
 */

import type { Transport } from '../index'
import { ConnectionError, ProtocolVersionError, RPCError } from '../errors'

// ============================================================================
// Constants
// ============================================================================

/** Current protocol version for version negotiation */
export const PROTOCOL_VERSION = '1.0.0'

// ============================================================================
// Types
// ============================================================================

/**
 * Connection state machine states
 */
export type ConnectionState =
  | 'disconnected' // Initial state, not connected
  | 'connecting' // Connection in progress
  | 'connected' // Successfully connected and authenticated
  | 'reconnecting' // Lost connection, attempting to reconnect
  | 'closed' // Explicitly closed, will not reconnect

/**
 * Event handlers for connection lifecycle events
 */
export interface WebSocketEventHandlers {
  /** Called when connection is successfully established and authenticated */
  onConnect?: () => void

  /** Called when connection is lost */
  onDisconnect?: (reason: string, code?: number) => void

  /** Called when attempting to reconnect */
  onReconnecting?: (attempt: number, maxAttempts: number) => void

  /** Called when an error occurs */
  onError?: (error: Error) => void

  /** Called when a message is received (for debugging) */
  onMessage?: (message: ServerMessage) => void
}

/**
 * Configuration options for the advanced WebSocket transport
 */
export interface WebSocketAdvancedOptions extends WebSocketEventHandlers {
  /** Authentication token (sent via first-message auth, not URL) */
  token?: string | (() => string | null | undefined | Promise<string | null | undefined>)

  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean

  /** Maximum reconnection attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number

  /** Initial backoff delay in milliseconds (default: 1000) */
  reconnectBackoff?: number

  /** Maximum backoff delay in milliseconds (default: 30000) */
  maxReconnectBackoff?: number

  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number

  /** Heartbeat interval in milliseconds (default: 30000, 0 to disable) */
  heartbeatInterval?: number

  /** Heartbeat timeout in milliseconds (default: 5000) */
  heartbeatTimeout?: number

  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number

  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number

  /**
   * Allow sending authentication tokens over insecure ws:// connections.
   *
   * **SECURITY WARNING**: This is dangerous and should only be used for local development.
   * Tokens sent over non-TLS connections can be intercepted by network attackers.
   * In production, always use wss:// endpoints.
   *
   * @default false
   */
  allowInsecureAuth?: boolean

  /** Enable debug logging (default: false) */
  debug?: boolean

  /** Behavior when protocol version mismatches: 'error' | 'warn' | 'ignore' (default: 'warn') */
  versionMismatchBehavior?: 'error' | 'warn' | 'ignore'
}

/**
 * Server message types
 */
export interface ServerMessage {
  id?: string | number
  type?: string
  result?: unknown
  error?: { code: string; message: string; data?: unknown }
  version?: string
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  createdAt: number
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_OPTIONS: Required<Omit<WebSocketAdvancedOptions, keyof WebSocketEventHandlers | 'token' | 'debug'>> = {
  autoReconnect: true,
  maxReconnectAttempts: Infinity,
  reconnectBackoff: 1000,
  maxReconnectBackoff: 30000,
  backoffMultiplier: 2,
  heartbeatInterval: 30000,
  heartbeatTimeout: 5000,
  connectTimeout: 10000,
  requestTimeout: 30000,
  allowInsecureAuth: false,
  versionMismatchBehavior: 'warn',
}

// ============================================================================
// WebSocket Advanced Transport Class
// ============================================================================

/**
 * Advanced WebSocket transport with reconnection, heartbeat, and error handling
 */
export class WebSocketAdvancedTransport implements Transport {
  private readonly url: string
  private readonly options: Required<Omit<WebSocketAdvancedOptions, keyof WebSocketEventHandlers | 'token' | 'debug'>> & {
    token?: WebSocketAdvancedOptions['token']
    debug?: boolean
  }
  private readonly handlers: WebSocketEventHandlers

  private ws: WebSocket | null = null
  private _state: ConnectionState = 'disconnected'
  private messageId = 0
  private pendingRequests: Map<string | number, PendingRequest> = new Map()

  // Reconnection state
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closeRequested = false

  // Heartbeat state
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  // Version state
  private serverProtocolVersion: string | null = null
  private versionValidated = false

  constructor(url: string, options: WebSocketAdvancedOptions = {}) {
    // Convert http(s) to ws(s) if needed
    this.url = url.replace(/^http/, 'ws')

    // Split options into config and handlers
    const {
      onConnect,
      onDisconnect,
      onReconnecting,
      onError,
      onMessage,
      token,
      debug,
      ...configOptions
    } = options

    this.options = {
      ...DEFAULT_OPTIONS,
      ...configOptions,
      token,
      debug,
    }

    this.handlers = {
      onConnect,
      onDisconnect,
      onReconnecting,
      onError,
      onMessage,
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this._state
  }

  /**
   * Server's protocol version (available after first message)
   */
  get serverVersion(): string | null {
    return this.serverProtocolVersion
  }

  /**
   * Client's protocol version
   */
  get clientVersion(): string {
    return PROTOCOL_VERSION
  }

  /**
   * Check if transport is connected and ready
   */
  isConnected(): boolean {
    return this._state === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this._state === 'connected' || this._state === 'connecting') {
      return
    }

    this.closeRequested = false
    this.setState('connecting')

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close()
        reject(ConnectionError.timeout(this.options.connectTimeout))
      }, this.options.connectTimeout)

      try {
        // Create WebSocket - token is NOT in URL (first-message auth)
        this.ws = new WebSocket(this.url)
        let hasRejected = false

        this.ws.addEventListener('open', async () => {
          // Send first-message auth if token is provided
          const token = await this.getToken()
          if (token) {
            // Check for insecure connection before sending token
            const insecureError = this.checkInsecureAuth()
            if (insecureError) {
              hasRejected = true
              clearTimeout(timeout)
              this.log('Blocked insecure auth attempt:', insecureError.message)
              this.ws?.close(4002, 'Insecure auth blocked')
              reject(insecureError)
              return
            }

            this.sendAuthMessage(token)
            // Wait for auth_result before resolving
          } else {
            // No auth required - complete connection
            clearTimeout(timeout)
            this.completeConnection()
            resolve()
          }
        })

        this.ws.addEventListener('close', (event) => {
          clearTimeout(timeout)
          this.stopHeartbeat()

          if (hasRejected) return

          if (this._state === 'connecting') {
            reject(new ConnectionError(
              event.reason || 'Connection failed',
              'CONNECTION_FAILED',
              true
            ))
          } else {
            this.handleDisconnect(event.reason || 'Connection closed', event.code)
          }
        })

        this.ws.addEventListener('error', (event) => {
          this.log('WebSocket error:', event)
          // Error handling is done in close event
        })

        this.ws.addEventListener('message', (event) => {
          // Handle auth_result during connection
          if (this._state === 'connecting') {
            try {
              const message = this.parseMessage(event.data)

              if (message.type === 'auth_result') {
                clearTimeout(timeout)
                if ((message as any).success) {
                  this.completeConnection()
                  resolve()
                } else {
                  const errorMessage = message.error?.message || 'Authentication failed'
                  this.ws?.close(4001, errorMessage)
                  reject(ConnectionError.authFailed(errorMessage))
                }
                return
              }
            } catch (error) {
              this.log('Failed to parse auth message:', error)
            }
          }

          this.handleMessage(event.data)
        })
      } catch (error) {
        clearTimeout(timeout)
        reject(new ConnectionError(
          `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
          'CONNECTION_FAILED',
          true
        ))
      }
    })
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    this.close()
  }

  /**
   * Close the connection (alias for disconnect, matches Transport interface)
   */
  close(): void {
    this.closeRequested = true
    this.clearReconnectTimer()
    this.stopHeartbeat()

    // Reject all pending requests
    const closeError = new Error('Connection closed')
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      request.reject(closeError)
      this.pendingRequests.delete(id)
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect')
      }
      this.ws = null
    }

    this.setState('closed')
  }

  /**
   * Send an RPC call (Transport interface)
   */
  async call(method: string, args: any[]): Promise<any> {
    // Auto-connect if needed
    if (!this.isConnected()) {
      await this.connect()
    }

    const id = ++this.messageId

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout after ${this.options.requestTimeout}ms`))
      }, this.options.requestTimeout)

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        createdAt: Date.now(),
      })

      try {
        this.getWebSocket().send(JSON.stringify({
          id,
          method: 'do',
          path: method,
          args,
        }))
        this.log('Sent RPC:', { id, method, args })
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setState(state: ConnectionState): void {
    const previousState = this._state
    this._state = state
    this.log(`State change: ${previousState} -> ${state}`)
  }

  private async getToken(): Promise<string | null> {
    const { token } = this.options
    if (!token) return null
    if (typeof token === 'function') {
      const result = await token()
      return result ?? null
    }
    return token
  }

  /**
   * Get WebSocket instance, throwing descriptive error if not available
   */
  private getWebSocket(): WebSocket {
    if (!this.ws) {
      throw ConnectionError.connectionLost('WebSocket is not available')
    }
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw ConnectionError.connectionLost(`WebSocket is not in OPEN state (current: ${this.ws.readyState})`)
    }
    return this.ws
  }

  /**
   * Check if connection is secure (wss://)
   */
  private isSecureConnection(): boolean {
    const url = new URL(this.url)
    return url.protocol === 'wss:'
  }

  /**
   * Check if sending auth is allowed on this connection
   */
  private checkInsecureAuth(): ConnectionError | null {
    if (!this.isSecureConnection() && !this.options.allowInsecureAuth) {
      return ConnectionError.insecureConnection()
    }
    return null
  }

  /**
   * Send first-message authentication
   */
  private sendAuthMessage(token: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    // Warn if using insecure connection with allowInsecureAuth
    if (!this.isSecureConnection() && this.options.allowInsecureAuth) {
      console.warn(
        '[WebSocketAdvancedTransport] WARNING: Sending authentication token over insecure ws:// connection. ' +
        'This is only safe for local development. Never use ws:// with tokens in production!'
      )
    }

    try {
      this.ws.send(JSON.stringify({
        type: 'auth',
        token,
      }))
      this.log('Sent auth message')
    } catch (error) {
      this.log('Failed to send auth message:', error)
    }
  }

  /**
   * Complete connection setup after auth (if required)
   */
  private completeConnection(): void {
    this.setState('connected')
    this.reconnectAttempts = 0
    this.startHeartbeat()
    this.handlers.onConnect?.()
  }

  /**
   * Parse incoming message
   */
  private parseMessage(data: unknown): ServerMessage {
    if (typeof data === 'string') {
      return JSON.parse(data)
    }
    if (data instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(data))
    }
    throw new Error('Invalid message format')
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: unknown): void {
    try {
      const message = this.parseMessage(data)
      this.log('Received message:', message)

      // Validate protocol version on first message with version
      if (message.version && !this.versionValidated) {
        this.validateVersion(message.version)
      }

      // Handle pong for heartbeat
      if (message.type === 'pong') {
        this.clearHeartbeatTimeout()
        return
      }

      // Handle pending request response
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const request = this.pendingRequests.get(message.id)!
        clearTimeout(request.timeout)
        this.pendingRequests.delete(message.id)

        if (message.error) {
          request.reject(new RPCError(
            message.error.message,
            message.error.code,
            message.error.data
          ))
        } else {
          request.resolve(message.result)
        }
        return
      }

      // Forward to message handler
      this.handlers.onMessage?.(message)
    } catch (error) {
      this.log('Failed to parse message:', error)
      this.handlers.onError?.(
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  /**
   * Validate protocol version
   */
  private validateVersion(serverVersion: string): void {
    this.serverProtocolVersion = serverVersion
    this.versionValidated = true

    if (!ProtocolVersionError.areCompatible(PROTOCOL_VERSION, serverVersion)) {
      const error = new ProtocolVersionError(PROTOCOL_VERSION, serverVersion)

      switch (this.options.versionMismatchBehavior) {
        case 'error':
          this.handlers.onError?.(error)
          this.close()
          break
        case 'warn':
          console.warn(`[WebSocketAdvancedTransport] ${error.message}`)
          break
        case 'ignore':
          // Do nothing
          break
      }
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(reason: string, code?: number): void {
    this.setState('disconnected')
    this.ws = null

    // Reject all pending requests
    const disconnectError = ConnectionError.connectionLost(reason)
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      request.reject(disconnectError)
      this.pendingRequests.delete(id)
    }

    this.handlers.onDisconnect?.(reason, code)

    // Attempt reconnection if configured
    if (
      !this.closeRequested &&
      this.options.autoReconnect &&
      this.reconnectAttempts < this.options.maxReconnectAttempts
    ) {
      this.scheduleReconnect()
    }
  }

  // ============================================================================
  // Reconnection
  // ============================================================================

  private scheduleReconnect(): void {
    this.setState('reconnecting')
    this.reconnectAttempts++

    // Calculate backoff with exponential increase
    const backoff = Math.min(
      this.options.reconnectBackoff * Math.pow(this.options.backoffMultiplier, this.reconnectAttempts - 1),
      this.options.maxReconnectBackoff
    )

    this.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts === Infinity ? '∞' : this.options.maxReconnectAttempts} in ${backoff}ms`
    )

    this.handlers.onReconnecting?.(this.reconnectAttempts, this.options.maxReconnectAttempts)

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch (error) {
        this.log('Reconnection failed:', error)

        if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.scheduleReconnect()
        } else {
          const finalError = ConnectionError.reconnectFailed(this.reconnectAttempts)
          this.handlers.onError?.(finalError)
          this.setState('closed')
        }
      }
    }, backoff)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ============================================================================
  // Heartbeat
  // ============================================================================

  private startHeartbeat(): void {
    if (this.options.heartbeatInterval <= 0) return

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        this.sendPing()
      }
    }, this.options.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.clearHeartbeatTimeout()
  }

  private sendPing(): void {
    try {
      this.ws?.send(JSON.stringify({
        type: 'ping',
        id: `ping-${Date.now()}`,
        timestamp: Date.now(),
      }))

      // Set timeout for pong response
      this.heartbeatTimeoutTimer = setTimeout(() => {
        this.log('Heartbeat timeout - connection may be dead')
        this.handlers.onError?.(ConnectionError.heartbeatTimeout())
        this.ws?.close(4000, 'Heartbeat timeout')
      }, this.options.heartbeatTimeout)
    } catch (error) {
      this.log('Failed to send ping:', error)
    }
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }
  }

  // ============================================================================
  // Logging
  // ============================================================================

  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[WebSocketAdvancedTransport]', ...args)
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an advanced WebSocket transport
 *
 * @example
 * ```typescript
 * import { wsAdvanced } from 'rpc.do/transports/ws-advanced'
 * import { RPC } from 'rpc.do'
 *
 * // Basic usage
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc'))
 *
 * // With authentication and event handlers
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc', {
 *   token: 'your-token',
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
 *   onError: (error) => console.error('Error:', error)
 * }))
 *
 * // With custom reconnection settings
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc', {
 *   autoReconnect: true,
 *   maxReconnectAttempts: 10,
 *   reconnectBackoff: 1000,      // Start at 1s
 *   maxReconnectBackoff: 30000,  // Max 30s
 *   backoffMultiplier: 2,        // Double each time
 * }))
 * ```
 */
export function wsAdvanced(
  url: string,
  options?: WebSocketAdvancedOptions
): WebSocketAdvancedTransport {
  return new WebSocketAdvancedTransport(url, options)
}

// Re-export error types for convenience
export { ConnectionError, ProtocolVersionError, RPCError } from '../errors'
