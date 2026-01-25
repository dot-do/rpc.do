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

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'

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

  if (command === 'init') {
    await initProject(args.slice(1))
    return
  }

  if (command === 'watch') {
    await watchCommand(args.slice(1))
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
// Init Command
// ============================================================================

interface InitOptions {
  projectName: string
  includeExamples: boolean
  transport: 'http' | 'ws' | 'both'
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolvePrompt) => {
    rl.question(question, (answer) => {
      rl.close()
      resolvePrompt(answer.trim())
    })
  })
}

async function initProject(args: string[]): Promise<void> {
  console.log('\nrpc.do - Create a new RPC project\n')

  // Get project name from args or prompt
  let projectName = args[0]
  if (!projectName) {
    projectName = await prompt('Project name: ')
    if (!projectName) {
      console.error('Error: Project name is required')
      process.exit(1)
    }
  }

  // Validate project name
  if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    console.error('Error: Project name can only contain letters, numbers, hyphens, and underscores')
    process.exit(1)
  }

  // Check if directory exists
  const projectPath = resolve(process.cwd(), projectName)
  if (existsSync(projectPath)) {
    const overwrite = await prompt(`Directory "${projectName}" already exists. Continue? (y/n): `)
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // Interactive prompts
  const includeExamplesAnswer = await prompt('Include examples? (Y/n): ')
  const includeExamples = includeExamplesAnswer.toLowerCase() !== 'n'

  const transportAnswer = await prompt('Transport preference (http/ws/both) [both]: ')
  const transport = (['http', 'ws', 'both'].includes(transportAnswer.toLowerCase())
    ? transportAnswer.toLowerCase()
    : 'both') as 'http' | 'ws' | 'both'

  const options: InitOptions = {
    projectName,
    includeExamples,
    transport,
  }

  // Create project structure
  console.log(`\nCreating project "${projectName}"...\n`)

  createProjectStructure(projectPath, options)

  // Print next steps
  console.log(`
Project created successfully!

Next steps:

  cd ${projectName}
  npm install && npm run dev

Then visit http://localhost:8787 to see your RPC endpoint.

Files created:
  ${projectName}/
  ├── src/
  │   ├── index.ts          (Worker entrypoint)
  │   └── rpc/
  │       └── example.ts    (Example RPC methods)
  ├── wrangler.toml         (Cloudflare config)
  ├── package.json          (Dependencies)
  ├── tsconfig.json         (TypeScript config)
  └── do.config.ts          (rpc.do config)
`)
}

function createProjectStructure(projectPath: string, options: InitOptions): void {
  // Create directories
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(join(projectPath, 'src'), { recursive: true })
  mkdirSync(join(projectPath, 'src', 'rpc'), { recursive: true })

  // Create package.json
  const packageJson = generatePackageJson(options)
  writeFileSync(join(projectPath, 'package.json'), packageJson)
  console.log('  Created package.json')

  // Create tsconfig.json
  const tsConfig = generateTsConfig()
  writeFileSync(join(projectPath, 'tsconfig.json'), tsConfig)
  console.log('  Created tsconfig.json')

  // Create wrangler.toml
  const wranglerToml = generateWranglerToml(options)
  writeFileSync(join(projectPath, 'wrangler.toml'), wranglerToml)
  console.log('  Created wrangler.toml')

  // Create do.config.ts
  const doConfig = generateDoConfig(options)
  writeFileSync(join(projectPath, 'do.config.ts'), doConfig)
  console.log('  Created do.config.ts')

  // Create src/index.ts
  const indexTs = generateIndexTs(options)
  writeFileSync(join(projectPath, 'src', 'index.ts'), indexTs)
  console.log('  Created src/index.ts')

  // Create src/rpc/example.ts
  if (options.includeExamples) {
    const exampleTs = generateExampleRpc()
    writeFileSync(join(projectPath, 'src', 'rpc', 'example.ts'), exampleTs)
    console.log('  Created src/rpc/example.ts')
  }
}

