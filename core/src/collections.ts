/**
 * Collections - MongoDB-style document store on DO SQLite
 *
 * Simple wrapper that provides:
 * - Named collections (like MongoDB)
 * - get/put/delete operations
 * - MongoDB-style filter queries
 * - All stored in a single SQLite table
 *
 * Billing: Each document is 1 row. Queries read only matching rows.
 *
 * @example
 * ```typescript
 * // Inside DO
 * export class MyDO extends DurableRPC {
 *   users = this.collection<User>('users')
 *
 *   async createUser(data: User) {
 *     await this.users.put(data.id, data)
 *   }
 *
 *   async getActiveUsers() {
 *     return this.users.find({ active: true, role: 'admin' })
 *   }
 * }
 *
 * // Outside DO (via RPC)
 * const users = await $.users.find({ active: true })
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * MongoDB-style filter operators
 */
export type FilterOperator =
  | { $eq: unknown }
  | { $ne: unknown }
  | { $gt: number }
  | { $gte: number }
  | { $lt: number }
  | { $lte: number }
  | { $in: unknown[] }
  | { $nin: unknown[] }
  | { $exists: boolean }
  | { $regex: string }

/**
 * MongoDB-style filter query
 */
export type Filter<T> = {
  [K in keyof T]?: T[K] | FilterOperator
} & {
  $and?: Filter<T>[]
  $or?: Filter<T>[]
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Sort by field (prefix with - for descending) */
  sort?: string
}

/**
 * Collection interface
 */
export interface Collection<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Get a document by ID */
  get(id: string): T | null
  /** Put a document (insert or update) */
  put(id: string, doc: T): void
  /** Delete a document */
  delete(id: string): boolean
  /** Check if document exists */
  has(id: string): boolean
  /** Find documents matching filter */
  find(filter?: Filter<T>, options?: QueryOptions): T[]
  /** Count documents matching filter */
  count(filter?: Filter<T>): number
  /** List all documents */
  list(options?: QueryOptions): T[]
  /** Get all IDs */
  keys(): string[]
  /** Delete all documents in collection */
  clear(): number
}

// ============================================================================
// SQL Schema
// ============================================================================

/**
 * Initialize the collections schema.
 * Each statement must be executed separately since SqlStorage.exec()
 * may not support multiple statements in a single call.
 */
function initCollectionsSchema(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS _collections (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (collection, id)
    )
  `)
  sql.exec(`CREATE INDEX IF NOT EXISTS _collections_collection ON _collections(collection)`)
  sql.exec(`CREATE INDEX IF NOT EXISTS _collections_updated ON _collections(collection, updated_at)`)
}

// ============================================================================
// Filter Compiler
// ============================================================================

/**
 * Compile a MongoDB-style filter to SQL WHERE clause
 */
function compileFilter<T>(filter: Filter<T>, params: unknown[]): string {
  const conditions: string[] = []

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' && Array.isArray(value)) {
      const subConditions = value.map(f => compileFilter(f, params))
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' AND ')})`)
      }
    } else if (key === '$or' && Array.isArray(value)) {
      const subConditions = value.map(f => compileFilter(f, params))
      if (subConditions.length > 0) {
        conditions.push(`(${subConditions.join(' OR ')})`)
      }
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Operator or nested object
      const op = value as Record<string, unknown>
      if ('$eq' in op) {
        const eqVal = op['$eq']
        params.push(typeof eqVal === 'boolean' ? (eqVal ? 1 : 0) : eqVal)
        conditions.push(`json_extract(data, '$.${key}') = ?`)
      } else if ('$ne' in op) {
        const neVal = op['$ne']
        params.push(typeof neVal === 'boolean' ? (neVal ? 1 : 0) : neVal)
        conditions.push(`json_extract(data, '$.${key}') != ?`)
      } else if ('$gt' in op) {
        params.push(op['$gt'])
        conditions.push(`CAST(json_extract(data, '$.${key}') AS REAL) > ?`)
      } else if ('$gte' in op) {
        params.push(op['$gte'])
        conditions.push(`CAST(json_extract(data, '$.${key}') AS REAL) >= ?`)
      } else if ('$lt' in op) {
        params.push(op['$lt'])
        conditions.push(`CAST(json_extract(data, '$.${key}') AS REAL) < ?`)
      } else if ('$lte' in op) {
        params.push(op['$lte'])
        conditions.push(`CAST(json_extract(data, '$.${key}') AS REAL) <= ?`)
      } else if ('$in' in op && Array.isArray(op['$in'])) {
        const inValues = (op['$in'] as unknown[]).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v)
        const placeholders = inValues.map(() => '?').join(', ')
        params.push(...inValues)
        conditions.push(`json_extract(data, '$.${key}') IN (${placeholders})`)
      } else if ('$nin' in op && Array.isArray(op['$nin'])) {
        const ninValues = (op['$nin'] as unknown[]).map(v => typeof v === 'boolean' ? (v ? 1 : 0) : v)
        const placeholders = ninValues.map(() => '?').join(', ')
        params.push(...ninValues)
        conditions.push(`json_extract(data, '$.${key}') NOT IN (${placeholders})`)
      } else if ('$exists' in op) {
        if (op['$exists']) {
          conditions.push(`json_extract(data, '$.${key}') IS NOT NULL`)
        } else {
          conditions.push(`json_extract(data, '$.${key}') IS NULL`)
        }
      } else if ('$regex' in op) {
        params.push(op['$regex'])
        conditions.push(`json_extract(data, '$.${key}') REGEXP ?`)
      } else {
        // Plain object value - exact match
        params.push(JSON.stringify(value))
        conditions.push(`json_extract(data, '$.${key}') = json(?)`)
      }
    } else {
      // Simple equality - handle booleans specially since SQLite JSON returns 1/0
      if (typeof value === 'boolean') {
        params.push(value ? 1 : 0)
      } else {
        params.push(value)
      }
      conditions.push(`json_extract(data, '$.${key}') = ?`)
    }
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1'
}

