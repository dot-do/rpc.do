/**
 * Validation Middleware Tests
 *
 * Comprehensive tests for the RPC validation middleware.
 */

import { describe, it, expect, vi } from 'vitest'
import { RPC, type Transport } from '../index'
import {
  withValidation,
  ValidationError,
  prefixSchemas,
  mergeSchemas,
  type ValidationSchemas,
  type ZodLikeSchema,
  type ZodLikeError,
} from './validation'

// ============================================================================
// Mock Zod-like Schema Implementation
// ============================================================================

/**
 * Creates a mock schema that mimics Zod's safeParse interface.
 * This allows testing without requiring Zod as a dependency.
 */
function createMockSchema<T>(
  validator: (data: unknown) => { success: true; data: T } | { success: false; issues: ZodLikeError['issues'] }
): ZodLikeSchema<T> {
  return {
    safeParse(data: unknown) {
      const result = validator(data)
      if (result.success) {
        return { success: true, data: result.data }
      }
      return {
        success: false,
        error: { issues: result.issues },
      }
    },
  }
}

// Common mock schemas for testing
const mockSchemas = {
  string: () =>
    createMockSchema<string>((data) =>
      typeof data === 'string'
        ? { success: true, data }
        : { success: false, issues: [{ path: [], message: 'Expected string', code: 'invalid_type' }] }
    ),

  number: () =>
    createMockSchema<number>((data) =>
      typeof data === 'number'
        ? { success: true, data }
        : { success: false, issues: [{ path: [], message: 'Expected number', code: 'invalid_type' }] }
    ),

  object: <T extends Record<string, unknown>>(shape: { [K in keyof T]: ZodLikeSchema<T[K]> }) =>
    createMockSchema<T>((data) => {
      if (typeof data !== 'object' || data === null) {
        return { success: false, issues: [{ path: [], message: 'Expected object', code: 'invalid_type' }] }
      }

      const issues: ZodLikeError['issues'] = []
      const result = {} as T

      for (const [key, schema] of Object.entries(shape)) {
        const fieldResult = schema.safeParse((data as Record<string, unknown>)[key])
        if (!fieldResult.success) {
          for (const issue of fieldResult.error.issues) {
            issues.push({ ...issue, path: [key, ...issue.path] })
          }
        } else {
          ;(result as Record<string, unknown>)[key] = fieldResult.data
        }
      }

      if (issues.length > 0) {
        return { success: false, issues }
      }
      return { success: true, data: result }
    }),

  email: () =>
    createMockSchema<string>((data) => {
      if (typeof data !== 'string') {
        return { success: false, issues: [{ path: [], message: 'Expected string', code: 'invalid_type' }] }
      }
      if (!data.includes('@') || !data.includes('.')) {
        return { success: false, issues: [{ path: [], message: 'Invalid email format', code: 'invalid_string' }] }
      }
      return { success: true, data }
    }),

  nullable: <T>(schema: ZodLikeSchema<T>) =>
    createMockSchema<T | null>((data) => {
      if (data === null) {
        return { success: true, data: null }
      }
      const result = schema.safeParse(data)
      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, issues: result.error.issues }
    }),

  array: <T>(itemSchema: ZodLikeSchema<T>) =>
    createMockSchema<T[]>((data) => {
      if (!Array.isArray(data)) {
        return { success: false, issues: [{ path: [], message: 'Expected array', code: 'invalid_type' }] }
      }
      const issues: ZodLikeError['issues'] = []
      const result: T[] = []

      for (let i = 0; i < data.length; i++) {
        const itemResult = itemSchema.safeParse(data[i])
        if (!itemResult.success) {
          for (const issue of itemResult.error.issues) {
            issues.push({ ...issue, path: [i, ...issue.path] })
          }
        } else {
          result.push(itemResult.data)
        }
      }

      if (issues.length > 0) {
        return { success: false, issues }
      }
      return { success: true, data: result }
    }),
}

// ============================================================================
// Basic Functionality Tests
// ============================================================================

