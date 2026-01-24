/**
 * Error Classes Tests
 *
 * Tests for RPCError, ConnectionError, and ProtocolVersionError
 * from src/errors.ts
 */

import { describe, it, expect } from 'vitest'
import { RPCError, ConnectionError, ProtocolVersionError } from '../src/errors'

// ============================================================================
// RPCError Tests
// ============================================================================

describe('RPCError', () => {
  describe('constructor', () => {
    it('should create error with message, code, and data', () => {
      const error = new RPCError('Something went wrong', 'INTERNAL_ERROR', { detail: 'extra info' })

      expect(error.message).toBe('Something went wrong')
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.data).toEqual({ detail: 'extra info' })
    })

    it('should set name property to "RPCError"', () => {
      const error = new RPCError('Test error', 'TEST_CODE')

      expect(error.name).toBe('RPCError')
    })

    it('should make data property optional', () => {
      const error = new RPCError('No data error', 'NO_DATA')

      expect(error.message).toBe('No data error')
      expect(error.code).toBe('NO_DATA')
      expect(error.data).toBeUndefined()
    })

    it('should accept various data types', () => {
      const stringData = new RPCError('Error', 'CODE', 'string data')
      expect(stringData.data).toBe('string data')

      const numberData = new RPCError('Error', 'CODE', 42)
      expect(numberData.data).toBe(42)

      const arrayData = new RPCError('Error', 'CODE', [1, 2, 3])
      expect(arrayData.data).toEqual([1, 2, 3])

      const nullData = new RPCError('Error', 'CODE', null)
      expect(nullData.data).toBeNull()
    })
  })

  describe('inheritance', () => {
    it('should be instanceof Error', () => {
      const error = new RPCError('Test', 'CODE')

      expect(error).toBeInstanceOf(Error)
    })

    it('should be instanceof RPCError', () => {
      const error = new RPCError('Test', 'CODE')

      expect(error).toBeInstanceOf(RPCError)
    })

    it('should NOT be instanceof ConnectionError', () => {
      const error = new RPCError('Test', 'CODE')

      expect(error).not.toBeInstanceOf(ConnectionError)
    })

    it('should NOT be instanceof ProtocolVersionError', () => {
      const error = new RPCError('Test', 'CODE')

      expect(error).not.toBeInstanceOf(ProtocolVersionError)
    })
  })

  describe('stack trace', () => {
    it('should capture stack trace', () => {
      const error = new RPCError('Test error', 'TEST_CODE')

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('RPCError')
    })
  })

  describe('serialization', () => {
    it('should serialize relevant properties with JSON.stringify', () => {
      const error = new RPCError('Test error', 'TEST_CODE', { foo: 'bar' })
      const serialized = JSON.stringify(error)
      const parsed = JSON.parse(serialized)

      expect(parsed.code).toBe('TEST_CODE')
      expect(parsed.data).toEqual({ foo: 'bar' })
    })

    it('should include message when using object spread', () => {
      const error = new RPCError('Test error', 'TEST_CODE', { foo: 'bar' })
      const serializable = {
        message: error.message,
        code: error.code,
        data: error.data,
        name: error.name,
      }

      expect(serializable.message).toBe('Test error')
      expect(serializable.code).toBe('TEST_CODE')
      expect(serializable.data).toEqual({ foo: 'bar' })
      expect(serializable.name).toBe('RPCError')
    })
  })
})

// ============================================================================
// ConnectionError Tests
// ============================================================================

