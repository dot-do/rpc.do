/**
 * wrap-target utility tests
 */

import { describe, it, expect, vi } from 'vitest'
import { RpcTarget } from '@dotdo/capnweb/server'
import {
  hasNestedFunctions,
  collectObjectProperties,
  definePrototypeProperties,
  wrapObjectAsTarget,
  wrapObjectWithCustomMethods,
  DEFAULT_SKIP_PROPS,
  SECURITY_BLOCKLIST,
} from './wrap-target'

describe('hasNestedFunctions', () => {
  it('should return true for object with direct function', () => {
    const obj = { fn: () => 'test' }
    expect(hasNestedFunctions(obj)).toBe(true)
  })

  it('should return true for object with nested function', () => {
    const obj = { nested: { fn: () => 'test' } }
    expect(hasNestedFunctions(obj)).toBe(true)
  })

  it('should return false for object without functions', () => {
    const obj = { a: 1, b: 'string', c: { d: true } }
    expect(hasNestedFunctions(obj)).toBe(false)
  })

  it('should respect maxDepth', () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            fn: () => 'deep'
          }
        }
      }
    }
    // maxDepth=2: checks level1 (depth 5), level2 (depth 4), level3 (depth 3) - finds fn at depth 3
    // maxDepth=3: checks down to level3 and finds fn
    // Need deeper nesting to test depth limit
    expect(hasNestedFunctions(obj, 3)).toBe(false)
    expect(hasNestedFunctions(obj, 4)).toBe(true)
  })

  it('should ignore arrays', () => {
    const obj = { arr: [() => 'test'] }
    expect(hasNestedFunctions(obj)).toBe(false)
  })
})

describe('collectObjectProperties', () => {
  it('should collect methods from object', () => {
    const obj = {
      greet: (name: string) => `Hello, ${name}`,
      add: (a: number, b: number) => a + b,
    }

    const { methods, namespaces } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    expect(Object.keys(methods)).toContain('greet')
    expect(Object.keys(methods)).toContain('add')
    expect(Object.keys(namespaces)).toHaveLength(0)
  })

  it('should skip private properties starting with _', () => {
    const obj = {
      publicMethod: () => 'public',
      _privateMethod: () => 'private',
    }

    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    expect(Object.keys(methods)).toContain('publicMethod')
    expect(Object.keys(methods)).not.toContain('_privateMethod')
  })

  it('should skip properties in skip set', () => {
    const obj = {
      allowed: () => 'ok',
      skipped: () => 'skip me',
    }

    const skip = new Set([...DEFAULT_SKIP_PROPS, 'skipped'])
    const { methods } = collectObjectProperties(obj, skip, new WeakSet())

    expect(Object.keys(methods)).toContain('allowed')
    expect(Object.keys(methods)).not.toContain('skipped')
  })

  it('should collect namespaces with nested functions', () => {
    const obj = {
      users: {
        list: () => [],
        get: (id: string) => ({ id }),
      }
    }

    const { methods, namespaces } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    expect(Object.keys(methods)).toHaveLength(0)
    expect(Object.keys(namespaces)).toContain('users')
  })

  it('should collect methods from prototype chain', () => {
    class Parent {
      parentMethod() { return 'parent' }
    }
    class Child extends Parent {
      childMethod() { return 'child' }
    }

    const obj = new Child()
    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    expect(Object.keys(methods)).toContain('childMethod')
    expect(Object.keys(methods)).toContain('parentMethod')
  })
})

describe('definePrototypeProperties', () => {
  it('should define methods on prototype', () => {
    class TestClass {}
    const methods = {
      test: () => 'result',
    }

    definePrototypeProperties(TestClass, methods, {})

    const instance = new TestClass() as Record<string, unknown>
    expect(typeof instance.test).toBe('function')
    expect((instance.test as () => string)()).toBe('result')
  })

  it('should define namespace getters on prototype', () => {
    class TestClass {}
    const mockTarget = new RpcTarget()
    const namespaces = {
      sub: mockTarget,
    }

    definePrototypeProperties(TestClass, {}, namespaces)

    const instance = new TestClass() as Record<string, unknown>
    expect(instance.sub).toBe(mockTarget)
  })
})

