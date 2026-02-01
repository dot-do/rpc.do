/**
 * Mock SqlStorage Implementation for Tests
 *
 * Provides a mock SqlStorage that wraps sql.js to simulate Cloudflare Workers SQLite API.
 * This is shared across all test files that need to test against SQL storage.
 */

import type { Database } from 'sql.js'

// Schema for _collections table (copied from collections.ts)
export const COLLECTIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS _collections (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS _collections_collection ON _collections(collection);
  CREATE INDEX IF NOT EXISTS _collections_updated ON _collections(collection, updated_at);
`

/**
 * Mock SQL cursor that mimics Cloudflare's SqlStorageCursor
 */
export class SqlCursor<T> {
  private rows: T[]
  readonly rowsRead: number
  readonly rowsWritten: number

  constructor(rows: T[], rowsRead: number, rowsWritten: number) {
    this.rows = rows
    this.rowsRead = rowsRead
    this.rowsWritten = rowsWritten
  }

  one(): T | null {
    return this.rows[0] ?? null
  }

  toArray(): T[] {
    return this.rows
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const row of this.rows) {
      yield row
    }
  }
}

/**
 * Mock SqlStorage that wraps sql.js to simulate Cloudflare Workers SQLite API
 */
export class MockSqlStorage {
  private db: Database
  private regexpInstalled = false

  constructor(db: Database) {
    this.db = db
    // Initialize the schema immediately
    this.initSchema()
  }

  private initSchema(): void {
    // Execute each statement separately since sql.js doesn't handle multi-statement well
    const statements = COLLECTIONS_SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0)
    for (const stmt of statements) {
      this.db.run(stmt)
    }
  }

  /**
   * Execute SQL and return a cursor-like object
   */
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): SqlCursor<T> {
    // Install REGEXP function if needed and not already installed
    if (query.includes('REGEXP') && !this.regexpInstalled) {
      this.db.create_function('regexp', (pattern: string, value: string) => {
        if (value === null || value === undefined) return 0
        try {
          const regex = new RegExp(pattern as string)
          return regex.test(String(value)) ? 1 : 0
        } catch {
          return 0
        }
      })
      this.regexpInstalled = true
    }

    // Handle multi-statement queries (for schema creation) - skip since we init manually
    if (query.includes(';') && query.trim().split(';').filter(s => s.trim()).length > 1) {
      // Schema already initialized, just return empty cursor
      return new SqlCursor<T>([], 0, 0)
    }

    const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(query)

    // Convert params to the format sql.js expects
    const bindParams = params.map(p => {
      if (p === undefined) return null
      return p
    })

    if (isWrite) {
      this.db.run(query, bindParams)
      const changes = this.db.getRowsModified()
      return new SqlCursor<T>([], 0, changes)
    } else {
      const stmt = this.db.prepare(query)
      stmt.bind(bindParams)
      const rows: T[] = []
      while (stmt.step()) {
        const row = stmt.getAsObject() as T
        rows.push(row)
      }
      stmt.free()
      return new SqlCursor<T>(rows, rows.length, 0)
    }
  }

  close(): void {
    this.db.close()
  }
}
