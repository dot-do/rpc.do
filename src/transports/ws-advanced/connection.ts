/**
 * Connection management for the Advanced WebSocket Transport
 *
 * Handles WebSocket lifecycle:
 * - WebSocket creation
 * - Connection state machine
 * - Event listeners setup
 * - Message parsing and routing
 */

import type { Transport } from '../../index'
import { ConnectionError, ProtocolVersionError, RPCError } from '../../errors'
import {
  type ConnectionState,
  type ServerMessage,
  type PendingRequest,
  type WebSocketAdvancedOptions,
  type WebSocketEventHandlers,
  type ResolvedOptions,
  PROTOCOL_VERSION,
  DEFAULT_OPTIONS,
} from './types'
import { getToken, checkInsecureAuth, sendAuthMessage, handleAuthMessage } from './auth'
import { startHeartbeat, stopHeartbeat, sendPing, clearHeartbeatTimeout } from './heartbeat'
import { scheduleReconnect, clearReconnectTimer, shouldReconnect, calculateBackoff } from './reconnection'

/**
 * Advanced WebSocket transport with reconnection, heartbeat, and error handling
 */
export class WebSocketAdvancedTransport implements Transport {
  private readonly url: string
  private readonly options: ResolvedOptions
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
   * Connect to the WebSocket server.
   *
   * This method orchestrates the connection process:
   * 1. Creates a new WebSocket connection
   * 2. Sets up event listeners for connection lifecycle
   * 3. Handles authentication if a token is provided
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

        // Set up event listeners with connection callbacks
        this.setupEventListeners(this.ws, timeout, resolve, reject)
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
    this.reconnectTimer = clearReconnectTimer(this.reconnectTimer)
    const timers = stopHeartbeat(this.heartbeatTimer, this.heartbeatTimeoutTimer)
    this.heartbeatTimer = timers.heartbeatTimer
    this.heartbeatTimeoutTimer = timers.heartbeatTimeoutTimer

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
  // Connection Setup Methods
  // ============================================================================

