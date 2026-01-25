/**
 * TestDO - A standalone test Durable Object for E2E testing
 *
 * This is a self-contained implementation that doesn't import from @dotdo/rpc
 * to avoid module resolution issues with vitest-pool-workers.
 *
 * It implements similar functionality to DurableRPC to test:
 * - HTTP RPC via POST requests
 * - WebSocket connections
 * - Schema introspection
 * - SQL operations
 * - Storage operations
 * - Collection-like operations
 */

/**
 * User document type for testing
 */
export interface User {
  name: string
  email: string
  age?: number
  active?: boolean
  role?: 'admin' | 'user' | 'guest'
  metadata?: Record<string, unknown>
}

/**
 * Task document type for testing collections
 */
export interface Task {
  title: string
  completed: boolean
  priority: number
  assignee?: string
  tags?: string[]
  createdAt: number
}

// Collection schema
const COLLECTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS _collections (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS _collections_collection ON _collections(collection);
`

/**
 * TestDO - Durable Object for E2E testing
 *
 * Uses `implements DurableObject` pattern which works with vitest-pool-workers
 */
export class TestDO implements DurableObject {
  private _initialized = false
  private _collectionsInitialized = false

  constructor(readonly ctx: DurableObjectState, readonly env: unknown) {}

  // ============================================================================
  // Accessors
  // ============================================================================

  get sql(): SqlStorage {
    return this.ctx.storage.sql
  }

  get storage(): DurableObjectStorage {
    return this.ctx.storage
  }

  // ============================================================================
  // Schema Initialization
  // ============================================================================

  private initSchema() {
    if (this._initialized) return

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        age INTEGER,
        active INTEGER DEFAULT 1,
        role TEXT DEFAULT 'user',
        metadata TEXT,
        created_at INTEGER DEFAULT (unixepoch() * 1000),
        updated_at INTEGER DEFAULT (unixepoch() * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `)

    this._initialized = true
  }

  private initCollections() {
    if (this._collectionsInitialized) return
    this.sql.exec(COLLECTIONS_SCHEMA)
    this._collectionsInitialized = true
  }

  // ============================================================================
  // HTTP Handling
  // ============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Schema endpoint
    if (request.method === 'GET' && (url.pathname === '/__schema' || url.pathname === '/')) {
      return Response.json(this.getSchema())
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade()
    }

    // HTTP RPC
    if (request.method === 'POST') {
      return this.handleRpc(request)
    }

    return new Response('Method not allowed', { status: 405 })
  }

  private handleWebSocketUpgrade(): Response {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return

    try {
      const request = JSON.parse(message) as { id: number; method: string; args: unknown[] }
      const result = await this.callMethod(request.method, request.args)
      ws.send(JSON.stringify({ id: request.id, result }))
    } catch (error: any) {
      const request = JSON.parse(message as string) as { id: number }
      ws.send(JSON.stringify({ id: request.id, error: { message: error.message } }))
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Cleanup if needed
  }

  private async handleRpc(request: Request): Promise<Response> {
    try {
      const batch = (await request.json()) as Array<{ id: number; method: string; args: unknown[] }>

      const results = await Promise.all(
        batch.map(async (call) => {
          try {
            const result = await this.callMethod(call.method, call.args)
            return { id: call.id, result }
          } catch (error: any) {
            return { id: call.id, error: { message: error.message } }
          }
        })
      )

      return Response.json(results)
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  private async callMethod(path: string, args: unknown[]): Promise<unknown> {
    const parts = path.split('.')

    if (parts.length === 1) {
      // Top-level method
      const method = (this as any)[parts[0]]
      if (typeof method !== 'function') {
        throw new Error(`Method not found: ${path}`)
      }
      return method.apply(this, args)
    } else if (parts.length === 2) {
      // Namespace method
      const namespace = (this as any)[parts[0]]
      if (!namespace || typeof namespace !== 'object') {
        throw new Error(`Namespace not found: ${parts[0]}`)
      }
      const method = namespace[parts[1]]
      if (typeof method !== 'function') {
        throw new Error(`Method not found: ${path}`)
      }
      return method.apply(namespace, args)
    }

    throw new Error(`Invalid method path: ${path}`)
  }

  // ============================================================================
  // Schema Introspection
  // ============================================================================

  getSchema(): object {
    const methods: Array<{ name: string; path: string; params: number }> = []
    const namespaces: Array<{ name: string; methods: Array<{ name: string; path: string }> }> = []

    // Top-level methods
    const skip = new Set([
      'constructor',
      'fetch',
      'getSchema',
      'webSocketMessage',
      'webSocketClose',
      'reset',
    ])

    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
      if (skip.has(key) || key.startsWith('_') || key.startsWith('init')) continue
      const value = (this as any)[key]
      if (typeof value === 'function') {
        methods.push({ name: key, path: key, params: value.length })
      }
    }

    // Instance properties (namespaces)
    for (const key of Object.keys(this)) {
      if (key.startsWith('_')) continue
      const value = (this as any)[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nsMethods: Array<{ name: string; path: string }> = []
        for (const nsKey of Object.keys(value)) {
          if (typeof value[nsKey] === 'function') {
            nsMethods.push({ name: nsKey, path: `${key}.${nsKey}` })
          }
        }
        if (nsMethods.length > 0) {
          namespaces.push({ name: key, methods: nsMethods })
        }
      }
    }

    // Database schema
    let database: object | undefined
    try {
      this.initSchema()
      const tables = this.sql
        .exec<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
        )
        .toArray()

      const tableSchemas = tables.map(({ name }) => {
        const columns = this.sql
          .exec<{ name: string; type: string; notnull: number; pk: number }>(
            `PRAGMA table_info('${name}')`
          )
          .toArray()
        return {
          name,
          columns: columns.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: c.notnull === 0,
            primaryKey: c.pk > 0,
          })),
        }
      })

      if (tableSchemas.length > 0) {
        database = { tables: tableSchemas }
      }
    } catch {
      // SQL not initialized
    }

    return {
      version: 1,
      methods,
      namespaces,
      database,
    }
  }

  // ============================================================================
  // RPC-callable SQL methods
  // ============================================================================

  __sql(query: { strings: string[]; values: unknown[] }): { results: unknown[]; meta: object } {
    this.initSchema()
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return {
      results: cursor.toArray(),
      meta: { rows_read: cursor.rowsRead, rows_written: cursor.rowsWritten },
    }
  }

  __sqlFirst(query: { strings: string[]; values: unknown[] }): unknown | null {
    this.initSchema()
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    const rows = cursor.toArray()
    return rows[0] ?? null
  }

  __sqlRun(query: { strings: string[]; values: unknown[] }): { rowsWritten: number } {
    this.initSchema()
    const cursor = this.sql.exec(query.strings.join('?'), ...query.values)
    return { rowsWritten: cursor.rowsWritten }
  }

  __dbSchema(): object {
    this.initSchema()
    const tables = this.sql
      .exec<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`
      )
      .toArray()

    return {
      tables: tables.map(({ name }) => ({
        name,
        columns: this.sql
          .exec<{ name: string; type: string }>(`PRAGMA table_info('${name}')`)
          .toArray(),
      })),
    }
  }

  // ============================================================================
  // RPC-callable storage methods
  // ============================================================================

  async __storageGet<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key)
  }

  async __storagePut<T>(key: string, value: T): Promise<void> {
    await this.storage.put(key, value)
  }

  async __storageDelete(key: string): Promise<boolean> {
    return this.storage.delete(key)
  }

  async __storageKeys(prefix?: string): Promise<string[]> {
    const map = await this.storage.list(prefix ? { prefix } : {})
    return Array.from(map.keys())
  }

  // ============================================================================
  // RPC-callable collection methods
  // ============================================================================

  __collectionGet(collection: string, id: string): unknown | null {
    this.initCollections()
    const rows = this.sql
      .exec<{ data: string }>(
        `SELECT data FROM _collections WHERE collection = ? AND id = ?`,
        collection,
        id
      )
      .toArray()
    const row = rows[0]
    return row ? JSON.parse(row.data) : null
  }

  __collectionPut(collection: string, id: string, doc: unknown): void {
    this.initCollections()
    const data = JSON.stringify(doc)
    const now = Date.now()
    this.sql.exec(
      `INSERT INTO _collections (collection, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(collection, id) DO UPDATE SET data = ?, updated_at = ?`,
      collection,
      id,
      data,
      now,
      now,
      data,
      now
    )
  }

  __collectionDelete(collection: string, id: string): boolean {
    this.initCollections()
    const result = this.sql.exec(
      `DELETE FROM _collections WHERE collection = ? AND id = ?`,
      collection,
      id
    )
    return result.rowsWritten > 0
  }

  __collectionHas(collection: string, id: string): boolean {
    this.initCollections()
    const rows = this.sql
      .exec<{ c: number }>(
        `SELECT 1 as c FROM _collections WHERE collection = ? AND id = ?`,
        collection,
        id
      )
      .toArray()
    return rows.length > 0
  }

  __collectionCount(collection: string, filter?: object): number {
    this.initCollections()
    // Simple count without filter for now
    const rows = this.sql
      .exec<{ c: number }>(`SELECT COUNT(*) as c FROM _collections WHERE collection = ?`, collection)
      .toArray()
    return rows[0]?.c ?? 0
  }

  __collectionNames(): string[] {
    this.initCollections()
    const rows = this.sql
      .exec<{ collection: string }>(`SELECT DISTINCT collection FROM _collections`)
      .toArray()
    return rows.map((r) => r.collection)
  }

  __collectionStats(): Array<{ name: string; count: number; size: number }> {
    this.initCollections()
    const rows = this.sql
      .exec<{ collection: string; count: number; size: number }>(
        `SELECT collection, COUNT(*) as count, SUM(LENGTH(data)) as size
         FROM _collections GROUP BY collection`
      )
      .toArray()
    return rows.map((r) => ({ name: r.collection, count: r.count, size: r.size || 0 }))
  }

  // ============================================================================
  // Namespaced Users API
  // ============================================================================

  users = {
    create: async (id: string, data: User): Promise<{ ok: true; id: string }> => {
      this.initSchema()

      const metadata = data.metadata ? JSON.stringify(data.metadata) : null
      const now = Date.now()

      this.sql.exec(
        `INSERT INTO users (id, name, email, age, active, role, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.name,
        data.email,
        data.age ?? null,
        data.active !== false ? 1 : 0,
        data.role ?? 'user',
        metadata,
        now,
        now
      )

      return { ok: true, id }
    },

    get: async (id: string): Promise<User | null> => {
      this.initSchema()

      const rows = this.sql
        .exec<{
          name: string
          email: string
          age: number | null
          active: number
          role: string
          metadata: string | null
        }>(`SELECT * FROM users WHERE id = ?`, id)
        .toArray()

      const row = rows[0]
      if (!row) return null

      return {
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }
    },

    update: async (id: string, data: Partial<User>): Promise<{ ok: true; updated: boolean }> => {
      this.initSchema()

      const updates: string[] = []
      const values: unknown[] = []

      if (data.name !== undefined) {
        updates.push('name = ?')
        values.push(data.name)
      }
      if (data.email !== undefined) {
        updates.push('email = ?')
        values.push(data.email)
      }
      if (data.age !== undefined) {
        updates.push('age = ?')
        values.push(data.age)
      }
      if (data.active !== undefined) {
        updates.push('active = ?')
        values.push(data.active ? 1 : 0)
      }
      if (data.role !== undefined) {
        updates.push('role = ?')
        values.push(data.role)
      }
      if (data.metadata !== undefined) {
        updates.push('metadata = ?')
        values.push(JSON.stringify(data.metadata))
      }

      if (updates.length === 0) {
        return { ok: true, updated: false }
      }

      updates.push('updated_at = ?')
      values.push(Date.now())
      values.push(id)

      const result = this.sql.exec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...values)

      return { ok: true, updated: result.rowsWritten > 0 }
    },

    delete: async (id: string): Promise<{ ok: true; deleted: boolean }> => {
      this.initSchema()
      const result = this.sql.exec(`DELETE FROM users WHERE id = ?`, id)
      return { ok: true, deleted: result.rowsWritten > 0 }
    },

    list: async (options?: {
      limit?: number
      offset?: number
      role?: string
    }): Promise<User[]> => {
      this.initSchema()

      let query = 'SELECT * FROM users'
      const params: unknown[] = []

      if (options?.role) {
        query += ' WHERE role = ?'
        params.push(options.role)
      }

      query += ' ORDER BY created_at DESC'

      if (options?.limit) {
        query += ' LIMIT ?'
        params.push(options.limit)
      }

      if (options?.offset) {
        query += ' OFFSET ?'
        params.push(options.offset)
      }

      const rows = this.sql
        .exec<{
          name: string
          email: string
          age: number | null
          active: number
          role: string
          metadata: string | null
        }>(query, ...params)
        .toArray()

      return rows.map((row) => ({
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
    },

    findByRole: async (role: string): Promise<User[]> => {
      this.initSchema()

      const rows = this.sql
        .exec<{
          name: string
          email: string
          age: number | null
          active: number
          role: string
          metadata: string | null
        }>(`SELECT * FROM users WHERE role = ?`, role)
        .toArray()

      return rows.map((row) => ({
        name: row.name,
        email: row.email,
        age: row.age ?? undefined,
        active: row.active === 1,
        role: row.role as User['role'],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))
    },

    count: async (filter?: { active?: boolean; role?: string }): Promise<number> => {
      this.initSchema()

      let query = 'SELECT COUNT(*) as c FROM users WHERE 1=1'
      const params: unknown[] = []

      if (filter?.active !== undefined) {
        query += ' AND active = ?'
        params.push(filter.active ? 1 : 0)
      }

      if (filter?.role) {
        query += ' AND role = ?'
        params.push(filter.role)
      }

      const rows = this.sql.exec<{ c: number }>(query, ...params).toArray()
      return rows[0]?.c ?? 0
    },
  }

  // ============================================================================
  // KV Storage namespace
  // ============================================================================

  kv = {
    get: async <T = unknown>(key: string): Promise<T | undefined> => {
      return this.storage.get<T>(key)
    },

    put: async <T = unknown>(key: string, value: T): Promise<void> => {
      await this.storage.put(key, value)
    },

    delete: async (key: string): Promise<boolean> => {
      return this.storage.delete(key)
    },

    list: async <T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> => {
      return this.storage.list<T>(options)
    },

    getMultiple: async <T = unknown>(keys: string[]): Promise<Map<string, T>> => {
      return this.storage.get<T>(keys)
    },

    putMultiple: async <T = unknown>(entries: Record<string, T>): Promise<void> => {
      await this.storage.put(entries)
    },

    deleteMultiple: async (keys: string[]): Promise<number> => {
      return this.storage.delete(keys)
    },
  }

  // ============================================================================
  // Tasks API (using collections)
  // ============================================================================

  tasksApi = {
    create: async (id: string, task: Task): Promise<{ ok: true; id: string }> => {
      this.__collectionPut('tasks', id, task)
      return { ok: true, id }
    },

    get: async (id: string): Promise<Task | null> => {
      return this.__collectionGet('tasks', id) as Task | null
    },

    update: async (id: string, updates: Partial<Task>): Promise<{ ok: true; updated: boolean }> => {
      const existing = this.__collectionGet('tasks', id) as Task | null
      if (!existing) {
        return { ok: true, updated: false }
      }
      this.__collectionPut('tasks', id, { ...existing, ...updates })
      return { ok: true, updated: true }
    },

    delete: async (id: string): Promise<{ ok: true; deleted: boolean }> => {
      const deleted = this.__collectionDelete('tasks', id)
      return { ok: true, deleted }
    },

    find: async (filter?: {
      completed?: boolean
      priority?: number
      assignee?: string
    }): Promise<Task[]> => {
      this.initCollections()

      let query = `SELECT data FROM _collections WHERE collection = 'tasks'`
      const params: unknown[] = []

      if (filter?.completed !== undefined) {
        // JSON boolean values in SQLite: true=1, false=0
        query += ` AND json_extract(data, '$.completed') = ?`
        params.push(filter.completed ? 1 : 0)
      }
      if (filter?.priority !== undefined) {
        query += ` AND json_extract(data, '$.priority') = ?`
        params.push(filter.priority)
      }
      if (filter?.assignee !== undefined) {
        query += ` AND json_extract(data, '$.assignee') = ?`
        params.push(filter.assignee)
      }

      const rows = this.sql.exec<{ data: string }>(query, ...params).toArray()
      return rows.map((r) => JSON.parse(r.data))
    },

    count: async (filter?: { completed?: boolean }): Promise<number> => {
      this.initCollections()

      let query = `SELECT COUNT(*) as c FROM _collections WHERE collection = 'tasks'`
      const params: unknown[] = []

      if (filter?.completed !== undefined) {
        // JSON boolean values in SQLite: true=1, false=0
        query += ` AND json_extract(data, '$.completed') = ?`
        params.push(filter.completed ? 1 : 0)
      }

      const rows = this.sql.exec<{ c: number }>(query, ...params).toArray()
      return rows[0]?.c ?? 0
    },

    keys: async (): Promise<string[]> => {
      this.initCollections()
      const rows = this.sql
        .exec<{ id: string }>(`SELECT id FROM _collections WHERE collection = 'tasks'`)
        .toArray()
      return rows.map((r) => r.id)
    },

    clear: async (): Promise<{ ok: true; deleted: number }> => {
      this.initCollections()
      const result = this.sql.exec(`DELETE FROM _collections WHERE collection = 'tasks'`)
      return { ok: true, deleted: result.rowsWritten }
    },
  }

  // ============================================================================
  // Collection discovery methods
  // ============================================================================

  async getCollectionNames(): Promise<string[]> {
    return this.__collectionNames()
  }

  async getCollectionStats(): Promise<Array<{ name: string; count: number; size: number }>> {
    return this.__collectionStats()
  }

  // ============================================================================
  // Test utility methods
  // ============================================================================

  async echo(message: string): Promise<string> {
    return `Echo: ${message}`
  }

  async add(a: number, b: number): Promise<number> {
    return a + b
  }

  async throwError(message: string): Promise<never> {
    throw new Error(message)
  }

  async getComplexData(): Promise<{
    timestamp: number
    nested: { deep: { value: string } }
    array: number[]
  }> {
    return {
      timestamp: Date.now(),
      nested: { deep: { value: 'test' } },
      array: [1, 2, 3, 4, 5],
    }
  }

  async delayed(ms: number, value: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return value
  }

  async executeRawSql(
    query: string,
    ...params: unknown[]
  ): Promise<{ results: unknown[]; rowsWritten: number }> {
    this.initSchema()
    const cursor = this.sql.exec(query, ...params)
    return {
      results: cursor.toArray(),
      rowsWritten: cursor.rowsWritten,
    }
  }

  async reset(): Promise<{ ok: true }> {
    // Clear SQL tables
    try {
      this.sql.exec('DROP TABLE IF EXISTS users')
      this.sql.exec('DROP TABLE IF EXISTS _collections')
    } catch {
      // Tables might not exist
    }

    // Clear storage
    const allEntries = await this.storage.list()
    const keys = Array.from(allEntries.keys())
    if (keys.length > 0) {
      await this.storage.delete(keys)
    }

    this._initialized = false
    this._collectionsInitialized = false

    return { ok: true }
  }
}
