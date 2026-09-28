// Copyright (c) 2025 dot.do
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit
//
// Carried over from the @dotdo/capnweb fork (github.com/dot-do/capnweb, src/hibernatable-ws.ts at
// 1456f51) when rpc.do moved to upstream `capnweb`. Upstream has no equivalent: it is the one
// runtime addition the fork made. It only depends on capnweb's public `RpcTransport` interface.
//
// KEEP IN SYNC: `core/src/hibernatable-ws.ts` (@dotdo/rpc) and `src/hibernatable-ws.ts`
// (rpc.do/server) are identical copies, because the two packages publish separately and neither
// depends on the other at runtime. `tests/hibernatable-ws.test.ts` fails if they drift.

/**
 * HibernatableWebSocketTransport - RpcTransport for Cloudflare DO hibernation API
 *
 * This transport bridges capnweb's RpcSession with Cloudflare's WebSocket hibernation API.
 * Unlike standard WebSocket transports that use event listeners, this one:
 * - Works with ctx.acceptWebSocket() hibernation API
 * - Queues messages delivered through the DO's webSocketMessage handler
 *
 * ## ⚠ AN RPC SESSION DOES NOT SURVIVE A HIBERNATION CYCLE, AND THE FAILURE IS SILENT
 *
 * This was measured against local workerd in dot-do/capnweb `__tests__/hibernation.test.ts`, not reasoned
 * about. After the runtime evicts the Durable Object and wakes it on the next inbound frame:
 *
 * | observable                       | after the wake |
 * |----------------------------------|----------------|
 * | Durable Object class constructed | **again** — every instance field is a new object |
 * | `ctx.getWebSockets().length`     | 1 — the socket is still connected |
 * | `ws.deserializeAttachment()`     | intact — the transport id is still there |
 * | the {@link TransportRegistry}    | **empty** |
 * | the client's next RPC call       | **never returns**: no error, no close frame, no signal |
 *
 * The registry is per-instance memory (see the note on {@link TransportRegistry}), so the
 * post-wake lookup misses. **And rebuilding the transport does not fix it**: `RpcSessionImpl`
 * holds its `exports` and `imports` tables as arrays of live `StubHook` objects (capnweb `src/rpc.ts`),
 * which are not serializable in principle. A woken Durable Object cannot reconstruct a peer's
 * import table, so wire ids from before the sleep address nothing.
 *
 * **So the supported pattern is: detect the wake and close the socket with a defined code that
 * the client treats as a reconnect signal.** A reconnect re-runs whatever handshake the
 * application performs, which is also why hibernation becomes an authorization refresh rather
 * than an authorization hole. The example below is that pattern. The previous example in this
 * docstring taught the broken one.
 *
 * @example
 * ```typescript
 * // In your Durable Object. `epoch` is a fresh value per constructed instance; because a wake
 * // constructs the class again, an attachment stamped with a DIFFERENT epoch is proof that the
 * // session on the other end of this socket belongs to an instance that no longer exists.
 * export class SessionDo extends DurableObject {
 *   epoch = crypto.randomUUID()
 *   transports = new TransportRegistry()
 *
 *   async fetch(request: Request) {
 *     // ... authenticate BEFORE accepting; never accept-then-authenticate ...
 *     const [client, server] = Object.values(new WebSocketPair())
 *     this.ctx.acceptWebSocket(server)
 *     const transport = new HibernatableWebSocketTransport(server)
 *     this.transports.register(transport)
 *     server.serializeAttachment({ epoch: this.epoch, transportId: transport.id })
 *     new RpcSession(transport, myApi)
 *     return new Response(null, { status: 101, webSocket: client })
 *   }
 *
 *   webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
 *     const { epoch, transportId } = ws.deserializeAttachment()
 *     if (epoch !== this.epoch) {
 *       // Woken. The session this socket belonged to is gone and cannot be rebuilt.
 *       ws.close(4001, 'reconnect')
 *       return
 *     }
 *     const transport = this.transports.get(transportId)
 *     if (transport && typeof message === 'string') transport.enqueueMessage(message)
 *   }
 *
 *   webSocketClose(ws: WebSocket, code: number, reason: string) {
 *     const { epoch, transportId } = ws.deserializeAttachment()
 *     if (epoch !== this.epoch) return
 *     this.transports.get(transportId)?.handleClose(code, reason)
 *   }
 * }
 * ```
 */

import type { RpcTransport } from "capnweb";

/**
 * Message queue entry with resolve/reject for receive() promises
 */
export interface PendingReceive {
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
   * This is called by your DO's webSocketMessage to feed messages to the transport.
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
   * Handle WebSocket close - call from webSocketClose handler
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
 * Transport registry, scoped to ONE Durable Object instance.
 *
 * Since we can't serialize the transport itself, we store transports in a map and serialize only
 * the transport ID in the WebSocket attachment.
 *
 * ⚠ **This map does not, and cannot, survive a hibernation wake.** A wake constructs the Durable
 * Object class again, so the woken instance holds a *different, empty* registry, and every
 * transport id in every surviving socket attachment resolves to `undefined`. The header note on
 * {@link HibernatableWebSocketTransport} carries the measurement and the pattern that works;
 * dot-do/capnweb `__tests__/hibernation.test.ts` is the test. The name of this class used to say "across
 * hibernation wakeups", which is the opposite of what it does.
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

  /**
   * Get the number of active transports
   */
  get size(): number {
    return this.transports.size
  }
}