describe('withValidation', () => {
  describe('input validation', () => {
    it('should pass valid input', async () => {
      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.object({
            name: mockSchemas.string(),
            email: mockSchemas.email(),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ id: '123', name: 'John' }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      const result = await rpc.users.create({ name: 'John', email: 'john@example.com' })
      expect(result).toEqual({ id: '123', name: 'John' })
    })

    it('should throw ValidationError for invalid input', async () => {
      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.object({
            name: mockSchemas.string(),
            email: mockSchemas.email(),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ id: '123' }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      await expect(rpc.users.create({ name: 'John', email: 'invalid' })).rejects.toThrow(ValidationError)
    })

    it('should include method name in error', async () => {
      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.string(),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({}),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      try {
        await rpc.users.create(123)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).method).toBe('users.create')
        expect((error as ValidationError).type).toBe('input')
      }
    })

    it('should include path in error for nested objects', async () => {
      const schemas: ValidationSchemas = {
        'users.update': {
          input: mockSchemas.object({
            user: mockSchemas.object({
              name: mockSchemas.string(),
            }),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({}),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      try {
        await rpc.users.update({ user: { name: 123 } })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.issues[0].path).toEqual(['user', 'name'])
      }
    })

    it('should skip validation for methods without schemas', async () => {
      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.string(),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ ok: true }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      // users.list has no schema, should not throw
      const result = await rpc.users.list({ invalid: 'data' })
      expect(result).toEqual({ ok: true })
    })

    it('should validate only first argument', async () => {
      const schemas: ValidationSchemas = {
        test: {
          input: mockSchemas.string(),
        },
      }

      const calls: unknown[][] = []
      const mockTransport: Transport = {
        call: async (_, args) => {
          calls.push(args)
          return {}
        },
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      await rpc.test('valid', 'second-arg', 'third-arg')

      expect(calls[0]).toEqual(['valid', 'second-arg', 'third-arg'])
    })
  })

  describe('output validation', () => {
    it('should pass valid output', async () => {
      const schemas: ValidationSchemas = {
        'users.get': {
          output: mockSchemas.object({
            id: mockSchemas.string(),
            name: mockSchemas.string(),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ id: '123', name: 'John' }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      const result = await rpc.users.get('123')
      expect(result).toEqual({ id: '123', name: 'John' })
    })

    it('should throw ValidationError for invalid output', async () => {
      const schemas: ValidationSchemas = {
        'users.get': {
          output: mockSchemas.object({
            id: mockSchemas.string(),
            name: mockSchemas.string(),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ id: 123, name: 'John' }), // id should be string
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      try {
        await rpc.users.get('123')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).type).toBe('output')
      }
    })

    it('should validate nullable output', async () => {
      const schemas: ValidationSchemas = {
        'users.get': {
          output: mockSchemas.nullable(
            mockSchemas.object({
              id: mockSchemas.string(),
            })
          ),
        },
      }

      const mockTransport: Transport = {
        call: async () => null,
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      const result = await rpc.users.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should validate array output', async () => {
      const schemas: ValidationSchemas = {
        'users.list': {
          output: mockSchemas.array(
            mockSchemas.object({
              id: mockSchemas.string(),
            })
          ),
        },
      }

      const mockTransport: Transport = {
        call: async () => [{ id: '1' }, { id: '2' }],
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      const result = await rpc.users.list()
      expect(result).toEqual([{ id: '1' }, { id: '2' }])
    })

    it('should include index in error for array items', async () => {
      const schemas: ValidationSchemas = {
        'users.list': {
          output: mockSchemas.array(
            mockSchemas.object({
              id: mockSchemas.string(),
            })
          ),
        },
      }

      const mockTransport: Transport = {
        call: async () => [{ id: '1' }, { id: 123 }], // Second item has invalid id
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      try {
        await rpc.users.list()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        const ve = error as ValidationError
        expect(ve.issues[0].path).toEqual([1, 'id'])
      }
    })
  })

  describe('combined input and output validation', () => {
    it('should validate both input and output', async () => {
      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.object({
            name: mockSchemas.string(),
          }),
          output: mockSchemas.object({
            id: mockSchemas.string(),
            name: mockSchemas.string(),
          }),
        },
      }

      const mockTransport: Transport = {
        call: async () => ({ id: '123', name: 'John' }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      const result = await rpc.users.create({ name: 'John' })
      expect(result).toEqual({ id: '123', name: 'John' })
    })

    it('should fail on invalid input before making call', async () => {
      const callMock = vi.fn().mockResolvedValue({ id: '123' })

      const schemas: ValidationSchemas = {
        'users.create': {
          input: mockSchemas.object({ name: mockSchemas.string() }),
          output: mockSchemas.object({ id: mockSchemas.string() }),
        },
      }

      const mockTransport: Transport = { call: callMock }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas)],
      })

      await expect(rpc.users.create({ name: 123 })).rejects.toThrow(ValidationError)

      // Transport should not be called if input validation fails
      expect(callMock).not.toHaveBeenCalled()
    })
  })

  describe('options', () => {
    it('should disable input validation with validateInput: false', async () => {
      const schemas: ValidationSchemas = {
        test: { input: mockSchemas.string() },
      }

      const mockTransport: Transport = {
        call: async () => ({ ok: true }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas, { validateInput: false })],
      })

      // Should not throw even with invalid input
      const result = await rpc.test(123)
      expect(result).toEqual({ ok: true })
    })

    it('should disable output validation with validateOutput: false', async () => {
      const schemas: ValidationSchemas = {
        test: { output: mockSchemas.string() },
      }

      const mockTransport: Transport = {
        call: async () => 123, // Invalid output
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas, { validateOutput: false })],
      })

      // Should not throw even with invalid output
      const result = await rpc.test()
      expect(result).toBe(123)
    })

    it('should call onValidationError callback', async () => {
      const onValidationError = vi.fn()

      const schemas: ValidationSchemas = {
        test: { input: mockSchemas.string() },
      }

      const mockTransport: Transport = {
        call: async () => ({}),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas, { onValidationError })],
      })

      await expect(rpc.test(123)).rejects.toThrow(ValidationError)

      expect(onValidationError).toHaveBeenCalledTimes(1)
      expect(onValidationError).toHaveBeenCalledWith('test', 'input', expect.any(ValidationError))
    })

    it('should not throw with throwOnError: false', async () => {
      const onValidationError = vi.fn()

      const schemas: ValidationSchemas = {
        test: { input: mockSchemas.string() },
      }

      const mockTransport: Transport = {
        call: async () => ({ ok: true }),
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas, { throwOnError: false, onValidationError })],
      })

      // Should not throw
      const result = await rpc.test(123)
      expect(result).toEqual({ ok: true })

      // But callback should still be called
      expect(onValidationError).toHaveBeenCalledTimes(1)
    })

    it('should call onValidationError for output errors', async () => {
      const onValidationError = vi.fn()

      const schemas: ValidationSchemas = {
        test: { output: mockSchemas.string() },
      }

      const mockTransport: Transport = {
        call: async () => 123,
      }

      const rpc = RPC(mockTransport, {
        middleware: [withValidation(schemas, { onValidationError })],
      })

      await expect(rpc.test()).rejects.toThrow(ValidationError)

      expect(onValidationError).toHaveBeenCalledWith('test', 'output', expect.any(ValidationError))
    })
  })
})

