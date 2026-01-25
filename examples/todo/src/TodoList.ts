/**
 * TodoList Durable Object
 *
 * A Durable Object that stores and manages a list of todo items using SQLite storage.
 * Extends DurableRPC from @dotdo/rpc for automatic RPC handling.
 */

import { DurableRPC } from '@dotdo/rpc'

/**
 * Todo item structure
 */
export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Raw database row structure
 */
interface TodoRow {
  id: string
  text: string
  done: number
  created_at: number
  updated_at: number
}

/**
 * TodoList Durable Object
 *
 * Provides CRUD operations for todo items using SQL storage.
 */
export class TodoList extends DurableRPC {
  /**
   * Initialize the SQL schema on first access
   */
  private initialized = false

  private ensureSchema(): void {
    if (this.initialized) return

    this.$.sql.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.initialized = true
  }

  /**
   * Generate a unique ID for a new todo
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Create a new todo item
   *
   * @param text - The todo text/description
   * @returns The created todo item
   */
  async create(text: string): Promise<Todo> {
    this.ensureSchema()

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Todo text is required')
    }

    const id = this.generateId()
    const now = Date.now()
    const trimmedText = text.trim()

    this.$.sql.exec(
      `INSERT INTO todos (id, text, done, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
      id,
      trimmedText,
      now,
      now
    )

    return {
      id,
      text: trimmedText,
      done: false,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * List all todo items
   *
   * @returns Array of all todos, sorted by creation date (newest first)
   */
  async list(): Promise<Todo[]> {
    this.ensureSchema()

    const cursor = this.$.sql.exec<TodoRow>(
      `SELECT id, text, done, created_at, updated_at FROM todos ORDER BY created_at DESC`
    )

    return cursor.toArray().map((row) => ({
      id: row.id,
      text: row.text,
      done: Boolean(row.done),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Update a todo's done status
   *
   * @param id - The todo ID
   * @param done - The new done status
   * @returns The updated todo item
   */
  async update(id: string, done: boolean): Promise<Todo> {
    this.ensureSchema()

    if (!id || typeof id !== 'string') {
      throw new Error('Todo ID is required')
    }

    const now = Date.now()

    // Check if todo exists
    const cursor = this.$.sql.exec<TodoRow>(
      `SELECT id, text, done, created_at, updated_at FROM todos WHERE id = ?`,
      id
    )
    const existing = cursor.one()

    if (!existing) {
      throw new Error(`Todo not found: ${id}`)
    }

    // Update the todo
    this.$.sql.exec(
      `UPDATE todos SET done = ?, updated_at = ? WHERE id = ?`,
      done ? 1 : 0,
      now,
      id
    )

    return {
      id: existing.id,
      text: existing.text,
      done,
      createdAt: existing.created_at,
      updatedAt: now,
    }
  }

  /**
   * Delete a todo item
   *
   * @param id - The todo ID to delete
   * @returns Success status
   */
  async delete(id: string): Promise<{ success: boolean }> {
    this.ensureSchema()

    if (!id || typeof id !== 'string') {
      throw new Error('Todo ID is required')
    }

    // Check if todo exists
    const cursor = this.$.sql.exec<{ id: string }>(
      `SELECT id FROM todos WHERE id = ?`,
      id
    )
    const existing = cursor.one()

    if (!existing) {
      throw new Error(`Todo not found: ${id}`)
    }

    this.$.sql.exec(`DELETE FROM todos WHERE id = ?`, id)

    return { success: true }
  }

  /**
   * Get a single todo by ID
   *
   * @param id - The todo ID
   * @returns The todo item or null if not found
   */
  async get(id: string): Promise<Todo | null> {
    this.ensureSchema()

    if (!id || typeof id !== 'string') {
      throw new Error('Todo ID is required')
    }

    const cursor = this.$.sql.exec<TodoRow>(
      `SELECT id, text, done, created_at, updated_at FROM todos WHERE id = ?`,
      id
    )

    // Use toArray and check first item (one() throws if no rows)
    const rows = cursor.toArray()
    if (rows.length === 0) {
      return null
    }

    const row = rows[0]
    return {
      id: row.id,
      text: row.text,
      done: Boolean(row.done),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * Clear all completed todos
   *
   * @returns Number of deleted todos
   */
  async clearCompleted(): Promise<{ deleted: number }> {
    this.ensureSchema()

    const countCursor = this.$.sql.exec<{ count: number }>(
      `SELECT COUNT(*) as count FROM todos WHERE done = 1`
    )
    const result = countCursor.one()
    const count = result?.count ?? 0

    this.$.sql.exec(`DELETE FROM todos WHERE done = 1`)

    return { deleted: count }
  }
}
