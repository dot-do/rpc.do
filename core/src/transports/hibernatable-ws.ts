/**
 * HibernatableWebSocketTransport - capnweb RpcTransport for Cloudflare hibernation
 *
 * This transport bridges capnweb's RpcSession with Cloudflare's WebSocket hibernation API.
 * Unlike standard WebSocket transports, this one:
 * - Works with ctx.acceptWebSocket() hibernation API
 * - Queues messages between hibernation wakeups
 * - Can be "resumed" when the DO wakes from hibernation
 *
 * @example
 * ```typescript
 * // In DurableRPC.handleWebSocketUpgrade:
 * const transport = new HibernatableWebSocketTransport(ws)
 * const session = new RpcSession(transport, this)
 *
 * // Store transport reference for webSocketMessage handler
 * ws.serializeAttachment({ transportId: transport.id })
 * this._transports.set(transport.id, transport)
 *
 * // In webSocketMessage:
 * const { transportId } = ws.deserializeAttachment()
 * const transport = this._transports.get(transportId)
 * transport.enqueueMessage(message)
 * ```
 */

import type { RpcTransport } from 'capnweb'

/**
 * Message queue entry with resolve/reject for receive() promises
 */
interface PendingReceive {
  resolve: (message: string) => void
  reject: (error: Error) => void
}

/**
 * RpcTransport implementation for Cloudflare DO hibernation
 */
export class HibernatableWebSocketTransport implements RpcTransport {
  /** Unique ID for this transport (used for attachment serialization) */
  readonly id: string

  /** The hibernatable WebSocket */
  private ws: WebSocket

  /** Queue of messages received while no receive() was pending */
  private messageQueue: string[] = []

  /** Queue of pending receive() promises waiting for messages */
  private receiveQueue: PendingReceive[] = []

  /** Whether the transport is closed */
  private closed = false

  /** Error that caused closure (if any) */
  private closeError?: Error

  constructor(ws: WebSocket, id?: string) {
    this.ws = ws
    this.id = id ?? crypto.randomUUID()
  }

  /**
   * Send a message to the client via WebSocket
   */
  async send(message: string): Promise<void> {
    if (this.closed) {
      throw this.closeError ?? new Error('Transport is closed')
    }

    try {
      this.ws.send(message)
    } catch (error: any) {
      this.handleError(error)
      throw error
    }
  }

  /**
   * Receive a message from the client
   *
   * If messages are queued, returns immediately.
   * Otherwise, returns a promise that resolves when enqueueMessage() is called.
   */
  receive(): Promise<string> {
    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error('Transport is closed'))
    }

    // If there's a queued message, return it immediately
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!)
    }

    // Otherwise, wait for a message
    return new Promise<string>((resolve, reject) => {
      this.receiveQueue.push({ resolve, reject })
    })
  }

  /**
   * Abort the transport due to an error
   */
  abort(reason: any): void {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    this.handleError(error)

    try {
      this.ws.close(1011, error.message.slice(0, 123)) // WebSocket reason max 123 bytes
    } catch {
      // Ignore errors when closing
    }
  }

  /**
   * Enqueue a message received from webSocketMessage handler
   *
   * This is called by DurableRPC.webSocketMessage to feed messages to the transport.
   */
  enqueueMessage(message: string): void {
    if (this.closed) return

    // If there's a pending receive(), resolve it immediately
    const pending = this.receiveQueue.shift()
    if (pending) {
      pending.resolve(message)
      return
    }

    // Otherwise, queue the message
    this.messageQueue.push(message)
  }

  /**
   * Handle WebSocket close
   */
  handleClose(code: number, reason: string): void {
    if (this.closed) return

    const error = new Error(`WebSocket closed: ${code} ${reason}`)
    this.handleError(error)
  }

  /**
   * Handle WebSocket error
   */
  handleError(error: Error): void {
    if (this.closed) return

    this.closed = true
    this.closeError = error

    // Reject all pending receives
    while (this.receiveQueue.length > 0) {
      const pending = this.receiveQueue.shift()!
      pending.reject(error)
    }

    // Clear message queue
    this.messageQueue.length = 0
  }

  /**
   * Check if the transport is closed
   */
  get isClosed(): boolean {
    return this.closed
  }

  /**
   * Get the underlying WebSocket
   */
  getWebSocket(): WebSocket {
    return this.ws
  }
}

/**
 * Transport registry for managing transports across hibernation wakeups
 *
 * Since we can't serialize the transport itself, we store transports in a map
 * and serialize only the transport ID in the WebSocket attachment.
 */
export class TransportRegistry {
  private transports = new Map<string, HibernatableWebSocketTransport>()

  /**
   * Register a new transport
   */
  register(transport: HibernatableWebSocketTransport): void {
    this.transports.set(transport.id, transport)
  }

  /**
   * Get a transport by ID
   */
  get(id: string): HibernatableWebSocketTransport | undefined {
    return this.transports.get(id)
  }

  /**
   * Remove a transport from the registry
   */
  remove(id: string): boolean {
    return this.transports.delete(id)
  }

  /**
   * Get all registered transports
   */
  all(): HibernatableWebSocketTransport[] {
    return Array.from(this.transports.values())
  }

  /**
   * Clear all transports
   */
  clear(): void {
    this.transports.clear()
  }
}
