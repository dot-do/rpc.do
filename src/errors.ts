/**
 * rpc.do Error Classes
 *
 * Provides typed error classes for connection, protocol, and RPC errors.
 * Some types are re-exported from @dotdo/types for convenience.
 */

import type {
  RPCError as RPCErrorType,
  RPCErrorCode,
  RPCStringErrorCode,
  ConnectionErrorCode as BaseConnectionErrorCode,
  ConnectionError as ConnectionErrorInterface,
  AuthenticationError as AuthenticationErrorInterface,
} from '@dotdo/types/rpc'

// Re-export types from @dotdo/types
export type { RPCErrorType, RPCErrorCode, RPCStringErrorCode }

/**
 * Error codes for connection-related errors
 * Extended from @dotdo/types with additional rpc.do-specific codes
 */
export type ConnectionErrorCode =
  | BaseConnectionErrorCode
  | 'CONNECTION_TIMEOUT'
  | 'AUTH_FAILED'
  | 'RECONNECT_FAILED'
  | 'HEARTBEAT_TIMEOUT'
  | 'INSECURE_CONNECTION'
  | 'REQUEST_TIMEOUT'

/**
 * Connection error with retry information
 *
 * Represents errors that occur during WebSocket connection establishment,
 * authentication, or during an active connection.
 *
 * @example
 * ```typescript
 * try {
 *   await transport.connect()
 * } catch (error) {
 *   if (error instanceof ConnectionError) {
 *     if (error.retryable) {
 *       console.log(`Connection failed, will retry: ${error.message}`)
 *     } else {
 *       console.error(`Fatal connection error: ${error.message}`)
 *     }
 *   }
 * }
 * ```
 */
export class ConnectionError extends Error {
  /** Error code for programmatic handling */
  readonly code: ConnectionErrorCode

  /** Whether this error is retryable (connection can be re-attempted) */
  readonly retryable: boolean

  constructor(
    message: string,
    code: ConnectionErrorCode,
    retryable: boolean = true
  ) {
    super(message)
    this.name = 'ConnectionError'
    this.code = code
    this.retryable = retryable

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConnectionError)
    }
  }

  /**
   * Create a connection timeout error (retryable)
   *
   * @param timeoutMs - The timeout duration that was exceeded
   * @returns ConnectionError with code 'CONNECTION_TIMEOUT'
   *
   * @example
   * ```typescript
   * const error = ConnectionError.timeout(5000)
   * // error.message: "Connection timeout after 5000ms"
   * // error.retryable: true
   * ```
   */
  static timeout(timeoutMs: number): ConnectionError {
    return new ConnectionError(
      `Connection timeout after ${timeoutMs}ms`,
      'CONNECTION_TIMEOUT',
      true
    )
  }

  /**
   * Create an authentication failed error (not retryable)
   *
   * @param reason - Optional detailed reason for the auth failure
   * @returns ConnectionError with code 'AUTH_FAILED'
   *
   * @example
   * ```typescript
   * const error = ConnectionError.authFailed('Invalid token')
   * // error.retryable: false (credentials need to be fixed)
   * ```
   */
  static authFailed(reason?: string): ConnectionError {
    return new ConnectionError(
      reason || 'Authentication failed',
      'AUTH_FAILED',
      false
    )
  }

  /**
   * Create a connection lost error (retryable)
   *
   * @param reason - Optional reason why the connection was lost
   * @returns ConnectionError with code 'CONNECTION_LOST'
   *
   * @example
   * ```typescript
   * const error = ConnectionError.connectionLost('WebSocket closed unexpectedly')
   * // error.retryable: true
   * ```
   */
  static connectionLost(reason?: string): ConnectionError {
    return new ConnectionError(
      reason || 'Connection lost',
      'CONNECTION_LOST',
      true
    )
  }

  /**
   * Create a reconnection failed error (not retryable)
   *
   * Thrown when the maximum number of reconnection attempts has been reached.
   *
   * @param attempts - Number of reconnection attempts made
   * @returns ConnectionError with code 'RECONNECT_FAILED'
   *
   * @example
   * ```typescript
   * const error = ConnectionError.reconnectFailed(5)
   * // error.message: "Failed to reconnect after 5 attempts"
   * // error.retryable: false (max attempts reached)
   * ```
   */
  static reconnectFailed(attempts: number): ConnectionError {
    return new ConnectionError(
      `Failed to reconnect after ${attempts} attempts`,
      'RECONNECT_FAILED',
      false
    )
  }

  /**
   * Create a heartbeat timeout error (retryable)
   *
   * Thrown when the server does not respond to ping messages within the timeout period.
   *
   * @returns ConnectionError with code 'HEARTBEAT_TIMEOUT'
   *
   * @example
   * ```typescript
   * const error = ConnectionError.heartbeatTimeout()
   * // error.retryable: true (reconnection can be attempted)
   * ```
   */
  static heartbeatTimeout(): ConnectionError {
    return new ConnectionError(
      'Connection heartbeat timeout - server not responding',
      'HEARTBEAT_TIMEOUT',
      true
    )
  }

  /**
   * Create an insecure connection error (not retryable)
   *
   * Thrown when attempting to send auth credentials over an insecure `ws://` connection.
   * This is a security protection to prevent credential leakage.
   *
   * @returns ConnectionError with code 'INSECURE_CONNECTION'
   *
   * @example
   * ```typescript
   * // This error is thrown automatically when:
   * const transport = capnweb('ws://api.example.com', {
   *   auth: 'my-token',  // Trying to send token over insecure connection
   *   // allowInsecureAuth: true  // Would bypass the check (local dev only!)
   * })
   * ```
   */
  static insecureConnection(): ConnectionError {
    return new ConnectionError(
      'SECURITY ERROR: Refusing to send authentication token over insecure ws:// connection. ' +
        'Use wss:// for secure connections, or set allowInsecureAuth: true for local development only.',
      'INSECURE_CONNECTION',
      false
    )
  }

  /**
   * Create a request timeout error (retryable)
   *
   * Thrown when an individual RPC request exceeds the configured timeout.
   * Different from connection timeout - this is for a specific call, not the connection itself.
   *
   * @param timeoutMs - The timeout duration that was exceeded
   * @returns ConnectionError with code 'REQUEST_TIMEOUT'
   *
   * @example
   * ```typescript
   * // Configure request timeout
   * const transport = http('https://api.example.com', { timeout: 5000 })
   *
   * try {
   *   await $.slowMethod()  // Takes longer than 5 seconds
   * } catch (error) {
   *   if (error instanceof ConnectionError && error.code === 'REQUEST_TIMEOUT') {
   *     console.log('Request took too long, consider increasing timeout')
   *   }
   * }
   * ```
   */
  static requestTimeout(timeoutMs: number): ConnectionError {
    return new ConnectionError(
      `Request timeout after ${timeoutMs}ms`,
      'REQUEST_TIMEOUT',
      true
    )
  }
}

