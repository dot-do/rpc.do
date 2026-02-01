/**
 * rpc.do CLI - Generate typed RPC clients from Durable Object schemas
 *
 * Zero-config usage (recommended):
 *   npx rpc.do                                 # Auto-detects DOs from wrangler config
 *
 * Explicit usage:
 *   npx rpc.do generate --source ./MyDO.ts     # Extracts full types from source
 *   npx rpc.do generate --url <schema-url>     # Fetches runtime schema (weak types)
 *
 * Zero-config workflow:
 *   1. Define your DOs (extending DurableRPC/DigitalObject)
 *   2. Configure wrangler.toml with durable_objects bindings
 *   3. Run `npx rpc.do`
 *   4. Import typed clients from .do/
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, accessSync, constants } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { watch as fsWatch } from 'node:fs'
import { extractTypes, generateDTS, generateIndex, type ExtractedSchema } from './extract.js'
import { runZeroConfig, detectFromWrangler } from './detect.js'

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
  source?: string
}

// ============================================================================
// CLI Entry
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === '--help' || command === '-h') {
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

  // Zero-config: just run `npx rpc.do` with no args
  if (!command) {
    await runZeroConfigCommand()
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
  const sourceIndex = args.indexOf('--source')
  const source = sourceIndex !== -1 ? args[sourceIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const outputArg = outIndex !== -1 ? args[outIndex + 1] : undefined

  // Check for mutually exclusive flags
  if (url && source) {
    console.error('Error: Cannot use both --source and --url together.')
    console.error('Use --source for full types from TypeScript source, OR --url for runtime schema.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig()

  // Determine mode: source-based, URL-based, or zero-config
  const sourceFile = source || config?.source
  const schemaUrl = url || config?.schemaUrl

  if (sourceFile) {
    // Source-based generation (full types)
    await generateFromSource(sourceFile, outputArg || config?.output)
  } else if (schemaUrl) {
    // URL-based generation (runtime schema, weak types)
    await generateFromUrl(schemaUrl, outputArg || config?.output)
  } else {
    // No explicit source/url - try zero-config
    await runZeroConfigCommand(outputArg || config?.output)
  }
}

// ============================================================================
// Zero-Config Generation
// ============================================================================

async function runZeroConfigCommand(outputDir?: string): Promise<void> {
  const cwd = process.cwd()
  const output = outputDir || '.do'

  console.log('rpc.do - Zero-config type generation\n')

  try {
    // Check for wrangler config
    const bindings = await detectFromWrangler(cwd)
    if (bindings.length > 0) {
      console.log(`Found wrangler config with ${bindings.length} Durable Object(s):`)
      for (const b of bindings) {
        console.log(`  - ${b.className} (binding: ${b.name})`)
      }
      console.log('')
    } else {
      console.log('No wrangler config found, scanning for DO patterns...\n')
    }

    // Run zero-config detection and generation
    const result = await runZeroConfig(cwd, { outputDir: output })

    if (result.detected.length === 0) {
      console.error('No Durable Objects found.')
      console.error('\nEnsure your project has:')
      console.error('  1. wrangler.toml or wrangler.jsonc with durable_objects bindings')
      console.error('  2. OR TypeScript files with classes extending DurableObject/DurableRPC/DigitalObject')
      console.error('  3. OR DO() factory calls')
      process.exit(1)
    }

    // Print results
    console.log(`Detected ${result.detected.length} Durable Object(s):`)
    for (const d of result.detected) {
      console.log(`  - ${d.className} (extends ${d.baseClass})`)
      console.log(`    Source: ${d.filePath}`)
    }
    console.log('')

    if (result.generated.length > 0) {
      console.log(`Generated ${result.generated.length} file(s):`)
      for (const f of result.generated) {
        console.log(`  - ${f}`)
      }
      console.log('')
    }

    if (result.warnings.length > 0) {
      console.log('Warnings:')
      for (const w of result.warnings) {
        console.log(`  ⚠ ${w}`)
      }
      console.log('')
    }

    // Import hint
    const apiNames = result.detected.map((d) => `${d.className}API`).join(', ')
    console.log('Done! Import your typed client:')
    console.log(`  import type { ${apiNames} } from './${output}'`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exit(1)
  }
}

// ============================================================================
// Source-based Generation (Full Types)
// ============================================================================

async function generateFromSource(sourcePath: string, outputDir?: string): Promise<void> {
  const output = outputDir || './.do'
  const resolvedOutput = resolve(process.cwd(), output)

  console.log(`Parsing source file: ${sourcePath}`)

  try {
    // Check if file exists
    if (!sourcePath.includes('*') && !existsSync(resolve(process.cwd(), sourcePath))) {
      console.error(`Error: Source file not found: ${sourcePath}`)
      process.exit(1)
    }

    // Check file extension
    if (!sourcePath.includes('*') && !sourcePath.endsWith('.ts')) {
      console.error(`Error: Source must be a TypeScript file (.ts): ${sourcePath}`)
      process.exit(1)
    }

    // Extract types
    const schemas = await extractTypes(sourcePath)

    if (schemas.length === 0) {
      console.error('Error: No valid Durable Object classes found.')
      process.exit(1)
    }

    // Ensure output directory exists and is writable
    try {
      mkdirSync(resolvedOutput, { recursive: true })
      // Test write access
      const testFile = join(resolvedOutput, '.write-test')
      writeFileSync(testFile, '')
      const fs = await import('node:fs')
      fs.unlinkSync(testFile)
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
      const message = err instanceof Error ? err.message : String(err)
      if (code === 'EACCES') {
        console.error(`Error: permission denied - cannot write to output directory: ${resolvedOutput}`)
      } else if (code === 'ENOENT') {
        console.error(`Error: cannot write - directory does not exist: ${resolvedOutput}`)
      } else {
        console.error(`Error: cannot write to output directory: ${message}`)
      }
      process.exit(1)
    }

    // Generate .d.ts files for each schema
    for (const schema of schemas) {
      const dtsContent = generateDTS(schema)
      const dtsPath = join(resolvedOutput, `${schema.className}.d.ts`)
      writeFileSync(dtsPath, dtsContent)
      console.log(`Generated: ${dtsPath}`)
    }

    // Generate index.ts entrypoint
    const indexContent = generateIndex(schemas)
    const indexPath = join(resolvedOutput, 'index.ts')
    writeFileSync(indexPath, indexContent)
    console.log(`Generated: ${indexPath}`)

    console.log(`\nDone! Generated types for ${schemas.length} Durable Object(s).`)
    console.log(`Import your typed client:`)
    console.log(`  import type { ${schemas.map((s) => s.className + 'API').join(', ')} } from '${output}'`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Handle specific error types
    if (message.includes('not found') || message.includes('ENOENT')) {
      console.error(`Error: ${message}`)
    } else if (message.includes('syntax error')) {
      console.error(`Error: TypeScript syntax error in source file.`)
      console.error(message)
    } else if (message.includes('No class extending')) {
      console.error(`Error: No valid Durable Object class found.`)
      console.error('Ensure your class extends DurableObject, DurableRPC, or DigitalObject.')
    } else if (message.includes('empty')) {
      console.error(`Error: ${message}`)
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }
}

// ============================================================================
// URL-based Generation (Runtime Schema)
// ============================================================================

async function generateFromUrl(schemaUrl: string, outputDir?: string): Promise<void> {
  const output = outputDir || './generated/rpc'
  const resolvedOutput = resolve(process.cwd(), output)

  // Fetch schema
  console.log(`Fetching schema from ${schemaUrl}...`)
  const schema = await fetchSchema(schemaUrl)
  console.log(`Found ${schema.methods.length} methods, ${schema.namespaces.length} namespaces`)

  // Generate types
  const code = generateClient(schema)

  // Write output
  mkdirSync(resolvedOutput, { recursive: true })
  const outputPath = join(resolvedOutput, 'client.d.ts')
  writeFileSync(outputPath, code)
  console.log(`Generated typed client: ${outputPath}`)

  // Also write a JS stub that re-exports RPC with the type
  const jsPath = join(resolvedOutput, 'index.ts')
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
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`Error loading ${candidate}: ${message}`)
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

  const schema = (await response.json()) as RpcSchema
  if (!schema.version || !schema.methods || !schema.namespaces) {
    console.error('Invalid schema response. Ensure the DO extends DurableRPC.')
    process.exit(1)
  }

  return schema
}

// ============================================================================
// Code Generation (URL-based, weak types)
// ============================================================================

function generateClient(schema: RpcSchema): string {
  const lines: string[] = ['// Generated by `npx rpc.do generate`', '// Do not edit manually', '', 'export interface GeneratedAPI {']

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
  transport: 'http' | 'capnweb' | 'both'
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

  const transportAnswer = await prompt('Transport preference (http/capnweb/both) [both]: ')
  const transport = (['http', 'capnweb', 'both'].includes(transportAnswer.toLowerCase())
    ? transportAnswer.toLowerCase()
    : 'both') as 'http' | 'capnweb' | 'both'

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
  if (options.transport === 'capnweb' || options.transport === 'both') {
    transportImports.push('createCapnwebTransport')
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
${
  options.includeExamples
    ? `
    // Register example methods
    this.register(exampleMethods)`
    : `
    // Register your RPC methods here
    // this.register({
    //   hello: (name: string) => \`Hello, \${name}!\`,
    // })`
}
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
  const sourceIndex = args.indexOf('--source')
  const source = sourceIndex !== -1 ? args[sourceIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const outputArg = outIndex !== -1 ? args[outIndex + 1] : undefined
  const intervalIndex = args.indexOf('--interval')
  const intervalStr = intervalIndex !== -1 ? args[intervalIndex + 1] : undefined
  const intervalArg = intervalStr ? parseInt(intervalStr, 10) : 5000

  // Check for mutually exclusive flags
  if (url && source) {
    console.error('Error: Cannot use both --source and --url together.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig()

  const sourceFile = source || config?.source
  const schemaUrl = url || config?.schemaUrl

  if (sourceFile) {
    await watchSource(sourceFile, outputArg || config?.output || './.do')
  } else if (schemaUrl) {
    await watchUrl(schemaUrl, outputArg || config?.output || './generated/rpc', intervalArg)
  } else {
    console.error('Error: No source file or schema URL provided.')
    process.exit(1)
  }
}

/**
 * Watch source files for changes (--source mode)
 */
