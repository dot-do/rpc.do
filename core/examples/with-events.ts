/**
 * Example: DurableRPC with @dotdo/events integration
 *
 * This example demonstrates how to use @dotdo/events with DurableRPC for:
 * - Pipeline-first event streaming
 * - CDC (Change Data Capture) for collections
 * - Alarm-based retries (only on Pipeline failure)
 *
 * Prerequisites:
 * - Install @dotdo/events: pnpm add @dotdo/events
 * - Add EVENTS_PIPELINE binding to wrangler config
 */

import { DurableRPC } from '@dotdo/rpc'
import { EventEmitter, CDCCollection, type PipelineLike } from '@dotdo/events'

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
  EVENTS_PIPELINE: PipelineLike
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
 * - Pipeline-first transport (zero storage I/O on happy path)
 * - Alarm-based retry for reliability (only on failure)
 */
export class MyDO extends DurableRPC {
  // Pipeline-first event emitter — zero storage writes on success
  events = new EventEmitter(
    (this.env as Env).EVENTS_PIPELINE,
    { cdc: true, trackPrevious: true },
    this.ctx,
  )

  // CDC-wrapped collections - mutations emit events automatically
  users = new CDCCollection<User>(this.collection<User>('users'), this.events, 'users')
  orders = new CDCCollection<Order>(this.collection<Order>('orders'), this.events, 'orders')

  // ==========================================================================
  // User Methods
  // ==========================================================================

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
      type: 'user',
      event: 'user.registered',
      data: { userId: id, email: user.email, role: user.role },
    })

    return user
  }

  async updateUserRole(userId: string, role: 'admin' | 'user'): Promise<User | null> {
    const user = this.users.get(userId)
    if (!user) return null

    // This emits CDC update event with both old and new doc
    this.users.put(userId, { ...user, role })

    return { ...user, role }
  }

  async deactivateUser(userId: string): Promise<boolean> {
    const user = this.users.get(userId)
    if (!user) return false

    this.users.put(userId, { ...user, active: false })

    this.events.emit({
      type: 'user',
      event: 'user.deactivated',
      data: { userId, email: user.email, reason: 'manual' },
    })

    return true
  }

  getUser(userId: string): User | null {
    return this.users.get(userId)
  }

  listActiveUsers(): User[] {
    return this.users.find({ active: true })
  }

  // ==========================================================================
  // Order Methods
  // ==========================================================================

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

    this.orders.put(orderId, order)

    this.events.emit({
      type: 'order',
      event: 'order.created',
      data: { orderId, userId: data.userId, total, itemCount: data.items.length },
    })

    return order
  }

  async updateOrderStatus(
    orderId: string,
    status: Order['status']
  ): Promise<Order | null> {
    const order = this.orders.get(orderId)
    if (!order) return null

    this.orders.put(orderId, { ...order, status })

    this.events.emit({
      type: 'order',
      event: `order.${status}`,
      data: { orderId, userId: order.userId, total: order.total, previousStatus: order.status },
    })

    return { ...order, status }
  }

  // ==========================================================================
  // Lifecycle Handlers
  // ==========================================================================

  /** Forward alarm to event emitter — only fires when Pipeline send fails */
  async alarm(): Promise<void> {
    await this.events.handleAlarm()
  }
}

// =============================================================================
// Alternative: Using createEventEmitter factory
// =============================================================================

import { createEventEmitter } from '@dotdo/rpc/events'

/**
 * Alternative pattern using the factory function.
 * Auto-discovers EVENTS_PIPELINE from env.
 */
export class MyDOWithFactory extends DurableRPC {
  events = createEventEmitter(this, { cdc: true })

  async doSomething(): Promise<void> {
    this.events.emit({ type: 'custom', event: 'something.happened', data: { value: 123 } })
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
    const url = new URL(request.url)
    const id = env.MY_DO?.idFromName(url.pathname.slice(1) || 'default')

    if (!id) {
      return new Response('Missing DO binding', { status: 500 })
    }

    const stub = env.MY_DO.get(id)
    return stub.fetch(request)
  },
}

declare global {
  interface Env {
    MY_DO: DurableObjectNamespace
  }
}
