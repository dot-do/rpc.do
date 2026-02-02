/**
 * OpenAPI Export Tests
 *
 * Tests for converting RPC schemas to OpenAPI 3.0/3.1 specification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  toOpenAPI,
  toOpenAPIFromExtracted,
  generateOpenAPIJson,
  type OpenAPIDocument,
  type ToOpenAPIOptions,
} from '../src/openapi.js'
import type { RpcSchema, RpcMethodSchema, RpcNamespaceSchema } from '../src/cli/types.js'
import type { ExtractedSchema, ExtractedMethod, ExtractedNamespace, ExtractedType } from '../src/extract.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createRpcSchema(overrides: Partial<RpcSchema> = {}): RpcSchema {
  return {
    version: 1,
    methods: [],
    namespaces: [],
    ...overrides,
  }
}

function createExtractedSchema(overrides: Partial<ExtractedSchema> = {}): ExtractedSchema {
  return {
    className: 'TestDO',
    methods: [],
    namespaces: [],
    types: [],
    ...overrides,
  }
}

// ============================================================================
// toOpenAPI Tests (Runtime Schema)
// ============================================================================

describe('toOpenAPI', () => {
  describe('basic conversion', () => {
    it('should generate valid OpenAPI 3.0.3 document', () => {
      const schema = createRpcSchema({
        methods: [{ name: 'ping', path: 'ping', params: 0 }],
      })

      const result = toOpenAPI(schema)

      expect(result.openapi).toBe('3.0.3')
      expect(result.info).toBeDefined()
      expect(result.info.title).toBe('RPC API')
      expect(result.info.version).toBe('1.0.0')
      expect(result.paths).toBeDefined()
    })

    it('should generate OpenAPI 3.1.0 when specified', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, { version: '3.1.0' })

      expect(result.openapi).toBe('3.1.0')
    })

    it('should use custom title and version', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        title: 'My API',
        apiVersion: '2.0.0',
      })

      expect(result.info.title).toBe('My API')
      expect(result.info.version).toBe('2.0.0')
    })

    it('should include description when provided', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        description: 'API description',
      })

      expect(result.info.description).toBe('API description')
    })

    it('should include contact information when provided', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        contact: {
          name: 'Support',
          email: 'support@example.com',
          url: 'https://example.com',
        },
      })

      expect(result.info.contact).toEqual({
        name: 'Support',
        email: 'support@example.com',
        url: 'https://example.com',
      })
    })

    it('should include license information when provided', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      })

      expect(result.info.license).toEqual({
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      })
    })
  })

  describe('server configuration', () => {
    it('should include servers when provided as strings', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        servers: ['https://api.example.com', 'https://staging.example.com'],
      })

      expect(result.servers).toHaveLength(2)
      expect(result.servers![0]).toEqual({ url: 'https://api.example.com' })
      expect(result.servers![1]).toEqual({ url: 'https://staging.example.com' })
    })

    it('should include servers when provided as objects', () => {
      const schema = createRpcSchema()
      const result = toOpenAPI(schema, {
        servers: [
          { url: 'https://api.example.com', description: 'Production' },
          { url: 'https://staging.example.com', description: 'Staging' },
        ],
      })

      expect(result.servers).toHaveLength(2)
      expect(result.servers![0]).toEqual({
        url: 'https://api.example.com',
        description: 'Production',
      })
    })
  })

  describe('method conversion', () => {
    it('should convert top-level methods to POST endpoints', () => {
      const schema = createRpcSchema({
        methods: [
          { name: 'ping', path: 'ping', params: 0 },
          { name: 'echo', path: 'echo', params: 1 },
        ],
      })

      const result = toOpenAPI(schema)

      expect(result.paths['/ping']).toBeDefined()
      expect(result.paths['/ping']!.post).toBeDefined()
      expect(result.paths['/ping']!.post!.operationId).toBe('ping')

      expect(result.paths['/echo']).toBeDefined()
      expect(result.paths['/echo']!.post).toBeDefined()
      expect(result.paths['/echo']!.post!.operationId).toBe('echo')
    })

    it('should add request body for methods with parameters', () => {
      const schema = createRpcSchema({
        methods: [{ name: 'create', path: 'create', params: 2 }],
      })

      const result = toOpenAPI(schema)

      const operation = result.paths['/create']!.post!
      expect(operation.requestBody).toBeDefined()
      expect(operation.requestBody!.required).toBe(true)
      expect(operation.requestBody!.content['application/json']).toBeDefined()
    })

    it('should not add request body for parameterless methods', () => {
      const schema = createRpcSchema({
        methods: [{ name: 'ping', path: 'ping', params: 0 }],
      })

      const result = toOpenAPI(schema)

      const operation = result.paths['/ping']!.post!
      expect(operation.requestBody).toBeUndefined()
    })

    it('should include response definitions', () => {
      const schema = createRpcSchema({
        methods: [{ name: 'get', path: 'get', params: 1 }],
      })

      const result = toOpenAPI(schema)

      const operation = result.paths['/get']!.post!
      expect(operation.responses['200']).toBeDefined()
      expect(operation.responses['200'].description).toBe('Successful response')
      expect(operation.responses['400']).toBeDefined()
      expect(operation.responses['500']).toBeDefined()
    })
  })

  describe('namespace conversion', () => {
    it('should convert namespace methods to nested paths', () => {
      const schema = createRpcSchema({
        namespaces: [
          {
            name: 'users',
            methods: [
              { name: 'get', path: 'users.get', params: 1 },
              { name: 'create', path: 'users.create', params: 1 },
            ],
          },
        ],
      })

      const result = toOpenAPI(schema)

      expect(result.paths['/users/get']).toBeDefined()
      expect(result.paths['/users/create']).toBeDefined()
    })

    it('should generate correct operationIds for namespaced methods', () => {
      const schema = createRpcSchema({
        namespaces: [
          {
            name: 'users',
            methods: [{ name: 'getById', path: 'users.getById', params: 1 }],
          },
        ],
      })

      const result = toOpenAPI(schema)

      const operation = result.paths['/users/getById']!.post!
      expect(operation.operationId).toBe('usersGetById')
    })

    it('should create tags for namespaces', () => {
      const schema = createRpcSchema({
        namespaces: [
          { name: 'users', methods: [{ name: 'list', path: 'users.list', params: 0 }] },
          { name: 'posts', methods: [{ name: 'list', path: 'posts.list', params: 0 }] },
        ],
      })

      const result = toOpenAPI(schema)

      expect(result.tags).toHaveLength(2)
      expect(result.tags!.find((t) => t.name === 'users')).toBeDefined()
      expect(result.tags!.find((t) => t.name === 'posts')).toBeDefined()
    })

    it('should assign tags to namespaced operations', () => {
      const schema = createRpcSchema({
        namespaces: [
          { name: 'users', methods: [{ name: 'get', path: 'users.get', params: 1 }] },
        ],
      })

      const result = toOpenAPI(schema)

      const operation = result.paths['/users/get']!.post!
      expect(operation.tags).toEqual(['users'])
    })
  })

  describe('base path', () => {
    it('should prepend base path to all endpoints', () => {
      const schema = createRpcSchema({
        methods: [{ name: 'ping', path: 'ping', params: 0 }],
        namespaces: [
          { name: 'users', methods: [{ name: 'get', path: 'users.get', params: 1 }] },
        ],
      })

      const result = toOpenAPI(schema, { basePath: '/api/v1' })

      expect(result.paths['/api/v1/ping']).toBeDefined()
      expect(result.paths['/api/v1/users/get']).toBeDefined()
    })
  })
})

// ============================================================================
// toOpenAPIFromExtracted Tests (Source Schema)
// ============================================================================

describe('toOpenAPIFromExtracted', () => {
  describe('basic conversion', () => {
    it('should use className as default title', () => {
      const schema = createExtractedSchema({ className: 'ChatDO' })
      const result = toOpenAPIFromExtracted(schema)

      expect(result.info.title).toBe('ChatDO')
    })

    it('should override title when provided', () => {
      const schema = createExtractedSchema({ className: 'ChatDO' })
      const result = toOpenAPIFromExtracted(schema, { title: 'Chat API' })

      expect(result.info.title).toBe('Chat API')
    })
  })

  describe('typed method conversion', () => {
    it('should convert methods with typed parameters', () => {
      const schema = createExtractedSchema({
        methods: [
          {
            name: 'createUser',
            parameters: [
              { name: 'name', type: 'string', optional: false },
              { name: 'email', type: 'string', optional: false },
              { name: 'age', type: 'number', optional: true },
            ],
            returnType: 'Promise<User>',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const operation = result.paths['/createUser']!.post!
      expect(operation.requestBody).toBeDefined()

      const requestSchema = operation.requestBody!.content['application/json'].schema
      expect(requestSchema.properties!['name']).toEqual({ type: 'string' })
      expect(requestSchema.properties!['email']).toEqual({ type: 'string' })
      expect(requestSchema.properties!['age']).toEqual({ type: 'number' })
      expect(requestSchema.required).toEqual(['name', 'email'])
    })

    it('should convert return types to response schemas', () => {
      const schema = createExtractedSchema({
        methods: [
          {
            name: 'getUser',
            parameters: [{ name: 'id', type: 'string', optional: false }],
            returnType: 'Promise<User | null>',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const operation = result.paths['/getUser']!.post!
      const responseSchema = operation.responses['200'].content!['application/json'].schema
      expect(responseSchema.$ref).toBe('#/components/schemas/User')
      expect(responseSchema.nullable).toBe(true)
    })

    it('should handle array return types', () => {
      const schema = createExtractedSchema({
        methods: [
          {
            name: 'listUsers',
            parameters: [],
            returnType: 'Promise<User[]>',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const operation = result.paths['/listUsers']!.post!
      const responseSchema = operation.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items!.$ref).toBe('#/components/schemas/User')
    })

    it('should handle primitive return types', () => {
      const schema = createExtractedSchema({
        methods: [
          { name: 'count', parameters: [], returnType: 'Promise<number>' },
          { name: 'ping', parameters: [], returnType: 'Promise<string>' },
          { name: 'isReady', parameters: [], returnType: 'Promise<boolean>' },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.paths['/count']!.post!.responses['200'].content!['application/json'].schema.type).toBe('number')
      expect(result.paths['/ping']!.post!.responses['200'].content!['application/json'].schema.type).toBe('string')
      expect(result.paths['/isReady']!.post!.responses['200'].content!['application/json'].schema.type).toBe('boolean')
    })

    it('should handle void return type', () => {
      const schema = createExtractedSchema({
        methods: [
          { name: 'delete', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<void>' },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const responseSchema = result.paths['/delete']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.description).toBe('No return value')
    })
  })

  describe('namespace conversion', () => {
    it('should convert namespaces with typed methods', () => {
      const schema = createExtractedSchema({
        namespaces: [
          {
            name: 'users',
            methods: [
              {
                name: 'get',
                parameters: [{ name: 'id', type: 'string', optional: false }],
                returnType: 'Promise<User>',
              },
            ],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.paths['/users/get']).toBeDefined()
      const operation = result.paths['/users/get']!.post!
      expect(operation.tags).toEqual(['users'])
    })

    it('should include namespace typeName in tag description', () => {
      const schema = createExtractedSchema({
        namespaces: [
          {
            name: 'products',
            typeName: 'Collection<Product>',
            methods: [
              { name: 'get', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<Product>' },
            ],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const tag = result.tags!.find((t) => t.name === 'products')
      expect(tag?.description).toContain('Collection<Product>')
    })

    it('should handle nested namespaces', () => {
      const schema = createExtractedSchema({
        namespaces: [
          {
            name: 'api',
            methods: [],
            nestedNamespaces: [
              {
                name: 'users',
                methods: [
                  { name: 'get', parameters: [], returnType: 'Promise<User>' },
                ],
              },
            ],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.paths['/api/users/get']).toBeDefined()
      expect(result.tags!.find((t) => t.name === 'api.users')).toBeDefined()
    })
  })

  describe('type extraction', () => {
    it('should add extracted types to components/schemas', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'User',
            declaration: 'interface User { id: string; name: string; email: string }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.components).toBeDefined()
      expect(result.components!.schemas).toBeDefined()
      expect(result.components!.schemas!['User']).toBeDefined()
      expect(result.components!.schemas!['User'].type).toBe('object')
      expect(result.components!.schemas!['User'].properties!['id']).toEqual({ type: 'string' })
      expect(result.components!.schemas!['User'].properties!['name']).toEqual({ type: 'string' })
    })

    it('should handle optional properties in interfaces', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Config',
            declaration: 'interface Config { host: string; port?: number }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const configSchema = result.components!.schemas!['Config']
      expect(configSchema.required).toEqual(['host'])
      expect(configSchema.properties!['port']).toEqual({ type: 'number' })
    })

    it('should convert enum types', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Status',
            declaration: 'enum Status { Active, Inactive, Pending }',
            kind: 'enum',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      const statusSchema = result.components!.schemas!['Status']
      expect(statusSchema.enum).toBeDefined()
    })

    it('should not include components when no types are extracted', () => {
      const schema = createExtractedSchema({ types: [] })
      const result = toOpenAPIFromExtracted(schema)

      expect(result.components).toBeUndefined()
    })
  })
})

// ============================================================================
// generateOpenAPIJson Tests
// ============================================================================

describe('generateOpenAPIJson', () => {
  it('should generate pretty JSON by default', () => {
    const schema = createRpcSchema({
      methods: [{ name: 'ping', path: 'ping', params: 0 }],
    })

    const result = generateOpenAPIJson(schema)

    expect(result).toContain('\n')
    expect(result).toContain('  ')
  })

  it('should generate compact JSON when pretty is false', () => {
    const schema = createRpcSchema({
      methods: [{ name: 'ping', path: 'ping', params: 0 }],
    })

    const result = generateOpenAPIJson(schema, { pretty: false })

    expect(result).not.toContain('\n')
    expect(result).not.toContain('  ')
  })

  it('should detect RpcSchema vs ExtractedSchema', () => {
    const rpcSchema = createRpcSchema({
      methods: [{ name: 'ping', path: 'ping', params: 0 }],
    })

    const extractedSchema = createExtractedSchema({
      className: 'TestDO',
      methods: [{ name: 'ping', parameters: [], returnType: 'Promise<string>' }],
    })

    const rpcResult = JSON.parse(generateOpenAPIJson(rpcSchema))
    const extractedResult = JSON.parse(generateOpenAPIJson(extractedSchema))

    expect(rpcResult.info.title).toBe('RPC API')
    expect(extractedResult.info.title).toBe('TestDO')
  })

  it('should pass through options', () => {
    const schema = createRpcSchema()
    const result = JSON.parse(
      generateOpenAPIJson(schema, {
        title: 'Custom Title',
        version: '3.1.0',
        apiVersion: '2.0.0',
      })
    )

    expect(result.openapi).toBe('3.1.0')
    expect(result.info.title).toBe('Custom Title')
    expect(result.info.version).toBe('2.0.0')
  })
})

// ============================================================================
// Type Conversion Tests (typeToSchema)
// ============================================================================

describe('type conversion (typeToSchema)', () => {
  describe('primitive types', () => {
    it('should convert string type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'string', optional: false }], returnType: 'Promise<string>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({ type: 'string' })
    })

    it('should convert number type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'number', optional: false }], returnType: 'Promise<number>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({ type: 'number' })
    })

    it('should convert boolean type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'boolean', optional: false }], returnType: 'Promise<boolean>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({ type: 'boolean' })
    })

    it('should convert void type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'void' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.description).toBe('No return value')
    })

    it('should convert undefined type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'undefined' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.description).toBe('No return value')
    })

    it('should convert any type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'any', optional: false }], returnType: 'Promise<any>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({
        type: 'object',
        description: 'Any value',
      })
    })

    it('should convert unknown type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'unknown', optional: false }], returnType: 'Promise<unknown>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({
        type: 'object',
        description: 'Any value',
      })
    })

    it('should convert object type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: 'object', optional: false }], returnType: 'Promise<object>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({ type: 'object' })
    })

    it('should convert null type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'null' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.nullable).toBe(true)
    })

    it('should handle lowercase type case-insensitively', () => {
      const schema = createExtractedSchema({
        methods: [
          { name: 'test1', parameters: [], returnType: 'STRING' },
          { name: 'test2', parameters: [], returnType: 'Number' },
          { name: 'test3', parameters: [], returnType: 'BOOLEAN' },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      expect(result.paths['/test1']!.post!.responses['200'].content!['application/json'].schema.type).toBe('string')
      expect(result.paths['/test2']!.post!.responses['200'].content!['application/json'].schema.type).toBe('number')
      expect(result.paths['/test3']!.post!.responses['200'].content!['application/json'].schema.type).toBe('boolean')
    })
  })

  describe('Promise types', () => {
    it('should unwrap Promise<T>', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<string>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('string')
    })

    it('should unwrap nested Promise<Array<T>>', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Array<User>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items!.$ref).toBe('#/components/schemas/User')
    })
  })

  describe('array types', () => {
    it('should convert T[] syntax', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<string[]>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items).toEqual({ type: 'string' })
    })

    it('should convert Array<T> syntax', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Array<number>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items).toEqual({ type: 'number' })
    })

    it('should convert nested array types', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<string[][]>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items!.type).toBe('array')
      expect(responseSchema.items!.items).toEqual({ type: 'string' })
    })

    it('should convert Array<CustomType>', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Array<CustomType>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items!.$ref).toBe('#/components/schemas/CustomType')
    })
  })

  describe('nullable types', () => {
    it('should convert T | null to nullable', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<string | null>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('string')
      expect(responseSchema.nullable).toBe(true)
    })

    it('should convert CustomType | null to nullable ref', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<User | null>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.$ref).toBe('#/components/schemas/User')
      expect(responseSchema.nullable).toBe(true)
    })

    it('should handle array with nullable', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<string[] | null>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items).toEqual({ type: 'string' })
      expect(responseSchema.nullable).toBe(true)
    })
  })

  describe('object types', () => {
    it('should convert Record<K, V> to object with additionalProperties', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Record<string, number>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.additionalProperties).toEqual({ type: 'number' })
    })

    it('should convert Map<K, V> to object with additionalProperties', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Map<string, boolean>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.additionalProperties).toEqual({ type: 'boolean' })
    })

    it('should convert Record with complex value type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Record<string, User>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.additionalProperties).toEqual({ $ref: '#/components/schemas/User' })
    })

    it('should convert Map with array value type', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Map<string, string[]>>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.additionalProperties).toEqual({ type: 'array', items: { type: 'string' } })
    })
  })

  describe('Date type', () => {
    it('should convert Date to string with date-time format', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Date>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('string')
      expect(responseSchema.format).toBe('date-time')
    })

    it('should convert Date[] to array of date-time strings', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<Date[]>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('array')
      expect(responseSchema.items).toEqual({ type: 'string', format: 'date-time' })
    })
  })

  describe('custom types', () => {
    it('should create $ref for PascalCase types', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<CustomType>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.$ref).toBe('#/components/schemas/CustomType')
    })

    it('should handle lowercase custom types as generic object', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [], returnType: 'Promise<someCustomType>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.paths['/test']!.post!.responses['200'].content!['application/json'].schema
      expect(responseSchema.type).toBe('object')
      expect(responseSchema.description).toBe('Type: someCustomType')
    })
  })

  describe('whitespace handling', () => {
    it('should trim whitespace from type strings', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'test', parameters: [{ name: 'val', type: '  string  ', optional: false }], returnType: 'Promise<string>' }],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/test']!.post!
      expect(operation.requestBody!.content['application/json'].schema.properties!['val']).toEqual({ type: 'string' })
    })
  })
})

// ============================================================================
// typesToComponents Tests
// ============================================================================

describe('typesToComponents', () => {
  describe('interface parsing', () => {
    it('should parse simple interface with required properties', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'User',
            declaration: 'interface User { id: string; name: string; age: number }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const userSchema = result.components!.schemas!['User']

      expect(userSchema.type).toBe('object')
      expect(userSchema.properties!['id']).toEqual({ type: 'string' })
      expect(userSchema.properties!['name']).toEqual({ type: 'string' })
      expect(userSchema.properties!['age']).toEqual({ type: 'number' })
      expect(userSchema.required).toEqual(['id', 'name', 'age'])
    })

    it('should parse interface with optional properties', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Config',
            declaration: 'interface Config { host: string; port?: number; timeout?: number }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const configSchema = result.components!.schemas!['Config']

      expect(configSchema.required).toEqual(['host'])
      expect(configSchema.properties!['port']).toEqual({ type: 'number' })
      expect(configSchema.properties!['timeout']).toEqual({ type: 'number' })
    })

    it('should parse interface with mixed required and optional properties', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Product',
            declaration: 'interface Product { id: string; name: string; description?: string; price: number; discount?: number }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const productSchema = result.components!.schemas!['Product']

      expect(productSchema.required).toEqual(['id', 'name', 'price'])
      expect(Object.keys(productSchema.properties!)).toHaveLength(5)
    })

    it('should parse interface with array properties', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Post',
            declaration: 'interface Post { id: string; tags: string[]; comments: Comment[] }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const postSchema = result.components!.schemas!['Post']

      expect(postSchema.properties!['tags']).toEqual({ type: 'array', items: { type: 'string' } })
      expect(postSchema.properties!['comments']).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Comment' } })
    })

    it('should parse interface with complex nested types', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Response',
            declaration: 'interface Response { data: Record<string, number>; users: Map<string, User> }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const responseSchema = result.components!.schemas!['Response']

      expect(responseSchema.properties!['data']).toEqual({ type: 'object', additionalProperties: { type: 'number' } })
      expect(responseSchema.properties!['users']).toEqual({ type: 'object', additionalProperties: { $ref: '#/components/schemas/User' } })
    })

    it('should parse multiline interface', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'MultilineUser',
            declaration: `interface MultilineUser {
              id: string
              name: string
              email: string
            }`,
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const userSchema = result.components!.schemas!['MultilineUser']

      expect(userSchema.type).toBe('object')
      expect(userSchema.properties!['id']).toEqual({ type: 'string' })
      expect(userSchema.properties!['name']).toEqual({ type: 'string' })
      expect(userSchema.properties!['email']).toEqual({ type: 'string' })
    })

    it('should handle empty interface', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Empty',
            declaration: 'interface Empty { }',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const emptySchema = result.components!.schemas!['Empty']

      expect(emptySchema.type).toBe('object')
      expect(emptySchema.properties).toEqual({})
      expect(emptySchema.required).toBeUndefined()
    })

    it('should handle interface without braces', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'NoBraces',
            declaration: 'interface NoBraces extends Base',
            kind: 'interface',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const noBracesSchema = result.components!.schemas!['NoBraces']

      expect(noBracesSchema.type).toBe('object')
    })
  })

  describe('type alias parsing', () => {
    it('should parse type alias with object structure', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Point',
            declaration: 'type Point = { x: number; y: number }',
            kind: 'type',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const pointSchema = result.components!.schemas!['Point']

      expect(pointSchema.type).toBe('object')
      expect(pointSchema.properties!['x']).toEqual({ type: 'number' })
      expect(pointSchema.properties!['y']).toEqual({ type: 'number' })
    })

    it('should parse type alias with optional properties', () => {
      const schema = createExtractedSchema({
        types: [
          {
            name: 'Options',
            declaration: 'type Options = { debug?: boolean; verbose?: boolean }',
            kind: 'type',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const optionsSchema = result.components!.schemas!['Options']

      expect(optionsSchema.properties!['debug']).toEqual({ type: 'boolean' })
      expect(optionsSchema.properties!['verbose']).toEqual({ type: 'boolean' })
      expect(optionsSchema.required).toBeUndefined()
    })
  })
})

// ============================================================================
// parseEnumDeclaration Tests
// ============================================================================

describe('parseEnumDeclaration', () => {
  it('should parse string enum without explicit values', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'Status',
          declaration: 'enum Status { Active, Inactive, Pending }',
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const statusSchema = result.components!.schemas!['Status']

    expect(statusSchema.type).toBe('string')
    expect(statusSchema.enum).toEqual(['Active', 'Inactive', 'Pending'])
  })

  it('should parse enum with string values', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'Color',
          declaration: `enum Color { Red = 'red', Green = 'green', Blue = 'blue' }`,
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const colorSchema = result.components!.schemas!['Color']

    expect(colorSchema.type).toBe('string')
    expect(colorSchema.enum).toEqual(['red', 'green', 'blue'])
  })

  it('should parse enum with numeric values', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'Priority',
          declaration: 'enum Priority { Low = 1, Medium = 2, High = 3 }',
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const prioritySchema = result.components!.schemas!['Priority']

    expect(prioritySchema.type).toBe('integer')
    expect(prioritySchema.enum).toEqual([1, 2, 3])
  })

  it('should parse enum with quoted string values', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'Direction',
          declaration: `enum Direction { Up = "UP", Down = "DOWN" }`,
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const directionSchema = result.components!.schemas!['Direction']

    expect(directionSchema.type).toBe('string')
    expect(directionSchema.enum).toEqual(['UP', 'DOWN'])
  })

  it('should handle empty enum', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'Empty',
          declaration: 'enum Empty { }',
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const emptySchema = result.components!.schemas!['Empty']

    expect(emptySchema.enum).toEqual([])
  })

  it('should handle enum without braces', () => {
    const schema = createExtractedSchema({
      types: [
        {
          name: 'NoBraces',
          declaration: 'enum NoBraces',
          kind: 'enum',
        },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)
    const noBracesSchema = result.components!.schemas!['NoBraces']

    expect(noBracesSchema.type).toBe('string')
  })
})

// ============================================================================
// CLI Command Tests
// ============================================================================

describe('CLI openapi command', () => {
  const mockWriteFileSync = vi.fn()
  const mockFetch = vi.fn()
  const mockExtractTypes = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mock('node:fs', () => ({
      writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should parse --source flag', async () => {
    const { parseOpenAPIArgs } = await import('../src/cli/openapi.js')
    const args = parseOpenAPIArgs(['--source', './MyDO.ts'])
    expect(args.source).toBe('./MyDO.ts')
  })

  it('should parse --url flag', async () => {
    const { parseOpenAPIArgs } = await import('../src/cli/openapi.js')
    const args = parseOpenAPIArgs(['--url', 'https://example.com'])
    expect(args.url).toBe('https://example.com')
  })

  it('should parse --output flag', async () => {
    const { parseOpenAPIArgs } = await import('../src/cli/openapi.js')
    const args = parseOpenAPIArgs(['--output', 'api.json'])
    expect(args.output).toBe('api.json')
  })

  it('should parse -o shorthand for output', async () => {
    const { parseOpenAPIArgs } = await import('../src/cli/openapi.js')
    const args = parseOpenAPIArgs(['-o', 'api.json'])
    expect(args.output).toBe('api.json')
  })

  it('should parse all options together', async () => {
    const { parseOpenAPIArgs } = await import('../src/cli/openapi.js')
    const args = parseOpenAPIArgs([
      '--source', './MyDO.ts',
      '--output', 'openapi.json',
      '--title', 'My API',
      '--version', '2.0.0',
      '--server', 'https://api.example.com',
      '--format', '3.1',
    ])

    expect(args.source).toBe('./MyDO.ts')
    expect(args.output).toBe('openapi.json')
    expect(args.title).toBe('My API')
    expect(args.version).toBe('2.0.0')
    expect(args.server).toBe('https://api.example.com')
    expect(args.format).toBe('3.1')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle empty schema', () => {
    const schema = createRpcSchema()
    const result = toOpenAPI(schema)

    expect(result.paths).toEqual({})
    expect(result.tags).toBeUndefined()
  })

  it('should handle schema with only namespaces (no top-level methods)', () => {
    const schema = createRpcSchema({
      namespaces: [
        { name: 'api', methods: [{ name: 'health', path: 'api.health', params: 0 }] },
      ],
    })

    const result = toOpenAPI(schema)

    expect(result.paths['/api/health']).toBeDefined()
    expect(result.tags).toHaveLength(1)
  })

  it('should handle deeply nested paths', () => {
    const schema = createRpcSchema({
      methods: [
        { name: 'action', path: 'api.v1.users.actions.perform', params: 1 },
      ],
    })

    const result = toOpenAPI(schema)

    expect(result.paths['/api/v1/users/actions/perform']).toBeDefined()
  })

  it('should handle special characters in method names', () => {
    const schema = createExtractedSchema({
      methods: [
        { name: 'get_user', parameters: [], returnType: 'Promise<User>' },
      ],
    })

    const result = toOpenAPIFromExtracted(schema)

    expect(result.paths['/get_user']).toBeDefined()
    expect(result.paths['/get_user']!.post!.operationId).toBe('get_user')
  })

  it('should handle empty servers array', () => {
    const schema = createRpcSchema()
    const result = toOpenAPI(schema, { servers: [] })

    expect(result.servers).toBeUndefined()
  })

  it('should handle methods with many parameters', () => {
    const schema = createRpcSchema({
      methods: [{ name: 'create', path: 'create', params: 10 }],
    })

    const result = toOpenAPI(schema)
    const operation = result.paths['/create']!.post!

    expect(operation.requestBody!.content['application/json'].schema.description).toBe('Arguments for create (10 parameters)')
  })

  it('should handle single parameter method', () => {
    const schema = createRpcSchema({
      methods: [{ name: 'get', path: 'get', params: 1 }],
    })

    const result = toOpenAPI(schema)
    const operation = result.paths['/get']!.post!

    expect(operation.requestBody!.content['application/json'].schema.description).toBe('Arguments for get (1 parameter)')
  })
})

// ============================================================================
// toOpenAPIFromExtracted - Additional Tests
// ============================================================================

describe('toOpenAPIFromExtracted - additional tests', () => {
  describe('methods without parameters', () => {
    it('should not add requestBody for parameterless methods', () => {
      const schema = createExtractedSchema({
        methods: [
          { name: 'ping', parameters: [], returnType: 'Promise<string>' },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/ping']!.post!

      expect(operation.requestBody).toBeUndefined()
    })
  })

  describe('methods with all optional parameters', () => {
    it('should set requestBody.required to false when all params optional', () => {
      const schema = createExtractedSchema({
        methods: [
          {
            name: 'search',
            parameters: [
              { name: 'query', type: 'string', optional: true },
              { name: 'limit', type: 'number', optional: true },
            ],
            returnType: 'Promise<string[]>',
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const operation = result.paths['/search']!.post!

      expect(operation.requestBody!.required).toBe(false)
      expect(operation.requestBody!.content['application/json'].schema.required).toBeUndefined()
    })
  })

  describe('namespace without typeName', () => {
    it('should create tag description without type info', () => {
      const schema = createExtractedSchema({
        namespaces: [
          {
            name: 'users',
            methods: [{ name: 'list', parameters: [], returnType: 'Promise<User[]>' }],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)
      const tag = result.tags!.find((t) => t.name === 'users')

      expect(tag?.description).toBe('Operations for users')
    })
  })

  describe('deeply nested namespaces', () => {
    it('should process multiple levels of nested namespaces', () => {
      const schema = createExtractedSchema({
        namespaces: [
          {
            name: 'api',
            methods: [{ name: 'version', parameters: [], returnType: 'Promise<string>' }],
            nestedNamespaces: [
              {
                name: 'v1',
                methods: [{ name: 'health', parameters: [], returnType: 'Promise<boolean>' }],
                nestedNamespaces: [
                  {
                    name: 'users',
                    methods: [
                      { name: 'list', parameters: [], returnType: 'Promise<User[]>' },
                      { name: 'get', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<User>' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.paths['/api/version']).toBeDefined()
      expect(result.paths['/api/v1/health']).toBeDefined()
      expect(result.paths['/api/v1/users/list']).toBeDefined()
      expect(result.paths['/api/v1/users/get']).toBeDefined()

      expect(result.tags!.find((t) => t.name === 'api')).toBeDefined()
      expect(result.tags!.find((t) => t.name === 'api.v1')).toBeDefined()
      expect(result.tags!.find((t) => t.name === 'api.v1.users')).toBeDefined()

      const getUserOp = result.paths['/api/v1/users/get']!.post!
      expect(getUserOp.operationId).toBe('apiV1UsersGet')
      expect(getUserOp.tags).toEqual(['api.v1.users'])
    })
  })

  describe('multiple types in schema', () => {
    it('should process multiple interfaces, types, and enums', () => {
      const schema = createExtractedSchema({
        types: [
          { name: 'User', declaration: 'interface User { id: string; name: string }', kind: 'interface' },
          { name: 'Product', declaration: 'interface Product { sku: string; price: number }', kind: 'interface' },
          { name: 'Status', declaration: 'enum Status { Active, Inactive }', kind: 'enum' },
          { name: 'Config', declaration: 'type Config = { debug: boolean }', kind: 'type' },
        ],
      })

      const result = toOpenAPIFromExtracted(schema)

      expect(result.components!.schemas!['User']).toBeDefined()
      expect(result.components!.schemas!['Product']).toBeDefined()
      expect(result.components!.schemas!['Status']).toBeDefined()
      expect(result.components!.schemas!['Config']).toBeDefined()
    })
  })

  describe('options propagation', () => {
    it('should propagate all options correctly', () => {
      const schema = createExtractedSchema({ className: 'TestDO' })
      const result = toOpenAPIFromExtracted(schema, {
        version: '3.1.0',
        title: 'Custom Title',
        description: 'Custom description',
        apiVersion: '2.0.0',
        servers: ['https://api.example.com'],
        contact: { name: 'Support', email: 'support@test.com' },
        license: { name: 'MIT' },
        basePath: '/api',
      })

      expect(result.openapi).toBe('3.1.0')
      expect(result.info.title).toBe('Custom Title')
      expect(result.info.description).toBe('Custom description')
      expect(result.info.version).toBe('2.0.0')
      expect(result.servers![0].url).toBe('https://api.example.com')
      expect(result.info.contact).toEqual({ name: 'Support', email: 'support@test.com' })
      expect(result.info.license).toEqual({ name: 'MIT' })
    })

    it('should apply basePath to extracted schema endpoints', () => {
      const schema = createExtractedSchema({
        methods: [{ name: 'ping', parameters: [], returnType: 'Promise<string>' }],
        namespaces: [
          {
            name: 'users',
            methods: [{ name: 'get', parameters: [], returnType: 'Promise<User>' }],
          },
        ],
      })

      const result = toOpenAPIFromExtracted(schema, { basePath: '/rpc' })

      expect(result.paths['/rpc/ping']).toBeDefined()
      expect(result.paths['/rpc/users/get']).toBeDefined()
    })

    it('should handle servers as objects in toOpenAPIFromExtracted', () => {
      const schema = createExtractedSchema({ className: 'TestDO' })
      const result = toOpenAPIFromExtracted(schema, {
        servers: [
          { url: 'https://api.example.com', description: 'Production' },
          { url: 'https://staging.example.com', description: 'Staging' },
        ],
      })

      expect(result.servers).toHaveLength(2)
      expect(result.servers![0]).toEqual({ url: 'https://api.example.com', description: 'Production' })
      expect(result.servers![1]).toEqual({ url: 'https://staging.example.com', description: 'Staging' })
    })

    it('should handle servers as strings in toOpenAPIFromExtracted', () => {
      const schema = createExtractedSchema({ className: 'TestDO' })
      const result = toOpenAPIFromExtracted(schema, {
        servers: ['https://api.example.com', 'https://staging.example.com'],
      })

      expect(result.servers).toHaveLength(2)
      expect(result.servers![0]).toEqual({ url: 'https://api.example.com' })
      expect(result.servers![1]).toEqual({ url: 'https://staging.example.com' })
    })

    it('should handle empty servers array in toOpenAPIFromExtracted', () => {
      const schema = createExtractedSchema({ className: 'TestDO' })
      const result = toOpenAPIFromExtracted(schema, { servers: [] })

      expect(result.servers).toBeUndefined()
    })
  })
})

// ============================================================================
// generateOpenAPIJson - Additional Tests
// ============================================================================

describe('generateOpenAPIJson - additional tests', () => {
  it('should handle ExtractedSchema with all features', () => {
    const schema = createExtractedSchema({
      className: 'FullDO',
      methods: [
        {
          name: 'process',
          parameters: [{ name: 'input', type: 'string', optional: false }],
          returnType: 'Promise<Result>',
        },
      ],
      namespaces: [
        {
          name: 'data',
          methods: [{ name: 'fetch', parameters: [], returnType: 'Promise<Data[]>' }],
        },
      ],
      types: [
        { name: 'Result', declaration: 'interface Result { success: boolean }', kind: 'interface' },
        { name: 'Data', declaration: 'type Data = { value: number }', kind: 'type' },
      ],
    })

    const result = JSON.parse(generateOpenAPIJson(schema))

    expect(result.info.title).toBe('FullDO')
    expect(result.paths['/process']).toBeDefined()
    expect(result.paths['/data/fetch']).toBeDefined()
    expect(result.components.schemas['Result']).toBeDefined()
    expect(result.components.schemas['Data']).toBeDefined()
  })

  it('should produce valid JSON for complex schemas', () => {
    const schema = createExtractedSchema({
      className: 'ComplexDO',
      methods: [
        {
          name: 'complexMethod',
          parameters: [
            { name: 'data', type: 'Record<string, User[]>', optional: false },
            { name: 'options', type: 'Options | null', optional: true },
          ],
          returnType: 'Promise<Map<string, Result>>',
        },
      ],
      types: [
        { name: 'User', declaration: 'interface User { id: string }', kind: 'interface' },
        { name: 'Options', declaration: 'interface Options { debug?: boolean }', kind: 'interface' },
        { name: 'Result', declaration: 'interface Result { data: any }', kind: 'interface' },
      ],
    })

    const json = generateOpenAPIJson(schema)
    const parsed = JSON.parse(json)

    expect(parsed.openapi).toBe('3.0.3')
    expect(parsed.paths['/complexMethod']).toBeDefined()
  })
})