  /**
   * Set up WebSocket event listeners for connection handling.
   *
   * This method configures all necessary event listeners on the WebSocket:
   * - open: Triggers authentication flow
   * - close: Handles disconnection and potential reconnection
   * - error: Logs errors (actual handling in close event)
   * - message: Routes messages to auth or general message handling
   */
  private setupEventListeners(
    ws: WebSocket,
    timeout: ReturnType<typeof setTimeout>,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    let hasRejected = false

    ws.addEventListener('open', async () => {
      try {
        const setRejected = () => { hasRejected = true }
        await this.handleOpenEvent(timeout, resolve, reject, setRejected)
      } catch (error) {
        if (!hasRejected) {
          hasRejected = true
          clearTimeout(timeout)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

    ws.addEventListener('close', (event) => {
      clearTimeout(timeout)
      const timers = stopHeartbeat(this.heartbeatTimer, this.heartbeatTimeoutTimer)
      this.heartbeatTimer = timers.heartbeatTimer
      this.heartbeatTimeoutTimer = timers.heartbeatTimeoutTimer

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

    ws.addEventListener('error', (event) => {
      this.log('WebSocket error:', event)
      // Error handling is done in close event
    })

    ws.addEventListener('message', (event) => {
      const authResult = this.handleAuthMessageWrapper(event.data, timeout, resolve, reject, hasRejected)
      if (authResult) {
        if (authResult === 'rejected') {
          hasRejected = true
        }
        return
      }
      this.handleMessage(event.data)
    })
  }

  /**
   * Handle the WebSocket open event and initiate authentication if needed.
   *
   * If a token is configured:
   * 1. Validates the connection is secure (wss://) unless allowInsecureAuth is set
   * 2. Sends the auth message
   * 3. Waits for auth_result (handled in message listener)
   *
   * If no token is configured, completes the connection immediately.
   */
  private async handleOpenEvent(
    timeout: ReturnType<typeof setTimeout>,
    resolve: () => void,
    reject: (error: Error) => void,
    setRejected: () => void
  ): Promise<void> {
    const token = await getToken(this.options)
    if (token) {
      const insecureError = checkInsecureAuth(this.url, this.options.allowInsecureAuth)
      if (insecureError) {
        this.log('Blocked insecure auth attempt:', insecureError.message)
        // Set rejected flag BEFORE closing to prevent close handler from rejecting with wrong error
        setRejected()
        clearTimeout(timeout)
        reject(insecureError)
        this.ws?.close(4002, 'Insecure auth blocked')
        return
      }

      sendAuthMessage(this.ws!, token, this.url, this.options.allowInsecureAuth, this.log.bind(this))
      // Wait for auth_result before resolving (handled in message listener)
    } else {
      // No auth required - complete connection
      clearTimeout(timeout)
      this.completeConnection()
      resolve()
    }
  }

  /**
   * Wrapper for handleAuthMessage that integrates with the transport
   */
  private handleAuthMessageWrapper(
    data: unknown,
    timeout: ReturnType<typeof setTimeout>,
    resolve: () => void,
    reject: (error: Error) => void,
    hasRejected: boolean
  ): 'resolved' | 'rejected' | false {
    if (this._state !== 'connecting' || hasRejected) {
      return false
    }

    const result = handleAuthMessage(
      data,
      this.parseMessage.bind(this),
      timeout,
      () => {},  // Will be handled after
      reject,
      this.ws,
      this.log.bind(this)
    )

    if (result === 'resolved') {
      this.completeConnection()
      resolve()
    }

    return result
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setState(state: ConnectionState): void {
    const previousState = this._state
    this._state = state
    this.log(`State change: ${previousState} -> ${state}`)
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
   * Complete connection setup after auth (if required)
   */
  private completeConnection(): void {
    this.setState('connected')
    this.reconnectAttempts = 0
    this.heartbeatTimer = startHeartbeat(
      this.options.heartbeatInterval,
      () => this.isConnected(),
      () => this.doSendPing()
    )
    this.handlers.onConnect?.()
  }

  /**
   * Send ping and set up timeout
   */
  private doSendPing(): void {
    this.heartbeatTimeoutTimer = sendPing(
      this.ws,
      this.options.heartbeatTimeout,
      this.handlers.onError,
      this.log.bind(this)
    )
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
        this.heartbeatTimeoutTimer = clearHeartbeatTimeout(this.heartbeatTimeoutTimer)
        return
      }

      // Handle pending request response
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const request = this.pendingRequests.get(message.id)!
        clearTimeout(request.timeout)
        this.pendingRequests.delete(message.id)

        // Discriminated union: if error is defined, result is undefined and vice versa
        if (message.error !== undefined) {
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
    if (shouldReconnect(
      this.closeRequested,
      this.options.autoReconnect,
      this.reconnectAttempts,
      this.options.maxReconnectAttempts
    )) {
      this.doScheduleReconnect()
    }
  }

  // ============================================================================
  // Reconnection
  // ============================================================================

  private doScheduleReconnect(): void {
    this.setState('reconnecting')
    this.reconnectAttempts++

    const backoff = calculateBackoff(
      this.reconnectAttempts,
      this.options.reconnectBackoff,
      this.options.backoffMultiplier,
      this.options.maxReconnectBackoff
    )

    this.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts === Infinity ? '\u221e' : this.options.maxReconnectAttempts} in ${backoff}ms`
    )

    this.handlers.onReconnecting?.(this.reconnectAttempts, this.options.maxReconnectAttempts)

    this.reconnectTimer = scheduleReconnect(
      backoff,
      async () => {
        try {
          await this.connect()
        } catch (error) {
          this.log('Reconnection failed:', error)

          if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
            this.doScheduleReconnect()
          } else {
            const finalError = ConnectionError.reconnectFailed(this.reconnectAttempts)
            this.handlers.onError?.(finalError)
            this.setState('closed')
          }
        }
      }
    )
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
