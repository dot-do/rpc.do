/**
 * OpenAPI Schema Export
 *
 * Converts rpc.do schema format to OpenAPI 3.0/3.1 specification.
 * Enables integration with OpenAPI tools (Swagger UI, code generators, etc.)
 *
 * @example Programmatic usage
 * ```typescript
 * import { toOpenAPI } from 'rpc.do/openapi'
 * import { extractTypes } from 'rpc.do/extract'
 *
 * const schemas = await extractTypes('./src/MyDO.ts')
 * const openApiSpec = toOpenAPI(schemas[0])
 * console.log(JSON.stringify(openApiSpec, null, 2))
 * ```
 *
 * @example CLI usage
 * ```bash
 * npx rpc.do openapi --source ./MyDO.ts --output openapi.json
 * ```
 */

import type { RpcSchema, RpcMethodSchema, RpcNamespaceSchema } from './cli/types.js'
import type { ExtractedSchema, ExtractedMethod, ExtractedNamespace, ExtractedType } from './extract.js'

// ============================================================================
// OpenAPI Types
// ============================================================================

/**
 * OpenAPI 3.0/3.1 Document structure
 */
export interface OpenAPIDocument {
  openapi: '3.0.3' | '3.1.0'
  info: OpenAPIInfo
  servers?: OpenAPIServer[]
  paths: Record<string, OpenAPIPathItem>
  components?: OpenAPIComponents
  tags?: OpenAPITag[]
}

export interface OpenAPIInfo {
  title: string
  description?: string
  version: string
  contact?: {
    name?: string
    url?: string
    email?: string
  }
  license?: {
    name: string
    url?: string
  }
}

export interface OpenAPIServer {
  url: string
  description?: string
}

export interface OpenAPIPathItem {
  post?: OpenAPIOperation
  summary?: string
  description?: string
}

export interface OpenAPIOperation {
  operationId: string
  summary?: string
  description?: string
  tags?: string[]
  requestBody?: OpenAPIRequestBody
  responses: Record<string, OpenAPIResponse>
  parameters?: OpenAPIParameter[]
}

export interface OpenAPIRequestBody {
  description?: string
  required?: boolean
  content: Record<string, OpenAPIMediaType>
}

export interface OpenAPIResponse {
  description: string
  content?: Record<string, OpenAPIMediaType>
}

export interface OpenAPIMediaType {
  schema: OpenAPISchema
}

export interface OpenAPISchema {
  type?: string
  format?: string
  description?: string
  properties?: Record<string, OpenAPISchema>
  items?: OpenAPISchema
  required?: string[]
  $ref?: string
  allOf?: OpenAPISchema[]
  oneOf?: OpenAPISchema[]
  anyOf?: OpenAPISchema[]
  additionalProperties?: boolean | OpenAPISchema
  nullable?: boolean
  enum?: (string | number | boolean | null)[]
  default?: unknown
  example?: unknown
}

export interface OpenAPIParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  schema: OpenAPISchema
}

export interface OpenAPIComponents {
  schemas?: Record<string, OpenAPISchema>
  responses?: Record<string, OpenAPIResponse>
  parameters?: Record<string, OpenAPIParameter>
  requestBodies?: Record<string, OpenAPIRequestBody>
}

export interface OpenAPITag {
  name: string
  description?: string
}

// ============================================================================
// Conversion Options
// ============================================================================

/**
 * Options for OpenAPI conversion
 */
export interface ToOpenAPIOptions {
  /** OpenAPI version to generate (default: '3.0.3') */
  version?: '3.0.3' | '3.1.0'
  /** API title (default: schema className or 'RPC API') */
  title?: string
  /** API description */
  description?: string
  /** API version string (default: '1.0.0') */
  apiVersion?: string
  /** Server URL(s) to include */
  servers?: string[] | OpenAPIServer[]
  /** Contact information */
  contact?: OpenAPIInfo['contact']
  /** License information */
  license?: OpenAPIInfo['license']
  /** Base path prefix for all endpoints (default: '') */
  basePath?: string
}

// ============================================================================
// Type Conversion Helpers
// ============================================================================

/**
 * Convert TypeScript type string to OpenAPI schema
 */
