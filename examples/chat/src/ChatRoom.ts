/**
 * ChatRoom Durable Object
 *
 * A real-time chat room that demonstrates rpc.do patterns:
 * - RPC methods: join, sendMessage, getHistory
 * - Durable Object storage for message persistence
 * - WebSocket broadcasting to connected clients
 */

import { DurableObject } from 'cloudflare:workers'

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>
}

export interface ChatMessage {
  id: string
  username: string
  text: string
  timestamp: number
}

export interface JoinResult {
  success: boolean
  username: string
  recentMessages: ChatMessage[]
}

export interface SendResult {
  success: boolean
  message: ChatMessage
}

/**
 * ChatRoom Durable Object
 *
 * Handles real-time chat with persistent storage and WebSocket broadcasting.
 */
export class ChatRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, { username: string }> = new Map()

  /**
   * Handle incoming fetch requests (WebSocket upgrades and RPC)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade for real-time connections
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request)
    }

    // Handle HTTP RPC requests
    if (request.method === 'POST') {
      return this.handleRpc(request)
    }

    return new Response('Chat Room - Use WebSocket or POST for RPC', { status: 200 })
  }

  /**
   * Handle WebSocket connections for real-time updates
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept the WebSocket connection
    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle incoming WebSocket messages
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string)
      const { id, method, path, args = [] } = data

      let result: unknown
      let error: { code: string; message: string } | undefined

      try {
        // Route to RPC methods
        switch (path) {
          case 'join':
            result = await this.join(args[0], ws)
            break
          case 'sendMessage':
            result = await this.sendMessage(args[0], ws)
            break
          case 'getHistory':
            result = await this.getHistory(args[0])
            break
          case 'leave':
            result = await this.leave(ws)
            break
          default:
            error = { code: 'UNKNOWN_METHOD', message: `Unknown method: ${path}` }
        }
      } catch (e) {
        error = {
          code: 'RPC_ERROR',
          message: e instanceof Error ? e.message : String(e)
        }
      }

      // Send response
      ws.send(JSON.stringify({ id, result, error }))
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e)
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await this.leave(ws)
  }

  /**
   * Handle HTTP RPC requests
   */
  private async handleRpc(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { method?: string; path?: string; args?: unknown[] }
      const { path, args = [] } = body

      let result: unknown

      switch (path) {
        case 'getHistory':
          result = await this.getHistory(args[0] as number | undefined)
          break
        default:
          return Response.json(
            { error: `Method ${path} requires WebSocket connection` },
            { status: 400 }
          )
      }

      return Response.json(result)
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : 'RPC error' },
        { status: 500 }
      )
    }
  }

  // ==========================================================================
  // RPC Methods
  // ==========================================================================

  /**
   * Join the chat room
   *
   * @param username - The username to join with
   * @param ws - The WebSocket connection (for real-time updates)
   * @returns Join result with recent messages
   */
  async join(username: string, ws?: WebSocket): Promise<JoinResult> {
    if (!username || typeof username !== 'string') {
      throw new Error('Username is required')
    }

    // Clean username
    const cleanUsername = username.trim().slice(0, 32)

    if (ws) {
      // Register the session
      this.sessions.set(ws, { username: cleanUsername })

      // Broadcast join event to other users
      this.broadcast({
        type: 'user_joined',
        username: cleanUsername,
        timestamp: Date.now()
      }, ws)
    }

    // Get recent messages for the joining user
    const recentMessages = await this.getHistory(50)

    return {
      success: true,
      username: cleanUsername,
      recentMessages
    }
  }

  /**
   * Send a message to the chat room
   *
   * @param text - The message text
   * @param ws - The WebSocket connection of the sender
   * @returns Send result with the created message
   */
  async sendMessage(text: string, ws?: WebSocket): Promise<SendResult> {
    if (!text || typeof text !== 'string') {
      throw new Error('Message text is required')
    }

    // Get the username from the session
    const session = ws ? this.sessions.get(ws) : null
    if (!session) {
      throw new Error('Must join the room before sending messages')
    }

    // Create the message
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      username: session.username,
      text: text.trim().slice(0, 1000), // Limit message length
      timestamp: Date.now()
    }

    // Store the message
    await this.storeMessage(message)

    // Broadcast to all connected clients (including sender for confirmation)
    this.broadcast({
      type: 'message',
      message
    })

    return {
      success: true,
      message
    }
  }

  /**
   * Get message history
   *
   * @param limit - Maximum number of messages to return (default: 100)
   * @returns Array of messages, most recent last
   */
  async getHistory(limit: number = 100): Promise<ChatMessage[]> {
    const safeLimit = Math.min(Math.max(1, limit || 100), 1000)

    // Get messages from storage
    const messages: ChatMessage[] = []
    const stored = await this.ctx.storage.list<ChatMessage>({
      prefix: 'msg:',
      reverse: true,
      limit: safeLimit
    })

    for (const [, message] of stored) {
      messages.unshift(message) // Reverse order so oldest first
    }

    return messages
  }

  /**
   * Leave the chat room
   */
  async leave(ws: WebSocket): Promise<{ success: boolean }> {
    const session = this.sessions.get(ws)
    if (session) {
      this.sessions.delete(ws)

      // Broadcast leave event
      this.broadcast({
        type: 'user_left',
        username: session.username,
        timestamp: Date.now()
      }, ws)
    }

    return { success: true }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Store a message in Durable Object storage
   */
  private async storeMessage(message: ChatMessage): Promise<void> {
    // Use timestamp-based key for chronological ordering
    const key = `msg:${message.timestamp}:${message.id}`
    await this.ctx.storage.put(key, message)

    // Cleanup old messages (keep last 1000)
    await this.cleanupOldMessages()
  }

  /**
   * Clean up old messages to prevent unbounded storage growth
   */
  private async cleanupOldMessages(): Promise<void> {
    const stored = await this.ctx.storage.list<ChatMessage>({
      prefix: 'msg:',
      reverse: true
    })

    const keys = Array.from(stored.keys())
    if (keys.length > 1000) {
      const keysToDelete = keys.slice(1000)
      await this.ctx.storage.delete(keysToDelete)
    }
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   *
   * @param data - The data to broadcast
   * @param exclude - Optional WebSocket to exclude from broadcast
   */
  private broadcast(data: unknown, exclude?: WebSocket): void {
    const message = JSON.stringify(data)

    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(message)
        } catch (e) {
          // Client disconnected, will be cleaned up
        }
      }
    }
  }
}
