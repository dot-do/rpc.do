/**
 * Tests for type guards
 */

import { describe, it, expect } from 'vitest'
import {
  isNonNullObject,
  isFunction,
  isString,
  isNumber,
  isBoolean,
  isArray,
  isStringArray,
  hasProperty,
  hasStringProperty,
  hasNumberProperty,
  hasBooleanProperty,
  hasFunctionProperty,
  isIndexable,
  getPropertySafe,
  isRpcErrorResponse,
  isRpcSuccessResponse,
  isJsonRpcRequest,
  isJsonRpcResponse,
  assertNonNullObject,
  assertFunction,
  assertString,
  assert,
} from './type-guards'

describe('Basic Type Guards', () => {
  describe('isNonNullObject', () => {
    it('should return true for plain objects', () => {
      expect(isNonNullObject({})).toBe(true)
      expect(isNonNullObject({ key: 'value' })).toBe(true)
    })

    it('should return true for arrays (which are objects)', () => {
      expect(isNonNullObject([])).toBe(true)
    })

    it('should return false for null', () => {
      expect(isNonNullObject(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isNonNullObject(undefined)).toBe(false)
    })

    it('should return false for primitives', () => {
      expect(isNonNullObject('string')).toBe(false)
      expect(isNonNullObject(123)).toBe(false)
      expect(isNonNullObject(true)).toBe(false)
    })
  })

  describe('isFunction', () => {
    it('should return true for functions', () => {
      expect(isFunction(() => {})).toBe(true)
      expect(isFunction(function() {})).toBe(true)
      expect(isFunction(async () => {})).toBe(true)
    })

    it('should return false for non-functions', () => {
      expect(isFunction({})).toBe(false)
      expect(isFunction(null)).toBe(false)
      expect(isFunction('function')).toBe(false)
    })
  })

  describe('isString', () => {
    it('should return true for strings', () => {
      expect(isString('')).toBe(true)
      expect(isString('hello')).toBe(true)
    })

    it('should return false for non-strings', () => {
      expect(isString(123)).toBe(false)
      expect(isString(null)).toBe(false)
    })
  })

  describe('isNumber', () => {
    it('should return true for numbers', () => {
      expect(isNumber(0)).toBe(true)
      expect(isNumber(123)).toBe(true)
      expect(isNumber(-456.78)).toBe(true)
    })

    it('should return false for NaN', () => {
      expect(isNumber(NaN)).toBe(false)
    })

    it('should return false for non-numbers', () => {
      expect(isNumber('123')).toBe(false)
      expect(isNumber(null)).toBe(false)
    })
  })

  describe('isBoolean', () => {
    it('should return true for booleans', () => {
      expect(isBoolean(true)).toBe(true)
      expect(isBoolean(false)).toBe(true)
    })

    it('should return false for truthy/falsy non-booleans', () => {
      expect(isBoolean(1)).toBe(false)
      expect(isBoolean(0)).toBe(false)
      expect(isBoolean('')).toBe(false)
    })
  })

  describe('isArray', () => {
    it('should return true for arrays', () => {
      expect(isArray([])).toBe(true)
      expect(isArray([1, 2, 3])).toBe(true)
    })

    it('should return false for non-arrays', () => {
      expect(isArray({})).toBe(false)
      expect(isArray('array')).toBe(false)
    })
  })

  describe('isStringArray', () => {
    it('should return true for string arrays', () => {
      expect(isStringArray([])).toBe(true)
      expect(isStringArray(['a', 'b', 'c'])).toBe(true)
    })

    it('should return false for mixed arrays', () => {
      expect(isStringArray([1, 'a', 2])).toBe(false)
      expect(isStringArray(['a', null, 'b'])).toBe(false)
    })
  })
})

describe('Object Property Guards', () => {
  describe('hasProperty', () => {
    it('should return true if object has property', () => {
      expect(hasProperty({ name: 'test' }, 'name')).toBe(true)
    })

    it('should return false if object lacks property', () => {
      expect(hasProperty({}, 'name')).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(hasProperty(null, 'name')).toBe(false)
      expect(hasProperty('string', 'name')).toBe(false)
    })
  })

  describe('hasStringProperty', () => {
    it('should return true if property is a string', () => {
      expect(hasStringProperty({ name: 'test' }, 'name')).toBe(true)
    })

    it('should return false if property is not a string', () => {
      expect(hasStringProperty({ name: 123 }, 'name')).toBe(false)
    })
  })

  describe('hasNumberProperty', () => {
    it('should return true if property is a number', () => {
      expect(hasNumberProperty({ count: 42 }, 'count')).toBe(true)
    })

    it('should return false if property is not a number', () => {
      expect(hasNumberProperty({ count: '42' }, 'count')).toBe(false)
    })
  })

  describe('hasBooleanProperty', () => {
    it('should return true if property is a boolean', () => {
      expect(hasBooleanProperty({ active: true }, 'active')).toBe(true)
    })

    it('should return false if property is not a boolean', () => {
      expect(hasBooleanProperty({ active: 1 }, 'active')).toBe(false)
    })
  })

  describe('hasFunctionProperty', () => {
    it('should return true if property is a function', () => {
      expect(hasFunctionProperty({ fn: () => {} }, 'fn')).toBe(true)
    })

    it('should return false if property is not a function', () => {
      expect(hasFunctionProperty({ fn: 'not a function' }, 'fn')).toBe(false)
    })
  })
})

describe('Indexable Object Guards', () => {
  describe('isIndexable', () => {
    it('should return true for objects', () => {
      expect(isIndexable({ key: 'value' })).toBe(true)
    })

    it('should return false for non-objects', () => {
      expect(isIndexable(null)).toBe(false)
      expect(isIndexable('string')).toBe(false)
    })
  })

  describe('getPropertySafe', () => {
    it('should return property value if exists', () => {
      expect(getPropertySafe({ name: 'test' }, 'name')).toBe('test')
    })

    it('should return undefined if property does not exist', () => {
      expect(getPropertySafe({}, 'name')).toBe(undefined)
    })

    it('should return undefined for non-objects', () => {
      expect(getPropertySafe(null, 'name')).toBe(undefined)
      expect(getPropertySafe('string', 'name')).toBe(undefined)
    })
  })
})

describe('RPC-specific Type Guards', () => {
  describe('isRpcErrorResponse', () => {
    it('should return true for error responses', () => {
      expect(isRpcErrorResponse({ error: { message: 'Error occurred' } })).toBe(true)
      expect(isRpcErrorResponse({ error: { message: 'Error', code: 'ERR_001' } })).toBe(true)
    })

    it('should return false for success responses', () => {
      expect(isRpcErrorResponse({ result: 'success' })).toBe(false)
    })

    it('should return false for malformed error responses', () => {
      expect(isRpcErrorResponse({ error: 'string error' })).toBe(false)
      expect(isRpcErrorResponse({ error: { code: 'no message' } })).toBe(false)
    })
  })

  describe('isRpcSuccessResponse', () => {
    it('should return true for success responses', () => {
      expect(isRpcSuccessResponse({ result: 'success' })).toBe(true)
      expect(isRpcSuccessResponse({ result: null })).toBe(true)
    })

    it('should return false for error responses', () => {
      expect(isRpcSuccessResponse({ error: { message: 'Error' } })).toBe(false)
    })
  })

  describe('isJsonRpcRequest', () => {
    it('should return true for valid requests', () => {
      expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'test' })).toBe(true)
      expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'test', params: [1, 2], id: 1 })).toBe(true)
    })

    it('should return false for invalid requests', () => {
      expect(isJsonRpcRequest({ method: 'test' })).toBe(false)
      expect(isJsonRpcRequest({ jsonrpc: '1.0', method: 'test' })).toBe(false)
      expect(isJsonRpcRequest({ jsonrpc: '2.0' })).toBe(false)
    })
  })

  describe('isJsonRpcResponse', () => {
    it('should return true for success responses', () => {
      expect(isJsonRpcResponse({ jsonrpc: '2.0', result: 'data', id: 1 })).toBe(true)
    })

    it('should return true for error responses', () => {
      expect(isJsonRpcResponse({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid' }, id: 1 })).toBe(true)
    })

    it('should return false for invalid responses', () => {
      expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1 })).toBe(false)
      expect(isJsonRpcResponse({ result: 'data', id: 1 })).toBe(false)
    })
  })
})

