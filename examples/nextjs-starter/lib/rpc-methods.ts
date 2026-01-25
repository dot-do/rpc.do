/**
 * RPC Method Implementations
 *
 * Define your RPC method handlers here. These are called by the server
 * when an RPC request is received.
 */

import type {
  GreetingInput,
  GreetingOutput,
  GetUserInput,
  GetUserOutput,
  ListUsersInput,
  ListUsersOutput,
  SimulateErrorInput,
  User,
} from './rpc-types'

// ============================================================================
// Mock Data (replace with your database in production)
// ============================================================================

const mockUsers: User[] = [
  {
    id: '1',
    name: 'Alice Johnson',
    email: 'alice@example.com',
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    name: 'Bob Smith',
    email: 'bob@example.com',
    createdAt: '2024-02-20T14:45:00Z',
  },
  {
    id: '3',
    name: 'Carol Williams',
    email: 'carol@example.com',
    createdAt: '2024-03-10T09:15:00Z',
  },
]

// ============================================================================
// RPC Method Handlers
// ============================================================================

/**
 * Greeting methods
 */
export const greetingMethods = {
  sayHello: async (input: GreetingInput): Promise<GreetingOutput> => {
    // Simulate some async work
    await new Promise((resolve) => setTimeout(resolve, 100))

    return {
      message: `Hello, ${input.name}! Welcome to rpc.do`,
      timestamp: new Date().toISOString(),
    }
  },
}

/**
 * User methods
 */
export const userMethods = {
  get: async (input: GetUserInput): Promise<GetUserOutput> => {
    // Simulate database lookup
    await new Promise((resolve) => setTimeout(resolve, 50))

    const user = mockUsers.find((u) => u.id === input.id) || null
    return { user }
  },

  list: async (input: ListUsersInput): Promise<ListUsersOutput> => {
    // Simulate database query
    await new Promise((resolve) => setTimeout(resolve, 100))

    const limit = input.limit ?? 10
    const offset = input.offset ?? 0

    const users = mockUsers.slice(offset, offset + limit)

    return {
      users,
      total: mockUsers.length,
    }
  },
}

/**
 * Error simulation methods (for demonstrating error handling)
 */
export const errorMethods = {
  simulate: async (input: SimulateErrorInput): Promise<never> => {
    switch (input.type) {
      case 'validation':
        throw new Error('Validation failed: Invalid input provided')
      case 'not_found':
        throw new Error('Resource not found')
      case 'server':
        throw new Error('Internal server error')
      default:
        throw new Error(`Unknown error type: ${input.type}`)
    }
  },
}

// ============================================================================
// Method Dispatcher
// ============================================================================

/**
 * Dispatch RPC calls to the appropriate handler
 *
 * @param method - The method path (e.g., 'greeting.sayHello')
 * @param args - The method arguments
 * @returns The method result
 */
export async function dispatch(
  method: string,
  args: unknown[]
): Promise<unknown> {
  const [namespace, methodName] = method.split('.')

  // Get the first argument as input (rpc.do convention)
  const input = args[0] as Record<string, unknown>

  switch (namespace) {
    case 'greeting':
      if (methodName === 'sayHello') {
        return greetingMethods.sayHello(input as GreetingInput)
      }
      break

    case 'users':
      if (methodName === 'get') {
        return userMethods.get(input as GetUserInput)
      }
      if (methodName === 'list') {
        return userMethods.list(input as ListUsersInput)
      }
      break

    case 'errors':
      if (methodName === 'simulate') {
        return errorMethods.simulate(input as SimulateErrorInput)
      }
      break
  }

  throw new Error(`Unknown method: ${method}`)
}
