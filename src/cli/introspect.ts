/**
 * CLI Introspect Command - Fetch schema from running server and generate types
 *
 * Connects to a running RPC server endpoint, fetches the runtime schema from
 * the `/__schema` endpoint, and generates TypeScript type definitions.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { RpcSchema, RpcNamespaceSchema, RpcMethodSchema } from './types.js'

/**
 * Result of the introspect operation
 */
export interface IntrospectResult {
  success: boolean
  schema?: RpcSchema
  generatedFiles?: string[]
  error?: string
}

/**
 * Options for the introspect command
 */
export interface IntrospectOptions {
  url: string
  output?: string | undefined
  timeout?: number | undefined
}

/**
 * Introspect command entry point
 */
export async function introspectCommand(args: string[]): Promise<void> {
  // Parse flags
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined
  const outputIndex = args.indexOf('--output')
  const output = outputIndex !== -1 ? args[outputIndex + 1] : '.do'

  // Validate required URL
  if (!url) {
    console.error('Error: --url flag is required')
    console.error('')
    console.error('Usage: npx rpc.do introspect --url <endpoint> [--output <dir>]')
    console.error('')
    console.error('Example:')
    console.error('  npx rpc.do introspect --url https://my-worker.workers.dev')
    console.error('  npx rpc.do introspect --url http://localhost:8787 --output ./types')
    process.exit(1)
  }

  console.log('rpc.do introspect - Generate types from running server\n')

  try {
    const result = await introspect({ url, output })

    if (!result.success) {
      console.error(`Error: ${result.error}`)
      process.exit(1)
    }

    // Print summary
    console.log('\nDone! Generated types from runtime schema.')
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      console.log(`\nGenerated ${result.generatedFiles.length} file(s):`)
      for (const file of result.generatedFiles) {
        console.log(`  - ${file}`)
      }
    }

    console.log('\nImport your typed client:')
    console.log(`  import type { IntrospectedAPI } from '${output}'`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exit(1)
  }
}

/**
 * Introspect a running RPC server and generate types
 */
export async function introspect(options: IntrospectOptions): Promise<IntrospectResult> {
  const { url, output = '.do', timeout = 10000 } = options

  // Normalize the URL and ensure it points to /__schema
  const schemaUrl = normalizeSchemaUrl(url)

  console.log(`Fetching schema from ${schemaUrl}...`)

  // Fetch schema with timeout
  let schema: RpcSchema
  try {
    schema = await fetchSchemaWithTimeout(schemaUrl, timeout)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to fetch schema: ${message}` }
  }

  // Validate schema
  const validationError = validateSchema(schema)
  if (validationError) {
    return { success: false, error: validationError }
  }

  // Print schema summary
  const totalMethods = schema.methods.length + schema.namespaces.reduce((acc, ns) => acc + ns.methods.length, 0)
  console.log(`Found ${totalMethods} method(s) in ${schema.namespaces.length} namespace(s)`)

  // Generate TypeScript definitions
  const resolvedOutput = resolve(process.cwd(), output)

  try {
    mkdirSync(resolvedOutput, { recursive: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to create output directory: ${message}` }
  }

  const generatedFiles: string[] = []

  // Generate client.d.ts with API interface
  const dtsContent = generateIntrospectedDTS(schema)
  const dtsPath = join(resolvedOutput, 'client.d.ts')
  try {
    writeFileSync(dtsPath, dtsContent)
    generatedFiles.push(dtsPath)
    console.log(`Generated: ${dtsPath}`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to write ${dtsPath}: ${message}` }
  }

  // Generate index.ts entrypoint
  const indexContent = generateIntrospectedIndex()
  const indexPath = join(resolvedOutput, 'index.ts')
  try {
    writeFileSync(indexPath, indexContent)
    generatedFiles.push(indexPath)
    console.log(`Generated: ${indexPath}`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to write ${indexPath}: ${message}` }
  }

  return { success: true, schema, generatedFiles }
}

/**
 * Normalize the URL to point to the schema endpoint
 */
export function normalizeSchemaUrl(url: string): string {
  // Remove trailing slash
  let normalized = url.replace(/\/$/, '')

  // If already ends with /__schema, return as-is
  if (normalized.endsWith('/__schema')) {
    return normalized
  }

  // Append /__schema
  return `${normalized}/__schema`
}

/**
 * Fetch schema with timeout handling
 */
