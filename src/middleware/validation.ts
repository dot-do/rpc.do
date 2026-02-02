/**
 * Validation middleware for RPC client
 *
 * Provides optional runtime validation of RPC requests and responses using Zod schemas.
 * Zod is a peer dependency and the middleware works without it if not used.
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { RPC } from 'rpc.do'
 * import { withValidation } from 'rpc.do/middleware'
 *
 * const schemas = {
 *   'users.create': {
 *     input: z.object({ name: z.string(), email: z.string().email() }),
 *     output: z.object({ id: z.string(), name: z.string() }),
 *   },
 *   'users.get': {
 *     input: z.string().uuid(),
 *     output: z.object({ id: z.string(), name: z.string() }).nullable(),
 *   },
 * }
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [withValidation(schemas)]
 * })
 *
 * // Will throw ValidationError if input doesn't match schema
 * await $.users.create({ name: 'John', email: 'invalid' }) // throws!
 * ```
 */

import type { RpcClientMiddleware } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Zod-like schema interface for type compatibility.
 *
 * This interface matches the minimal subset of Zod's `ZodType` that we need,
 * allowing the middleware to work with Zod without a direct dependency.
 * Any schema that implements `safeParse` with this signature will work.
 */
export interface ZodLikeSchema<T = unknown> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: ZodLikeError }
}

/**
 * Zod-like error interface for type compatibility.
 */
export interface ZodLikeError {
  issues: Array<{
    path: Array<string | number>
    message: string
    code?: string
  }>
  format?: () => unknown
}

/**
 * Schema definition for a single RPC method.
 *
 * You can define input validation, output validation, or both.
 * Validation only runs for schemas that are defined.
 */
export interface MethodSchema {
  /** Schema to validate input arguments (first argument to RPC method) */
  input?: ZodLikeSchema
  /** Schema to validate the response */
  output?: ZodLikeSchema
}

/**
 * Map of method names to their schemas.
 *
 * Method names use dot notation matching the RPC call path.
 *
 * @example
 * ```typescript
 * const schemas: ValidationSchemas = {
 *   'users.create': { input: z.object({ name: z.string() }) },
 *   'users.get': { input: z.string(), output: z.object({ id: z.string() }).nullable() },
 *   'config.update': { input: z.object({ key: z.string(), value: z.unknown() }) },
 * }
 * ```
 */
export type ValidationSchemas = Record<string, MethodSchema>

/**
 * Options for the validation middleware.
 */
export interface ValidationOptions {
  /**
   * Whether to validate input arguments (default: true)
   */
  validateInput?: boolean

  /**
   * Whether to validate response data (default: true)
   */
  validateOutput?: boolean

  /**
   * Callback when validation fails (before throwing).
   * Useful for logging or metrics.
   */
  onValidationError?: (
    method: string,
    type: 'input' | 'output',
    error: ValidationError
  ) => void

  /**
   * Whether to throw on validation errors (default: true).
   * If false, validation errors are only reported via onValidationError.
   */
  throwOnError?: boolean
}

// ============================================================================
// Error Class
// ============================================================================

/**
 * Error thrown when RPC validation fails.
 *
 * Contains detailed information about which fields failed validation
 * and why, formatted for easy debugging.
 */
export class ValidationError extends Error {
  /** The RPC method that was called */
  readonly method: string
  /** Whether this was input or output validation */
  readonly type: 'input' | 'output'
  /** Detailed validation issues */
  readonly issues: Array<{
    path: Array<string | number>
    message: string
    code?: string
  }>
  /** The data that failed validation */
  readonly data: unknown