function typeToSchema(typeStr: string): OpenAPISchema {
  // Clean up the type string
  const cleanType = typeStr.trim()

  // Handle Promise<T>
  const promiseMatch = cleanType.match(/^Promise<(.+)>$/i)
  if (promiseMatch) {
    return typeToSchema(promiseMatch[1]!)
  }

  // Handle arrays
  const arrayMatch = cleanType.match(/^(.+)\[\]$/)
  if (arrayMatch) {
    return {
      type: 'array',
      items: typeToSchema(arrayMatch[1]!),
    }
  }

  // Handle Array<T>
  const arrayGenericMatch = cleanType.match(/^Array<(.+)>$/i)
  if (arrayGenericMatch) {
    return {
      type: 'array',
      items: typeToSchema(arrayGenericMatch[1]!),
    }
  }

  // Handle union types with null (nullable)
  const nullableMatch = cleanType.match(/^(.+)\s*\|\s*null$/)
  if (nullableMatch) {
    const schema = typeToSchema(nullableMatch[1]!)
    return { ...schema, nullable: true }
  }

  // Handle Record<K, V>
  const recordMatch = cleanType.match(/^Record<(.+),\s*(.+)>$/i)
  if (recordMatch) {
    return {
      type: 'object',
      additionalProperties: typeToSchema(recordMatch[2]!),
    }
  }

  // Handle Map<K, V>
  const mapMatch = cleanType.match(/^Map<(.+),\s*(.+)>$/i)
  if (mapMatch) {
    return {
      type: 'object',
      additionalProperties: typeToSchema(mapMatch[2]!),
    }
  }

  // Handle basic types
  switch (cleanType.toLowerCase()) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'void':
    case 'undefined':
      return { type: 'object', description: 'No return value' }
    case 'any':
    case 'unknown':
      return { type: 'object', description: 'Any value' }
    case 'object':
      return { type: 'object' }
    case 'date':
      return { type: 'string', format: 'date-time' }
    case 'null':
      return { type: 'object', nullable: true }
    default:
      // Assume it's a custom type - create a reference
      if (/^[A-Z]/.test(cleanType)) {
        return { $ref: `#/components/schemas/${cleanType}` }
      }
      return { type: 'object', description: `Type: ${cleanType}` }
  }
}

/**
 * Convert extracted TypeScript types to OpenAPI component schemas
 */
function typesToComponents(types: ExtractedType[]): Record<string, OpenAPISchema> {
  const schemas: Record<string, OpenAPISchema> = {}

  for (const type of types) {
    // Parse interface/type declarations
    if (type.kind === 'interface' || type.kind === 'type') {
      schemas[type.name] = parseTypeDeclaration(type.declaration)
    } else if (type.kind === 'enum') {
      schemas[type.name] = parseEnumDeclaration(type.declaration)
    }
  }

  return schemas
}

/**
 * Parse a TypeScript interface/type declaration to OpenAPI schema
 */
function parseTypeDeclaration(declaration: string): OpenAPISchema {
  // Basic parsing - extract properties from interface
  const propsMatch = declaration.match(/\{([^}]+)\}/)
  if (!propsMatch) {
    return { type: 'object' }
  }

  const propsStr = propsMatch[1]!
  const properties: Record<string, OpenAPISchema> = {}
  const required: string[] = []

  // Parse each property line
  const lines = propsStr.split(/[;\n]/).filter((l) => l.trim())
  for (const line of lines) {
    const propMatch = line.trim().match(/^(\w+)(\?)?\s*:\s*(.+)$/)
    if (propMatch) {
      const [, propName, optional, propType] = propMatch
      if (propName && propType) {
        properties[propName] = typeToSchema(propType.trim())
        if (!optional) {
          required.push(propName)
        }
      }
    }
  }

  const schema: OpenAPISchema = {
    type: 'object',
    properties,
  }
  if (required.length > 0) {
    schema.required = required
  }
  return schema
}

/**
 * Parse a TypeScript enum declaration to OpenAPI schema
 */
