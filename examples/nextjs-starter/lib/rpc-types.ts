/**
 * RPC API Type Definitions
 *
 * Define your RPC methods here for full type safety across client and server.
 */

// ============================================================================
// Greeting RPC Types
// ============================================================================

export interface GreetingInput {
  name: string
}

export interface GreetingOutput {
  message: string
  timestamp: string
}

// ============================================================================
// User Data Types
// ============================================================================

export interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export interface GetUserInput {
  id: string
}

export interface GetUserOutput {
  user: User | null
}

export interface ListUsersInput {
  limit?: number
  offset?: number
}

export interface ListUsersOutput {
  users: User[]
  total: number
}

// ============================================================================
// Error Example Types
// ============================================================================

export interface SimulateErrorInput {
  type: 'validation' | 'not_found' | 'server'
}

// ============================================================================
// Full API Definition
// ============================================================================

/**
 * Complete RPC API interface
 *
 * This interface defines all available RPC methods and their signatures.
 * Use this to get full type safety in both client and server code.
 */
export interface RPCAPI {
  greeting: {
    sayHello: (input: GreetingInput) => GreetingOutput
  }
  users: {
    get: (input: GetUserInput) => GetUserOutput
    list: (input: ListUsersInput) => ListUsersOutput
  }
  errors: {
    simulate: (input: SimulateErrorInput) => never
  }
}
