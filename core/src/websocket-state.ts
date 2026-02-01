/**
 * @dotdo/rpc WebSocket State Machine
 *
 * Shared state management for WebSocket hibernation.
 * Used by both full DurableRPC and lite versions.
 *
 * State transitions:
 * ```
 *   [connecting] ──accept──> [active] ──hibernate──> [hibernated]
 *        │                      │                         │
 *        │                      │                         │
 *        │                      ▼                         │
 *        │                   [closed] <─────close─────────┤
 *        │                      ▲                         │
 *        └───────error──────────┴────────error────────────┘
 * ```
 *
 * - connecting: WebSocket pair created, waiting for acceptance
 * - active: WebSocket accepted and actively processing messages
 * - hibernated: DO hibernated, WebSocket maintained by runtime (will wake on message)
 * - closed: WebSocket closed (terminal state)
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Explicit state tracking for WebSocket hibernation.
 */
export type WebSocketState = 'connecting' | 'active' | 'hibernated' | 'closed'

/**
 * WebSocket attachment data that survives hibernation.
 * Stored via ws.serializeAttachment() and retrieved via ws.deserializeAttachment()
 */
export interface WebSocketAttachment {
  /** Transport ID for capnweb session recovery */
  transportId: string
  /** Current WebSocket state */
  state: WebSocketState
  /** Timestamp when connection was established */
  connectedAt: number
  /** Timestamp of last state transition */
  lastTransition: number
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid WebSocketAttachment.
 * Used for validating deserialized WebSocket attachments that survive hibernation.
 *
 * @param value - The value to check (typically from ws.deserializeAttachment())
 * @returns True if the value is a valid WebSocketAttachment
 */
export function isWebSocketAttachment(value: unknown): value is WebSocketAttachment {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as WebSocketAttachment).transportId === 'string' &&
    typeof (value as WebSocketAttachment).state === 'string' &&
    typeof (value as WebSocketAttachment).connectedAt === 'number' &&
    typeof (value as WebSocketAttachment).lastTransition === 'number'
  )
}

// ============================================================================
// State Management Functions
// ============================================================================

/**
 * Create initial WebSocket attachment with 'connecting' state.
 *
 * STATE: -> connecting
 *
 * @param transportId - The transport ID for capnweb session recovery
 * @returns New WebSocketAttachment in 'connecting' state
 */
export function createWebSocketAttachment(transportId: string): WebSocketAttachment {
  const now = Date.now()
  return {
    transportId,
    state: 'connecting',
    connectedAt: now,
    lastTransition: now,
  }
}

/**
 * Transition WebSocket to a new state.
 * Updates the attachment and logs the transition for debugging.
 *
 * Valid state transitions:
 * - connecting -> active (WebSocket accepted)
 * - connecting -> closed (error during setup)
 * - active -> hibernated (DO hibernating, implicit)
 * - active -> closed (normal close or error)
 * - hibernated -> active (DO woke from hibernation)
 * - hibernated -> closed (close while hibernated)
 *
 * @param ws - The WebSocket to update
 * @param attachment - Current attachment data
 * @param newState - Target state
 * @param reason - Optional reason for the transition (for debugging)
 * @param logPrefix - Log prefix for debugging (default: '[DurableRPC]')
 */
export function transitionWebSocketState(
  ws: WebSocket,
  attachment: WebSocketAttachment,
  newState: WebSocketState,
  reason?: string,
  logPrefix = '[DurableRPC]'
): void {
  const oldState = attachment.state
  attachment.state = newState
  attachment.lastTransition = Date.now()

  // Persist the updated state (survives hibernation)
  ws.serializeAttachment(attachment)

  // Debug logging for state transitions
  console.debug(
    `${logPrefix} WebSocket state: ${oldState} -> ${newState}` +
      (reason ? ` (${reason})` : '')
  )
}

/**
 * Get WebSocket attachment with type safety.
 * Returns null if attachment is missing or invalid.
 *
 * @param ws - The WebSocket to get attachment from
 * @param logPrefix - Log prefix for debugging (default: '[DurableRPC]')
 * @returns The attachment, or null if missing/invalid
 */
export function getWebSocketAttachment(
  ws: WebSocket,
  logPrefix = '[DurableRPC]'
): WebSocketAttachment | null {
  try {
    const attachment = ws.deserializeAttachment()
    if (isWebSocketAttachment(attachment)) {
      return attachment
    }
  } catch (error) {
    console.debug(`${logPrefix} Failed to deserialize WebSocket attachment:`, error)
  }
  return null
}
