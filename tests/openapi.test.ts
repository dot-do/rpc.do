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
// Type Conversion Tests
// ============================================================================

describe('type conversion', () => {
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
})