describe('wrapObjectAsTarget', () => {
  it('should return an RpcTarget instance', () => {
    const obj = { test: () => 'ok' }
    const target = wrapObjectAsTarget(obj)

    expect(target).toBeInstanceOf(RpcTarget)
  })

  it('should expose methods on the target', () => {
    const obj = {
      greet: (name: string) => `Hello, ${name}!`,
      add: (a: number, b: number) => a + b,
    }

    const target = wrapObjectAsTarget(obj) as RpcTarget & Record<string, unknown>

    expect(typeof target.greet).toBe('function')
    expect(typeof target.add).toBe('function')
    expect((target.greet as (name: string) => string)('World')).toBe('Hello, World!')
    expect((target.add as (a: number, b: number) => number)(2, 3)).toBe(5)
  })

  it('should expose nested namespaces', () => {
    const obj = {
      users: {
        list: vi.fn(() => [{ id: '1' }]),
        get: vi.fn((id: string) => ({ id })),
      }
    }

    const target = wrapObjectAsTarget(obj) as RpcTarget & Record<string, RpcTarget & Record<string, unknown>>

    expect(target.users).toBeInstanceOf(RpcTarget)
    expect(typeof target.users.list).toBe('function')
    expect(typeof target.users.get).toBe('function')
    expect((target.users.list as () => unknown)()).toEqual([{ id: '1' }])
  })

  it('should handle circular references', () => {
    const obj: Record<string, unknown> = {
      method: () => 'test',
    }
    obj.self = obj

    // Should not throw
    const target = wrapObjectAsTarget(obj) as RpcTarget & Record<string, unknown>
    expect(target).toBeInstanceOf(RpcTarget)
    expect(typeof target.method).toBe('function')
  })

  it('should respect custom skip set', () => {
    const obj = {
      allowed: () => 'ok',
      secret: () => 'hidden',
    }

    const skip = new Set([...DEFAULT_SKIP_PROPS, 'secret'])
    const target = wrapObjectAsTarget(obj, { skip }) as RpcTarget & Record<string, unknown>

    expect(typeof target.allowed).toBe('function')
    expect(target.secret).toBeUndefined()
  })
})