function generatePackageJson(options: InitOptions): string {
  const pkg = {
    name: options.projectName,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      generate: 'npx rpc.do generate',
    },
    dependencies: {
      'rpc.do': '^0.2.0',
    },
    devDependencies: {
      '@cloudflare/workers-types': '^4.20240620.0',
      typescript: '^5.5.0',
      wrangler: '^3.60.0',
    },
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

function generateTsConfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      lib: ['ES2022'],
      types: ['@cloudflare/workers-types'],
      outDir: './dist',
      declaration: true,
    },
    include: ['src/**/*', 'do.config.ts'],
    exclude: ['node_modules', 'dist'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

function generateWranglerToml(options: InitOptions): string {
  return `name = "${options.projectName}"
main = "src/index.ts"
compatibility_date = "2024-06-01"

[durable_objects]
bindings = [
  { name = "RPC_DO", class_name = "RpcDurableObject" }
]

[[migrations]]
tag = "v1"
new_classes = ["RpcDurableObject"]
`
}

function generateDoConfig(options: InitOptions): string {
  return `import { defineConfig } from 'rpc.do'

export default defineConfig({
  durableObjects: './src/rpc/*.ts',
  output: './generated/rpc',
  // Set this after deploying your worker
  // schemaUrl: 'https://${options.projectName}.workers.dev',
})
`
}

function generateIndexTs(options: InitOptions): string {
  const transportImports: string[] = []

  if (options.transport === 'http' || options.transport === 'both') {
    transportImports.push('createHTTPTransport')
  }
  if (options.transport === 'ws' || options.transport === 'both') {
    transportImports.push('createWebSocketTransport')
  }

  return `import { DurableRPC${transportImports.length > 0 ? ', ' + transportImports.join(', ') : ''} } from 'rpc.do'
${options.includeExamples ? "import { exampleMethods } from './rpc/example'" : ''}

export interface Env {
  RPC_DO: DurableObjectNamespace
}

/**
 * RPC Durable Object
 *
 * Exposes methods via HTTP and/or WebSocket transports.
 * Schema available at /__schema endpoint.
 */
export class RpcDurableObject extends DurableRPC {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
${options.includeExamples ? `
    // Register example methods
    this.register(exampleMethods)` : `
    // Register your RPC methods here
    // this.register({
    //   hello: (name: string) => \`Hello, \${name}!\`,
    // })`}
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route to Durable Object
    const id = env.RPC_DO.idFromName('default')
    const stub = env.RPC_DO.get(id)

    return stub.fetch(request)
  },
}
`
}

function generateExampleRpc(): string {
  return `/**
 * Example RPC methods
 *
 * These methods are exposed via the RPC endpoint.
 * Call them with: POST / { "method": "hello", "params": ["World"] }
 */