async function watchSource(sourcePath: string, output: string): Promise<void> {
  const resolvedOutput = resolve(process.cwd(), output)
  const resolvedSource = resolve(process.cwd(), sourcePath)
  const sourceDir = dirname(resolvedSource)

  console.log(`[rpc.do] Watching ${sourcePath} for changes...`)

  // Initial generation
  try {
    const schemas = await extractTypes(sourcePath)
    await writeSourceGeneratedFiles(schemas, resolvedOutput)
    console.log('[rpc.do] Initial generation complete')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[rpc.do] Error in initial generation: ${message}`)
    // Continue watching anyway
  }

  console.log('[rpc.do] Watching for changes... (Ctrl+C to stop)')

  // Watch for file changes
  const watcher = fsWatch(sourceDir, { recursive: true }, async (eventType, filename) => {
    if (!filename?.endsWith('.ts') || filename.endsWith('.d.ts')) return

    console.log(`[rpc.do] File changed: ${filename}, regenerating...`)

    try {
      const schemas = await extractTypes(sourcePath)
      await writeSourceGeneratedFiles(schemas, resolvedOutput)
      console.log('[rpc.do] Updated types')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[rpc.do] Error: ${message}`)
    }
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[rpc.do] Stopping watch mode...')
    watcher.close()
    console.log('[rpc.do] Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Write generated files from source extraction
 */
async function writeSourceGeneratedFiles(schemas: ExtractedSchema[], outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })

  for (const schema of schemas) {
    const dtsContent = generateDTS(schema)
    const dtsPath = join(outputDir, `${schema.className}.d.ts`)
    writeFileSync(dtsPath, dtsContent)
  }

  const indexContent = generateIndex(schemas)
  const indexPath = join(outputDir, 'index.ts')
  writeFileSync(indexPath, indexContent)
}

