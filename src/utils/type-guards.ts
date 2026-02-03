/**
 * Type Guards for rpc.do
 *
 * Runtime type guards for validating unknown values at type boundaries.
 * These enable replacing `any` with `unknown` + runtime validation.
 *
 * @packageDocumentation
 */

// ============================================================================
// Basic Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a non-null object.
 * Useful for narrowing `unknown` before checking properties with `in`.
 *
 * @param value - The value to check
 * @returns true if value is a non-null object
 *
 * @example
 * ```typescript
 * function processData(data: unknown) {
 *   if (isNonNullObject(data) && 'name' in data) {
 *     console.log(data.name) // TypeScript knows data is Record<string, unknown>
 *   }
 * }
 * ```
 */
export function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Type guard to check if a value is a callable function.
 *
 * @param value - The value to check
 * @returns true if value is a function
 *
 * @example
 * ```typescript
 * function maybeCall(fn: unknown) {
 *   if (isFunction(fn)) {
 *     fn() // TypeScript knows fn is callable
 *   }
 * }
 * ```
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

/**
 * Type guard to check if a value is a string.
 *
 * @param value - The value to check
 * @returns true if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Type guard to check if a value is a number.
 *
 * @param value - The value to check
 * @returns true if value is a number
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

/**
 * Type guard to check if a value is a boolean.
 *
 * @param value - The value to check
 * @returns true if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * Type guard to check if a value is an array.
 *
 * @param value - The value to check
 * @returns true if value is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * Type guard to check if a value is a string array.
 *
 * @param value - The value to check
 * @returns true if value is an array of strings
 */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// ============================================================================
// Object Property Guards
// ============================================================================

/**
 * Type guard to check if an object has a specific property.
 * Returns true only if the object is non-null and has the named property.
 *
 * @param obj - The object to check
 * @param prop - The property name to check for
 * @returns true if obj is a non-null object with the specified property
 *
 * @example
 * ```typescript
 * function processResponse(data: unknown) {
 *   if (hasProperty(data, 'result')) {
 *     console.log(data.result) // TypeScript knows data has 'result'
 *   }
 * }
 * ```
 */
export function hasProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, unknown> {
  return isNonNullObject(obj) && prop in obj
}

/**
 * Type guard to check if an object has a string property.
 *
 * @param obj - The object to check
 * @param prop - The property name to check for
 * @returns true if obj has the property and it's a string
 */
export function hasStringProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, string> {
  return hasProperty(obj, prop) && typeof obj[prop] === 'string'
}

/**
 * Type guard to check if an object has a number property.
 *
 * @param obj - The object to check
 * @param prop - The property name to check for
 * @returns true if obj has the property and it's a number
 */
export function hasNumberProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, number> {
  return hasProperty(obj, prop) && typeof obj[prop] === 'number'
}

/**
 * Type guard to check if an object has a boolean property.
 *
 * @param obj - The object to check
 * @param prop - The property name to check for
 * @returns true if obj has the property and it's a boolean
 */
export function hasBooleanProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, boolean> {
  return hasProperty(obj, prop) && typeof obj[prop] === 'boolean'
}

/**
 * Type guard to check if an object has a function property.
 *
 * @param obj - The object to check
 * @param prop - The property name to check for
 * @returns true if obj has the property and it's a function
 */
export function hasFunctionProperty<K extends string>(
  obj: unknown,
  prop: K
): obj is Record<K, (...args: unknown[]) => unknown> {
  return hasProperty(obj, prop) && typeof obj[prop] === 'function'
}

// ============================================================================
// Indexable Object Guards
// ============================================================================

/**
 * Type guard to check if an object is indexable with string keys.
 * This is useful when you need to access dynamic properties.
 *
 * @param value - The value to check
 * @returns true if value is a non-null object that can be indexed with strings
 *
 * @example
 * ```typescript
 * function getProperty(obj: unknown, key: string): unknown {
 *   if (isIndexable(obj)) {
 *     return obj[key] // Safe dynamic property access
 *   }
 *   return undefined
 * }
 * ```
 */
