/**
 * rpc.do/server - Capnweb server utilities with convenience wrappers
 *
 * Re-exports capnweb/server and adds helpers for common patterns.
 *
 * @example
 * // Wrap any object/SDK as an RpcTarget and serve it
 * import { createTarget, createHandler } from 'rpc.do/server'
 * import esbuild from 'esbuild'
 *
 * const target = createTarget(esbuild)
 * export default { fetch: createHandler(target) }
 *
 * @example
 * // Use handleRpc for authenticated WebSocket + HTTP batch
 * import { handleRpc, RpcTarget } from 'rpc.do/server'
 *
 * class MyTarget extends RpcTarget {
 *   greet(name: string) { return `Hello, ${name}!` }
 * }
 *
 * export default {
 *   fetch(req: Request) {
 *     return handleRpc(req, ({ userId }) => new MyTarget(), {
 *       authenticate: async (token) => token || null,
 *     })
 *   }
 * }
 */

// Re-export everything from capnweb/server
export {
  RpcTarget,
  RpcSession,
  RpcStub,
  newWorkersRpcResponse,
  newHttpBatchRpcResponse,
  HibernatableWebSocketTransport,
  TransportRegistry,
  serialize,
  deserialize,
} from '@dotdo/capnweb/server'

export type {
  RpcCompatible,
  RpcSessionOptions,
  RpcTransport,
} from '@dotdo/capnweb/server'

import { RpcTarget, RpcSession, newHttpBatchRpcResponse, newWorkersRpcResponse } from '@dotdo/capnweb/server'
import type { RpcTransport } from '@dotdo/capnweb/server'
import { wrapObjectAsTarget, DEFAULT_SKIP_PROPS } from './utils/wrap-target'

// ============================================================================
// handleRpc — Unified HTTP batch + WebSocket auth handler
// ============================================================================

/**
 * Options for handleRpc()
 */
export interface HandleRpcOptions {
  /** Validate a token and return a userId, or null to reject */
  authenticate?: (token: string) => Promise<string | null> | string | null
  /** Default userId when no auth is provided (default: 'anonymous') */
  anonymousId?: string
  /** Milliseconds to wait for the first-message auth frame (default: 10000) */
  authTimeout?: number
  /**
   * Override the capnweb functions used internally.
   * Use this in monorepos where multiple copies of @dotdo/capnweb exist
   * (pnpm peer dependency resolution can cause class identity mismatches).
   * Pass functions from YOUR copy of @dotdo/capnweb/server.
   */
  capnweb?: {
    newHttpBatchRpcResponse?: (request: Request, localMain: unknown) => Promise<Response>
    RpcSession?: new (transport: RpcTransport, localMain: unknown) => unknown
  }
}

/**
 * Context passed to the target factory
 */
export interface HandleRpcContext {
  /** The authenticated user ID (or anonymousId if unauthenticated) */
  userId: string
}

/**
 * A WebSocket transport that intercepts the first message for authentication.
 *
 * When connected, the first message received is checked:
 * - If it's `{ type: 'auth', token: '...' }`, it's consumed for auth validation
 *   and NOT passed to the RpcSession's readLoop.
 * - If it's any other message, it's treated as a normal protocol message
 *   (anonymous connection) and delivered to receive() normally.
 *
 * After auth resolution, all subsequent messages flow through to RpcSession.
 *
 * This class implements the capnweb `RpcTransport` interface via duck typing,
 * so it works with any copy of capnweb (no class identity / instanceof issues).
 *
 * @example
 * import { RpcSession, newWorkersRpcResponse } from '@dotdo/capnweb/server'
 * import { AuthenticatingWebSocketTransport } from 'rpc.do/server'
 *
 * const pair = new WebSocketPair()
 * pair[1].accept()
 * const transport = new AuthenticatingWebSocketTransport(pair[1], myAuthFn)
 * const userId = await transport.getAuthResult()
 * const target = createTarget(userId)
 * new RpcSession(transport, target)
 * return new Response(null, { status: 101, webSocket: pair[0] })
 */
export class AuthenticatingWebSocketTransport implements RpcTransport {
  private ws: WebSocket
  private messageQueue: string[] = []
  private receiveWaiters: Array<{ resolve: (msg: string) => void; reject: (err: Error) => void }> = []
  private closed = false
  private closeError: Error | null = null

  private authResolve!: (userId: string | null) => void
  private authPromise: Promise<string | null>

