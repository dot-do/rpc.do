/**
 * Capnweb Module Loader
 *
 * Centralizes the dynamic import of @dotdo/capnweb to:
 * - Handle the dynamic import once and cache the result
 * - Provide typed exports for capnweb functions
 * - Allow injection of mocks for testing
 *
 * @module
 */

import { RPCError } from './errors.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Type for the RpcSession constructor from capnweb
 */
export type RpcSessionConstructor = new (
  transport: unknown,
  localMain?: unknown
) => {
  getRemoteMain(): unknown
  [Symbol.dispose]?: () => void
}

/**
 * Type for session factory functions from capnweb
 */
export type SessionFactory = (url: string) => unknown

/**
 * Capnweb module interface - the exports we use from @dotdo/capnweb
 */
export interface CapnwebModule {
  /** Create an HTTP batch RPC session */
  newHttpBatchRpcSession: SessionFactory
  /** Create a WebSocket RPC session */
  newWebSocketRpcSession: SessionFactory
  /** RpcSession class for custom transports */
  RpcSession: RpcSessionConstructor
}

// ============================================================================
// Module State
// ============================================================================

/**
 * Cached module promise - ensures single load
 */
let modulePromise: Promise<CapnwebModule> | null = null

/**
 * Resolved module reference - for synchronous access after first load.
 * This enables promise pipelining by allowing transports to create
 * capnweb sessions without an async boundary.
 */
let resolvedModule: CapnwebModule | null = null

/**
 * Mock module for testing - when set, this is returned instead of the real module
 */
let mockModule: CapnwebModule | null = null

// ============================================================================
// Public API
// ============================================================================

/**
 * Load the capnweb module
 *
 * This function handles dynamic importing of @dotdo/capnweb with:
 * - Single-load caching (module is only imported once)
 * - Type-safe exports
 * - Mock injection support for testing
 *
 * @returns Promise resolving to the capnweb module
 * @throws {RPCError} If the module cannot be loaded or is missing required exports
 *
 * @example
 * ```typescript
 * import { loadCapnweb } from './capnweb-loader'
 *
 * const capnweb = await loadCapnweb()
 * const session = capnweb.newHttpBatchRpcSession('https://api.example.com/rpc')
 * ```
 */
export async function loadCapnweb(): Promise<CapnwebModule> {
  // Return mock if set (for testing)
  if (mockModule) {
    return mockModule
  }

  // Fast path: already resolved
  if (resolvedModule) {
    return Promise.resolve(resolvedModule)
  }

  // Return cached promise if already loading
  if (modulePromise) {
    return modulePromise
  }

  // Start loading
  modulePromise = (async (): Promise<CapnwebModule> => {
    try {
      // Dynamic import capnweb (optional dependency)
      const mod = await import('@dotdo/capnweb') as Record<string, unknown>

      // Validate required exports exist
      const newHttpBatchRpcSession = mod['newHttpBatchRpcSession'] as SessionFactory | undefined
      const newWebSocketRpcSession = mod['newWebSocketRpcSession'] as SessionFactory | undefined
      const RpcSession = mod['RpcSession'] as RpcSessionConstructor | undefined

      if (!newHttpBatchRpcSession) {
        throw new RPCError('capnweb.newHttpBatchRpcSession not found', 'MODULE_ERROR')
      }
      if (!newWebSocketRpcSession) {
        throw new RPCError('capnweb.newWebSocketRpcSession not found', 'MODULE_ERROR')
      }
      if (!RpcSession) {
        throw new RPCError('capnweb.RpcSession not found', 'MODULE_ERROR')
      }

      const result: CapnwebModule = {
        newHttpBatchRpcSession,
        newWebSocketRpcSession,
        RpcSession,
      }
      resolvedModule = result
      return result
    } catch (error) {
      // Clear cache on error so retry is possible
      modulePromise = null

      if (error instanceof RPCError) {
        throw error
      }

      // Handle module not found
      if (error instanceof Error && error.message.includes('Cannot find module')) {
        throw new RPCError(
          '@dotdo/capnweb is not installed. Install it with: npm install @dotdo/capnweb',
          'MODULE_NOT_FOUND'
        )
      }

      throw new RPCError(
        `Failed to load @dotdo/capnweb: ${error instanceof Error ? error.message : String(error)}`,
        'MODULE_ERROR'
      )
    }
  })()

  return modulePromise
}

/**
 * Set a mock capnweb module for testing
 *
 * When a mock is set, `loadCapnweb()` will return it instead of
 * dynamically importing the real module.
 *
 * @param mock - The mock module to use, or null to clear
 *
 * @example
 * ```typescript
 * import { setCapnwebMock, loadCapnweb } from './capnweb-loader'
 *
 * // In test setup
 * const mockCapnweb = {
 *   newHttpBatchRpcSession: vi.fn(),
 *   newWebSocketRpcSession: vi.fn(),
 *   RpcSession: vi.fn(),
 * }
 * setCapnwebMock(mockCapnweb)
 *
 * // Now loadCapnweb() returns the mock
 * const capnweb = await loadCapnweb()
 * expect(capnweb).toBe(mockCapnweb)
 *
 * // In test teardown
 * setCapnwebMock(null)
 * ```
 */
export function setCapnwebMock(mock: CapnwebModule | null): void {
  mockModule = mock
}

/**
 * Get the capnweb module synchronously if already loaded.
 *
 * Returns the cached module without an async boundary, enabling
 * transports to create sessions synchronously for promise pipelining.
 * Returns null if the module hasn't been loaded yet.
 *
 * @returns The cached capnweb module or null
 */
export function getCapnwebModuleSync(): CapnwebModule | null {
  return mockModule ?? resolvedModule
}

/**
 * Clear the cached module
 *
 * This is primarily useful for testing to ensure a fresh load.
 * In production, the module cache should generally not be cleared.
 */
export function clearCapnwebCache(): void {
  modulePromise = null
  resolvedModule = null
}

/**
 * Check if a mock is currently set
 *
 * @returns true if a mock module is set
 */
export function hasCapnwebMock(): boolean {
  return mockModule !== null
}

/**
 * Get the current mock module (for testing introspection)
 *
 * @returns The current mock module or null
 */
export function getCapnwebMock(): CapnwebModule | null {
  return mockModule
}