describe('ConnectionError', () => {
  describe('constructor', () => {
    it('should create error with message, code, and retryable flag', () => {
      const error = new ConnectionError('Connection failed', 'CONNECTION_FAILED', true)

      expect(error.message).toBe('Connection failed')
      expect(error.code).toBe('CONNECTION_FAILED')
      expect(error.retryable).toBe(true)
    })

    it('should set name property to "ConnectionError"', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT', true)

      expect(error.name).toBe('ConnectionError')
    })

    it('should default retryable to true', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error.retryable).toBe(true)
    })

    it('should allow retryable to be false', () => {
      const error = new ConnectionError('Auth failed', 'AUTH_FAILED', false)

      expect(error.retryable).toBe(false)
    })
  })

  describe('inheritance', () => {
    it('should be instanceof Error', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error).toBeInstanceOf(Error)
    })

    it('should be instanceof ConnectionError', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error).toBeInstanceOf(ConnectionError)
    })

    it('should NOT be instanceof RPCError', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error).not.toBeInstanceOf(RPCError)
    })

    it('should NOT be instanceof ProtocolVersionError', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error).not.toBeInstanceOf(ProtocolVersionError)
    })
  })

  describe('stack trace', () => {
    it('should capture stack trace', () => {
      const error = new ConnectionError('Test', 'CONNECTION_TIMEOUT')

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ConnectionError')
    })
  })

  describe('static factory methods', () => {
    describe('timeout()', () => {
      it('should create CONNECTION_TIMEOUT error', () => {
        const error = ConnectionError.timeout(5000)

        expect(error.message).toBe('Connection timeout after 5000ms')
        expect(error.code).toBe('CONNECTION_TIMEOUT')
        expect(error.retryable).toBe(true)
      })

      it('should include timeout duration in message', () => {
        const error = ConnectionError.timeout(30000)

        expect(error.message).toContain('30000ms')
      })
    })

    describe('authFailed()', () => {
      it('should create AUTH_FAILED error with default message', () => {
        const error = ConnectionError.authFailed()

        expect(error.message).toBe('Authentication failed')
        expect(error.code).toBe('AUTH_FAILED')
        expect(error.retryable).toBe(false)
      })

      it('should create AUTH_FAILED error with custom reason', () => {
        const error = ConnectionError.authFailed('Invalid token')

        expect(error.message).toBe('Invalid token')
        expect(error.code).toBe('AUTH_FAILED')
        expect(error.retryable).toBe(false)
      })
    })

    describe('connectionLost()', () => {
      it('should create CONNECTION_LOST error with default message', () => {
        const error = ConnectionError.connectionLost()

        expect(error.message).toBe('Connection lost')
        expect(error.code).toBe('CONNECTION_LOST')
        expect(error.retryable).toBe(true)
      })

      it('should create CONNECTION_LOST error with custom reason', () => {
        const error = ConnectionError.connectionLost('Server closed connection')

        expect(error.message).toBe('Server closed connection')
        expect(error.code).toBe('CONNECTION_LOST')
        expect(error.retryable).toBe(true)
      })
    })

    describe('reconnectFailed()', () => {
      it('should create RECONNECT_FAILED error', () => {
        const error = ConnectionError.reconnectFailed(3)

        expect(error.message).toBe('Failed to reconnect after 3 attempts')
        expect(error.code).toBe('RECONNECT_FAILED')
        expect(error.retryable).toBe(false)
      })

      it('should include attempt count in message', () => {
        const error = ConnectionError.reconnectFailed(10)

        expect(error.message).toContain('10 attempts')
      })
    })

    describe('heartbeatTimeout()', () => {
      it('should create HEARTBEAT_TIMEOUT error', () => {
        const error = ConnectionError.heartbeatTimeout()

        expect(error.message).toBe('Connection heartbeat timeout - server not responding')
        expect(error.code).toBe('HEARTBEAT_TIMEOUT')
        expect(error.retryable).toBe(true)
      })
    })

    describe('insecureConnection()', () => {
      it('should create INSECURE_CONNECTION error', () => {
        const error = ConnectionError.insecureConnection()

        expect(error.message).toContain('SECURITY ERROR')
        expect(error.message).toContain('wss://')
        expect(error.code).toBe('INSECURE_CONNECTION')
        expect(error.retryable).toBe(false)
      })
    })

    describe('requestTimeout()', () => {
      it('should create REQUEST_TIMEOUT error', () => {
        const error = ConnectionError.requestTimeout(10000)

        expect(error.message).toBe('Request timeout after 10000ms')
        expect(error.code).toBe('REQUEST_TIMEOUT')
        expect(error.retryable).toBe(true)
      })

      it('should include timeout duration in message', () => {
        const error = ConnectionError.requestTimeout(60000)

        expect(error.message).toContain('60000ms')
      })
    })
  })

  describe('retryable property correctness', () => {
    it('should have correct retryable values for each error type', () => {
      // Retryable errors
      expect(ConnectionError.timeout(5000).retryable).toBe(true)
      expect(ConnectionError.connectionLost().retryable).toBe(true)
      expect(ConnectionError.heartbeatTimeout().retryable).toBe(true)
      expect(ConnectionError.requestTimeout(5000).retryable).toBe(true)

      // Non-retryable errors
      expect(ConnectionError.authFailed().retryable).toBe(false)
      expect(ConnectionError.reconnectFailed(5).retryable).toBe(false)
      expect(ConnectionError.insecureConnection().retryable).toBe(false)
    })
  })

  describe('serialization', () => {
    it('should serialize relevant properties with JSON.stringify', () => {
      const error = ConnectionError.timeout(5000)
      const serialized = JSON.stringify(error)
      const parsed = JSON.parse(serialized)

      expect(parsed.code).toBe('CONNECTION_TIMEOUT')
      expect(parsed.retryable).toBe(true)
    })
  })
})