  constructor(
    ws: WebSocket,
    private authenticate?: (token: string) => Promise<string | null> | string | null,
    private anonymousId = 'anonymous',
    private authTimeout = 10000,
  ) {
    this.ws = ws
    let firstMessage = true

    this.authPromise = new Promise<string | null>((resolve) => {
      this.authResolve = resolve
    })

    // Set up auth timeout
    const timer = setTimeout(() => {
      // If auth hasn't resolved yet, resolve as anonymous
      if (firstMessage) {
        firstMessage = false
        this.authResolve(this.anonymousId)
      }
    }, this.authTimeout)

    ws.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : ''

      if (firstMessage) {
        firstMessage = false
        clearTimeout(timer)

        // Try to parse as auth message
        try {
          const parsed = JSON.parse(data)
          if (parsed && typeof parsed === 'object' && parsed.type === 'auth' && typeof parsed.token === 'string') {
            // This is an auth message — consume it, don't pass to RpcSession
            this.handleAuth(parsed.token)
            return
          }
        } catch {
          // Not JSON — not an auth message, fall through
        }

        // Not an auth message — resolve as anonymous and deliver as normal message
        this.authResolve(this.anonymousId)
        this.deliverMessage(data)
        return
      }

      // Subsequent messages: check for heartbeat ping, otherwise deliver normally
      try {
        const parsed = JSON.parse(data)
        if (parsed && typeof parsed === 'object' && parsed.type === 'ping') {
          // Respond to heartbeat ping with pong
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', t: parsed.t }))
          }
          return
        }
      } catch {
        // Not JSON — normal capnweb message
      }

      this.deliverMessage(data)
    })

    ws.addEventListener('close', () => {
      this.closed = true
      this.closeError = this.closeError ?? new Error('WebSocket closed')
      // Resolve auth if still pending
      if (firstMessage) {
        firstMessage = false
        clearTimeout(timer)
        this.authResolve(this.anonymousId)
      }
      this.rejectWaiters()
    })

    ws.addEventListener('error', (event) => {
      this.closed = true
      this.closeError = new Error('WebSocket error')
      if (firstMessage) {
        firstMessage = false
        clearTimeout(timer)
        this.authResolve(null)
      }
      this.rejectWaiters()
    })
  }

  private async handleAuth(token: string): Promise<void> {
    if (!this.authenticate) {
      // No authenticator — use token as userId
      this.authResolve(token || this.anonymousId)
      return
    }
    try {
      const userId = await this.authenticate(token)
      this.authResolve(userId)
    } catch {
      this.authResolve(null)
    }
  }

  private deliverMessage(data: string): void {
    if (this.receiveWaiters.length > 0) {
      const waiter = this.receiveWaiters.shift()!
      waiter.resolve(data)
    } else {
      this.messageQueue.push(data)
    }
  }

  private rejectWaiters(): void {
    const err = this.closeError ?? new Error('WebSocket closed')
    for (const waiter of this.receiveWaiters) {
      waiter.reject(err)
    }
    this.receiveWaiters = []
  }

  /** Wait for auth to complete and return the userId (or null if rejected) */
  getAuthResult(): Promise<string | null> {
    return this.authPromise
  }

  // --- RpcTransport interface ---

  async send(message: string): Promise<void> {
    if (this.closed) throw this.closeError ?? new Error('WebSocket closed')
    this.ws.send(message)
  }

  receive(): Promise<string> {
    if (this.messageQueue.length > 0) {
      return Promise.resolve(this.messageQueue.shift()!)
    }
    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error('WebSocket closed'))
    }
    return new Promise<string>((resolve, reject) => {
      this.receiveWaiters.push({ resolve, reject })
    })
  }

  abort(reason: unknown): void {
    this.closed = true
    this.closeError = reason instanceof Error ? reason : new Error(String(reason))
    this.rejectWaiters()
    try {
      this.ws.close(1011, 'RPC session aborted')
    } catch {
      // Already closed
    }
  }
}

/**
 * Unified handler for capnweb RPC requests with first-message WebSocket auth.
 *
 * Handles both HTTP batch and WebSocket upgrade requests:
 *
 * **HTTP path**: Extracts Bearer token from Authorization header → calls
 * `authenticate()` → creates target with userId → delegates to
 * `newHttpBatchRpcResponse`.
 *
 * **WebSocket path**: Accepts the WebSocket, creates an
 * `AuthenticatingWebSocketTransport` that intercepts the first message
 * as `{ type: 'auth', token }`, validates the token, then creates a
 * `RpcSession` with the authenticated target. The auth message is consumed
 * before `readLoop()` starts — capnweb never sees it.
 *
 * @param request - Incoming HTTP or WebSocket upgrade request
 * @param targetFactory - Creates an RpcTarget per connection, receives auth context
 * @param options - Authentication configuration
 *
 * @example
 * import { handleRpc } from 'rpc.do/server'
 *
 * export default {
 *   fetch(req: Request) {
 *     return handleRpc(req, ({ userId }) => createMyTarget(userId), {
 *       authenticate: async (token) => {
 *         const user = await verifyToken(token)
 *         return user?.id ?? null
 *       },
 *     })
 *   }
 * }
 */