// ============================================================================
// ValidationError Tests
// ============================================================================

describe('ValidationError', () => {
  it('should have correct name', () => {
    const error = new ValidationError('test', 'input', [], null)
    expect(error.name).toBe('ValidationError')
  })

  it('should include method in message', () => {
    const error = new ValidationError('users.create', 'input', [], null)
    expect(error.message).toContain('users.create')
  })

  it('should include type in message', () => {
    const error = new ValidationError('test', 'input', [], null)
    expect(error.message).toContain('input')

    const outputError = new ValidationError('test', 'output', [], null)
    expect(outputError.message).toContain('output')
  })

  it('should format issues in message', () => {
    const error = new ValidationError(
      'test',
      'input',
      [
        { path: ['name'], message: 'Required', code: 'invalid_type' },
        { path: ['email'], message: 'Invalid email', code: 'invalid_string' },
      ],
      null
    )

    expect(error.message).toContain('name: Required')
    expect(error.message).toContain('email: Invalid email')
  })

  it('should handle empty path', () => {
    const error = new ValidationError('test', 'input', [{ path: [], message: 'Expected string' }], 123)

    expect(error.message).toContain('Expected string')
  })

  it('should handle nested paths', () => {
    const error = new ValidationError(
      'test',
      'input',
      [{ path: ['user', 'address', 'city'], message: 'Required' }],
      null
    )

    expect(error.message).toContain('user.address.city: Required')
  })

  it('should have correct properties', () => {
    const data = { invalid: true }
    const issues = [{ path: ['test'], message: 'Error' }]
    const error = new ValidationError('users.create', 'input', issues, data)

    expect(error.method).toBe('users.create')
    expect(error.type).toBe('input')
    expect(error.issues).toEqual(issues)
    expect(error.data).toBe(data)
  })

  it('should serialize to JSON correctly', () => {
    const error = new ValidationError(
      'test',
      'input',
      [{ path: ['field'], message: 'Invalid' }],
      { field: 123 }
    )

    const json = error.toJSON()

    expect(json.name).toBe('ValidationError')
    expect(json.method).toBe('test')
    expect(json.type).toBe('input')
    expect(json.issues).toEqual([{ path: ['field'], message: 'Invalid' }])
    expect(json.message).toContain('field: Invalid')
  })

  it('should be instanceof Error', () => {
    const error = new ValidationError('test', 'input', [], null)
    expect(error).toBeInstanceOf(Error)
  })
})