// ============================================================================
// Collection Factory
// ============================================================================

/**
 * Track which SqlStorage instances have been initialized.
 * We use a WeakSet to avoid memory leaks - when a SqlStorage is GC'd,
 * it's automatically removed from this set.
 */
const initializedStorages = new WeakSet<SqlStorage>()

/**
 * Create a collection bound to a SQL storage
 */
export function createCollection<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: SqlStorage,
  name: string
): Collection<T> {
  // Initialize schema once per SqlStorage instance
  if (!initializedStorages.has(sql)) {
    initCollectionsSchema(sql)
    initializedStorages.add(sql)
  }

  return {
    get(id: string): T | null {
      const rows = sql.exec<{ data: string }>(
        `SELECT data FROM _collections WHERE collection = ? AND id = ?`,
        name, id
      ).toArray()
      return rows.length > 0 ? JSON.parse(rows[0].data) : null
    },

    put(id: string, doc: T): void {
      const data = JSON.stringify(doc)
      const now = Date.now()
      sql.exec(
        `INSERT INTO _collections (collection, id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET data = ?, updated_at = ?`,
        name, id, data, now, now, data, now
      )
    },

    delete(id: string): boolean {
      const result = sql.exec(
        `DELETE FROM _collections WHERE collection = ? AND id = ?`,
        name, id
      )
      return result.rowsWritten > 0
    },

    has(id: string): boolean {
      const rows = sql.exec<{ c: number }>(
        `SELECT 1 as c FROM _collections WHERE collection = ? AND id = ?`,
        name, id
      ).toArray()
      return rows.length > 0
    },

    find(filter?: Filter<T>, options?: QueryOptions): T[] {
      const params: unknown[] = [name]
      let whereClause = 'collection = ?'

      if (filter && Object.keys(filter).length > 0) {
        whereClause += ' AND ' + compileFilter(filter, params)
      }

      let query = `SELECT data FROM _collections WHERE ${whereClause}`

      // Sort
      if (options?.sort) {
        const desc = options.sort.startsWith('-')
        const field = desc ? options.sort.slice(1) : options.sort
        query += ` ORDER BY json_extract(data, '$.${field}') ${desc ? 'DESC' : 'ASC'}`
      } else {
        query += ' ORDER BY updated_at DESC'
      }

      // Pagination
      if (options?.limit) {
        query += ` LIMIT ${options.limit}`
      }
      if (options?.offset) {
        query += ` OFFSET ${options.offset}`
      }

      const rows = sql.exec<{ data: string }>(query, ...params).toArray()
      return rows.map(row => JSON.parse(row.data))
    },

    count(filter?: Filter<T>): number {
      const params: unknown[] = [name]
      let whereClause = 'collection = ?'

      if (filter && Object.keys(filter).length > 0) {
        whereClause += ' AND ' + compileFilter(filter, params)
      }

      const rows = sql.exec<{ c: number }>(
        `SELECT COUNT(*) as c FROM _collections WHERE ${whereClause}`,
        ...params
      ).toArray()
      return rows[0]?.c ?? 0
    },

    list(options?: QueryOptions): T[] {
      return this.find(undefined, options)
    },

    keys(): string[] {
      const rows = sql.exec<{ id: string }>(
        `SELECT id FROM _collections WHERE collection = ? ORDER BY id`,
        name
      ).toArray()
      return rows.map(row => row.id)
    },

    clear(): number {
      const result = sql.exec(
        `DELETE FROM _collections WHERE collection = ?`,
        name
      )
      return result.rowsWritten
    },
  }
}

// ============================================================================
// Collections Manager
// ============================================================================

/**
 * Manage multiple collections
 */
export class Collections {
  private sql: SqlStorage
  private cache = new Map<string, Collection<any>>()

  constructor(sql: SqlStorage) {
    this.sql = sql
  }

  /**
   * Get or create a collection
   */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Collection<T> {
    let col = this.cache.get(name)
    if (!col) {
      col = createCollection<T>(this.sql, name)
      this.cache.set(name, col)
    }
    return col as Collection<T>
  }

  /**
   * List all collection names
   */
  names(): string[] {
    const rows = this.sql.exec<{ collection: string }>(
      `SELECT DISTINCT collection FROM _collections ORDER BY collection`
    ).toArray()
    return rows.map(row => row.collection)
  }

  /**
   * Drop a collection
   */
  drop(name: string): number {
    this.cache.delete(name)
    const result = this.sql.exec(
      `DELETE FROM _collections WHERE collection = ?`,
      name
    )
    return result.rowsWritten
  }

  /**
   * Get stats for all collections
   */
  stats(): Array<{ name: string; count: number; size: number }> {
    const rows = this.sql.exec<{ collection: string; count: number; size: number }>(
      `SELECT collection, COUNT(*) as count, SUM(LENGTH(data)) as size
       FROM _collections GROUP BY collection ORDER BY collection`
    ).toArray()
    return rows.map(row => ({
      name: row.collection,
      count: row.count,
      size: row.size,
    }))
  }
}
