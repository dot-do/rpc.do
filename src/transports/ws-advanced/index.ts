/**
 * Advanced WebSocket Transport
 *
 * A robust WebSocket transport for rpc.do with production-ready features:
 * - Automatic reconnection with exponential backoff (1s -> 30s max)
 * - Heartbeat ping-pong every 30 seconds for connection health
 * - Connection state machine: disconnected -> connecting -> connected -> reconnecting -> closed
 * - First-message authentication (token not in URL for security)
 * - Comprehensive event handlers: onConnect, onDisconnect, onReconnecting, onError
 *
 * ## Security: First-Message Authentication
 *
 * This transport implements first-message authentication where the auth token
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
 * - By default, sending tokens over `ws://` is BLOCKED with a ConnectionError
 * - For local development only, set `allowInsecureAuth: true` to override
 *
 * @example
 * ```typescript
 * import { wsAdvanced } from 'rpc.do/transports/ws-advanced'
 * import { RPC } from 'rpc.do'
 *
 * const transport = wsAdvanced('wss://api.example.com/rpc', {
 *   token: 'your-auth-token',
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
 *   onError: (error) => console.error('Error:', error)
 * })
 *
 * const rpc = RPC(transport)
 * await rpc.some.method({ arg: 'value' })
 * ```
 */

// Re-export the transport class
export { WebSocketAdvancedTransport } from './connection'

// Re-export types
export {
  PROTOCOL_VERSION,
  type ConnectionState,
  type ServerMessage,
  type PendingRequest,
  type WebSocketEventHandlers,
  type WebSocketAdvancedOptions,
} from './types'

// Re-export error types for convenience
export { ConnectionError, ProtocolVersionError, RPCError } from '../../errors'

// Import for factory function
import { WebSocketAdvancedTransport } from './connection'
import type { WebSocketAdvancedOptions } from './types'

/**
 * Create an advanced WebSocket transport
 *
 * @example
 * ```typescript
 * import { wsAdvanced } from 'rpc.do/transports/ws-advanced'
 * import { RPC } from 'rpc.do'
 *
 * // Basic usage
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc'))
 *
 * // With authentication and event handlers
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc', {
 *   token: 'your-token',
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (reason) => console.log('Disconnected:', reason),
 *   onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
 *   onError: (error) => console.error('Error:', error)
 * }))
 *
 * // With custom reconnection settings
 * const rpc = RPC(wsAdvanced('wss://api.example.com/rpc', {
 *   autoReconnect: true,
 *   maxReconnectAttempts: 10,
 *   reconnectBackoff: 1000,      // Start at 1s
 *   maxReconnectBackoff: 30000,  // Max 30s
 *   backoffMultiplier: 2,        // Double each time
 * }))
 * ```
 */
export function wsAdvanced(
  url: string,
  options?: WebSocketAdvancedOptions
): WebSocketAdvancedTransport {
  return new WebSocketAdvancedTransport(url, options)
}
