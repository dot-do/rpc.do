/**
 * Todo Client
 *
 * Typed RPC client for the Todo API using rpc.do http transport.
 * Demonstrates typed RPC calls with error handling.
 */

import { RPC, http } from 'rpc.do'
import type { Todo } from './TodoList'

/**
 * Todo API interface for typed RPC
 */
export interface TodoAPI {
  create(text: string): Todo
  list(): Todo[]
  update(id: string, done: boolean): Todo
  delete(id: string): { success: boolean }
  get(id: string): Todo | null
  clearCompleted(): { deleted: number }
}

/**
 * Options for creating a Todo client
 */
export interface TodoClientOptions {
  /** Base URL of the Todo API (default: http://localhost:8787) */
  baseUrl?: string
  /** Optional list ID (default: 'default') */
  listId?: string
  /** Optional auth token */
  token?: string
}

/**
 * Create a typed Todo RPC client
 *
 * @example
 * ```typescript
 * const client = createTodoClient({ baseUrl: 'https://todo-api.example.com' })
 *
 * // Create a todo
 * const todo = await client.create('Buy groceries')
 *
 * // List all todos
 * const todos = await client.list()
 *
 * // Update a todo
 * await client.update(todo.id, true)
 *
 * // Delete a todo
 * await client.delete(todo.id)
 * ```
 */
export function createTodoClient(options: TodoClientOptions = {}) {
  const {
    baseUrl = 'http://localhost:8787',
    listId = 'default',
    token,
  } = options

  // Build the full URL for the todo list DO
  const url = `${baseUrl}/todos/${listId}`

  // Create transport with optional auth
  const transport = token ? http(url, token) : http(url)

  // Create typed RPC client
  return RPC<TodoAPI>(transport)
}

/**
 * Error handling utilities
 */
export class TodoError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'TodoError'
  }

  static fromError(error: unknown): TodoError {
    if (error instanceof TodoError) {
      return error
    }
    if (error instanceof Error) {
      return new TodoError(error.message, 'UNKNOWN', error)
    }
    return new TodoError(String(error), 'UNKNOWN', error)
  }
}

/**
 * Wrapper with built-in error handling
 *
 * @example
 * ```typescript
 * const client = createTodoClientWithErrorHandling()
 *
 * try {
 *   const todo = await client.create('Buy milk')
 *   console.log('Created:', todo)
 * } catch (error) {
 *   if (error instanceof TodoError) {
 *     console.error('Todo error:', error.message, error.code)
 *   }
 * }
 * ```
 */
export function createTodoClientWithErrorHandling(options: TodoClientOptions = {}) {
  const client = createTodoClient(options)

  const wrap = <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
    return (async (...args: Parameters<T>) => {
      try {
        return await fn(...args)
      } catch (error) {
        throw TodoError.fromError(error)
      }
    }) as T
  }

  return {
    create: wrap(client.create.bind(client) as typeof client.create),
    list: wrap(client.list.bind(client) as typeof client.list),
    update: wrap(client.update.bind(client) as typeof client.update),
    delete: wrap(client.delete.bind(client) as typeof client.delete),
    get: wrap(client.get.bind(client) as typeof client.get),
    clearCompleted: wrap(client.clearCompleted.bind(client) as typeof client.clearCompleted),
  }
}

// Default export for convenience
export default createTodoClient
