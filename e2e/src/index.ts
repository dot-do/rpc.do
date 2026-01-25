/**
 * E2E Test Worker - Uses REAL DurableRPC
 *
 * This tests the actual @dotdo/rpc implementation, not mocks.
 */

// Import from source to avoid bundling issues with DurableObject
// vitest-pool-workers runs in Workers runtime where DurableObject is defined
import { DurableRPC } from '../../core/src/index.js'

// ============================================================================
// Types
// ============================================================================

export interface User {
  name: string
  email: string
  age?: number
  active?: boolean
  role?: 'admin' | 'user' | 'guest'
}

export interface Task {
  title: string
  completed: boolean
  priority: number
  tags?: string[]
}

// ============================================================================
// TestDO - Extends REAL DurableRPC
// ============================================================================

export class TestDO extends DurableRPC {
  private _schemaInit = false

  private initSchema() {
    if (this._schemaInit) return
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        age INTEGER,
        active INTEGER DEFAULT 1,
        role TEXT DEFAULT 'user',
        created_at INTEGER DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `)
    this._schemaInit = true
  }

  // Simple methods for testing
  echo(msg: string): string {
    return msg
  }

  add(a: number, b: number): number {
    return a + b
  }

  async delayed(ms: number, value: string): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, ms))
    return value
  }

  throwError(message: string): never {
    throw new Error(message)
  }

  // Users namespace - SQL backed
  users = {
    create: (id: string, data: User) => {
      this.initSchema()
      const now = Date.now()
      this.sql.exec(
        `INSERT INTO users (id, name, email, age, active, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.name,
        data.email,
        data.age ?? null,
        data.active !== false ? 1 : 0,
        data.role ?? 'user',
        now
      )
      return { ok: true, id }
    },

    get: (id: string): User | null => {
      this.initSchema()
      const rows = this.sql.exec<{ name: string; email: string; age: number | null; active: number; role: string }>(
        `SELECT name, email, age, active, role FROM users WHERE id = ?`,
        id
      ).toArray()
      if (rows.length === 0) return null
      const row = rows[0]
      return {
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
      }
    },

    list: (): User[] => {
      this.initSchema()
      return this.sql.exec<{ name: string; email: string; age: number | null; active: number; role: string }>(
        `SELECT name, email, age, active, role FROM users ORDER BY created_at DESC`
      ).toArray().map(row => ({
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
      }))
    },

    update: (id: string, data: Partial<User>) => {
      this.initSchema()
      const sets: string[] = []
      const values: unknown[] = []

      if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name) }
      if (data.email !== undefined) { sets.push('email = ?'); values.push(data.email) }
      if (data.age !== undefined) { sets.push('age = ?'); values.push(data.age) }
      if (data.active !== undefined) { sets.push('active = ?'); values.push(data.active ? 1 : 0) }
      if (data.role !== undefined) { sets.push('role = ?'); values.push(data.role) }

      if (sets.length === 0) return { ok: true, updated: false }

      values.push(id)
      const result = this.sql.exec(
        `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
        ...values
      )
      return { ok: true, updated: result.rowsWritten > 0 }
    },

    delete: (id: string) => {
      this.initSchema()
      const result = this.sql.exec(`DELETE FROM users WHERE id = ?`, id)
      return { ok: true, deleted: result.rowsWritten > 0 }
    },

    count: () => {
      this.initSchema()
      const rows = this.sql.exec<{ count: number }>(`SELECT COUNT(*) as count FROM users`).toArray()
      return rows[0]?.count ?? 0
    },

    findByRole: (role: string): User[] => {
      this.initSchema()
      return this.sql.exec<{ name: string; email: string; age: number | null; active: number; role: string }>(
        `SELECT name, email, age, active, role FROM users WHERE role = ?`,
        role
      ).toArray().map(row => ({
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
      }))
    },
  }

  // Tasks - uses this.collection() from DurableRPC
  tasks = {
    create: (id: string, data: Task) => {
      this.collection<Task>('tasks').put(id, data)
      return { ok: true, id }
    },

    get: (id: string) => {
      return this.collection<Task>('tasks').get(id)
    },

    update: (id: string, data: Partial<Task>) => {
      const existing = this.collection<Task>('tasks').get(id)
      if (!existing) return { ok: false, error: 'not found' }
      this.collection<Task>('tasks').put(id, { ...existing, ...data })
      return { ok: true }
    },

    delete: (id: string) => {
      return this.collection<Task>('tasks').delete(id)
    },

    find: (filter?: Record<string, unknown>) => {
      return this.collection<Task>('tasks').find(filter as any)
    },

    count: (filter?: Record<string, unknown>) => {
      return this.collection<Task>('tasks').count(filter as any)
    },

    list: (options?: { limit?: number; offset?: number; sort?: string }) => {
      return this.collection<Task>('tasks').list(options)
    },

    keys: () => {
      return this.collection<Task>('tasks').keys()
    },

    clear: () => {
      return this.collection<Task>('tasks').clear()
    },
  }

  // KV storage methods
  kv = {
    get: async <T>(key: string): Promise<T | undefined> => {
      return this.storage.get<T>(key)
    },

    put: async <T>(key: string, value: T): Promise<void> => {
      return this.storage.put(key, value)
    },

    delete: async (key: string): Promise<boolean> => {
      return this.storage.delete(key)
    },

    list: async (options?: { prefix?: string; limit?: number }): Promise<Map<string, unknown>> => {
      return this.storage.list(options)
    },
  }
}

// ============================================================================
// Worker Entry Point
// ============================================================================

export interface Env {
  TEST_DO: DurableObjectNamespace<TestDO>
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Upgrade',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { headers: corsHeaders })
    }

    // Info
    if (url.pathname === '/' || url.pathname === '') {
      return Response.json({
        name: 'rpc.do E2E Test Worker',
        version: '1.0.0',
        using: 'REAL DurableRPC from @dotdo/rpc',
      }, { headers: corsHeaders })
    }

    // Route to DO: /do/:id or /do
    const match = url.pathname.match(/^\/do(?:\/([^\/]+))?(\/.*)?$/)
    if (match) {
      const doId = match[1] || 'default'
      const id = env.TEST_DO.idFromName(doId)
      const stub = env.TEST_DO.get(id)

      // Forward request
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = match[2] || '/'

      const response = await stub.fetch(new Request(forwardUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }))

      // Add CORS headers
      const newHeaders = new Headers(response.headers)
      Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v))

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
        webSocket: response.webSocket,
      })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  },
}