export function isIndexable(value: unknown): value is Record<string, unknown> {
  return isNonNullObject(value)
}

/**
 * Safely access a property on an unknown value.
 * Returns undefined if the value is not an object or doesn't have the property.
 *
 * @param value - The value to access
 * @param key - The property key to access
 * @returns The property value or undefined
 *
 * @example
 * ```typescript
 * const name = getPropertySafe(data, 'name')
 * if (typeof name === 'string') {
 *   console.log(name)
 * }
 * ```
 */
export function getPropertySafe(value: unknown, key: string): unknown {
  if (isNonNullObject(value)) {
    return value[key]
  }
  return undefined
}

// ============================================================================
// RPC-specific Type Guards
// ============================================================================

/**
 * Type guard for RPC error responses.
 * Checks if a value looks like an error response from the server.
 *
 * @param value - The value to check
 * @returns true if value has an 'error' property with message
 */
export function isRpcErrorResponse(value: unknown): value is { error: { message: string; code?: string; data?: unknown } } {
  if (!isNonNullObject(value) || !('error' in value)) {
    return false
  }
  const error = value['error']
  return isNonNullObject(error) && hasStringProperty(error, 'message')
}

/**
 * Type guard for RPC success responses.
 * Checks if a value looks like a successful response from the server.
 *
 * @param value - The value to check
 * @returns true if value has a 'result' property
 */
export function isRpcSuccessResponse(value: unknown): value is { result: unknown } {
  return isNonNullObject(value) && 'result' in value
}

/**
 * Type guard for JSON-RPC request objects.
 *
 * @param value - The value to check
 * @returns true if value is a valid JSON-RPC request
 */
export function isJsonRpcRequest(value: unknown): value is {
  jsonrpc: '2.0'
  method: string
  params?: unknown
  id?: string | number
} {
  return (
    isNonNullObject(value) &&
    value['jsonrpc'] === '2.0' &&
    hasStringProperty(value, 'method')
  )
}

/**
 * Type guard for JSON-RPC response objects.
 *
 * @param value - The value to check
 * @returns true if value is a valid JSON-RPC response
 */
export function isJsonRpcResponse(value: unknown): value is {
  jsonrpc: '2.0'
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  id: string | number | null
} {
  return (
    isNonNullObject(value) &&
    value['jsonrpc'] === '2.0' &&
    ('result' in value || 'error' in value)
  )
}

// ============================================================================
// Assertion Functions
// ============================================================================

/**
 * Assert that a value is a non-null object, throwing if not.
 *
 * @param value - The value to check
 * @param message - Optional error message
 * @throws TypeError if value is not a non-null object
 */
export function assertNonNullObject(value: unknown, message?: string): asserts value is Record<string, unknown> {
  if (!isNonNullObject(value)) {
    throw new TypeError(message ?? 'Expected a non-null object')
  }
}

/**
 * Assert that a value is a function, throwing if not.
 *
 * @param value - The value to check
 * @param message - Optional error message
 * @throws TypeError if value is not a function
 */
export function assertFunction(value: unknown, message?: string): asserts value is (...args: unknown[]) => unknown {
  if (!isFunction(value)) {
    throw new TypeError(message ?? 'Expected a function')
  }
}

/**
 * Assert that a value is a string, throwing if not.
 *
 * @param value - The value to check
 * @param message - Optional error message
 * @throws TypeError if value is not a string
 */
export function assertString(value: unknown, message?: string): asserts value is string {
  if (!isString(value)) {
    throw new TypeError(message ?? 'Expected a string')
  }
}

/**
 * Assert that a condition is true, throwing if not.
 * This is a general-purpose assertion for TypeScript narrowing.
 *
 * @param condition - The condition to check
 * @param message - Optional error message
 * @throws Error if condition is false
 */
export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}
