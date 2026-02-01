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

    const instance = new TestClass() as any
    expect(typeof instance.test).toBe('function')
    expect(instance.test()).toBe('result')
  })

  it('should define namespace getters on prototype', () => {
    class TestClass {}
    const mockTarget = new RpcTarget()
    const namespaces = {
      sub: mockTarget,
    }

    definePrototypeProperties(TestClass, {}, namespaces)

    const instance = new TestClass() as any
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

    const target = wrapObjectAsTarget(obj) as any

    expect(typeof target.greet).toBe('function')
    expect(typeof target.add).toBe('function')
    expect(target.greet('World')).toBe('Hello, World!')
    expect(target.add(2, 3)).toBe(5)
  })

  it('should expose nested namespaces', () => {
    const obj = {
      users: {
        list: vi.fn(() => [{ id: '1' }]),
        get: vi.fn((id: string) => ({ id })),
      }
    }

    const target = wrapObjectAsTarget(obj) as any

    expect(target.users).toBeInstanceOf(RpcTarget)
    expect(typeof target.users.list).toBe('function')
    expect(typeof target.users.get).toBe('function')
    expect(target.users.list()).toEqual([{ id: '1' }])
  })

  it('should handle circular references', () => {
    const obj: Record<string, any> = {
      method: () => 'test',
    }
    obj.self = obj

    // Should not throw
    const target = wrapObjectAsTarget(obj) as any
    expect(target).toBeInstanceOf(RpcTarget)
    expect(typeof target.method).toBe('function')
  })

  it('should respect custom skip set', () => {
    const obj = {
      allowed: () => 'ok',
      secret: () => 'hidden',
    }

    const skip = new Set([...DEFAULT_SKIP_PROPS, 'secret'])
    const target = wrapObjectAsTarget(obj, { skip }) as any

    expect(typeof target.allowed).toBe('function')
    expect(target.secret).toBeUndefined()
  })
})

describe('wrapObjectWithCustomMethods', () => {
  it('should include SDK methods', () => {
    const sdk = {
      apiCall: () => ({ status: 'ok' }),
    }

    const target = wrapObjectWithCustomMethods(sdk) as any

    expect(typeof target.apiCall).toBe('function')
    expect(target.apiCall()).toEqual({ status: 'ok' })
  })

  it('should include custom methods', () => {
    const sdk = {
      apiCall: () => ({ status: 'ok' }),
    }

    const customMethods = {
      custom: function(this: any) { return { custom: true } },
    }

    const ctx = { sdk }
    const target = wrapObjectWithCustomMethods(sdk, customMethods, ctx) as any

    expect(typeof target.custom).toBe('function')
    expect(target.custom()).toEqual({ custom: true })
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
    const target = wrapObjectWithCustomMethods(sdk, customMethods, ctx) as any

    expect(target.enhanced()).toEqual({ data: 'from-sdk', enhanced: true })
  })

  it('should work without custom methods', () => {
    const sdk = {
      test: () => 'ok',
    }

    const target = wrapObjectWithCustomMethods(sdk) as any

    expect(typeof target.test).toBe('function')
    expect(target.test()).toBe('ok')
  })
})