describe('Assertion Functions', () => {
  describe('assertNonNullObject', () => {
    it('should not throw for valid objects', () => {
      expect(() => assertNonNullObject({})).not.toThrow()
    })

    it('should throw for null', () => {
      expect(() => assertNonNullObject(null)).toThrow(TypeError)
    })

    it('should throw with custom message', () => {
      expect(() => assertNonNullObject(null, 'Custom error')).toThrow('Custom error')
    })
  })

  describe('assertFunction', () => {
    it('should not throw for functions', () => {
      expect(() => assertFunction(() => {})).not.toThrow()
    })

    it('should throw for non-functions', () => {
      expect(() => assertFunction('not a function')).toThrow(TypeError)
    })
  })

  describe('assertString', () => {
    it('should not throw for strings', () => {
      expect(() => assertString('hello')).not.toThrow()
    })

    it('should throw for non-strings', () => {
      expect(() => assertString(123)).toThrow(TypeError)
    })
  })

  describe('assert', () => {
    it('should not throw for true conditions', () => {
      expect(() => assert(true)).not.toThrow()
      expect(() => assert(1 === 1)).not.toThrow()
    })

    it('should throw for false conditions', () => {
      expect(() => assert(false)).toThrow()
      expect(() => assert(1 === 2)).toThrow()
    })

    it('should throw with custom message', () => {
      expect(() => assert(false, 'Custom assertion')).toThrow('Custom assertion')
    })
  })
})
