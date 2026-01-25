/**
 * Heartbeat logic for the Advanced WebSocket Transport
 *
 * Implements ping-pong handling for connection health monitoring:
 * - Sends ping messages at configured intervals (default: 30 seconds)
 * - Expects pong response within timeout (default: 5 seconds)
 * - Closes connection if pong not received (dead connection detection)
 */

import { ConnectionError } from '../../errors'

/**
 * Start the heartbeat timer
 *
 * @param heartbeatInterval - Interval in ms between heartbeats (0 to disable)
 * @param isConnected - Function to check if connection is active
 * @param sendPingCallback - Function to call when ping should be sent
 * @returns The interval timer, or null if disabled
 */
export function startHeartbeat(
  heartbeatInterval: number,
  isConnected: () => boolean,
  sendPingCallback: () => void
): ReturnType<typeof setInterval> | null {
  if (heartbeatInterval <= 0) return null

  return setInterval(() => {
    if (isConnected()) {
      sendPingCallback()
    }
  }, heartbeatInterval)
}

/**
 * Stop the heartbeat timer and clear any pending timeout
 *
 * @param heartbeatTimer - The interval timer to clear
 * @param heartbeatTimeoutTimer - The timeout timer to clear
 * @returns Object with both timers set to null
 */
export function stopHeartbeat(
  heartbeatTimer: ReturnType<typeof setInterval> | null,
  heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null
): { heartbeatTimer: null; heartbeatTimeoutTimer: null } {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
  }
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer)
  }
  return { heartbeatTimer: null, heartbeatTimeoutTimer: null }
}

/**
 * Clear the heartbeat timeout (called when pong is received)
 *
 * @param heartbeatTimeoutTimer - The timeout timer to clear
 * @returns null
 */
export function clearHeartbeatTimeout(
  heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null
): null {
  if (heartbeatTimeoutTimer) {
    clearTimeout(heartbeatTimeoutTimer)
  }
  return null
}

/**
 * Send a ping message and set up the timeout for pong response
 *
 * @param ws - The WebSocket to send the ping on
 * @param heartbeatTimeout - Timeout in ms to wait for pong
 * @param onError - Error handler to call on timeout
 * @param log - Logging function
 * @returns The timeout timer, or null if send failed
 */
export function sendPing(
  ws: WebSocket | null,
  heartbeatTimeout: number,
  onError?: (error: Error) => void,
  log?: (...args: unknown[]) => void
): ReturnType<typeof setTimeout> | null {
  if (!ws) return null

  try {
    ws.send(JSON.stringify({
      type: 'ping',
      id: `ping-${Date.now()}`,
      timestamp: Date.now(),
    }))

    // Set timeout for pong response
    return setTimeout(() => {
      log?.('Heartbeat timeout - connection may be dead')
      onError?.(ConnectionError.heartbeatTimeout())
      ws.close(4000, 'Heartbeat timeout')
    }, heartbeatTimeout)
  } catch (error) {
    log?.('Failed to send ping:', error)
    return null
  }
}
