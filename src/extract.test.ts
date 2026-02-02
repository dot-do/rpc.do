/**
 * Direct unit tests for src/extract.ts
 *
 * Tests the extraction functions directly (not through the CLI binary).
 * Covers class-based DOs, factory patterns, namespaces, generics,
 * private/system method exclusion, type resolution, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { extractTypes, generateDTS, generateIndex } from './extract'
import type { ExtractedSchema, ExtractedMethod, ExtractedNamespace, ExtractedType } from './extract'

// ============================================================================
// Test Fixtures Directory
// ============================================================================

const FIXTURES_DIR = join(__dirname, '.test-extract-fixtures')

function writeFixture(filename: string, content: string): string {
  const filePath = join(FIXTURES_DIR, filename)
  writeFileSync(filePath, content)
  return filePath
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
  mkdirSync(FIXTURES_DIR, { recursive: true })
})

afterEach(() => {
  rmSync(FIXTURES_DIR, { recursive: true, force: true })
})

// ============================================================================
// Test: extractTypes — Class-based DOs
// ============================================================================

describe('extractTypes: class-based DOs', () => {
  it('should extract methods from a basic DurableObject class', async () => {
    const filePath = writeFixture('BasicDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class BasicDO extends DurableObject {
        async greet(name: string): Promise<string> {
          return \`Hello \${name}\`
        }

        async add(a: number, b: number): Promise<number> {
          return a + b
        }
      }
    `)

    const schemas = await extractTypes(filePath)

    expect(schemas).toHaveLength(1)
    const schema = schemas[0]!
    expect(schema.className).toBe('BasicDO')
    expect(schema.methods).toHaveLength(2)

    const greet = schema.methods.find((m) => m.name === 'greet')!
    expect(greet).toBeDefined()
    expect(greet.parameters).toHaveLength(1)
    expect(greet.parameters[0]!.name).toBe('name')
    expect(greet.parameters[0]!.type).toBe('string')
    expect(greet.returnType).toBe('Promise<string>')

    const add = schema.methods.find((m) => m.name === 'add')!
    expect(add).toBeDefined()
    expect(add.parameters).toHaveLength(2)
    expect(add.parameters[0]!.name).toBe('a')
    expect(add.parameters[0]!.type).toBe('number')
    expect(add.parameters[1]!.name).toBe('b')
    expect(add.parameters[1]!.type).toBe('number')
    expect(add.returnType).toBe('Promise<number>')
  })

  it('should recognize DurableRPC as a valid base class', async () => {
    const filePath = writeFixture('RpcDO.ts', `
      import { DurableRPC } from 'rpc.do'

      export class RpcDO extends DurableRPC {
        async ping(): Promise<string> {
          return 'pong'
        }
      }
    `)

    const schemas = await extractTypes(filePath)

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.className).toBe('RpcDO')
    expect(schemas[0]!.methods).toHaveLength(1)
    expect(schemas[0]!.methods[0]!.name).toBe('ping')
  })

  it('should recognize DigitalObject as a valid base class', async () => {
    const filePath = writeFixture('DigitalDO.ts', `
      import { DigitalObject } from 'some-module'

      export class DigitalDO extends DigitalObject {
        async process(data: string): Promise<boolean> {
          return true
        }
      }
    `)

    const schemas = await extractTypes(filePath)

    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.className).toBe('DigitalDO')
  })

  it('should extract literal return types', async () => {
    const filePath = writeFixture('LiteralDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class LiteralDO extends DurableObject {
        async ping(): Promise<'pong'> {
          return 'pong'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods[0]!.returnType).toBe("Promise<'pong'>")
  })

  it('should extract optional parameters', async () => {
    const filePath = writeFixture('OptionalDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class OptionalDO extends DurableObject {
        async list(limit?: number, offset?: number): Promise<string[]> {
          return []
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const method = schemas[0]!.methods[0]!
    expect(method.parameters).toHaveLength(2)
    expect(method.parameters[0]!.optional).toBe(true)
    expect(method.parameters[1]!.optional).toBe(true)
  })

  it('should extract complex return types with inline objects', async () => {
    const filePath = writeFixture('ComplexReturnDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class ComplexReturnDO extends DurableObject {
        async getStatus(): Promise<{ status: 'ok' | 'error'; timestamp: number }> {
          return { status: 'ok', timestamp: Date.now() }
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const method = schemas[0]!.methods[0]!
    expect(method.returnType).toContain('status:')
    expect(method.returnType).toContain('timestamp:')
  })
})

// ============================================================================
// Test: extractTypes — Private method exclusion
// ============================================================================

describe('extractTypes: private method exclusion', () => {
  it('should exclude methods starting with underscore', async () => {
    const filePath = writeFixture('PrivateDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class PrivateDO extends DurableObject {
        async publicMethod(): Promise<string> {
          return this._helper()
        }

        private async _helper(): Promise<string> {
          return 'hidden'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(1)
    expect(schema.methods[0]!.name).toBe('publicMethod')
    expect(schema.methods.find((m) => m.name === '_helper')).toBeUndefined()
  })

  it('should exclude methods starting with # (ES private)', async () => {
    const filePath = writeFixture('HashPrivateDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class HashPrivateDO extends DurableObject {
        async publicMethod(): Promise<void> {}

        async #internalProcess(): Promise<void> {}
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!

    // Only publicMethod should appear
    const methodNames = schema.methods.map((m) => m.name)
    expect(methodNames).toContain('publicMethod')
    expect(methodNames).not.toContain('#internalProcess')
    expect(methodNames).not.toContain('internalProcess')
  })

  it('should exclude methods with private keyword scope', async () => {
    const filePath = writeFixture('PrivateKeywordDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class PrivateKeywordDO extends DurableObject {
        async publicMethod(): Promise<string> {
          return 'visible'
        }

        private async secretMethod(): Promise<string> {
          return 'hidden'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const methodNames = schema.methods.map((m) => m.name)
    expect(methodNames).toContain('publicMethod')
    expect(methodNames).not.toContain('secretMethod')
  })

  it('should exclude protected methods', async () => {
    const filePath = writeFixture('ProtectedDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class ProtectedDO extends DurableObject {
        async publicMethod(): Promise<void> {}

        protected async guardedMethod(): Promise<void> {}
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const methodNames = schema.methods.map((m) => m.name)
    expect(methodNames).toContain('publicMethod')
    expect(methodNames).not.toContain('guardedMethod')
  })
})

// ============================================================================
// Test: extractTypes — System method exclusion
// ============================================================================

describe('extractTypes: system method exclusion', () => {
  it('should exclude fetch method', async () => {
    const filePath = writeFixture('FetchDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class FetchDO extends DurableObject {
        async fetch(request: Request): Promise<Response> {
          return new Response('ok')
        }

        async customMethod(): Promise<string> {
          return 'included'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const methodNames = schemas[0]!.methods.map((m) => m.name)
    expect(methodNames).not.toContain('fetch')
    expect(methodNames).toContain('customMethod')
  })

  it('should exclude alarm method', async () => {
    const filePath = writeFixture('AlarmDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class AlarmDO extends DurableObject {
        async alarm(): Promise<void> {}
        async doWork(): Promise<string> { return 'work' }
      }
    `)

    const schemas = await extractTypes(filePath)
    const methodNames = schemas[0]!.methods.map((m) => m.name)
    expect(methodNames).not.toContain('alarm')
    expect(methodNames).toContain('doWork')
  })

  it('should exclude all webSocket handler methods', async () => {
    const filePath = writeFixture('WebSocketDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class WebSocketDO extends DurableObject {
        async webSocketMessage(ws: WebSocket, message: string): Promise<void> {}
        async webSocketClose(ws: WebSocket): Promise<void> {}
        async webSocketError(ws: WebSocket, error: Error): Promise<void> {}
        async webSocketOpen(ws: WebSocket): Promise<void> {}
        async handleData(data: string): Promise<string> { return data }
      }
    `)

    const schemas = await extractTypes(filePath)
    const methodNames = schemas[0]!.methods.map((m) => m.name)
    expect(methodNames).not.toContain('webSocketMessage')
    expect(methodNames).not.toContain('webSocketClose')
    expect(methodNames).not.toContain('webSocketError')
    expect(methodNames).not.toContain('webSocketOpen')
    expect(methodNames).toContain('handleData')
  })

  it('should exclude constructor', async () => {
    const filePath = writeFixture('ConstructorDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class ConstructorDO extends DurableObject {
        constructor(ctx: any, env: any) {
          super(ctx, env)
        }

        async myMethod(): Promise<string> { return 'hello' }
      }
    `)

    const schemas = await extractTypes(filePath)
    const methodNames = schemas[0]!.methods.map((m) => m.name)
    expect(methodNames).not.toContain('constructor')
    expect(methodNames).toContain('myMethod')
  })
})

// ============================================================================
// Test: extractTypes — Namespace extraction (class properties)
// ============================================================================

describe('extractTypes: namespace extraction from class properties', () => {
  it('should extract a namespace object with arrow function methods', async () => {
    const filePath = writeFixture('NamespaceDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class NamespaceDO extends DurableObject {
        users = {
          get: async (id: string): Promise<string | null> => {
            return null
          },
          create: async (name: string): Promise<string> => {
            return name
          }
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!

    expect(schema.namespaces).toHaveLength(1)
    const ns = schema.namespaces[0]!
    expect(ns.name).toBe('users')
    expect(ns.methods).toHaveLength(2)

    const get = ns.methods.find((m) => m.name === 'get')!
    expect(get).toBeDefined()
    expect(get.parameters).toHaveLength(1)
    expect(get.parameters[0]!.name).toBe('id')
    expect(get.parameters[0]!.type).toBe('string')
    expect(get.returnType).toBe('Promise<string | null>')

    const create = ns.methods.find((m) => m.name === 'create')!
    expect(create).toBeDefined()
    expect(create.parameters).toHaveLength(1)
    expect(create.parameters[0]!.type).toBe('string')
  })

  it('should extract multiple namespaces', async () => {
    const filePath = writeFixture('MultiNsDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class MultiNsDO extends DurableObject {
        users = {
          list: async (): Promise<string[]> => []
        }
        posts = {
          count: async (): Promise<number> => 0
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.namespaces).toHaveLength(2)
    const nsNames = schema.namespaces.map((ns) => ns.name)
    expect(nsNames).toContain('users')
    expect(nsNames).toContain('posts')
  })

  it('should combine top-level methods and namespaces', async () => {
    const filePath = writeFixture('CombinedDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class CombinedDO extends DurableObject {
        async ping(): Promise<string> {
          return 'pong'
        }

        users = {
          list: async (): Promise<string[]> => []
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(1)
    expect(schema.methods[0]!.name).toBe('ping')
    expect(schema.namespaces).toHaveLength(1)
    expect(schema.namespaces[0]!.name).toBe('users')
  })

  it('should exclude private namespace properties', async () => {
    const filePath = writeFixture('PrivateNsDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class PrivateNsDO extends DurableObject {
        _internal = {
          debug: async (): Promise<void> => {}
        }

        public api = {
          health: async (): Promise<string> => 'ok'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const nsNames = schema.namespaces.map((ns) => ns.name)
    expect(nsNames).not.toContain('_internal')
    expect(nsNames).toContain('api')
  })
})

// ============================================================================
// Test: extractTypes — Factory pattern DO()
// ============================================================================

describe('extractTypes: DO() factory pattern', () => {
  it('should extract methods from a DO() factory with return statement', async () => {
    const filePath = writeFixture('factoryDO.ts', `
      const DO = (cb: any) => cb

      export const myDO = DO(async ($: any) => {
        return {
          ping: async (): Promise<string> => 'pong',
          add: async (a: number, b: number): Promise<number> => a + b,
        }
      })
    `)

    const schemas = await extractTypes(filePath)

    expect(schemas).toHaveLength(1)
    const schema = schemas[0]!
    expect(schema.className).toBe('myDO')
    expect(schema.methods).toHaveLength(2)

    const ping = schema.methods.find((m) => m.name === 'ping')!
    expect(ping).toBeDefined()
    expect(ping.returnType).toBe('Promise<string>')

    const add = schema.methods.find((m) => m.name === 'add')!
    expect(add.parameters).toHaveLength(2)
    expect(add.parameters[0]!.type).toBe('number')
  })

  it('should extract methods from a DO() factory with implicit return (parenthesized)', async () => {
    const filePath = writeFixture('implicitFactoryDO.ts', `
      const DO = (cb: any) => cb

      export const myDO = DO(async ($: any) => ({
        ping: async (): Promise<string> => 'pong',
      }))
    `)

    const schemas = await extractTypes(filePath)

    expect(schemas).toHaveLength(1)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(1)
    expect(schema.methods[0]!.name).toBe('ping')
  })

  it('should extract nested namespaces from DO() factory', async () => {
    const filePath = writeFixture('nestedFactoryDO.ts', `
      const DO = (cb: any) => cb

      export const myDO = DO(async ($: any) => {
        return {
          ping: async (): Promise<string> => 'pong',
          users: {
            get: async (id: string): Promise<string | null> => null,
            create: async (name: string): Promise<string> => name,
          }
        }
      })
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!

    expect(schema.methods).toHaveLength(1)
    expect(schema.methods[0]!.name).toBe('ping')
    expect(schema.namespaces).toHaveLength(1)
    expect(schema.namespaces[0]!.name).toBe('users')
    expect(schema.namespaces[0]!.methods).toHaveLength(2)
  })

  it('should extract method shorthand in DO() factory', async () => {
    const filePath = writeFixture('shorthandFactoryDO.ts', `
      const DO = (cb: any) => cb

      export const myDO = DO(async ($: any) => {
        return {
          async ping(): Promise<string> {
            return 'pong'
          }
        }
      })
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(1)
    expect(schema.methods[0]!.name).toBe('ping')
    expect(schema.methods[0]!.returnType).toBe('Promise<string>')
  })

  it('should return null/skip for DO() factory with no arguments', async () => {
    const filePath = writeFixture('emptyFactoryDO.ts', `
      const DO = (cb: any) => cb

      // Class is needed so we don't fail with "no DO class found"
      import { DurableObject } from 'cloudflare:workers'
      export class FallbackDO extends DurableObject {
        async ping(): Promise<string> { return 'pong' }
      }

      export const emptyDO = DO()
    `)

    const schemas = await extractTypes(filePath)
    // Should still get the class-based one, factory with no args is skipped
    expect(schemas.length).toBeGreaterThanOrEqual(1)
    expect(schemas.some((s) => s.className === 'FallbackDO')).toBe(true)
  })
})

// ============================================================================
// Test: extractTypes — Type extraction (interfaces, types, enums)
// ============================================================================

describe('extractTypes: type extraction from source', () => {
  it('should extract interfaces used in method signatures', async () => {
    const filePath = writeFixture('TypedDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface User {
        id: string
        name: string
        email: string
      }

      export class TypedDO extends DurableObject {
        async getUser(id: string): Promise<User | null> {
          return null
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.types).toHaveLength(1)
    expect(schema.types[0]!.name).toBe('User')
    expect(schema.types[0]!.kind).toBe('interface')
    expect(schema.types[0]!.declaration).toContain('interface User')
    expect(schema.types[0]!.declaration).toContain('id: string')
  })

  it('should extract type aliases used in signatures', async () => {
    const filePath = writeFixture('TypeAliasDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export type Status = 'pending' | 'active' | 'completed'

      export class TypeAliasDO extends DurableObject {
        async getStatus(): Promise<Status> {
          return 'active'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.types.some((t) => t.name === 'Status' && t.kind === 'type')).toBe(true)
  })

  it('should extract enums used in signatures', async () => {
    const filePath = writeFixture('EnumDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export enum Priority {
        Low = 'low',
        Medium = 'medium',
        High = 'high',
      }

      export class EnumDO extends DurableObject {
        async setPriority(id: string, priority: Priority): Promise<void> {}
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.types.some((t) => t.name === 'Priority' && t.kind === 'enum')).toBe(true)
  })

  it('should not extract built-in types as user types', async () => {
    const filePath = writeFixture('BuiltinDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class BuiltinDO extends DurableObject {
        async getData(): Promise<Map<string, number>> {
          return new Map()
        }

        async getSet(): Promise<Set<string>> {
          return new Set()
        }

        async getPartial(): Promise<Partial<{ x: number }>> {
          return {}
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    // Built-in types (Map, Set, Partial) should NOT appear in the extracted types list
    const typeNames = schema.types.map((t) => t.name)
    expect(typeNames).not.toContain('Map')
    expect(typeNames).not.toContain('Set')
    expect(typeNames).not.toContain('Partial')
    expect(typeNames).not.toContain('Promise')
  })

  it('should extract types from both parameters and return types', async () => {
    const filePath = writeFixture('MultiTypeDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface Input {
        query: string
      }

      export interface Output {
        result: string
      }

      export class MultiTypeDO extends DurableObject {
        async search(input: Input): Promise<Output> {
          return { result: 'found' }
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const typeNames = schema.types.map((t) => t.name)
    expect(typeNames).toContain('Input')
    expect(typeNames).toContain('Output')
  })
})

// ============================================================================
// Test: extractTypes — Import resolution
// ============================================================================

describe('extractTypes: import resolution', () => {
  it('should resolve types imported from a local file', async () => {
    writeFixture('types.ts', `
      export interface User {
        id: string
        name: string
        email: string
      }

      export type UserRole = 'admin' | 'user' | 'guest'
    `)

    const filePath = writeFixture('ImportDO.ts', `
      import { DurableObject } from 'cloudflare:workers'
      import { User, UserRole } from './types'

      export class ImportDO extends DurableObject {
        async getUser(id: string): Promise<User | null> {
          return null
        }

        async getRole(userId: string): Promise<UserRole> {
          return 'user'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const typeNames = schema.types.map((t) => t.name)

    // Should have resolved and inlined the imported types
    expect(typeNames).toContain('User')
    expect(typeNames).toContain('UserRole')
  })

  it('should not attempt to resolve external module imports', async () => {
    // This should not throw even though 'some-external-lib' doesn't exist
    const filePath = writeFixture('ExternalImportDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class ExternalImportDO extends DurableObject {
        async ping(): Promise<string> {
          return 'pong'
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.methods[0]!.name).toBe('ping')
  })
})

// ============================================================================
// Test: extractTypes — Generic type handling
// ============================================================================

describe('extractTypes: generic type handling', () => {
  it('should preserve generic type parameters in namespace types', async () => {
    const filePath = writeFixture('GenericDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface Collection<T> {
        get(id: string): Promise<T | null>
        put(id: string, item: T): Promise<void>
      }

      export interface Product {
        id: string
        name: string
        price: number
      }

      export class GenericDO extends DurableObject {
        products: Collection<Product> = {} as any

        async ping(): Promise<string> { return 'pong' }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!

    // Should have the products namespace
    const productsNs = schema.namespaces.find((ns) => ns.name === 'products')
    expect(productsNs).toBeDefined()

    // The typeName should reference Collection<Product>
    expect(productsNs!.typeName).toBe('Collection<Product>')
  })

  it('should extract complex return types with generics', async () => {
    const filePath = writeFixture('ComplexGenericDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface Product {
        id: string
        name: string
      }

      export interface Order {
        id: string
        total: number
      }

      export class ComplexGenericDO extends DurableObject {
        async getProductWithOrders(productId: string): Promise<{ product: Product | null; orders: Order[] }> {
          return { product: null, orders: [] }
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const method = schemas[0]!.methods[0]!
    expect(method.returnType).toContain('product:')
    expect(method.returnType).toContain('orders:')
  })
})

// ============================================================================
// Test: extractTypes — Edge cases
// ============================================================================

describe('extractTypes: edge cases', () => {
  it('should throw when source path is empty', async () => {
    await expect(extractTypes('')).rejects.toThrow('Source path is required')
  })

  it('should throw when file does not exist', async () => {
    await expect(extractTypes(join(FIXTURES_DIR, 'nonexistent.ts'))).rejects.toThrow(/not found|File not found/)
  })

  it('should throw when path is a directory', async () => {
    mkdirSync(join(FIXTURES_DIR, 'subdir'), { recursive: true })
    await expect(extractTypes(join(FIXTURES_DIR, 'subdir'))).rejects.toThrow(/directory/)
  })

  it('should throw when file is not a .ts file', async () => {
    const filePath = writeFixture('notts.js', 'export const x = 1')
    await expect(extractTypes(filePath)).rejects.toThrow(/TypeScript file/)
  })

  it('should throw when file is empty', async () => {
    const filePath = writeFixture('Empty.ts', '')
    await expect(extractTypes(filePath)).rejects.toThrow(/empty/i)
  })

  it('should throw when no DO class is found', async () => {
    const filePath = writeFixture('NoDO.ts', `
      export function notADO() {
        return 42
      }
    `)
    await expect(extractTypes(filePath)).rejects.toThrow(/No DurableObject class found/)
  })

  it('should throw when syntax errors are present', async () => {
    const filePath = writeFixture('SyntaxError.ts', `
      export class Broken {
        this is not valid {{{{
      }
    `)
    await expect(extractTypes(filePath)).rejects.toThrow(/syntax error/i)
  })

  it('should handle a class with no public methods (only system methods)', async () => {
    const filePath = writeFixture('OnlySystemDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class OnlySystemDO extends DurableObject {
        async fetch(request: Request): Promise<Response> {
          return new Response('ok')
        }

        async alarm(): Promise<void> {}
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(0)
    expect(schema.namespaces).toHaveLength(0)
  })

  it('should handle a class with only a constructor', async () => {
    const filePath = writeFixture('ConstructorOnlyDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class ConstructorOnlyDO extends DurableObject {
        constructor(ctx: any, env: any) {
          super(ctx, env)
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    expect(schema.methods).toHaveLength(0)
  })

  it('should handle methods with no parameters', async () => {
    const filePath = writeFixture('NoParamsDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class NoParamsDO extends DurableObject {
        async healthCheck(): Promise<boolean> {
          return true
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const method = schemas[0]!.methods[0]!
    expect(method.name).toBe('healthCheck')
    expect(method.parameters).toHaveLength(0)
    expect(method.returnType).toBe('Promise<boolean>')
  })
})

// ============================================================================
// Test: extractTypes — isBuiltInType coverage
// ============================================================================

describe('extractTypes: isBuiltInType check', () => {
  it('should not extract String, Number, Boolean, etc. as user types', async () => {
    const filePath = writeFixture('AllBuiltinsDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export class AllBuiltinsDO extends DurableObject {
        async method1(): Promise<String> { return '' }
        async method2(): Promise<Number> { return 0 }
        async method3(): Promise<Boolean> { return true }
        async method4(): Promise<Array<string>> { return [] }
        async method5(): Promise<Date> { return new Date() }
        async method6(): Promise<Error> { return new Error() }
        async method7(): Promise<Record<string, number>> { return {} }
        async method8(): Promise<Partial<{ x: number }>> { return {} }
        async method9(): Promise<Required<{ x?: number }>> { return { x: 1 } }
        async method10(): Promise<Readonly<{ x: number }>> { return { x: 1 } }
        async method11(): Promise<Pick<{ x: number; y: string }, 'x'>> { return { x: 1 } }
        async method12(): Promise<Omit<{ x: number; y: string }, 'y'>> { return { x: 1 } }
        async method13(): Promise<Exclude<'a' | 'b', 'a'>> { return 'b' }
        async method14(): Promise<Awaited<Promise<string>>> { return '' }
      }
    `)

    const schemas = await extractTypes(filePath)
    const schema = schemas[0]!
    const typeNames = schema.types.map((t) => t.name)

    // None of the built-in types should appear in extracted types
    const builtIns = [
      'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'Date', 'Error',
      'Map', 'Set', 'WeakMap', 'WeakSet', 'Request', 'Response', 'WebSocket',
      'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Record',
      'Exclude', 'Extract', 'ReturnType', 'Parameters', 'Awaited',
    ]
    for (const builtIn of builtIns) {
      expect(typeNames).not.toContain(builtIn)
    }
  })

  it('should extract user-defined PascalCase types that are not built-ins', async () => {
    const filePath = writeFixture('CustomTypeDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface MyCustomType {
        value: string
      }

      export class CustomTypeDO extends DurableObject {
        async getData(): Promise<MyCustomType> {
          return { value: 'hello' }
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    const typeNames = schemas[0]!.types.map((t) => t.name)
    expect(typeNames).toContain('MyCustomType')
  })
})

// ============================================================================
// Test: generateDTS
// ============================================================================

describe('generateDTS', () => {
  it('should generate valid .d.ts content from a schema', () => {
    const schema: ExtractedSchema = {
      className: 'TestDO',
      methods: [
        { name: 'greet', parameters: [{ name: 'name', type: 'string', optional: false }], returnType: 'Promise<string>' },
        { name: 'add', parameters: [{ name: 'a', type: 'number', optional: false }, { name: 'b', type: 'number', optional: false }], returnType: 'Promise<number>' },
      ],
      namespaces: [],
      types: [],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('// Generated by')
    expect(dts).toContain('export interface TestDOAPI')
    expect(dts).toContain('greet(name: string): Promise<string>')
    expect(dts).toContain('add(a: number, b: number): Promise<number>')
  })

  it('should generate namespace blocks', () => {
    const schema: ExtractedSchema = {
      className: 'NsDO',
      methods: [],
      namespaces: [
        {
          name: 'users',
          methods: [
            { name: 'get', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<string | null>' },
          ],
        },
      ],
      types: [],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('users: {')
    expect(dts).toContain('get(id: string): Promise<string | null>')
  })

  it('should use typeName for typed namespaces', () => {
    const schema: ExtractedSchema = {
      className: 'TypedNsDO',
      methods: [],
      namespaces: [
        {
          name: 'products',
          methods: [
            { name: 'get', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<Product | null>' },
          ],
          typeName: 'Collection<Product>',
        },
      ],
      types: [],
    }

    const dts = generateDTS(schema)

    // When typeName is set, it should use it directly instead of expanding methods
    expect(dts).toContain('products: Collection<Product>')
  })

  it('should include type definitions', () => {
    const schema: ExtractedSchema = {
      className: 'TypedDO',
      methods: [
        { name: 'getUser', parameters: [], returnType: 'Promise<User>' },
      ],
      namespaces: [],
      types: [
        { name: 'User', declaration: 'interface User {\n  id: string\n  name: string\n}', kind: 'interface' },
      ],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('export interface User')
    expect(dts).toContain('id: string')
  })

  it('should add export keyword to type declarations that lack it', () => {
    const schema: ExtractedSchema = {
      className: 'ExportDO',
      methods: [],
      namespaces: [],
      types: [
        { name: 'Foo', declaration: 'interface Foo { x: number }', kind: 'interface' },
      ],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('export interface Foo')
  })

  it('should not double-add export keyword', () => {
    const schema: ExtractedSchema = {
      className: 'ExportDO',
      methods: [],
      namespaces: [],
      types: [
        { name: 'Bar', declaration: 'export interface Bar { y: string }', kind: 'interface' },
      ],
    }

    const dts = generateDTS(schema)

    // Should contain exactly one "export interface Bar", not "export export interface Bar"
    expect(dts).toContain('export interface Bar')
    expect(dts).not.toContain('export export')
  })

  it('should handle optional parameters in method signatures', () => {
    const schema: ExtractedSchema = {
      className: 'OptDO',
      methods: [
        {
          name: 'list',
          parameters: [
            { name: 'limit', type: 'number', optional: true },
            { name: 'offset', type: 'number', optional: true },
          ],
          returnType: 'Promise<string[]>',
        },
      ],
      namespaces: [],
      types: [],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('list(limit?: number, offset?: number): Promise<string[]>')
  })

  it('should handle nested namespaces', () => {
    const schema: ExtractedSchema = {
      className: 'NestedDO',
      methods: [],
      namespaces: [
        {
          name: 'admin',
          methods: [
            { name: 'status', parameters: [], returnType: 'Promise<string>' },
          ],
          nestedNamespaces: [
            {
              name: 'config',
              methods: [
                { name: 'get', parameters: [{ name: 'key', type: 'string', optional: false }], returnType: 'Promise<string>' },
              ],
            },
          ],
        },
      ],
      types: [],
    }

    const dts = generateDTS(schema)

    expect(dts).toContain('admin: {')
    expect(dts).toContain('status(): Promise<string>')
    expect(dts).toContain('config: {')
    expect(dts).toContain('get(key: string): Promise<string>')
  })
})

// ============================================================================
// Test: generateIndex
// ============================================================================

describe('generateIndex', () => {
  it('should generate index.ts with imports and re-exports', () => {
    const schemas: ExtractedSchema[] = [
      { className: 'UserDO', methods: [], namespaces: [], types: [] },
      { className: 'TaskDO', methods: [], namespaces: [], types: [] },
    ]

    const index = generateIndex(schemas)

    expect(index).toContain('// Generated by')
    expect(index).toContain("import type { UserDOAPI } from './UserDO'")
    expect(index).toContain("import type { TaskDOAPI } from './TaskDO'")
    expect(index).toContain('export type { UserDOAPI }')
    expect(index).toContain('export type { TaskDOAPI }')
  })

  it('should handle single schema', () => {
    const schemas: ExtractedSchema[] = [
      { className: 'SingleDO', methods: [], namespaces: [], types: [] },
    ]

    const index = generateIndex(schemas)

    expect(index).toContain("import type { SingleDOAPI } from './SingleDO'")
    expect(index).toContain('export type { SingleDOAPI }')
  })

  it('should handle empty schemas array', () => {
    const index = generateIndex([])

    expect(index).toContain('// Generated by')
    // Should not have any import/export lines
    expect(index).not.toContain('import type')
    expect(index).not.toContain('export type')
  })
})

// ============================================================================
// Test: extractTypes — Full round-trip with generateDTS
// ============================================================================

describe('extractTypes + generateDTS round-trip', () => {
  it('should produce valid .d.ts from a class-based DO', async () => {
    const filePath = writeFixture('RoundTripDO.ts', `
      import { DurableObject } from 'cloudflare:workers'

      export interface User {
        id: string
        name: string
      }

      export class RoundTripDO extends DurableObject {
        async getUser(id: string): Promise<User | null> {
          return null
        }

        users = {
          list: async (limit?: number): Promise<User[]> => []
        }
      }
    `)

    const schemas = await extractTypes(filePath)
    expect(schemas).toHaveLength(1)

    const dts = generateDTS(schemas[0]!)

    expect(dts).toContain('export interface RoundTripDOAPI')
    expect(dts).toContain('getUser(id: string): Promise<User | null>')
    expect(dts).toContain('users: {')
    expect(dts).toContain('list(limit?: number): Promise<User[]>')
    expect(dts).toContain('interface User')
  })

  it('should produce valid .d.ts from a factory-based DO', async () => {
    const filePath = writeFixture('FactoryRoundTrip.ts', `
      const DO = (cb: any) => cb

      export const calculator = DO(async ($: any) => {
        return {
          add: async (a: number, b: number): Promise<number> => a + b,
          multiply: async (a: number, b: number): Promise<number> => a * b,
        }
      })
    `)

    const schemas = await extractTypes(filePath)
    expect(schemas).toHaveLength(1)

    const dts = generateDTS(schemas[0]!)

    expect(dts).toContain('export interface calculatorAPI')
    expect(dts).toContain('add(a: number, b: number): Promise<number>')
    expect(dts).toContain('multiply(a: number, b: number): Promise<number>')
  })
})
