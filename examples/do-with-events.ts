/**
 * Example: DurableRPC with Events, CDC, and Snapshots
 *
 * Shows full integration of:
 * - Event emission for RPC calls
 * - CDC (Change Data Capture) for collections
 * - R2 streaming for lakehouse queries
 * - Alarm-based retries
 * - Point-in-time snapshots
 */

import { DurableRPC } from '@dotdo/rpc'
import {
  EventEmitter,
  CDCCollection,
  createSnapshot,
  restoreSnapshot,
} from '@dotdo/rpc/events'

interface Env {
  EVENTS_BUCKET: R2Bucket
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
  // Event emitter with CDC enabled
  private events: EventEmitter

  // CDC-wrapped collections
  private _users: CDCCollection<User>
  private _messages: CDCCollection<Message>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize event emitter
    this.events = new EventEmitter(ctx, env, {
      endpoint: 'https://events.workers.do/ingest',
      cdc: true,
      trackPrevious: true,  // Enable diffs in CDC events
      r2Bucket: env.EVENTS_BUCKET,
      batchSize: 50,
      flushIntervalMs: 500,
    })

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

  // Override fetch to enrich events with request context
  async fetch(request: Request): Promise<Response> {
    this.events.enrichFromRequest(request)
    return super.fetch(request)
  }

  // Override alarm to handle event retries
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
        method: 'users.create',
        namespace: 'users',
        durationMs: Date.now() - start,
        success: true,
      })

      return { id, ...user }
    },

    get: async (id: string) => {
      const start = Date.now()
      const user = this._users.get(id)

      this.events.emit({
        type: 'rpc.call',
        method: 'users.get',
        namespace: 'users',
        durationMs: Date.now() - start,
        success: user !== null,
      })

      return user
    },

    update: async (id: string, updates: Partial<User>) => {
      const start = Date.now()
      const existing = this._users.get(id)
      if (!existing) {
        this.events.emit({
          type: 'rpc.call',
          method: 'users.update',
          namespace: 'users',
          durationMs: Date.now() - start,
          success: false,
          error: 'User not found',
        })
        throw new Error('User not found')
      }

      this._users.put(id, { ...existing, ...updates })  // CDC: update event with prev

      this.events.emit({
        type: 'rpc.call',
        method: 'users.update',
        namespace: 'users',
        durationMs: Date.now() - start,
        success: true,
      })

      return this._users.get(id)
    },

    delete: async (id: string) => {
      const start = Date.now()
      const deleted = this._users.delete(id)  // CDC: delete event

      this.events.emit({
        type: 'rpc.call',
        method: 'users.delete',
        namespace: 'users',
        durationMs: Date.now() - start,
        success: deleted,
      })

      return { deleted }
    },

    list: async () => {
      const start = Date.now()
      const users = this._users.list()

      this.events.emit({
        type: 'rpc.call',
        method: 'users.list',
        namespace: 'users',
        durationMs: Date.now() - start,
        success: true,
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
        method: 'messages.send',
        namespace: 'messages',
        durationMs: Date.now() - start,
        success: true,
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

  /**
   * Create a point-in-time snapshot of all collections
   * Call periodically or before major operations
   */
  async createSnapshot(): Promise<{ key: string; collections: string[]; totalDocs: number }> {
    const env = this.env as Env

    this.events.emit({
      type: 'do.snapshot',
      action: 'create',
    } as any)

    return createSnapshot(this.sql, this.ctx.id.toString(), {
      bucket: env.SNAPSHOTS_BUCKET,
    })
  }

  /**
   * Restore from a specific snapshot
   * Use for disaster recovery or time-travel
   */
  async restoreFromSnapshot(snapshotKey: string): Promise<{ collections: string[]; totalDocs: number }> {
    const env = this.env as Env

    this.events.emit({
      type: 'do.snapshot',
      action: 'restore',
      snapshotKey,
    } as any)

    return restoreSnapshot(this.sql, env.SNAPSHOTS_BUCKET, snapshotKey)
  }

  /**
   * List available snapshots
   */
  async listSnapshots(limit = 10): Promise<R2Objects> {
    const env = this.env as Env
    const prefix = `snapshots/${this.ctx.id.toString()}/`

    return env.SNAPSHOTS_BUCKET.list({ prefix, limit })
  }

  // ==========================================================================
  // WebSocket Lifecycle (with events)
  // ==========================================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.events.emit({ type: 'ws.message' })
    return super.webSocketMessage(ws, message)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.events.emit({
      type: 'ws.close',
      connectionCount: this.connectionCount - 1,
      code,
      reason,
    })

    // Persist event batch before potential hibernation
    await this.events.persistBatch()

    return super.webSocketClose(ws, code, reason, wasClean)
  }
}

// ============================================================================
// Worker with DO Class Header Injection
// ============================================================================

export default {
  async fetch(request: Request, env: Env & { CHAT_ROOM: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(request.url)
    const roomId = url.pathname.split('/')[1] || 'default'

    const id = env.CHAT_ROOM.idFromName(roomId)
    const stub = env.CHAT_ROOM.get(id)

    // Inject DO metadata for event enrichment
    const headers = new Headers(request.headers)
    headers.set('X-DO-Class', 'ChatRoom')
    headers.set('X-DO-Name', roomId)

    return stub.fetch(new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
    }))
  },
}

// ============================================================================
// Example: Querying the Lakehouse
// ============================================================================

/**
 * Query events with DuckDB (run from analytics worker or CLI)
 *
 * ```sql
 * -- All CDC events for a specific DO in the last hour
 * SELECT *
 * FROM read_json_auto('r2://events-bucket/events/2024/01/15/12/*.jsonl')
 * WHERE type LIKE 'collection.%'
 *   AND "do".id = 'abc123'
 * ORDER BY ts DESC;
 *
 * -- Slow RPC calls across all DOs
 * SELECT
 *   "do".class,
 *   method,
 *   AVG(durationMs) as avg_duration,
 *   MAX(durationMs) as max_duration,
 *   COUNT(*) as call_count
 * FROM read_json_auto('r2://events-bucket/events/2024/01/**/*.jsonl')
 * WHERE type = 'rpc.call'
 *   AND durationMs > 100
 * GROUP BY "do".class, method
 * ORDER BY avg_duration DESC;
 *
 * -- Reconstruct document history (time travel)
 * SELECT
 *   ts,
 *   type,
 *   docId,
 *   doc,
 *   prev
 * FROM read_json_auto('r2://events-bucket/events/2024/**/*.jsonl')
 * WHERE type LIKE 'collection.%'
 *   AND collection = 'users'
 *   AND docId = 'user-123'
 * ORDER BY ts ASC;
 * ```
 */
