/**
 * Example: DurableRPC with @dotdo/events integration
 *
 * This example demonstrates how to use @dotdo/events with DurableRPC for:
 * - Event streaming to events.do
 * - CDC (Change Data Capture) for collections
 * - Lakehouse streaming to R2
 *
 * Prerequisites:
 * - Install @dotdo/events: pnpm add @dotdo/events
 * - Configure events.do endpoint (or use default)
 */

import { DurableRPC } from '@dotdo/rpc'
import { EventEmitter, CDCCollection } from '@dotdo/events'

// =============================================================================
// Type Definitions
// =============================================================================

interface User {
  name: string
  email: string
  role: 'admin' | 'user'
  active: boolean
  createdAt: string
}

interface Order {
  userId: string
  items: Array<{ productId: string; quantity: number; price: number }>
  total: number
  status: 'pending' | 'paid' | 'shipped' | 'delivered'
  createdAt: string
}

interface Env {
  EVENTS_BUCKET?: R2Bucket
  EVENTS_API_KEY?: string
}

// =============================================================================
// DurableRPC with Events
// =============================================================================

/**
 * Example DO with full events integration
 *
 * Features:
 * - Automatic CDC for user and order collections
 * - Custom event emission for business events
 * - R2 lakehouse streaming (optional)
 * - Alarm-based retry for reliability
 */
export class MyDO extends DurableRPC {
  // Event emitter instance - created once per DO
  events = new EventEmitter(this.ctx, this.env as Env, {
    cdc: true, // Enable CDC events
    trackPrevious: true, // Include previous doc in update events (for diffs)
    r2Bucket: (this.env as Env).EVENTS_BUCKET, // Optional R2 for lakehouse
    apiKey: (this.env as Env).EVENTS_API_KEY, // Optional auth
  })

  // CDC-wrapped collections - mutations emit events automatically
  users = new CDCCollection<User>(this.collection<User>('users'), this.events, 'users')
  orders = new CDCCollection<Order>(this.collection<Order>('orders'), this.events, 'orders')

  // ==========================================================================
  // User Methods
  // ==========================================================================

  /**
   * Create a new user
   * CDC event: collection.insert
   */
  async createUser(data: { name: string; email: string; role?: 'admin' | 'user' }): Promise<User> {
    const id = crypto.randomUUID()
    const user: User = {
      name: data.name,
      email: data.email,
      role: data.role ?? 'user',
      active: true,
      createdAt: new Date().toISOString(),
    }

    // This automatically emits a CDC insert event
    this.users.put(id, user)

    // Emit custom business event
    this.events.emit({
      type: 'user.registered',
      userId: id,
      email: user.email,
      role: user.role,
    })

    return user
  }

  /**
   * Update user role
   * CDC event: collection.update (with previous doc)
   */
  async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<User | null> {
    const user = this.users.get(userId)
    if (!user) return null

    // This emits CDC update event with both old and new doc
    this.users.put(userId, { ...user, role })

    return { ...user, role }
  }

  /**
   * Deactivate user
   * CDC event: collection.update
   */
  async deactivateUser(userId: string): Promise<boolean> {
    const user = this.users.get(userId)
    if (!user) return false

    this.users.put(userId, { ...user, active: false })

    // Custom event for analytics
    this.events.emit({
      type: 'user.deactivated',
      userId,
      email: user.email,
      reason: 'manual',
    })

    return true
  }

  /**
   * Get user by ID
   * No event emitted for reads
   */
  getUser(userId: string): User | null {
    return this.users.get(userId)
  }

  /**
   * List active users
   * No event emitted for reads
   */
  listActiveUsers(): User[] {
    return this.users.find({ active: true })
  }

  // ==========================================================================
  // Order Methods
  // ==========================================================================

  /**
   * Create a new order
   * CDC event: collection.insert + custom business event
   */
  async createOrder(data: {
    userId: string
    items: Array<{ productId: string; quantity: number; price: number }>
  }): Promise<Order> {
    const orderId = crypto.randomUUID()
    const total = data.items.reduce((sum, item) => sum + item.quantity * item.price, 0)

    const order: Order = {
      userId: data.userId,
      items: data.items,
      total,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }

    // CDC insert event
    this.orders.put(orderId, order)

    // Business event
    this.events.emit({
      type: 'order.created',
      orderId,
      userId: data.userId,
      total,
      itemCount: data.items.length,
    })

    return order
  }

  /**
   * Update order status
   * CDC event: collection.update
   */
  async updateOrderStatus(
    orderId: string,
    status: Order['status']
  ): Promise<Order | null> {
    const order = this.orders.get(orderId)
    if (!order) return null

    // CDC update event
    this.orders.put(orderId, { ...order, status })

    // Business event for status changes
    this.events.emit({
      type: `order.${status}`,
      orderId,
      userId: order.userId,
      total: order.total,
      previousStatus: order.status,
    })

    return { ...order, status }
  }

  // ==========================================================================
  // Lifecycle Handlers
  // ==========================================================================

  /**
   * Required: Forward alarm to event emitter for retry handling
   */
  async alarm(): Promise<void> {
    await this.events.handleAlarm()
  }

  /**
   * Enrich event identity from incoming requests
   * Call this at the start of fetch() for best context
   */
  async fetch(request: Request): Promise<Response> {
    // Enrich events with request context (colo, worker, etc.)
    this.events.enrichFromRequest(request)

    // Continue with normal RPC handling
    return super.fetch(request)
  }

  /**
   * Persist batch before hibernation
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Persist any pending events before hibernation
    await this.events.persistBatch()

    // Continue with normal WebSocket close handling
    await super.webSocketClose(ws, code, reason, wasClean)
  }
}

// =============================================================================
// Alternative: Using createEventEmitter factory
// =============================================================================

import { createEventEmitter } from '@dotdo/rpc/events'

/**
 * Alternative pattern using the factory function
 *
 * This is useful when you want:
 * - More explicit configuration
 * - Separation of concerns
 */
export class MyDOWithFactory extends DurableRPC {
  // Create events using the factory function
  events = createEventEmitter(this, { cdc: true })

  async doSomething(): Promise<void> {
    this.events.emit({ type: 'something.happened', data: 123 })
  }

  async alarm(): Promise<void> {
    await this.events.handleAlarm()
  }
}

// =============================================================================
// Worker Export
// =============================================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Simple routing to DO
    const url = new URL(request.url)
    const id = env.MY_DO?.idFromName(url.pathname.slice(1) || 'default')

    if (!id) {
      return new Response('Missing DO binding', { status: 500 })
    }

    const stub = env.MY_DO.get(id)
    return stub.fetch(request)
  },
}

// Type for DO binding (for wrangler.toml)
declare global {
  interface Env {
    MY_DO: DurableObjectNamespace
  }
}