export async function handleRpc(
  request: Request,
  targetFactory: (context: HandleRpcContext) => RpcTarget,
  options?: HandleRpcOptions,
): Promise<Response> {
  const anonymousId = options?.anonymousId ?? 'anonymous'
  const isUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket'

  if (!isUpgrade) {
    // HTTP batch path — extract Bearer token from Authorization header
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    let userId = anonymousId

    if (token && options?.authenticate) {
      const result = await options.authenticate(token)
      userId = result ?? anonymousId
    } else if (token) {
      userId = token
    }

    const target = targetFactory({ userId })
    const httpHandler = options?.capnweb?.newHttpBatchRpcResponse ?? newHttpBatchRpcResponse
    return httpHandler(request, target)
  }

  // WebSocket upgrade path — use WebSocketPair + AuthenticatingWebSocketTransport
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]

  // Accept the server side of the WebSocket
  server.accept()

  // Create our authenticating transport that intercepts the first message.
  // Event listeners are registered synchronously in the constructor —
  // messages are buffered until the RpcSession's readLoop calls receive().
  const transport = new AuthenticatingWebSocketTransport(
    server,
    options?.authenticate,
    anonymousId,
    options?.authTimeout ?? 10000,
  )

  // IMPORTANT: We must NOT await auth before returning the 101 response.
  // The client can only send the auth message AFTER receiving the 101 upgrade.
  // Awaiting here would deadlock (server waits for auth, client waits for 101).
  //
  // Instead, set up the RpcSession asynchronously: the transport buffers all
  // messages until readLoop calls receive(). Auth message is consumed by the
  // transport's event listener, and subsequent messages are queued for readLoop.
  const SessionCtor = options?.capnweb?.RpcSession ?? RpcSession
  transport.getAuthResult().then((userId) => {
    if (userId === null) {
      server.close(4001, 'Authentication failed')
      return
    }
    const target = targetFactory({ userId })
    new SessionCtor(transport, target)
  })

  // Return the 101 Switching Protocols response immediately
  return new Response(null, { status: 101, webSocket: client })
}

// ============================================================================
// Convenience wrappers
// ============================================================================

/** Properties to skip when wrapping a plain object as an RpcTarget */
const DEFAULT_SKIP = new Set([...DEFAULT_SKIP_PROPS])

/**
 * Wrap a plain object/SDK as an RpcTarget, recursively converting namespace
 * objects into sub-RpcTargets so the entire API is callable over capnweb RPC.
 *
 * @param obj - The object whose methods should be exposed
 * @param opts - Optional configuration
 * @param opts.skip - Property names to exclude from RPC exposure
 *
 * @example
 * import esbuild from 'esbuild'
 * import { createTarget, createHandler } from 'rpc.do/server'
 *
 * const target = createTarget(esbuild)
 * export default { fetch: createHandler(target) }
 *
 * @example
 * // With env
 * const target = createTarget(new Stripe(env.STRIPE_SECRET_KEY))
 *
 * @example
 * // Skip specific methods
 * const target = createTarget(sdk, { skip: ['internal', 'debug'] })
 */
export function createTarget(obj: object, opts?: { skip?: string[] }): RpcTarget {
  const skip = opts?.skip
    ? new Set([...DEFAULT_SKIP, ...opts.skip])
    : DEFAULT_SKIP

  return wrapObjectAsTarget(obj, { skip })
}

/**
 * Create a fetch handler from an RpcTarget.
 *
 * Returns a function suitable as a Worker's `fetch` handler that speaks
 * capnweb protocol (HTTP batch + WebSocket upgrade).
 *
 * @example
 * import { createTarget, createHandler } from 'rpc.do/server'
 *
 * const handler = createHandler(createTarget(myService))
 * export default { fetch: handler }
 */
export function createHandler(target: RpcTarget): (req: Request) => Promise<Response> {
  return (req) => newWorkersRpcResponse(req, target)
}
