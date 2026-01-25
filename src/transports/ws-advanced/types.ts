/**
 * Type definitions for the Advanced WebSocket Transport
 */

import type { Transport } from '../../index'

// ============================================================================
// Constants
// ============================================================================

/** Current protocol version for version negotiation */
export const PROTOCOL_VERSION = '1.0.0'

// ============================================================================
// Connection State Types
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

// ============================================================================
// Message Types
// ============================================================================

/**
 * Server message types - discriminated union for result vs error responses
 * This allows TypeScript to narrow types based on presence of result vs error
 */
export type ServerMessage =
  | { id?: string | number; type?: string; result: unknown; error?: undefined; version?: string }
  | { id?: string | number; type?: string; result?: undefined; error: { code: string; message: string; data?: unknown }; version?: string }

/**
 * Pending request tracking
 */
export interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  createdAt: number
}

// ============================================================================
// Event Handler Types
// ============================================================================

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

// ============================================================================
// Options Types
// ============================================================================

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

// ============================================================================
// Internal Options Types
// ============================================================================

/**
 * Resolved options with defaults applied (excluding handlers and optional fields)
 */
export type ResolvedOptions = Required<Omit<WebSocketAdvancedOptions, keyof WebSocketEventHandlers | 'token' | 'debug'>> & {
  token?: WebSocketAdvancedOptions['token']
  debug?: boolean
}

// ============================================================================
// Default Options
// ============================================================================

export const DEFAULT_OPTIONS: Required<Omit<WebSocketAdvancedOptions, keyof WebSocketEventHandlers | 'token' | 'debug'>> = {
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
