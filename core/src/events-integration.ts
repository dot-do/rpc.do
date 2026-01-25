/**
 * @dotdo/rpc Events Integration
 *
 * Optional integration with @dotdo/events for event streaming,
 * CDC (Change Data Capture), and lakehouse analytics.
 *
 * This module provides:
 * - Re-exports of EventEmitter and CDCCollection from @dotdo/events
 * - Factory functions to create event emitters from DurableRPC context
 * - Type definitions for seamless integration
 *
 * Note: This module requires @dotdo/events to be installed. It is an optional
 * peer dependency of @dotdo/rpc. If you don't need events, don't import from
 * '@dotdo/rpc/events'.
 *
 * @example
 * ```typescript
 * import { DurableRPC } from '@dotdo/rpc'
 * import { createEventEmitter, CDCCollection } from '@dotdo/rpc/events'
 *
 * export class MyDO extends DurableRPC {
 *   events = createEventEmitter(this)
 *   users = new CDCCollection(this.collection('users'), this.events, 'users')
 *
 *   async alarm() {
 *     await this.events.handleAlarm()
 *   }
 * }
 * ```
 */

// Re-export types and classes from @dotdo/events
// These will be tree-shaken if not used
export {
  EventEmitter,
  CDCCollection,
  type DurableEvent,
  type EventEmitterOptions,
  type EventBatch,
  type BaseEvent,
  type RpcCallEvent,
  type CollectionChangeEvent,
  type LifecycleEvent,
  type WebSocketEvent,
  type Collection as EventsCollection,
} from '@dotdo/events'

import { EventEmitter, type EventEmitterOptions } from '@dotdo/events'

/**
 * Options for creating an EventEmitter from DurableRPC context
 */
export interface CreateEventEmitterOptions extends Omit<EventEmitterOptions, 'endpoint'> {
  /** Custom endpoint (defaults to events.do) */
  endpoint?: string
  /** API key for authentication with events endpoint */
  apiKey?: string
}

/**
 * Minimal interface for DurableRPC context needed by event emitter factory
 * This avoids circular dependencies with the main DurableRPC class
 */
export interface DurableRpcContext {
  /** DurableObject state/context */
  ctx: DurableObjectState
  /** Environment bindings */
  env: Record<string, unknown>
}

/**
 * Creates an EventEmitter configured for use with DurableRPC
 *
 * This is the recommended way to create an EventEmitter inside a DurableRPC class.
 * It automatically uses the DO's context and environment.
 *
 * @param durableRpc - The DurableRPC instance (pass `this` from your DO class)
 * @param options - Optional configuration for the event emitter
 * @returns A configured EventEmitter instance
 *
 * @example
 * ```typescript
 * import { DurableRPC } from '@dotdo/rpc'
 * import { createEventEmitter, CDCCollection } from '@dotdo/rpc/events'
 *
 * export class MyDO extends DurableRPC {
 *   // Create event emitter with CDC enabled
 *   events = createEventEmitter(this, { cdc: true })
 *
 *   // Wrap collection with CDC
 *   users = new CDCCollection(this.collection('users'), this.events, 'users')
 *
 *   // Custom events
 *   async processOrder(orderId: string) {
 *     // ... process order
 *     this.events.emit({ type: 'order.processed', orderId })
 *   }
 *
 *   // Required: Forward alarm to event emitter for retries
 *   async alarm() {
 *     await this.events.handleAlarm()
 *   }
 * }
 * ```
 */
export function createEventEmitter(
  durableRpc: DurableRpcContext,
  options: CreateEventEmitterOptions = {}
): EventEmitter {
  return new EventEmitter(durableRpc.ctx, durableRpc.env, {
    endpoint: options.endpoint,
    batchSize: options.batchSize,
    flushIntervalMs: options.flushIntervalMs,
    cdc: options.cdc,
    r2Bucket: options.r2Bucket,
    trackPrevious: options.trackPrevious,
    apiKey: options.apiKey,
  })
}
