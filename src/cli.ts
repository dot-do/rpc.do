/**
 * rpc.do CLI - Generate typed RPC clients from Durable Object schemas
 *
 * Usage:
 *   npx rpc.do generate                    # Uses do.config.ts
 *   npx rpc.do generate --url <schema-url> # Fetches runtime schema
 *
 * Like Prisma's generate workflow:
 *   1. Define your DOs (extending DurableRPC)
 *   2. Configure do.config.ts
 *   3. Run `npx rpc.do generate`
 *   4. Import typed clients
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ============================================================================
// Types (mirrors @dotdo/rpc schema types)
// ============================================================================

interface RpcMethodSchema {
  name: string
  path: string
  params: number
}

interface RpcNamespaceSchema {
  name: string
  methods: RpcMethodSchema[]
}

interface RpcSchema {
  version: 1
  methods: RpcMethodSchema[]
  namespaces: RpcNamespaceSchema[]
}

interface RpcDoConfig {
  durableObjects: string | string[]
  output?: string
  schemaUrl?: string
}

// ============================================================================
// CLI Entry
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command !== 'generate') {
    console.error(`Unknown command: ${command}`)
    console.error('Run `npx rpc.do --help` for usage')
    process.exit(1)
  }

  // Parse flags
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const outputArg = outIndex !== -1 ? args[outIndex + 1] : undefined

  // Load config if no --url provided
  let config: RpcDoConfig | undefined
  if (!url) {
    config = await loadConfig()
  }

  const schemaUrl = url || config?.schemaUrl
  if (!schemaUrl) {
    console.error('Error: No schema URL provided.')
    console.error('Either:')
    console.error('  - Pass --url <schema-endpoint>')
    console.error('  - Set schemaUrl in do.config.ts')
    process.exit(1)
  }

  // Fetch schema
  console.log(`Fetching schema from ${schemaUrl}...`)
  const schema = await fetchSchema(schemaUrl)
  console.log(`Found ${schema.methods.length} methods, ${schema.namespaces.length} namespaces`)

  // Generate types
  const output = outputArg || config?.output || './generated/rpc'
  const outputDir = resolve(process.cwd(), output)
  const code = generateClient(schema)

  // Write output
  mkdirSync(outputDir, { recursive: true })
  const outputPath = join(outputDir, 'client.d.ts')
  writeFileSync(outputPath, code)
  console.log(`Generated typed client: ${outputPath}`)

  // Also write a JS stub that re-exports RPC with the type
  const jsPath = join(outputDir, 'index.ts')
  writeFileSync(jsPath, generateEntrypoint())
  console.log(`Generated entrypoint: ${jsPath}`)

  console.log('\nDone! Import your typed client:')
  console.log(`  import { rpc } from '${output}'`)
}

// ============================================================================
// Config Loading
// ============================================================================

async function loadConfig(): Promise<RpcDoConfig | undefined> {
  const cwd = process.cwd()
  const candidates = [
    'do.config.ts',
    'do.config.js',
    'rpc.config.ts',
    'rpc.config.js',
    '.do/config.ts',
    '.do/config.js',
  ]

  for (const candidate of candidates) {
    const configPath = resolve(cwd, candidate)
    if (existsSync(configPath)) {
      console.log(`Using config: ${candidate}`)
      try {
        const mod = await import(pathToFileURL(configPath).href)
        return mod.default || mod
      } catch (e: any) {
        console.error(`Error loading ${candidate}: ${e.message}`)
        console.error('Tip: Ensure your config file is valid JS/TS')
        process.exit(1)
      }
    }
  }

  return undefined
}

// ============================================================================
// Schema Fetching
// ============================================================================

async function fetchSchema(url: string): Promise<RpcSchema> {
  // Ensure we hit the __schema endpoint
  const schemaUrl = url.endsWith('/__schema') ? url : `${url.replace(/\/$/, '')}/__schema`

  const response = await fetch(schemaUrl)
  if (!response.ok) {
    console.error(`Failed to fetch schema: ${response.status} ${response.statusText}`)
    process.exit(1)
  }

  const schema = await response.json() as RpcSchema
  if (!schema.version || !schema.methods || !schema.namespaces) {
    console.error('Invalid schema response. Ensure the DO extends DurableRPC.')
    process.exit(1)
  }

  return schema
}

// ============================================================================
// Code Generation
// ============================================================================

function generateClient(schema: RpcSchema): string {
  const lines: string[] = [
    '// Generated by `npx rpc.do generate`',
    '// Do not edit manually',
    '',
    'export interface GeneratedAPI {',
  ]

  // Top-level methods
  for (const method of schema.methods) {
    lines.push(`  ${method.name}(...args: any[]): Promise<any>`)
  }

  // Namespaces
  for (const ns of schema.namespaces) {
    lines.push(`  ${ns.name}: {`)
    for (const method of ns.methods) {
      lines.push(`    ${method.name}(...args: any[]): Promise<any>`)
    }
    lines.push(`  }`)
  }

  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

function generateEntrypoint(): string {
  return [
    '// Generated by `npx rpc.do generate`',
    '// Do not edit manually',
    '',
    "import { RPC, type Transport } from 'rpc.do'",
    "import type { GeneratedAPI } from './client'",
    '',
    '/**',
    ' * Create a typed RPC client',
    ' */',
    'export function createClient(transport: Transport) {',
    '  return RPC<GeneratedAPI>(transport)',
    '}',
    '',
    'export type { GeneratedAPI }',
    '',
  ].join('\n')
}

// ============================================================================
// Help
// ============================================================================

function printHelp() {
  console.log(`
rpc.do - Generate typed RPC clients from Durable Object schemas

Usage:
  npx rpc.do generate [options]

Options:
  --url <url>       Schema endpoint URL (e.g. https://my-do.workers.dev)
  --output <dir>    Output directory (default: ./generated/rpc)
  --help, -h        Show this help

Config:
  Create a do.config.ts in your project root:

    import { defineConfig } from '@dotdo/rpc'

    export default defineConfig({
      durableObjects: './src/do/*.ts',
      output: './generated/rpc',
      schemaUrl: 'https://my-do.workers.dev',
    })

Workflow:
  1. Define your Durable Objects (extend DurableRPC from @dotdo/rpc)
  2. Deploy your Worker
  3. Run: npx rpc.do generate --url https://your-worker.workers.dev
  4. Import: import { createClient } from './generated/rpc'
`)
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