/**
 * Watch URL for schema changes (--url mode)
 */
async function watchUrl(schemaUrl: string, output: string, interval: number): Promise<void> {
  const outputDir = resolve(process.cwd(), output)

  // Normalize schema URL
  const normalizedSchemaUrl = schemaUrl.endsWith('/__schema') ? schemaUrl : `${schemaUrl.replace(/\/$/, '')}/__schema`

  console.log(`[rpc.do] Watching ${normalizedSchemaUrl}`)

  // Initial generation
  let previousHash: string | null = null
  try {
    const schema = await fetchSchemaForWatch(normalizedSchemaUrl)
    previousHash = hashSchema(schema)
    await writeUrlGeneratedFiles(schema, outputDir)
    console.log('[rpc.do] Initial generation complete')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[rpc.do] Failed to fetch initial schema: ${message}`)
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
        await writeUrlGeneratedFiles(schema, outputDir)
        previousHash = currentHash
        console.log('[rpc.do] Updated client types')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[rpc.do] Error fetching schema: ${message}`)
      // Continue watching, don't exit on transient errors
    }
  }

  intervalId = setInterval(poll, interval)

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

  const schema = (await response.json()) as RpcSchema
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
 * Write generated files for URL-based generation
 */
async function writeUrlGeneratedFiles(schema: RpcSchema, outputDir: string): Promise<void> {
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
rpc.do - Zero-config type generation for Durable Objects

QUICK START (Zero-config):
  npx rpc.do

  That's it! Reads your wrangler.toml, finds your DOs, generates types to .do/

HOW IT WORKS:
  1. Reads wrangler.toml or wrangler.jsonc
  2. Finds durable_objects bindings → class names
  3. Locates source files with those classes
  4. Extracts full TypeScript types
  5. Generates .do/*.d.ts with typed interfaces

USAGE:
  npx rpc.do                       Zero-config (recommended)
  npx rpc.do generate              Same as above
  npx rpc.do generate --source X   Explicit source file(s)
  npx rpc.do generate --url X      Runtime schema (weak types)
  npx rpc.do watch                 Watch mode
  npx rpc.do init [name]           Create new project

EXAMPLE:
  # wrangler.toml
  [durable_objects]
  bindings = [{ name = "CHAT", class_name = "ChatDO" }]

  # src/ChatDO.ts
  export class ChatDO extends DigitalObject {
    async sendMessage(text: string): Promise<Message> { ... }
    users = {
      get: async (id: string): Promise<User | null> => { ... },
      list: async (): Promise<User[]> => { ... },
    }
  }

  # Run
  $ npx rpc.do
  Found wrangler config with 1 Durable Object(s):
    - ChatDO (binding: CHAT)

  Generated 2 file(s):
    - .do/ChatDO.d.ts
    - .do/index.ts

  # Import
  import type { ChatDOAPI } from './.do'

EXPLICIT OPTIONS:
  --source <file>   TypeScript source (supports globs: "./do/*.ts")
  --url <url>       Schema endpoint for runtime types
  --output <dir>    Output directory (default: .do)

WATCH MODE:
  npx rpc.do watch                 Auto-regenerate on file changes
  npx rpc.do watch --source X      Watch specific files
  npx rpc.do watch --url X         Poll endpoint for changes

INIT:
  npx rpc.do init [project-name]   Create new project with examples
`)
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