export const exampleMethods = {
  /**
   * Simple greeting method
   */
  hello(name: string): string {
    return \`Hello, \${name}!\`
  },

  /**
   * Add two numbers
   */
  add(a: number, b: number): number {
    return a + b
  },

  /**
   * Get current timestamp
   */
  now(): string {
    return new Date().toISOString()
  },

  /**
   * Nested namespace example
   */
  math: {
    multiply(a: number, b: number): number {
      return a * b
    },
    divide(a: number, b: number): number {
      if (b === 0) throw new Error('Division by zero')
      return a / b
    },
  },
}
`
}

// ============================================================================
// Watch Command
// ============================================================================

async function watchCommand(args: string[]): Promise<void> {
  // Parse flags
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const outputArg = outIndex !== -1 ? args[outIndex + 1] : undefined
  const intervalIndex = args.indexOf('--interval')
  const intervalArg = intervalIndex !== -1 ? parseInt(args[intervalIndex + 1], 10) : 5000

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

  const output = outputArg || config?.output || './generated/rpc'
  const outputDir = resolve(process.cwd(), output)

  // Normalize schema URL
  const normalizedSchemaUrl = schemaUrl.endsWith('/__schema')
    ? schemaUrl
    : `${schemaUrl.replace(/\/$/, '')}/__schema`

  console.log(`[rpc.do] Watching ${normalizedSchemaUrl}`)

  // Initial generation
  let previousHash: string | null = null
  try {
    const schema = await fetchSchemaForWatch(normalizedSchemaUrl)
    previousHash = hashSchema(schema)
    await writeGeneratedFiles(schema, outputDir)
    console.log('[rpc.do] Initial generation complete')
  } catch (err: any) {
    console.error(`[rpc.do] Failed to fetch initial schema: ${err.message}`)
    process.exit(1)
  }

  console.log('[rpc.do] Watching for changes... (Ctrl+C to stop)')

  // Set up polling interval
  let intervalId: ReturnType<typeof setInterval> | null = null

  const poll = async () => {
    try {
      const schema = await fetchSchemaForWatch(normalizedSchemaUrl)
      const currentHash = hashSchema(schema)

      if (currentHash !== previousHash) {
        console.log('[rpc.do] Schema changed, regenerating...')
        await writeGeneratedFiles(schema, outputDir)
        previousHash = currentHash
        console.log('[rpc.do] Updated client types')
      }
    } catch (err: any) {
      console.error(`[rpc.do] Error fetching schema: ${err.message}`)
      // Continue watching, don't exit on transient errors
    }
  }

  intervalId = setInterval(poll, intervalArg)

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[rpc.do] Stopping watch mode...')
    if (intervalId) {
      clearInterval(intervalId)
    }
    console.log('[rpc.do] Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Fetch schema without process.exit on failure (for watch mode)
 */
async function fetchSchemaForWatch(schemaUrl: string): Promise<RpcSchema> {
  const response = await fetch(schemaUrl)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  const schema = await response.json() as RpcSchema
  if (!schema.version || !schema.methods || !schema.namespaces) {
    throw new Error('Invalid schema response')
  }

  return schema
}

/**
 * Hash a schema for change detection
 */
function hashSchema(schema: RpcSchema): string {
  const content = JSON.stringify(schema)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Write generated files to output directory
 */
async function writeGeneratedFiles(schema: RpcSchema, outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })

  const code = generateClient(schema)
  const outputPath = join(outputDir, 'client.d.ts')
  writeFileSync(outputPath, code)

  const jsPath = join(outputDir, 'index.ts')
  writeFileSync(jsPath, generateEntrypoint())
}

// ============================================================================
// Help
// ============================================================================

function printHelp() {
  console.log(`
rpc.do - Generate typed RPC clients from Durable Object schemas

Usage:
  npx rpc.do <command> [options]

Commands:
  init [project-name]              Create a new rpc.do project
  generate [options]               Generate typed client once
  watch [options]                  Watch for schema changes and regenerate

Init Command:
  npx rpc.do init [project-name]

  Creates a new project with:
    - src/index.ts          Worker entrypoint
    - src/rpc/example.ts    Example RPC methods
    - wrangler.toml         Cloudflare config
    - package.json          Dependencies
    - tsconfig.json         TypeScript config
    - do.config.ts          rpc.do config

  Interactive prompts:
    - Project name (if not provided)
    - Include examples? (y/n)
    - Transport preference (http/ws/both)

Generate Options:
  --url <url>       Schema endpoint URL (e.g. https://my-do.workers.dev)
  --output <dir>    Output directory (default: ./generated/rpc)

Watch Options:
  --url <url>       Schema endpoint URL (e.g. https://my-do.workers.dev)
  --output <dir>    Output directory (default: ./generated/rpc)
  --interval <ms>   Polling interval in milliseconds (default: 5000)

General Options:
  --help, -h        Show this help

Config:
  Create a do.config.ts in your project root:

    import { defineConfig } from 'rpc.do'

    export default defineConfig({
      durableObjects: './src/do/*.ts',
      output: './generated/rpc',
      schemaUrl: 'https://my-do.workers.dev',
    })

Workflow:
  1. Run: npx rpc.do init my-project
  2. cd my-project && npm install && npm run dev
  3. Deploy your Worker
  4. Run: npx rpc.do generate --url https://your-worker.workers.dev
     Or:  npx rpc.do watch --url https://your-worker.workers.dev
  5. Import: import { createClient } from './generated/rpc'
`)
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
