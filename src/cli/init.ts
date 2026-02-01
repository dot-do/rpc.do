/**
 * CLI Init Command - Create new RPC project
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createInterface } from 'node:readline'

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

/**
 * Initialize a new RPC project
 */
export async function initProject(args: string[]): Promise<void> {
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
