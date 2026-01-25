/**
 * Todo API Worker
 *
 * Routes requests to the TodoList Durable Object.
 * Uses HTTP transport for simple request/response pattern.
 */

import { router } from '@dotdo/rpc'

// Re-export the TodoList DO for wrangler
export { TodoList } from './TodoList'

/**
 * Environment bindings
 */
export interface Env {
  /** TodoList Durable Object namespace */
  TODO_LIST: DurableObjectNamespace
}

/**
 * Worker handler using @dotdo/rpc router
 *
 * Routes:
 * - POST /todos/:id - RPC calls to a specific todo list
 * - GET /todos/:id/__schema - Get API schema
 *
 * Default list ID is "default" if not specified.
 */
export default router<Env>({
  bindings: {
    todos: 'TODO_LIST',
  },
})
