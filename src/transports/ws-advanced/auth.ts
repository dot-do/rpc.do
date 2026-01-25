/**
 * Authentication handling for the Advanced WebSocket Transport
 *
 * This module implements first-message authentication where the auth token
 * is sent as the first message after the WebSocket connection is established,
 * rather than in the URL query parameters.
 *
 * **Why this is more secure than URL params:**
 * - URL query parameters are often logged by proxies, load balancers, and servers
 * - Browser history and referrer headers can expose URL params
 * - Server access logs typically record full URLs including query strings
 * - First-message auth keeps tokens out of URLs entirely
 *
 * **IMPORTANT: TLS/WSS is required for security**
 * - The token is sent encrypted over the WebSocket connection
 * - Always use `wss://` endpoints in production, never `ws://`
 * - Without TLS, the token can be intercepted in transit
 */

import { ConnectionError } from '../../errors'
import type { ServerMessage, WebSocketAdvancedOptions } from './types'

/**
 * Get the token value from the options
 */
export async function getToken(options: { token?: WebSocketAdvancedOptions['token'] }): Promise<string | null> {
  const { token } = options
  if (!token) return null
  if (typeof token === 'function') {
    const result = await token()
    return result ?? null
  }
  return token
}

/**
 * Check if connection is secure (wss://)
 */
export function isSecureConnection(url: string): boolean {
  const urlObj = new URL(url)
  return urlObj.protocol === 'wss:'
}

/**
 * Check if sending auth is allowed on this connection.
 * Returns a ConnectionError if not allowed, null if allowed.
 */
export function checkInsecureAuth(url: string, allowInsecureAuth: boolean): ConnectionError | null {
  if (!isSecureConnection(url) && !allowInsecureAuth) {
    return ConnectionError.insecureConnection()
  }
  return null
}

/**
 * Send first-message authentication
 */
export function sendAuthMessage(
  ws: WebSocket,
  token: string,
  url: string,
  allowInsecureAuth: boolean,
  log: (...args: unknown[]) => void
): void {
  if (ws.readyState !== WebSocket.OPEN) return

  // Warn if using insecure connection with allowInsecureAuth
  if (!isSecureConnection(url) && allowInsecureAuth) {
    console.warn(
      '[WebSocketAdvancedTransport] WARNING: Sending authentication token over insecure ws:// connection. ' +
      'This is only safe for local development. Never use ws:// with tokens in production!'
    )
  }

  try {
    ws.send(JSON.stringify({
      type: 'auth',
      token,
    }))
    log('Sent auth message')
  } catch (error) {
    log('Failed to send auth message:', error)
  }
}

/**
 * Handle authentication result messages during connection phase.
 *
 * This function processes auth_result messages received during the connecting state.
 * Returns 'resolved' if auth succeeded, 'rejected' if auth failed, or false if
 * the message was not an auth message and should be handled normally.
 */
export function handleAuthMessage(
  data: unknown,
  parseMessage: (data: unknown) => ServerMessage,
  timeout: ReturnType<typeof setTimeout>,
  resolve: () => void,
  reject: (error: Error) => void,
  ws: WebSocket | null,
  log: (...args: unknown[]) => void
): 'resolved' | 'rejected' | false {
  try {
    const message = parseMessage(data)

    if (message.type === 'auth_result') {
      clearTimeout(timeout)
      if ((message as any).success) {
        return 'resolved'
      } else {
        const errorMessage = message.error?.message || 'Authentication failed'
        ws?.close(4001, errorMessage)
        reject(ConnectionError.authFailed(errorMessage))
        return 'rejected'
      }
    }
  } catch (error) {
    log('Failed to parse auth message:', error)
  }

  return false
}