// ============================================================================
// ProtocolVersionError Tests
// ============================================================================

describe('ProtocolVersionError', () => {
  describe('constructor', () => {
    it('should create error with client and server versions', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error.clientVersion).toBe('1.0.0')
      expect(error.serverVersion).toBe('2.0.0')
    })

    it('should set name property to "ProtocolVersionError"', () => {
      const error = new ProtocolVersionError('1.0.0', '1.1.0')

      expect(error.name).toBe('ProtocolVersionError')
    })

    it('should generate appropriate message for major mismatch', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error.message).toContain('incompatible')
      expect(error.message).toContain('1.0.0')
      expect(error.message).toContain('2.0.0')
    })

    it('should generate appropriate message for minor mismatch', () => {
      const error = new ProtocolVersionError('1.0.0', '1.1.0')

      expect(error.message).toContain('Minor version differences')
      expect(error.message).toContain('1.0.0')
      expect(error.message).toContain('1.1.0')
    })
  })

  describe('isMajorMismatch property', () => {
    it('should detect major version mismatch', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error.isMajorMismatch).toBe(true)
    })

    it('should NOT flag minor version difference as major mismatch', () => {
      const error = new ProtocolVersionError('1.0.0', '1.1.0')

      expect(error.isMajorMismatch).toBe(false)
    })

    it('should NOT flag patch version difference as major mismatch', () => {
      const error = new ProtocolVersionError('1.0.0', '1.0.1')

      expect(error.isMajorMismatch).toBe(false)
    })

    it('should detect major mismatch for larger versions', () => {
      const error = new ProtocolVersionError('5.2.3', '10.0.0')

      expect(error.isMajorMismatch).toBe(true)
    })

    it('should NOT flag same major version even with different minor/patch', () => {
      const error = new ProtocolVersionError('2.1.5', '2.9.0')

      expect(error.isMajorMismatch).toBe(false)
    })
  })

  describe('static areCompatible()', () => {
    it('should return true for same major version', () => {
      expect(ProtocolVersionError.areCompatible('1.0.0', '1.1.0')).toBe(true)
      expect(ProtocolVersionError.areCompatible('2.5.3', '2.0.0')).toBe(true)
    })

    it('should return false for different major versions', () => {
      expect(ProtocolVersionError.areCompatible('1.0.0', '2.0.0')).toBe(false)
      expect(ProtocolVersionError.areCompatible('3.0.0', '5.0.0')).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(ProtocolVersionError.areCompatible('0.1.0', '0.2.0')).toBe(true)
      expect(ProtocolVersionError.areCompatible('10.0.0', '10.5.2')).toBe(true)
    })
  })

  describe('getMajorVersion helper (tested indirectly)', () => {
    it('should extract major version correctly via isMajorMismatch', () => {
      // Testing getMajorVersion through isMajorMismatch behavior
      const error1 = new ProtocolVersionError('1.2.3', '1.5.0')
      expect(error1.isMajorMismatch).toBe(false) // Both major = 1

      const error2 = new ProtocolVersionError('2.0.0', '3.0.0')
      expect(error2.isMajorMismatch).toBe(true) // 2 != 3
    })

    it('should handle versions without minor/patch', () => {
      // Testing edge case handling via areCompatible
      const error = new ProtocolVersionError('1', '1.0.0')
      expect(error.isMajorMismatch).toBe(false)
    })

    it('should handle invalid version strings gracefully', () => {
      // Invalid versions should parse to 0
      const error = new ProtocolVersionError('invalid', 'also-invalid')
      expect(error.isMajorMismatch).toBe(false) // Both parse to 0
    })
  })

  describe('inheritance', () => {
    it('should be instanceof Error', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error).toBeInstanceOf(Error)
    })

    it('should be instanceof ProtocolVersionError', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error).toBeInstanceOf(ProtocolVersionError)
    })

    it('should NOT be instanceof RPCError', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error).not.toBeInstanceOf(RPCError)
    })

    it('should NOT be instanceof ConnectionError', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error).not.toBeInstanceOf(ConnectionError)
    })
  })

  describe('stack trace', () => {
    it('should capture stack trace', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('ProtocolVersionError')
    })
  })

  describe('serialization', () => {
    it('should serialize relevant properties with JSON.stringify', () => {
      const error = new ProtocolVersionError('1.0.0', '2.0.0')
      const serialized = JSON.stringify(error)
      const parsed = JSON.parse(serialized)

      expect(parsed.clientVersion).toBe('1.0.0')
      expect(parsed.serverVersion).toBe('2.0.0')
      expect(parsed.isMajorMismatch).toBe(true)
    })
  })
})