  constructor(
    method: string,
    type: 'input' | 'output',
    issues: Array<{ path: Array<string | number>; message: string; code?: string }>,
    data: unknown
  ) {
    const issueMessages = issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `  - ${path}${issue.message}`
      })
      .join('\n')

    const message = `RPC ${type} validation failed for "${method}":\n${issueMessages}`

    super(message)
    this.name = 'ValidationError'
    this.method = method
    this.type = type
    this.issues = issues
    this.data = data

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError)
    }
  }

  /**
   * Get a formatted summary of validation issues.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      method: this.method,
      type: this.type,
      issues: this.issues,
      message: this.message,
    }
  }
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * Create a validation middleware for RPC calls.
 *
 * This middleware validates request arguments and/or response data against
 * Zod schemas (or any schema with a compatible `safeParse` interface).
 *
 * @param schemas - Map of method names to their input/output schemas
 * @param options - Validation options
 * @returns RpcClientMiddleware that validates requests and responses
 *
 * @example Basic usage
 * ```typescript
 * import { z } from 'zod'
 * import { RPC } from 'rpc.do'
 * import { withValidation } from 'rpc.do/middleware'
 *
 * const schemas = {
 *   'users.create': {
 *     input: z.object({
 *       name: z.string().min(1),
 *       email: z.string().email(),
 *     }),
 *     output: z.object({
 *       id: z.string(),
 *       name: z.string(),
 *     }),
 *   },
 * }
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [withValidation(schemas)]
 * })
 * ```
 *
 * @example Input-only validation
 * ```typescript
 * const schemas = {
 *   'users.create': {
 *     input: z.object({ name: z.string(), email: z.string().email() }),
 *     // No output schema - response won't be validated
 *   },
 * }
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [withValidation(schemas, { validateOutput: false })]
 * })
 * ```
 *
 * @example With error callback (for logging/metrics)
 * ```typescript
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [withValidation(schemas, {
 *     onValidationError: (method, type, error) => {
 *       console.error(`Validation failed for ${method} (${type}):`, error.issues)
 *       metrics.increment('rpc.validation_error', { method, type })
 *     }
 *   })]
 * })
 * ```
 *
 * @example Soft validation (log but don't throw)
 * ```typescript
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [withValidation(schemas, {
 *     throwOnError: false,
 *     onValidationError: (method, type, error) => {
 *       logger.warn('Validation issue', { method, type, issues: error.issues })
 *     }
 *   })]
 * })
 * ```
 */
export function withValidation(
  schemas: ValidationSchemas,
  options: ValidationOptions = {}
): RpcClientMiddleware {
  const {
    validateInput = true,
    validateOutput = true,
    onValidationError,
    throwOnError = true,
  } = options

  return {
    onRequest(method: string, args: unknown[]): void {
      if (!validateInput) return

      const schema = schemas[method]
      if (!schema?.input) return

      // Validate the first argument (RPC convention)
      const input = args[0]
      const result = schema.input.safeParse(input)

      if (!result.success) {
        const failedResult = result as { success: false; error: ZodLikeError }
        const error = new ValidationError(method, 'input', failedResult.error.issues, input)

        if (onValidationError) {
          onValidationError(method, 'input', error)
        }

        if (throwOnError) {
          throw error
        }
      }
    },

    onResponse(method: string, result: unknown): void {
      if (!validateOutput) return

      const schema = schemas[method]
      if (!schema?.output) return

      const parseResult = schema.output.safeParse(result)

      if (!parseResult.success) {
        const failedResult = parseResult as { success: false; error: ZodLikeError }
        const error = new ValidationError(method, 'output', failedResult.error.issues, result)

        if (onValidationError) {
          onValidationError(method, 'output', error)
        }

        if (throwOnError) {
          throw error
        }
      }
    },
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a partial schema map by prefixing all method names.
 *
 * Useful for organizing schemas by namespace.
 *
 * @example
 * ```typescript
 * const userSchemas = prefixSchemas('users', {
 *   'create': { input: z.object({ name: z.string() }) },
 *   'get': { input: z.string() },
 * })
 * // Result: { 'users.create': ..., 'users.get': ... }
 * ```
 */
export function prefixSchemas(
  prefix: string,
  schemas: ValidationSchemas
): ValidationSchemas {
  const result: ValidationSchemas = {}
  for (const [method, schema] of Object.entries(schemas)) {
    result[`${prefix}.${method}`] = schema
  }
  return result
}

/**
 * Merge multiple schema maps into one.
 *
 * Later schemas override earlier ones for the same method.
 *
 * @example
 * ```typescript
 * const allSchemas = mergeSchemas(
 *   prefixSchemas('users', userSchemas),
 *   prefixSchemas('config', configSchemas),
 *   { 'health': { output: z.object({ ok: z.boolean() }) } }
 * )
 * ```
 */
export function mergeSchemas(...schemaMaps: ValidationSchemas[]): ValidationSchemas {
  return Object.assign({}, ...schemaMaps)
}

export default withValidation
