/**
 * Dashboard RPC Client
 *
 * Demonstrates the composite transport pattern with rpc.do:
 * - Primary: WebSocket (wsAdvanced) for real-time subscriptions
 * - Fallback: HTTP for reliability when WebSocket fails
 *
 * This client can be used in Node.js, browsers, or Cloudflare Workers.
 */

import { RPC, http, composite, type RPCProxy } from 'rpc.do'
import { wsAdvanced, type WebSocketAdvancedOptions } from 'rpc.do/transports/ws-advanced'

// ============================================================================
// API Types
// ============================================================================

/**
 * Stats data returned by getStats()
 */
export interface StatsData {
  counters: Record<string, number>
  lastUpdated: number
  connectionCount: number
}

/**
 * Result of subscribe()
 */
export interface SubscribeResult {
  success: boolean
  stats: StatsData
}

/**
 * Result of incrementCounter()
 */
export interface IncrementResult {
  success: boolean
  name: string
  value: number
}

/**
 * Typed Stats API
 */
export interface StatsAPI {
  getStats(): StatsData
  subscribe(): SubscribeResult
  incrementCounter(name: string): IncrementResult
  getCounter(name: string): number
  resetCounter(name: string): IncrementResult
}

// ============================================================================
// Client Factory
// ============================================================================

export interface DashboardClientOptions {
  /** Base URL for the dashboard API (e.g., 'https://dashboard.example.com/api/stats') */
  baseUrl: string

  /** Authentication token (optional) */
  token?: string

  /** WebSocket-specific options */
  ws?: Partial<WebSocketAdvancedOptions>

  /** Event handlers */
  onConnect?: () => void
  onDisconnect?: (reason: string) => void
  onReconnecting?: (attempt: number) => void
  onError?: (error: Error) => void

  /** Called when a broadcast message is received (real-time updates) */
  onBroadcast?: (message: BroadcastMessage) => void

  /** Enable debug logging */
  debug?: boolean
}

/**
 * Broadcast message types from the server
 */
export type BroadcastMessage =
  | { type: 'counter_update'; name: string; value: number; timestamp: number }
  | { type: 'connection_count'; count: number; timestamp: number }

/**
 * Create a Dashboard RPC client with composite transport
 *
 * Uses WebSocket for real-time updates with HTTP fallback for reliability.
 *
 * @example
 * ```typescript
 * import { createDashboardClient } from './client'
 *
 * const client = createDashboardClient({
 *   baseUrl: 'https://dashboard.example.com/api/stats',
 *   token: 'optional-auth-token',
 *   onConnect: () => console.log('Connected!'),
 *   onBroadcast: (msg) => {
 *     if (msg.type === 'counter_update') {
 *       console.log(`Counter ${msg.name} = ${msg.value}`)
 *     }
 *   }
 * })
 *
 * // Get current stats
 * const stats = await client.getStats()
 *
 * // Subscribe to real-time updates (works best over WebSocket)
 * await client.subscribe()
 *
 * // Increment a counter
 * await client.incrementCounter('page-views')
 *
 * // Clean up
 * client.close()
 * ```
 */
export function createDashboardClient(options: DashboardClientOptions): RPCProxy<StatsAPI> & {
  /** Close all transports */
  close: () => void
  /** Get current transport info */
  getTransportInfo: () => { type: 'ws' | 'http'; connected: boolean }
} {
  const {
    baseUrl,
    token,
    onConnect,
    onDisconnect,
    onReconnecting,
    onError,
    onBroadcast,
    debug = false,
  } = options

  // Convert HTTP URL to WebSocket URL
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws'

  // Track current transport state
  let currentTransport: 'ws' | 'http' = 'ws'
  let isConnected = false

  // Create WebSocket transport with event handlers
  const wsTransport = wsAdvanced(wsUrl, {
    token,
    debug,
    autoReconnect: true,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,

    onConnect: () => {
      currentTransport = 'ws'
      isConnected = true
      if (debug) console.log('[DashboardClient] WebSocket connected')
      onConnect?.()
    },

    onDisconnect: (reason, code) => {
      isConnected = false
      if (debug) console.log('[DashboardClient] WebSocket disconnected:', reason)
      onDisconnect?.(reason)
    },

    onReconnecting: (attempt, maxAttempts) => {
      if (debug) console.log(`[DashboardClient] Reconnecting ${attempt}/${maxAttempts}`)
      onReconnecting?.(attempt)
    },

    onError: (error) => {
      if (debug) console.error('[DashboardClient] WebSocket error:', error)
      onError?.(error)
    },

    // Handle broadcast messages (not RPC responses)
    onMessage: (message) => {
      // Skip RPC responses (they have an id)
      if ('id' in message && message.id !== undefined) return

      // Handle broadcast messages
      if ('type' in message) {
        const broadcastMsg = message as unknown as BroadcastMessage
        if (debug) console.log('[DashboardClient] Broadcast:', broadcastMsg)
        onBroadcast?.(broadcastMsg)
      }
    },

    ...options.ws,
  })

  // Create HTTP transport as fallback
  const httpTransport = http(baseUrl, token)

  // Create composite transport: WebSocket first, HTTP fallback
  const transport = composite(wsTransport, httpTransport)

  // Create the RPC proxy
  const rpc = RPC<StatsAPI>(transport)

  // Add utility methods
  return Object.assign(rpc, {
    close: () => {
      transport.close?.()
    },
    getTransportInfo: () => ({
      type: currentTransport,
      connected: isConnected,
    }),
  })
}

// ============================================================================
// Standalone Example
// ============================================================================

/**
 * Example usage demonstrating transport switching
 */
async function example() {
  console.log('=== Dashboard Client Example ===\n')

  const client = createDashboardClient({
    baseUrl: 'http://localhost:8787/api/stats',
    debug: true,

    onConnect: () => {
      console.log('>> Connected to dashboard')
    },

    onDisconnect: (reason) => {
      console.log('>> Disconnected:', reason)
    },

    onBroadcast: (msg) => {
      if (msg.type === 'counter_update') {
        console.log(`>> Counter update: ${msg.name} = ${msg.value}`)
      }
    },
  })

  try {
    // Get initial stats
    console.log('\n1. Getting initial stats...')
    const stats = await client.getStats()
    console.log('Stats:', stats)

    // Subscribe to updates
    console.log('\n2. Subscribing to real-time updates...')
    const subResult = await client.subscribe()
    console.log('Subscribe result:', subResult)

    // Increment some counters
    console.log('\n3. Incrementing counters...')
    await client.incrementCounter('demo-clicks')
    await client.incrementCounter('demo-clicks')
    await client.incrementCounter('api-calls')

    // Get updated stats
    console.log('\n4. Getting updated stats...')
    const updatedStats = await client.getStats()
    console.log('Updated stats:', updatedStats)

    // Check transport info
    console.log('\n5. Transport info:')
    console.log(client.getTransportInfo())

    // Wait for some broadcasts
    console.log('\n6. Waiting for broadcasts (5 seconds)...')
    await new Promise(resolve => setTimeout(resolve, 5000))

  } catch (error) {
    console.error('Error:', error)
  } finally {
    console.log('\n7. Closing client...')
    client.close()
  }
}

// Run example if this file is executed directly
if (typeof require !== 'undefined' && require.main === module) {
  example().catch(console.error)
}

export { example }
