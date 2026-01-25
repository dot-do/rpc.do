/**
 * Chat Client
 *
 * Demonstrates using rpc.do's wsAdvanced transport for real-time chat.
 * This client provides typed RPC calls with automatic reconnection.
 */

import { RPC, type RPCProxy } from 'rpc.do'
import { wsAdvanced, type WebSocketAdvancedTransport } from 'rpc.do/transports/ws-advanced'

// =============================================================================
// Types
// =============================================================================

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
 * Chat room API shape for typed RPC calls
 */
export interface ChatRoomAPI {
  join: (username: string) => JoinResult
  sendMessage: (text: string) => SendResult
  getHistory: (limit?: number) => ChatMessage[]
  leave: () => { success: boolean }
}

/**
 * Server push message types
 */
export type ServerEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'user_joined'; username: string; timestamp: number }
  | { type: 'user_left'; username: string; timestamp: number }

/**
 * Event handlers for chat events
 */
export interface ChatEventHandlers {
  onMessage?: (message: ChatMessage) => void
  onUserJoined?: (username: string) => void
  onUserLeft?: (username: string) => void
  onConnect?: () => void
  onDisconnect?: (reason: string) => void
  onReconnecting?: (attempt: number) => void
  onError?: (error: Error) => void
}

// =============================================================================
// Chat Client Class
// =============================================================================

/**
 * Chat client with typed RPC and real-time event handling
 *
 * @example
 * ```typescript
 * const chat = new ChatClient('wss://chat.example.com/room/my-room', {
 *   onMessage: (msg) => console.log(`${msg.username}: ${msg.text}`),
 *   onUserJoined: (user) => console.log(`${user} joined`),
 *   onUserLeft: (user) => console.log(`${user} left`),
 * })
 *
 * await chat.connect()
 * const { recentMessages } = await chat.join('alice')
 * await chat.sendMessage('Hello, everyone!')
 * ```
 */
export class ChatClient {
  private transport: WebSocketAdvancedTransport
  private rpc: RPCProxy<ChatRoomAPI>
  private handlers: ChatEventHandlers
  private _username: string | null = null

  constructor(url: string, handlers: ChatEventHandlers = {}) {
    this.handlers = handlers

    // Create the advanced WebSocket transport
    this.transport = wsAdvanced(url, {
      // Reconnection settings
      autoReconnect: true,
      maxReconnectAttempts: Infinity,
      reconnectBackoff: 1000,
      maxReconnectBackoff: 30000,
      backoffMultiplier: 2,

      // Heartbeat settings
      heartbeatInterval: 30000,
      heartbeatTimeout: 5000,

      // Timeouts
      connectTimeout: 10000,
      requestTimeout: 30000,

      // For local development, allow ws://
      // In production, always use wss://
      allowInsecureAuth: url.startsWith('ws://localhost') || url.startsWith('ws://127.0.0.1'),

      // Event handlers
      onConnect: () => {
        this.handlers.onConnect?.()
        // Re-join if we had a username (reconnection scenario)
        if (this._username) {
          this.rejoin()
        }
      },

      onDisconnect: (reason) => {
        this.handlers.onDisconnect?.(reason)
      },

      onReconnecting: (attempt) => {
        this.handlers.onReconnecting?.(attempt)
      },

      onError: (error) => {
        this.handlers.onError?.(error)
      },

      // Handle server push messages
      onMessage: (message) => {
        this.handleServerEvent(message as unknown as ServerEvent)
      },
    })

    // Create typed RPC proxy
    this.rpc = RPC<ChatRoomAPI>(this.transport)
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Current username (if joined)
   */
  get username(): string | null {
    return this._username
  }

  /**
   * Connection state
   */
  get state() {
    return this.transport.state
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.transport.isConnected()
  }

  /**
   * Connect to the chat server
   */
  async connect(): Promise<void> {
    await this.transport.connect()
  }

  /**
   * Disconnect from the chat server
   */
  disconnect(): void {
    this._username = null
    this.transport.close()
  }

  /**
   * Join the chat room
   */
  async join(username: string): Promise<JoinResult> {
    const result = await this.rpc.join(username)
    this._username = result.username
    return result
  }

  /**
   * Send a message
   */
  async sendMessage(text: string): Promise<SendResult> {
    if (!this._username) {
      throw new Error('Must join the room before sending messages')
    }
    return this.rpc.sendMessage(text)
  }

  /**
   * Get message history
   */
  async getHistory(limit?: number): Promise<ChatMessage[]> {
    return this.rpc.getHistory(limit)
  }

  /**
   * Leave the chat room
   */
  async leave(): Promise<void> {
    if (this._username) {
      await this.rpc.leave()
      this._username = null
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Handle server push events
   */
  private handleServerEvent(event: ServerEvent): void {
    if (!event || typeof event !== 'object' || !('type' in event)) {
      return
    }

    switch (event.type) {
      case 'message':
        this.handlers.onMessage?.(event.message)
        break
      case 'user_joined':
        this.handlers.onUserJoined?.(event.username)
        break
      case 'user_left':
        this.handlers.onUserLeft?.(event.username)
        break
    }
  }

  /**
   * Re-join after reconnection
   */
  private async rejoin(): Promise<void> {
    if (this._username) {
      try {
        await this.rpc.join(this._username)
      } catch (error) {
        console.error('Failed to rejoin after reconnection:', error)
        this.handlers.onError?.(
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a chat client
 *
 * @example
 * ```typescript
 * import { createChatClient } from './client'
 *
 * const chat = createChatClient('wss://chat.example.com/room/general', {
 *   onMessage: (msg) => {
 *     console.log(`[${msg.username}] ${msg.text}`)
 *   },
 *   onUserJoined: (user) => {
 *     console.log(`* ${user} joined the room`)
 *   },
 *   onUserLeft: (user) => {
 *     console.log(`* ${user} left the room`)
 *   },
 * })
 *
 * await chat.connect()
 * await chat.join('alice')
 * await chat.sendMessage('Hello!')
 * ```
 */
export function createChatClient(
  url: string,
  handlers?: ChatEventHandlers
): ChatClient {
  return new ChatClient(url, handlers)
}

// =============================================================================
// Example Usage (for demonstration)
// =============================================================================

/**
 * Example: Basic chat client usage
 *
 * ```typescript
 * import { createChatClient } from './client'
 *
 * async function main() {
 *   const chat = createChatClient('wss://chat.example.com/room/general', {
 *     onMessage: (msg) => console.log(`${msg.username}: ${msg.text}`),
 *     onUserJoined: (user) => console.log(`${user} joined`),
 *     onUserLeft: (user) => console.log(`${user} left`),
 *     onConnect: () => console.log('Connected!'),
 *     onDisconnect: (reason) => console.log('Disconnected:', reason),
 *     onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
 *   })
 *
 *   // Connect and join
 *   await chat.connect()
 *   const { recentMessages } = await chat.join('alice')
 *
 *   // Show recent messages
 *   for (const msg of recentMessages) {
 *     console.log(`[history] ${msg.username}: ${msg.text}`)
 *   }
 *
 *   // Send a message
 *   await chat.sendMessage('Hello, everyone!')
 *
 *   // Later: disconnect
 *   // chat.disconnect()
 * }
 * ```
 */

export default ChatClient
