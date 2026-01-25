/**
 * Reconnection logic for the Advanced WebSocket Transport
 *
 * Implements automatic reconnection with exponential backoff:
 * - Initial backoff: 1 second (configurable)
 * - Maximum backoff: 30 seconds (configurable)
 * - Backoff multiplier: 2x (configurable)
 * - Maximum attempts: Infinity (configurable)
 */

/**
 * Calculate the backoff delay for a reconnection attempt
 *
 * @param attempt - Current attempt number (1-based)
 * @param baseBackoff - Initial backoff delay in ms
 * @param multiplier - Backoff multiplier for exponential growth
 * @param maxBackoff - Maximum backoff delay in ms
 * @returns Calculated backoff delay in ms
 */
export function calculateBackoff(
  attempt: number,
  baseBackoff: number,
  multiplier: number,
  maxBackoff: number
): number {
  return Math.min(
    baseBackoff * Math.pow(multiplier, attempt - 1),
    maxBackoff
  )
}

/**
 * Check if reconnection should be attempted
 *
 * @param closeRequested - Whether close() was explicitly called
 * @param autoReconnect - Whether auto-reconnection is enabled
 * @param currentAttempts - Number of attempts made so far
 * @param maxAttempts - Maximum attempts allowed
 * @returns true if reconnection should be attempted
 */
export function shouldReconnect(
  closeRequested: boolean,
  autoReconnect: boolean,
  currentAttempts: number,
  maxAttempts: number
): boolean {
  return (
    !closeRequested &&
    autoReconnect &&
    currentAttempts < maxAttempts
  )
}

/**
 * Schedule a reconnection attempt
 *
 * @param backoff - Delay in ms before attempting reconnection
 * @param connectCallback - Async function to call to attempt connection
 * @returns The timeout timer
 */
export function scheduleReconnect(
  backoff: number,
  connectCallback: () => Promise<void>
): ReturnType<typeof setTimeout> {
  return setTimeout(connectCallback, backoff)
}

/**
 * Clear a pending reconnect timer
 *
 * @param reconnectTimer - The timer to clear
 * @returns null
 */
export function clearReconnectTimer(
  reconnectTimer: ReturnType<typeof setTimeout> | null
): null {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
  }
  return null
}