async function fetchSchemaWithTimeout(url: string, timeout: number): Promise<RpcSchema> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }

    const schema = (await response.json()) as RpcSchema
    return schema
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error(`Connection timed out after ${timeout}ms`)
      }
      throw err
    }
    throw new Error(String(err))
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Validate the schema structure
 */
function validateSchema(schema: unknown): string | null {
  if (!schema || typeof schema !== 'object') {
    return 'Invalid schema: expected an object'
  }

  const s = schema as Record<string, unknown>

  if (!('version' in s) || s['version'] !== 1) {
    return 'Invalid schema: missing or invalid version field (expected 1)'
  }

  if (!('methods' in s) || !Array.isArray(s['methods'])) {
    return 'Invalid schema: missing or invalid methods array'
  }

  if (!('namespaces' in s) || !Array.isArray(s['namespaces'])) {
    return 'Invalid schema: missing or invalid namespaces array'
  }

  // Validate method structure
  for (const method of s['methods'] as unknown[]) {
    const methodError = validateMethod(method)
    if (methodError) {
      return `Invalid schema: ${methodError}`
    }
  }

  // Validate namespace structure
  for (const ns of s['namespaces'] as unknown[]) {
    const nsError = validateNamespace(ns)
    if (nsError) {
      return `Invalid schema: ${nsError}`
    }
  }

  return null
}

/**
 * Validate a method object
 */
function validateMethod(method: unknown): string | null {
  if (!method || typeof method !== 'object') {
    return 'method is not an object'
  }

  const m = method as Record<string, unknown>

  if (typeof m['name'] !== 'string' || !m['name']) {
    return 'method missing name'
  }

  if (typeof m['path'] !== 'string') {
    return `method "${m['name']}" missing path`
  }

  if (typeof m['params'] !== 'number') {
    return `method "${m['name']}" missing params count`
  }

  return null
}

/**
 * Validate a namespace object
 */
function validateNamespace(ns: unknown): string | null {
  if (!ns || typeof ns !== 'object') {
    return 'namespace is not an object'
  }

  const n = ns as Record<string, unknown>

  if (typeof n['name'] !== 'string' || !n['name']) {
    return 'namespace missing name'
  }

  if (!('methods' in n) || !Array.isArray(n['methods'])) {
    return `namespace "${n['name']}" missing methods array`
  }

  for (const method of n['methods'] as unknown[]) {
    const methodError = validateMethod(method)
    if (methodError) {
      return `namespace "${n['name']}": ${methodError}`
    }
  }

  return null
}

/**
 * Generate TypeScript definitions from introspected schema
 *
 * Note: Runtime schemas only provide method names and parameter counts,
 * so we generate weak types (unknown parameters and return types).
 */
export function generateIntrospectedDTS(schema: RpcSchema): string {
  const lines: string[] = [
    '// Generated by `npx rpc.do introspect`',
    '// Do not edit manually',
    '',
    '/**',
    ' * API interface generated from runtime schema introspection.',
    ' * ',
    ' * Note: Parameter and return types are weak (unknown) because',
    ' * runtime schemas only provide method signatures, not type information.',
    ' * For full type safety, use `npx rpc.do generate --source` instead.',
    ' */',
    'export interface IntrospectedAPI {',
  ]

  // Top-level methods
  for (const method of schema.methods) {
    lines.push(`  /** @param args - ${method.params} parameter(s) */`)
    lines.push(`  ${method.name}(...args: unknown[]): Promise<unknown>`)
  }

  // Namespaces
  for (const ns of schema.namespaces) {
    lines.push(`  ${ns.name}: {`)
    for (const method of ns.methods) {
      lines.push(`    /** @param args - ${method.params} parameter(s) */`)
      lines.push(`    ${method.name}(...args: unknown[]): Promise<unknown>`)
    }
    lines.push(`  }`)
  }

  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate entrypoint file for introspected types
 */
export function generateIntrospectedIndex(): string {
  return [
    '// Generated by `npx rpc.do introspect`',
    '// Do not edit manually',
    '',
    "import { RPC, type Transport } from 'rpc.do'",
    "import type { IntrospectedAPI } from './client'",
    '',
    '/**',
    ' * Create a typed RPC client from introspected schema',
    ' */',
    'export function createClient(transport: Transport) {',
    '  return RPC<IntrospectedAPI>(transport)',
    '}',
    '',
    'export type { IntrospectedAPI }',
    '',
  ].join('\n')
}