/**
 * Protocol version mismatch error
 *
 * Thrown when the server's protocol version is incompatible with the client.
 * This typically indicates that the client SDK needs to be updated to match
 * the server version.
 *
 * @example
 * ```typescript
 * transport.on('error', (error) => {
 *   if (error instanceof ProtocolVersionError) {
 *     console.error(`Protocol mismatch: client ${error.clientVersion}, server ${error.serverVersion}`)
 *     console.log('Please update your rpc.do package to the latest version')
 *   }
 * })
 * ```
 */
export class ProtocolVersionError extends Error {
  /** The protocol version that the client supports */
  readonly clientVersion: string

  /** The protocol version that the server reported */
  readonly serverVersion: string

  /** Whether this is a major version mismatch (breaking change) */
  readonly isMajorMismatch: boolean

  constructor(clientVersion: string, serverVersion: string) {
    const clientMajor = ProtocolVersionError.getMajorVersion(clientVersion)
    const serverMajor = ProtocolVersionError.getMajorVersion(serverVersion)
    const isMajorMismatch = clientMajor !== serverMajor

    const message = isMajorMismatch
      ? `Protocol version mismatch: client v${clientVersion} is incompatible with server v${serverVersion}. Please update your rpc.do package.`
      : `Protocol version mismatch: client v${clientVersion}, server v${serverVersion}. Minor version differences may cause issues.`

    super(message)
    this.name = 'ProtocolVersionError'
    this.clientVersion = clientVersion
    this.serverVersion = serverVersion
    this.isMajorMismatch = isMajorMismatch

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProtocolVersionError)
    }
  }

  /**
   * Extract the major version number from a semver string
   */
  private static getMajorVersion(version: string): number {
    const match = version.match(/^(\d+)/)
    const majorStr = match?.[1]
    return majorStr ? parseInt(majorStr, 10) : 0
  }

  /**
   * Check if two versions are compatible (same major version)
   */
  static areCompatible(clientVersion: string, serverVersion: string): boolean {
    const clientMajor = ProtocolVersionError.getMajorVersion(clientVersion)
    const serverMajor = ProtocolVersionError.getMajorVersion(serverVersion)
    return clientMajor === serverMajor
  }
}

