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
   * Create a connection timeout error
   */
  static timeout(timeoutMs: number): ConnectionError {
    return new ConnectionError(
      `Connection timeout after ${timeoutMs}ms`,
      'CONNECTION_TIMEOUT',
      true
    )
  }

  /**
   * Create an authentication failed error
   */
  static authFailed(reason?: string): ConnectionError {
    return new ConnectionError(
      reason || 'Authentication failed',
      'AUTH_FAILED',
      false
    )
  }

  /**
   * Create a connection lost error
   */
  static connectionLost(reason?: string): ConnectionError {
    return new ConnectionError(
      reason || 'Connection lost',
      'CONNECTION_LOST',
      true
    )
  }

  /**
   * Create a reconnection failed error
   */
  static reconnectFailed(attempts: number): ConnectionError {
    return new ConnectionError(
      `Failed to reconnect after ${attempts} attempts`,
      'RECONNECT_FAILED',
      false
    )
  }

  /**
   * Create a heartbeat timeout error
   */
  static heartbeatTimeout(): ConnectionError {
    return new ConnectionError(
      'Connection heartbeat timeout - server not responding',
      'HEARTBEAT_TIMEOUT',
      true
    )
  }

  /**
   * Create an insecure connection error
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
   * Create a request timeout error
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
 * RPC error from server
 *
 * Represents an error returned by the server in response to an RPC call.
 */
export class RPCError extends Error {
  /** Error code from server */
  readonly code: string

  /** Additional error data from server */
  readonly data?: unknown

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