function parseEnumDeclaration(declaration: string): OpenAPISchema {
  // Extract enum values
  const bodyMatch = declaration.match(/\{([^}]+)\}/)
  if (!bodyMatch) {
    return { type: 'string' }
  }

  const values: (string | number)[] = []
  const members = bodyMatch[1]!.split(',').filter((m) => m.trim())

  for (const member of members) {
    const match = member.trim().match(/^(\w+)(?:\s*=\s*(.+))?$/)
    if (match) {
      const [, name, value] = match
      if (value !== undefined) {
        // Try to parse as number or string
        const trimmedValue = value.trim().replace(/^['"]|['"]$/g, '')
        const numValue = Number(trimmedValue)
        values.push(isNaN(numValue) ? trimmedValue : numValue)
      } else if (name) {
        values.push(name)
      }
    }
  }

  return {
    type: typeof values[0] === 'number' ? 'integer' : 'string',
    enum: values,
  }
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert a method path to an OpenAPI path
 * e.g., "users.create" -> "/users/create"
 */
function methodPathToEndpoint(methodPath: string, basePath: string = ''): string {
  const path = '/' + methodPath.replace(/\./g, '/')
  return basePath ? basePath + path : path
}

/**
 * Convert a method path to a valid operationId
 * e.g., "users.create" -> "usersCreate"
 */
function methodPathToOperationId(methodPath: string): string {
  return methodPath
    .split('.')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/**
 * Create an OpenAPI operation from an RPC method schema
 */
function createOperation(method: RpcMethodSchema, tag?: string): OpenAPIOperation {
  const operation: OpenAPIOperation = {
    operationId: methodPathToOperationId(method.path),
    summary: `Call ${method.name}`,
    responses: {
      '200': {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: { type: 'object', description: 'RPC response' },
          },
        },
      },
      '400': {
        description: 'Invalid request',
      },
      '500': {
        description: 'Server error',
      },
    },
  }

  if (tag) {
    operation.tags = [tag]
  }

  // Add request body for methods with parameters
  if (method.params > 0) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: `Arguments for ${method.name} (${method.params} parameter${method.params > 1 ? 's' : ''})`,
          },
        },
      },
    }
  }

  return operation
}

/**
 * Create an OpenAPI operation from an extracted method with full type info
 */
function createTypedOperation(method: ExtractedMethod, namespace?: string): OpenAPIOperation {
  const operationId = namespace
    ? methodPathToOperationId(`${namespace}.${method.name}`)
    : methodPathToOperationId(method.name)

  const operation: OpenAPIOperation = {
    operationId,
    summary: `Call ${method.name}`,
    responses: {
      '200': {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: typeToSchema(method.returnType),
          },
        },
      },
      '400': {
        description: 'Invalid request',
      },
      '500': {
        description: 'Server error',
      },
    },
  }

  if (namespace) {
    operation.tags = [namespace]
  }

  // Add request body with typed parameters
  if (method.parameters.length > 0) {
    const properties: Record<string, OpenAPISchema> = {}
    const required: string[] = []

    for (const param of method.parameters) {
      properties[param.name] = typeToSchema(param.type)
      if (!param.optional) {
        required.push(param.name)
      }
    }

    const requestSchema: OpenAPISchema = {
      type: 'object',
      properties,
    }
    if (required.length > 0) {
      requestSchema.required = required
    }

    operation.requestBody = {
      required: required.length > 0,
      content: {
        'application/json': {
          schema: requestSchema,
        },
      },
    }
  }

  return operation
}

// ============================================================================
// Main Export Functions
// ============================================================================

/**
 * Convert RPC schema to OpenAPI specification
 *
 * This version works with runtime RpcSchema (from /__schema endpoint)
 * which has limited type information.
 *
 * @param schema - RPC schema from runtime introspection
 * @param options - Conversion options
 * @returns OpenAPI document
 *
 * @example
 * ```typescript
 * const $ = RPC('https://my-do.workers.dev')
 * const rpcSchema = await $.schema()
 * const openApi = toOpenAPI(rpcSchema, {
 *   title: 'My DO API',
 *   servers: ['https://my-do.workers.dev']
 * })
 * ```
 */
export function toOpenAPI(schema: RpcSchema, options: ToOpenAPIOptions = {}): OpenAPIDocument {
  const {
    version = '3.0.3',
    title = 'RPC API',
    description,
    apiVersion = '1.0.0',
    servers,
    contact,
    license,
    basePath = '',
  } = options

  const paths: Record<string, OpenAPIPathItem> = {}
  const tags: OpenAPITag[] = []

  // Add top-level methods
  for (const method of schema.methods) {
    const endpoint = methodPathToEndpoint(method.path, basePath)
    paths[endpoint] = {
      post: createOperation(method),
    }
  }

  // Add namespace methods
  for (const ns of schema.namespaces) {
    tags.push({
      name: ns.name,
      description: `Operations for ${ns.name}`,
    })

    for (const method of ns.methods) {
      const endpoint = methodPathToEndpoint(method.path, basePath)
      paths[endpoint] = {
        post: createOperation(method, ns.name),
      }
    }
  }

  const doc: OpenAPIDocument = {
    openapi: version,
    info: {
      title,
      version: apiVersion,
    },
    paths,
  }

  if (description) {
    doc.info.description = description
  }
  if (contact) {
    doc.info.contact = contact
  }
  if (license) {
    doc.info.license = license
  }

  if (servers && servers.length > 0) {
    doc.servers = servers.map((s) => (typeof s === 'string' ? { url: s } : s))
  }

  if (tags.length > 0) {
    doc.tags = tags
  }

  return doc
}

