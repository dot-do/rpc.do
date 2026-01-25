/**
 * Stats Durable Object
 *
 * A real-time statistics dashboard that demonstrates rpc.do patterns:
 * - RPC methods: getStats, subscribe, incrementCounter
 * - Durable Object storage for persistent counters
 * - WebSocket broadcasting for real-time updates
 *
 * This example showcases how to build a live dashboard with:
 * - Multiple transport support (HTTP and WebSocket)
 * - Real-time subscriptions via WebSocket
 * - Persistent state via DO storage
 */

import { DurableRPC } from '@dotdo/rpc'

// ============================================================================
// Types
// ============================================================================

export interface StatsData {
  counters: Record<string, number>
  lastUpdated: number
  connectionCount: number
}

export interface CounterUpdate {
  type: 'counter_update'
  name: string
  value: number
  timestamp: number
}

export interface SubscribeResult {
  success: boolean
  stats: StatsData
}

export interface IncrementResult {
  success: boolean
  name: string
  value: number
}

// ============================================================================
// Stats Durable Object
// ============================================================================

/**
 * Stats Durable Object
 *
 * Extends DurableRPC to provide real-time statistics with WebSocket broadcasting.
 * Demonstrates the composite transport pattern where clients can use either
 * HTTP for one-off requests or WebSocket for real-time subscriptions.
 */
export class Stats extends DurableRPC {
  // ==========================================================================
  // RPC Methods
  // ==========================================================================

  /**
   * Get current stats snapshot
   *
   * Works over both HTTP and WebSocket transports.
   * Returns the current state of all counters and metadata.
   */
  async getStats(): Promise<StatsData> {
    const counters = await this.loadCounters()
    const lastUpdated = (await this.$.storage.get<number>('lastUpdated')) || Date.now()

    return {
      counters,
      lastUpdated,
      connectionCount: this.connectionCount,
    }
  }

  /**
   * Subscribe to real-time stats updates
   *
   * This method is meaningful only over WebSocket - it registers the
   * connection to receive broadcasts. Over HTTP, it just returns current stats.
   *
   * @returns Current stats snapshot
   */
  async subscribe(): Promise<SubscribeResult> {
    // The subscription is implicit - any connected WebSocket will receive broadcasts
    // This method exists to:
    // 1. Provide a clear "subscribe" intent in the API
    // 2. Return initial state for the subscriber
    // 3. Potentially add per-subscriber tracking in the future

    const stats = await this.getStats()

    return {
      success: true,
      stats,
    }
  }

  /**
   * Increment a named counter
   *
   * Increments the counter by 1, persists to storage, and broadcasts
   * the update to all connected WebSocket clients.
   *
   * @param name - The counter name to increment
   * @returns The new counter value
   */
  async incrementCounter(name: string): Promise<IncrementResult> {
    if (!name || typeof name !== 'string') {
      throw new Error('Counter name is required')
    }

    // Clean the name (alphanumeric, dash, underscore only)
    const cleanName = name.trim().slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '_')

    // Load current counter value
    const key = `counter:${cleanName}`
    const current = (await this.$.storage.get<number>(key)) || 0
    const newValue = current + 1

    // Persist the new value and timestamp
    const timestamp = Date.now()
    await this.$.storage.put(key, newValue)
    await this.$.storage.put('lastUpdated', timestamp)

    // Broadcast update to all connected clients
    this.broadcast({
      type: 'counter_update',
      name: cleanName,
      value: newValue,
      timestamp,
    } satisfies CounterUpdate)

    return {
      success: true,
      name: cleanName,
      value: newValue,
    }
  }

  /**
   * Get a specific counter value
   *
   * @param name - The counter name
   * @returns The counter value (0 if not found)
   */
  async getCounter(name: string): Promise<number> {
    if (!name || typeof name !== 'string') {
      throw new Error('Counter name is required')
    }

    const cleanName = name.trim().slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '_')
    const key = `counter:${cleanName}`
    return (await this.$.storage.get<number>(key)) || 0
  }

  /**
   * Reset a counter to zero
   *
   * @param name - The counter name to reset
   */
  async resetCounter(name: string): Promise<IncrementResult> {
    if (!name || typeof name !== 'string') {
      throw new Error('Counter name is required')
    }

    const cleanName = name.trim().slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '_')
    const key = `counter:${cleanName}`
    const timestamp = Date.now()

    await this.$.storage.put(key, 0)
    await this.$.storage.put('lastUpdated', timestamp)

    // Broadcast the reset
    this.broadcast({
      type: 'counter_update',
      name: cleanName,
      value: 0,
      timestamp,
    } satisfies CounterUpdate)

    return {
      success: true,
      name: cleanName,
      value: 0,
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Load all counters from storage
   */
  private async loadCounters(): Promise<Record<string, number>> {
    const counters: Record<string, number> = {}
    const stored = await this.$.storage.list<number>({ prefix: 'counter:' })

    for (const [key, value] of stored) {
      const name = key.replace('counter:', '')
      counters[name] = value
    }

    return counters
  }

  // ==========================================================================
  // WebSocket Lifecycle (Override from DurableRPC)
  // ==========================================================================

  /**
   * Called when a WebSocket is closed
   * Broadcasts updated connection count to remaining clients
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Broadcast connection count update after a small delay
    // (to ensure the socket is fully removed from getWebSockets())
    setTimeout(() => {
      this.broadcast({
        type: 'connection_count',
        count: this.connectionCount,
        timestamp: Date.now(),
      })
    }, 100)
  }
}