// ============================================================================
// Cross-Error Type Tests
// ============================================================================

describe('Error type discrimination', () => {
  it('should correctly discriminate between error types', () => {
    const rpcError = new RPCError('RPC error', 'CODE')
    const connectionError = new ConnectionError('Connection error', 'CONNECTION_TIMEOUT')
    const protocolError = new ProtocolVersionError('1.0.0', '2.0.0')

    // Each error is only instanceof its own type
    expect(rpcError).toBeInstanceOf(RPCError)
    expect(rpcError).not.toBeInstanceOf(ConnectionError)
    expect(rpcError).not.toBeInstanceOf(ProtocolVersionError)

    expect(connectionError).toBeInstanceOf(ConnectionError)
    expect(connectionError).not.toBeInstanceOf(RPCError)
    expect(connectionError).not.toBeInstanceOf(ProtocolVersionError)

    expect(protocolError).toBeInstanceOf(ProtocolVersionError)
    expect(protocolError).not.toBeInstanceOf(RPCError)
    expect(protocolError).not.toBeInstanceOf(ConnectionError)

    // All are instanceof Error
    expect(rpcError).toBeInstanceOf(Error)
    expect(connectionError).toBeInstanceOf(Error)
    expect(protocolError).toBeInstanceOf(Error)
  })

  it('should have distinct name properties', () => {
    const rpcError = new RPCError('RPC error', 'CODE')
    const connectionError = new ConnectionError('Connection error', 'CONNECTION_TIMEOUT')
    const protocolError = new ProtocolVersionError('1.0.0', '2.0.0')

    expect(rpcError.name).toBe('RPCError')
    expect(connectionError.name).toBe('ConnectionError')
    expect(protocolError.name).toBe('ProtocolVersionError')
  })
})

// ============================================================================
// Error serialization for RPC responses
// ============================================================================

describe('Error serialization for RPC responses', () => {
  it('should serialize RPCError for RPC response', () => {
    const error = new RPCError('Method not found', 'METHOD_NOT_FOUND', { method: 'unknownMethod' })

    const response = {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: error.code,
        message: error.message,
        data: error.data,
      },
    }

    expect(response.error.code).toBe('METHOD_NOT_FOUND')
    expect(response.error.message).toBe('Method not found')
    expect(response.error.data).toEqual({ method: 'unknownMethod' })
  })

  it('should serialize ConnectionError for error reporting', () => {
    const error = ConnectionError.timeout(5000)

    const report = {
      type: 'connection_error',
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }

    expect(report.code).toBe('CONNECTION_TIMEOUT')
    expect(report.retryable).toBe(true)
  })

  it('should serialize ProtocolVersionError for version mismatch reporting', () => {
    const error = new ProtocolVersionError('1.0.0', '2.0.0')

    const report = {
      type: 'protocol_version_error',
      clientVersion: error.clientVersion,
      serverVersion: error.serverVersion,
      isMajorMismatch: error.isMajorMismatch,
      message: error.message,
    }

    expect(report.clientVersion).toBe('1.0.0')
    expect(report.serverVersion).toBe('2.0.0')
    expect(report.isMajorMismatch).toBe(true)
  })
})