/**
 * Convert extracted TypeScript schema to OpenAPI specification
 *
 * This version works with ExtractedSchema from source file analysis,
 * which includes full TypeScript type information.
 *
 * @param schema - Extracted schema from TypeScript source
 * @param options - Conversion options
 * @returns OpenAPI document
 *
 * @example
 * ```typescript
 * import { extractTypes } from 'rpc.do/extract'
 * import { toOpenAPIFromExtracted } from 'rpc.do/openapi'
 *
 * const schemas = await extractTypes('./src/MyDO.ts')
 * const openApi = toOpenAPIFromExtracted(schemas[0], {
 *   title: 'My DO API',
 *   servers: ['https://my-do.workers.dev']
 * })
 * ```
 */
export function toOpenAPIFromExtracted(schema: ExtractedSchema, options: ToOpenAPIOptions = {}): OpenAPIDocument {
  const {
    version = '3.0.3',
    title = schema.className,
    description,
    apiVersion = '1.0.0',
    servers,
    contact,
    license,
    basePath = '',
  } = options

  const paths: Record<string, OpenAPIPathItem> = {}
  const tags: OpenAPITag[] = []

  // Add top-level methods
  for (const method of schema.methods) {
    const endpoint = methodPathToEndpoint(method.name, basePath)
    paths[endpoint] = {
      post: createTypedOperation(method),
    }
  }

  // Add namespace methods (with recursive handling for nested namespaces)
  const processNamespace = (ns: ExtractedNamespace, parentPath: string = ''): void => {
    const nsPath = parentPath ? `${parentPath}.${ns.name}` : ns.name

    tags.push({
      name: nsPath,
      description: ns.typeName ? `Operations for ${ns.name} (${ns.typeName})` : `Operations for ${ns.name}`,
    })

    for (const method of ns.methods) {
      const methodPath = `${nsPath}.${method.name}`
      const endpoint = methodPathToEndpoint(methodPath, basePath)
      paths[endpoint] = {
        post: createTypedOperation(method, nsPath),
      }
    }

    // Process nested namespaces
    if (ns.nestedNamespaces) {
      for (const nestedNs of ns.nestedNamespaces) {
        processNamespace(nestedNs, nsPath)
      }
    }
  }

  for (const ns of schema.namespaces) {
    processNamespace(ns)
  }

  const doc: OpenAPIDocument = {
    openapi: version,
    info: {
      title,
      version: apiVersion,
    },
    paths,
  }

  if (description) {
    doc.info.description = description
  }
  if (contact) {
    doc.info.contact = contact
  }
  if (license) {
    doc.info.license = license
  }

  if (servers && servers.length > 0) {
    doc.servers = servers.map((s) => (typeof s === 'string' ? { url: s } : s))
  }

  if (tags.length > 0) {
    doc.tags = tags
  }

  // Add component schemas for extracted types
  if (schema.types.length > 0) {
    doc.components = {
      schemas: typesToComponents(schema.types),
    }
  }

  return doc
}

/**
 * Generate OpenAPI JSON string from RPC schema
 *
 * Convenience function that converts and stringifies in one step.
 *
 * @param schema - RPC schema or extracted schema
 * @param options - Conversion options plus formatting
 * @returns JSON string of OpenAPI document
 */
export function generateOpenAPIJson(
  schema: RpcSchema | ExtractedSchema,
  options: ToOpenAPIOptions & { pretty?: boolean } = {}
): string {
  const { pretty = true, ...openApiOptions } = options

  // Determine which type of schema we have
  const isExtracted = 'className' in schema

  const doc = isExtracted
    ? toOpenAPIFromExtracted(schema as ExtractedSchema, openApiOptions)
    : toOpenAPI(schema as RpcSchema, openApiOptions)

  return pretty ? JSON.stringify(doc, null, 2) : JSON.stringify(doc)
}