describe('wrapObjectWithCustomMethods', () => {
  it('should include SDK methods', () => {
    const sdk = {
      apiCall: () => ({ status: 'ok' }),
    }

    const target = wrapObjectWithCustomMethods(sdk) as RpcTarget & Record<string, unknown>

    expect(typeof target.apiCall).toBe('function')
    expect((target.apiCall as () => unknown)()).toEqual({ status: 'ok' })
  })

  it('should include custom methods', () => {
    const sdk = {
      apiCall: () => ({ status: 'ok' }),
    }

    const customMethods = {
      custom: function(this: Record<string, unknown>) { return { custom: true } },
    }

    const ctx = { sdk }
    const target = wrapObjectWithCustomMethods(sdk, customMethods, ctx) as RpcTarget & Record<string, unknown>

    expect(typeof target.custom).toBe('function')
    expect((target.custom as () => unknown)()).toEqual({ custom: true })
  })

  it('should bind custom methods to context', () => {
    const sdk = {
      getData: () => ({ data: 'from-sdk' }),
    }

    const customMethods = {
      enhanced: function(this: { sdk: typeof sdk }) {
        const data = this.sdk.getData()
        return { ...data, enhanced: true }
      },
    }

    const ctx = { sdk }
    const target = wrapObjectWithCustomMethods(sdk, customMethods, ctx) as RpcTarget & Record<string, unknown>

    expect((target.enhanced as () => unknown)()).toEqual({ data: 'from-sdk', enhanced: true })
  })

  it('should work without custom methods', () => {
    const sdk = {
      test: () => 'ok',
    }

    const target = wrapObjectWithCustomMethods(sdk) as RpcTarget & Record<string, unknown>

    expect(typeof target.test).toBe('function')
    expect((target.test as () => string)()).toBe('ok')
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('SECURITY_BLOCKLIST', () => {
  it('should contain all dangerous prototype-related properties', () => {
    expect(SECURITY_BLOCKLIST.has('__proto__')).toBe(true)
    expect(SECURITY_BLOCKLIST.has('constructor')).toBe(true)
    expect(SECURITY_BLOCKLIST.has('prototype')).toBe(true)
  })

  it('should contain legacy property descriptor methods', () => {
    expect(SECURITY_BLOCKLIST.has('__defineGetter__')).toBe(true)
    expect(SECURITY_BLOCKLIST.has('__defineSetter__')).toBe(true)
    expect(SECURITY_BLOCKLIST.has('__lookupGetter__')).toBe(true)
    expect(SECURITY_BLOCKLIST.has('__lookupSetter__')).toBe(true)
  })

  it('should have all blocklisted properties included in DEFAULT_SKIP_PROPS', () => {
    for (const prop of SECURITY_BLOCKLIST) {
      expect(DEFAULT_SKIP_PROPS.has(prop)).toBe(true)
    }
  })
})

describe('Security: dangerous property blocking', () => {
  it('should not expose __proto__ as an RPC method from source object', () => {
    const obj: Record<string, unknown> = {
      greet: () => 'hello',
    }

    // Attacker tries to add __proto__ as an own property
    Object.defineProperty(obj, '__proto__', {
      value: () => 'malicious',
      enumerable: true,
      configurable: true,
    })

    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    // Safe method should be collected
    expect(Object.keys(methods)).toContain('greet')

    // __proto__ should NOT be collected (blocked by skip set and _ prefix)
    // Note: We use Object.keys() to avoid JavaScript's special __proto__ behavior
    expect(Object.keys(methods)).not.toContain('__proto__')
  })

  it('should not expose constructor as an RPC method from source object', () => {
    const obj: Record<string, unknown> = {
      greet: () => 'hello',
    }

    // Attacker tries to add constructor as an own property
    Object.defineProperty(obj, 'constructor', {
      value: () => 'malicious constructor',
      enumerable: true,
      configurable: true,
    })

    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    // Safe method should be collected
    expect(Object.keys(methods)).toContain('greet')

    // constructor should NOT be collected (blocked by skip set)
    expect(Object.keys(methods)).not.toContain('constructor')
  })

  it('should not expose prototype as an RPC method from source object', () => {
    const obj: Record<string, unknown> = {
      greet: () => 'hello',
    }

    // Attacker tries to add prototype as an own property
    Object.defineProperty(obj, 'prototype', {
      value: () => 'malicious prototype',
      enumerable: true,
      configurable: true,
    })

    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())

    // Safe method should be collected
    expect(Object.keys(methods)).toContain('greet')

    // prototype should NOT be collected (blocked by skip set)
    expect(Object.keys(methods)).not.toContain('prototype')
  })

  it('should block all SECURITY_BLOCKLIST properties even when added to source', () => {
    const obj: Record<string, unknown> = {
      safeMethod: () => 'safe',
    }

    // Try to add all security-sensitive properties
    for (const prop of SECURITY_BLOCKLIST) {
      Object.defineProperty(obj, prop, {
        value: () => `malicious-${prop}`,
        enumerable: true,
        configurable: true,
      })
    }

    const { methods } = collectObjectProperties(obj, DEFAULT_SKIP_PROPS, new WeakSet())
    const methodKeys = Object.keys(methods)

    // Safe method should be collected
    expect(methodKeys).toContain('safeMethod')

    // All security-sensitive properties should NOT be collected
    for (const prop of SECURITY_BLOCKLIST) {
      expect(methodKeys).not.toContain(prop)
    }
  })

  it('should block dangerous properties in wrapped targets', () => {
    const obj = {
      greet: (name: string) => `Hello, ${name}!`,
    }

    const target = wrapObjectAsTarget(obj) as Record<string, unknown>

    // greet should be accessible
    expect(typeof target.greet).toBe('function')

    // Verify that prototype-pollution vectors are not exposed as enumerable methods
    // Note: __proto__ is a special JavaScript property, not an RPC method
    // constructor is inherited from RpcTarget, not exposed via RPC
    const ownMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(target))
      .filter(key => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), key)
        return descriptor?.enumerable === true
      })

    // greet should be enumerable
    expect(ownMethods).toContain('greet')

    // Security properties should NOT be enumerable on the prototype
    expect(ownMethods).not.toContain('__proto__')
    expect(ownMethods).not.toContain('constructor')
    expect(ownMethods).not.toContain('prototype')
    expect(ownMethods).not.toContain('__defineGetter__')
    expect(ownMethods).not.toContain('__defineSetter__')
    expect(ownMethods).not.toContain('__lookupGetter__')
    expect(ownMethods).not.toContain('__lookupSetter__')
  })
})