/**
 * Error thrown when authentication fails (HTTP 401)
 *
 * Represents an authentication failure, typically when credentials are
 * missing, invalid, or expired.
 *
 * @example
 * ```typescript
 * try {
 *   await rpc.protected.resource()
 * } catch (error) {
 *   if (error instanceof AuthenticationError) {
 *     console.error(`Auth failed: ${error.message}`)
 *     // Redirect to login or refresh token
 *   }
 * }
 * ```
 */
export class AuthenticationError extends Error {
  override readonly name = 'AuthenticationError'
  readonly status = 401

  constructor(message: string = 'Authentication failed') {
    super(message)

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthenticationError)
    }
  }
}

/**
 * Error thrown when rate limited (HTTP 429)
 *
 * Thrown when the server returns a 429 Too Many Requests response.
 * The retryAfter property indicates how many seconds to wait before retrying,
 * if the server provided a Retry-After header.
 *
 * @example
 * ```typescript
 * try {
 *   await client.someMethod()
 * } catch (error) {
 *   if (error instanceof RateLimitError) {
 *     if (error.retryAfter) {
 *       console.log(`Rate limited. Retry after ${error.retryAfter} seconds`)
 *       await delay(error.retryAfter * 1000)
 *     }
 *   }
 * }
 * ```
 */
export class RateLimitError extends Error {
  override readonly name = 'RateLimitError'
  readonly status = 429

  constructor(
    message: string = 'Rate limit exceeded',
    /** Seconds to wait before retrying (from Retry-After header) */
    public readonly retryAfter?: number
  ) {
    super(message)

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RateLimitError)
    }
  }
}

/**
 * RPC error returned by the server in response to an RPC call
 *
 * RPCError represents errors that occur during RPC method execution on the server.
 * The error includes a code for programmatic handling and optional additional data.
 *
 * Common error codes:
 * - `METHOD_NOT_FOUND` - The requested method does not exist
 * - `INVALID_PATH` - The method path is malformed
 * - `UNKNOWN_NAMESPACE` - A namespace in the path doesn't exist
 * - `UNKNOWN_METHOD` - Method exists but is not callable
 * - `MODULE_ERROR` - Required module (e.g., capnweb) is missing
 * - Custom codes - Your DO can return custom error codes
 *
 * @example Basic error handling
 * ```typescript
 * try {
 *   await $.users.get('invalid-id')
 * } catch (error) {
 *   if (error instanceof RPCError) {
 *     console.error(`RPC Error [${error.code}]: ${error.message}`)
 *     if (error.data) {
 *       console.error('Additional data:', error.data)
 *     }
 *   }
 * }
 * ```
 *
 * @example Handling specific error codes
 * ```typescript
 * try {
 *   await $.admin.deleteUser('user-123')
 * } catch (error) {
 *   if (error instanceof RPCError) {
 *     switch (error.code) {
 *       case 'UNAUTHORIZED':
 *         redirect('/login')
 *         break
 *       case 'NOT_FOUND':
 *         showError('User not found')
 *         break
 *       case 'VALIDATION_ERROR':
 *         showValidationErrors(error.data as ValidationErrors)
 *         break
 *       default:
 *         showError('An error occurred')
 *     }
 *   }
 * }
 * ```
 *
 * @example Throwing RPCError from your DO
 * ```typescript
 * // In your DurableRPC class
 * async deleteUser(id: string) {
 *   const user = this.users.get(id)
 *   if (!user) {
 *     throw new RPCError('User not found', 'NOT_FOUND', { id })
 *   }
 *   if (!this.$.auth?.isAdmin) {
 *     throw new RPCError('Admin access required', 'UNAUTHORIZED')
 *   }
 *   // ... delete user
 * }
 * ```
 */
export class RPCError extends Error {
  /** Error code from server for programmatic handling */
  readonly code: string

  /** Additional error data from server (validation errors, context, etc.) */
  readonly data?: unknown

  /**
   * Create an RPC error
   * @param message - Human-readable error message
   * @param code - Machine-readable error code
   * @param data - Optional additional error data
   */
  constructor(message: string, code: string, data?: unknown) {
    super(message)
    this.name = 'RPCError'
    this.code = code
    this.data = data

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RPCError)
    }
  }
}

/**
 * RPC error from server
 *
 * Preferred alias matching capnweb convention (lowercase 'pc').
 * This is an alias for RPCError - both names refer to the same class.
 */
export { RPCError as RpcError }
