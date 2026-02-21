/**
 * Example: DurableRPC with Events, CDC, and Snapshots
 *
 * Shows full integration of:
 * - Pipeline-first event emission
 * - CDC (Change Data Capture) for collections
 * - Alarm-based retries (only on Pipeline failure)
 * - Point-in-time snapshots
 */

import { DurableRPC } from '@dotdo/rpc'
import {
  EventEmitter,
  CDCCollection,
  createSnapshot,
  restoreSnapshot,
  type PipelineLike,
} from '@dotdo/rpc/events'

interface Env {
  EVENTS_PIPELINE: PipelineLike
  SNAPSHOTS_BUCKET: R2Bucket
}

interface User {
  name: string
  email: string
  active: boolean
  createdAt: string
}

interface Message {
  userId: string
  text: string
  sentAt: string
}

export class ChatRoom extends DurableRPC {
  // Pipeline-first event emitter with CDC enabled
  private events: EventEmitter

  // CDC-wrapped collections
  private _users: CDCCollection<User>
  private _messages: CDCCollection<Message>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize event emitter — Pipeline is primary transport, ctx enables alarm retry
    this.events = new EventEmitter(
      env.EVENTS_PIPELINE,
      { cdc: true, trackPrevious: true, batchSize: 50, flushIntervalMs: 500 },
      ctx,
    )

    // Wrap collections with CDC
    this._users = new CDCCollection(
      this.collection<User>('users'),
      this.events,
      'users'
    )
    this._messages = new CDCCollection(
      this.collection<Message>('messages'),
      this.events,
      'messages'
    )
  }

  // Override alarm to handle event retries (only fires on Pipeline failure)
  async alarm(): Promise<void> {
    await this.events.handleAlarm()
  }

  // ==========================================================================
  // RPC Methods (with automatic event tracking)
  // ==========================================================================

  users = {
    create: async (data: Omit<User, 'createdAt'>) => {
      const start = Date.now()
      const id = crypto.randomUUID()
      const user: User = {
        ...data,
        createdAt: new Date().toISOString(),
      }

      this._users.put(id, user)  // CDC event emitted automatically

      // Emit RPC call event
      this.events.emit({
        type: 'rpc.call',
        event: 'users.create',
        data: { durationMs: Date.now() - start, success: true },
      })

      return { id, ...user }
    },

    get: async (id: string) => {
      const start = Date.now()
      const user = this._users.get(id)

      this.events.emit({
        type: 'rpc.call',
        event: 'users.get',
        data: { durationMs: Date.now() - start, success: user !== null },
      })

      return user
    },

    update: async (id: string, updates: Partial<User>) => {
      const start = Date.now()
      const existing = this._users.get(id)
      if (!existing) {
        this.events.emit({
          type: 'rpc.call',
          event: 'users.update',
          data: { durationMs: Date.now() - start, success: false, error: 'User not found' },
        })
        throw new Error('User not found')
      }

      this._users.put(id, { ...existing, ...updates })  // CDC: update event with prev

      this.events.emit({
        type: 'rpc.call',
        event: 'users.update',
        data: { durationMs: Date.now() - start, success: true },
      })

      return this._users.get(id)
    },

    delete: async (id: string) => {
      const start = Date.now()
      const deleted = this._users.delete(id)  // CDC: delete event

      this.events.emit({
        type: 'rpc.call',
        event: 'users.delete',
        data: { durationMs: Date.now() - start, success: deleted },
      })

      return { deleted }
    },

    list: async () => {
      const start = Date.now()
      const users = this._users.list()

      this.events.emit({
        type: 'rpc.call',
        event: 'users.list',
        data: { durationMs: Date.now() - start, success: true },
      })

      return users
    },

    active: async () => {
      return this._users.find({ active: true })
    },
  }

  messages = {
    send: async (userId: string, text: string) => {
      const start = Date.now()
      const id = crypto.randomUUID()
      const message: Message = {
        userId,
        text,
        sentAt: new Date().toISOString(),
      }

      this._messages.put(id, message)

      // Broadcast to connected clients
      this.broadcast({ type: 'message', id, ...message })

      this.events.emit({
        type: 'rpc.call',
        event: 'messages.send',
        data: { durationMs: Date.now() - start, success: true },
      })

      return { id, ...message }
    },

    recent: async (limit = 50) => {
      return this._messages.list({ limit, orderBy: 'sentAt', order: 'desc' })
    },

    byUser: async (userId: string) => {
      return this._messages.find({ userId })
    },
  }

  // ==========================================================================
  // Snapshot Management
  // ==========================================================================

  async createSnapshot(): Promise<{ key: string; collections: string[]; totalDocs: number }> {
    const env = this.env as Env

    this.events.emit({
      type: 'do.snapshot',
      event: 'snapshot.create',
      data: {},
    })

    return createSnapshot(this.sql, this.ctx.id.toString(), {
      bucket: env.SNAPSHOTS_BUCKET,
    })
  }

  async restoreFromSnapshot(snapshotKey: string): Promise<{ collections: string[]; totalDocs: number }> {
    const env = this.env as Env

    this.events.emit({
      type: 'do.snapshot',
      event: 'snapshot.restore',
      data: { snapshotKey },
    })

    return restoreSnapshot(this.sql, env.SNAPSHOTS_BUCKET, snapshotKey)
  }

  async listSnapshots(limit = 10): Promise<R2Objects> {
    const env = this.env as Env
    const prefix = `snapshots/${this.ctx.id.toString()}/`
    return env.SNAPSHOTS_BUCKET.list({ prefix, limit })
  }

  // ==========================================================================
  // WebSocket Lifecycle (with events)
  // ==========================================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.events.emit({ type: 'ws', event: 'ws.message', data: {} })
    return super.webSocketMessage(ws, message)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.events.emit({
      type: 'ws',
      event: 'ws.close',
      data: { connectionCount: this.connectionCount - 1, code, reason },
    })
    return super.webSocketClose(ws, code, reason, wasClean)
  }
}

// ============================================================================
// Worker
// ============================================================================

export default {
  async fetch(request: Request, env: Env & { CHAT_ROOM: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(request.url)
    const roomId = url.pathname.split('/')[1] || 'default'

    const id = env.CHAT_ROOM.idFromName(roomId)
    const stub = env.CHAT_ROOM.get(id)

    return stub.fetch(request)
  },
}