// ============================================================================
// Helper Function Tests
// ============================================================================

describe('prefixSchemas', () => {
  it('should add prefix to all method names', () => {
    const schemas: ValidationSchemas = {
      create: { input: mockSchemas.string() },
      get: { output: mockSchemas.string() },
    }

    const prefixed = prefixSchemas('users', schemas)

    expect(Object.keys(prefixed)).toEqual(['users.create', 'users.get'])
    expect(prefixed['users.create']).toBe(schemas.create)
    expect(prefixed['users.get']).toBe(schemas.get)
  })

  it('should handle empty schemas', () => {
    const prefixed = prefixSchemas('test', {})
    expect(prefixed).toEqual({})
  })

  it('should not modify original schemas', () => {
    const original: ValidationSchemas = {
      test: { input: mockSchemas.string() },
    }

    prefixSchemas('prefix', original)

    expect(Object.keys(original)).toEqual(['test'])
  })
})

describe('mergeSchemas', () => {
  it('should merge multiple schema maps', () => {
    const users: ValidationSchemas = {
      'users.create': { input: mockSchemas.string() },
    }

    const config: ValidationSchemas = {
      'config.get': { output: mockSchemas.string() },
    }

    const merged = mergeSchemas(users, config)

    expect(Object.keys(merged).sort()).toEqual(['config.get', 'users.create'])
  })

  it('should override with later schemas', () => {
    const first: ValidationSchemas = {
      test: { input: mockSchemas.string() },
    }

    const second: ValidationSchemas = {
      test: { output: mockSchemas.number() },
    }

    const merged = mergeSchemas(first, second)

    expect(merged.test).toBe(second.test)
  })

  it('should handle empty arrays', () => {
    const merged = mergeSchemas()
    expect(merged).toEqual({})
  })

  it('should work with prefixSchemas', () => {
    const userSchemas: ValidationSchemas = {
      create: { input: mockSchemas.string() },
    }

    const configSchemas: ValidationSchemas = {
      get: { output: mockSchemas.string() },
    }

    const merged = mergeSchemas(
      prefixSchemas('users', userSchemas),
      prefixSchemas('config', configSchemas)
    )

    expect(Object.keys(merged).sort()).toEqual(['config.get', 'users.create'])
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('withValidation integration', () => {
  it('should work with other middleware', async () => {
    const logs: string[] = []

    const loggingMiddleware = {
      onRequest: () => logs.push('logging:request'),
      onResponse: () => logs.push('logging:response'),
    }

    const schemas: ValidationSchemas = {
      test: {
        input: mockSchemas.string(),
        output: mockSchemas.object({ ok: mockSchemas.string() }),
      },
    }

    const mockTransport: Transport = {
      call: async () => {
        logs.push('transport:call')
        return { ok: 'true' }
      },
    }

    const rpc = RPC(mockTransport, {
      middleware: [loggingMiddleware, withValidation(schemas)],
    })

    await rpc.test('valid')

    // Logging middleware runs first, then validation (which doesn't log),
    // then transport call, then response hooks in same order
    expect(logs).toEqual(['logging:request', 'transport:call', 'logging:response'])
  })

  it('should prevent call when input validation fails', async () => {
    const callMock = vi.fn()

    const schemas: ValidationSchemas = {
      test: { input: mockSchemas.string() },
    }

    const mockTransport: Transport = { call: callMock }

    const rpc = RPC(mockTransport, {
      middleware: [withValidation(schemas)],
    })

    await expect(rpc.test(123)).rejects.toThrow(ValidationError)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('should work with deeply nested method names', async () => {
    const schemas: ValidationSchemas = {
      'api.v1.users.create': {
        input: mockSchemas.object({ name: mockSchemas.string() }),
      },
    }

    const mockTransport: Transport = {
      call: async () => ({ id: '123' }),
    }

    const rpc = RPC(mockTransport, {
      middleware: [withValidation(schemas)],
    })

    const result = await rpc.api.v1.users.create({ name: 'John' })
    expect(result).toEqual({ id: '123' })

    await expect(rpc.api.v1.users.create({ name: 123 })).rejects.toThrow(ValidationError)
  })
})
