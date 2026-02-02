/**
 * CLI Init Command - Interactive wizard for creating new RPC projects
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { createInterface, Interface } from 'node:readline'

/**
 * Template types available for project initialization
 */
export type TemplateType = 'basic' | 'chat' | 'api'

/**
 * Options collected from the wizard
 */
export interface WizardOptions {
  projectName: string
  template: TemplateType
  includeExamples: boolean
  outputDir: string
}

/**
 * Prompter interface for dependency injection (allows testing)
 */
export interface Prompter {
  prompt(question: string): Promise<string>
  close(): void
}

/**
 * Creates a readline-based prompter using stdin/stdout
 */
export function createStdinPrompter(): Prompter {
  let rl: Interface | null = null

  return {
    async prompt(question: string): Promise<string> {
      rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      return new Promise((resolvePrompt) => {
        rl!.question(question, (answer) => {
          rl!.close()
          rl = null
          resolvePrompt(answer.trim())
        })
      })
    },
    close() {
      if (rl) {
        rl.close()
        rl = null
      }
    },
  }
}

/**
 * Template descriptions for the wizard
 */
const TEMPLATES: Record<TemplateType, { name: string; description: string }> = {
  basic: {
    name: 'Basic',
    description: 'Minimal DO with a few methods (hello, add, math)',
  },
  chat: {
    name: 'Chat',
    description: 'Real-time chat example with WebSocket support',
  },
  api: {
    name: 'API',
    description: 'REST-like CRUD operations example',
  },
}

/**
 * Run the interactive wizard to collect project options
 */
export async function runWizard(
  args: string[],
  prompter: Prompter = createStdinPrompter()
): Promise<WizardOptions> {
  console.log('\nrpc.do - Create a new RPC project\n')

  // 1. Project name (default: current directory name)
  const defaultName = basename(process.cwd())
  let projectName = args[0]
  if (!projectName) {
    const answer = await prompter.prompt(`Project name (${defaultName}): `)
    projectName = answer || defaultName
  }

  // Validate project name
  if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
    prompter.close()
    console.error('Error: Project name can only contain letters, numbers, hyphens, and underscores')
    process.exit(1)
  }

  // 2. Template choice
  console.log('\nAvailable templates:')
  console.log('  1. Basic  - Minimal DO with a few methods (hello, add, math)')
  console.log('  2. Chat   - Real-time chat example with WebSocket support')
  console.log('  3. API    - REST-like CRUD operations example')
  console.log('')

  const templateAnswer = await prompter.prompt('Select template (1-3) [1]: ')
  const templateNum = parseInt(templateAnswer, 10)
  let template: TemplateType
  if (templateNum === 2) {
    template = 'chat'
  } else if (templateNum === 3) {
    template = 'api'
  } else {
    template = 'basic'
  }

  // 3. Include examples?
  const examplesAnswer = await prompter.prompt('Include examples? (Y/n): ')
  const includeExamples = examplesAnswer.toLowerCase() !== 'n'

  // 4. Output directory
  const defaultDir = projectName
  const outputAnswer = await prompter.prompt(`Output directory (${defaultDir}): `)
  const outputDir = outputAnswer || defaultDir

  prompter.close()

  return {
    projectName,
    template,
    includeExamples,
    outputDir,
  }
}

/**
 * Initialize a new RPC project using the interactive wizard
 */
export async function initProject(
  args: string[],
  prompter?: Prompter
): Promise<void> {
  const options = await runWizard(args, prompter)
  const projectPath = resolve(process.cwd(), options.outputDir)

  // Check if directory exists
  if (existsSync(projectPath)) {
    const p = prompter || createStdinPrompter()
    const overwrite = await p.prompt(`Directory "${options.outputDir}" already exists. Continue? (y/n): `)
    p.close()
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // Create project structure
  console.log(`\nCreating project "${options.projectName}" with ${TEMPLATES[options.template].name} template...\n`)

  createProjectStructure(projectPath, options)

  // Print next steps
  printNextSteps(options)
}

/**
 * Create the project directory structure and files
 */
export function createProjectStructure(projectPath: string, options: WizardOptions): void {
  // Create directories
  mkdirSync(projectPath, { recursive: true })
  mkdirSync(join(projectPath, 'src'), { recursive: true })

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

  // Create src/index.ts based on template
  const indexTs = generateIndexTs(options)
  writeFileSync(join(projectPath, 'src', 'index.ts'), indexTs)
  console.log('  Created src/index.ts')

  // Create template-specific files
  if (options.includeExamples) {
    generateTemplateFiles(projectPath, options)
  }
}

/**
 * Generate template-specific example files
 */
function generateTemplateFiles(projectPath: string, options: WizardOptions): void {
  switch (options.template) {
    case 'basic':
      // Basic template uses inline examples in index.ts
      break
    case 'chat':
      mkdirSync(join(projectPath, 'src', 'types'), { recursive: true })
      writeFileSync(join(projectPath, 'src', 'types', 'chat.ts'), generateChatTypes())
      console.log('  Created src/types/chat.ts')
      break
    case 'api':
      mkdirSync(join(projectPath, 'src', 'types'), { recursive: true })
      writeFileSync(join(projectPath, 'src', 'types', 'api.ts'), generateApiTypes())
      console.log('  Created src/types/api.ts')
      break
  }
}

function generatePackageJson(options: WizardOptions): string {
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

function generateWranglerToml(options: WizardOptions): string {
  const className = getClassName(options.template)
  return `name = "${options.projectName}"
main = "src/index.ts"
compatibility_date = "2024-06-01"

[durable_objects]
bindings = [
  { name = "RPC_DO", class_name = "${className}" }
]

[[migrations]]
tag = "v1"
new_classes = ["${className}"]
`
}

function generateDoConfig(options: WizardOptions): string {
  return `import { defineConfig } from 'rpc.do'

export default defineConfig({
  durableObjects: './src/*.ts',
  output: './.do',
  // Set this after deploying your worker
  // schemaUrl: 'https://${options.projectName}.workers.dev',
})
`
}

function getClassName(template: TemplateType): string {
  switch (template) {
    case 'chat':
      return 'ChatDO'
    case 'api':
      return 'ApiDO'
    default:
      return 'RpcDurableObject'
  }
}

function generateIndexTs(options: WizardOptions): string {
  switch (options.template) {
    case 'chat':
      return generateChatIndexTs(options)
    case 'api':
      return generateApiIndexTs(options)
    default:
      return generateBasicIndexTs(options)
  }
}

function generateBasicIndexTs(options: WizardOptions): string {
  const examples = options.includeExamples
    ? `
  /**
   * Simple greeting method
   */
  async hello(name: string): Promise<string> {
    return \`Hello, \${name}!\`
  }

  /**
   * Add two numbers
   */
  async add(a: number, b: number): Promise<number> {
    return a + b
  }

  /**
   * Nested namespace for math operations
   */
  math = {
    multiply: async (a: number, b: number): Promise<number> => {
      return a * b
    },
    divide: async (a: number, b: number): Promise<number> => {
      if (b === 0) throw new Error('Division by zero')
      return a / b
    },
  }

  /**
   * Get current timestamp
   */
  async now(): Promise<string> {
    return new Date().toISOString()
  }`
    : `
  // Define your RPC methods here as class methods or properties:
  // async hello(name: string): Promise<string> {
  //   return \\\`Hello, \\\${name}!\\\`
  // }
  //
  // Or use nested namespaces:
  // users = {
  //   get: async (id: string) => this.sql\\\`SELECT * FROM users WHERE id = \\\${id}\\\`.one(),
  //   list: async () => this.sql\\\`SELECT * FROM users\\\`.all(),
  // }`

  return `import { DurableRPC } from 'rpc.do'

export interface Env {
  RPC_DO: DurableObjectNamespace
}

/**
 * RPC Durable Object
 *
 * Define methods directly on the class - they become callable via RPC automatically.
 * Schema available at /__schema endpoint.
 */
export class RpcDurableObject extends DurableRPC {${examples}
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route to Durable Object
    const id = env.RPC_DO.idFromName('default')
    const stub = env.RPC_DO.get(id)
    return stub.fetch(request)
  },
}
`
}

function generateChatIndexTs(options: WizardOptions): string {
  const importTypes = options.includeExamples ? `import type { Message, User, ChatRoom } from './types/chat'\n` : ''

  const examples = options.includeExamples
    ? `
  private messages: Message[] = []
  private users: Map<string, User> = new Map()
  private connections: Set<WebSocket> = new Set()

  /**
   * Join the chat room
   */
  async join(userId: string, username: string): Promise<User> {
    const user: User = { id: userId, username, joinedAt: new Date().toISOString() }
    this.users.set(userId, user)
    this.broadcast({ type: 'user_joined', user })
    return user
  }

  /**
   * Leave the chat room
   */
  async leave(userId: string): Promise<void> {
    const user = this.users.get(userId)
    if (user) {
      this.users.delete(userId)
      this.broadcast({ type: 'user_left', user })
    }
  }

  /**
   * Send a message to the chat
   */
  async sendMessage(userId: string, text: string): Promise<Message> {
    const user = this.users.get(userId)
    if (!user) throw new Error('User not in chat')

    const message: Message = {
      id: crypto.randomUUID(),
      userId,
      username: user.username,
      text,
      timestamp: new Date().toISOString(),
    }
    this.messages.push(message)
    this.broadcast({ type: 'message', message })
    return message
  }

  /**
   * Get recent messages
   */
  async getMessages(limit: number = 50): Promise<Message[]> {
    return this.messages.slice(-limit)
  }

  /**
   * Get online users
   */
  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values())
  }

  /**
   * Get chat room info
   */
  async getRoomInfo(): Promise<ChatRoom> {
    return {
      userCount: this.users.size,
      messageCount: this.messages.length,
    }
  }

  /**
   * Broadcast a message to all connected WebSocket clients
   */
  private broadcast(data: unknown): void {
    const payload = JSON.stringify(data)
    for (const ws of this.connections) {
      try {
        ws.send(payload)
      } catch {
        this.connections.delete(ws)
      }
    }
  }

  /**
   * Handle WebSocket connections for real-time updates
   */
  async handleWebSocket(request: Request): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair())
    this.connections.add(server)
    server.accept()

    server.addEventListener('close', () => {
      this.connections.delete(server)
    })

    return new Response(null, { status: 101, webSocket: client })
  }`
    : `
  // Implement your chat methods here:
  // async join(userId: string, username: string): Promise<User> { ... }
  // async sendMessage(userId: string, text: string): Promise<Message> { ... }
  // async getMessages(limit?: number): Promise<Message[]> { ... }`

  return `import { DurableRPC } from 'rpc.do'
${importTypes}
export interface Env {
  RPC_DO: DurableObjectNamespace
}

/**
 * Chat Durable Object
 *
 * Real-time chat with WebSocket support.
 * Supports joining, messaging, and user presence.
 */
export class ChatDO extends DurableRPC {${examples}
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.RPC_DO.idFromName('default')
    const stub = env.RPC_DO.get(id)
    return stub.fetch(request)
  },
}
`
}

function generateApiIndexTs(options: WizardOptions): string {
  const importTypes = options.includeExamples ? `import type { Item, CreateItemInput, UpdateItemInput, ListOptions, PaginatedResult } from './types/api'\n` : ''

  const examples = options.includeExamples
    ? `
  private items: Map<string, Item> = new Map()

  /**
   * CRUD namespace for items
   */
  items = {
    /**
     * Create a new item
     */
    create: async (input: CreateItemInput): Promise<Item> => {
      const item: Item = {
        id: crypto.randomUUID(),
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.items.set(item.id, item)
      return item
    },

    /**
     * Get an item by ID
     */
    get: async (id: string): Promise<Item | null> => {
      return this.items.get(id) || null
    },

    /**
     * Update an item
     */
    update: async (id: string, input: UpdateItemInput): Promise<Item> => {
      const item = this.items.get(id)
      if (!item) throw new Error(\`Item \${id} not found\`)

      const updated: Item = {
        ...item,
        ...input,
        updatedAt: new Date().toISOString(),
      }
      this.items.set(id, updated)
      return updated
    },

    /**
     * Delete an item
     */
    delete: async (id: string): Promise<boolean> => {
      return this.items.delete(id)
    },

    /**
     * List items with pagination
     */
    list: async (options: ListOptions = {}): Promise<PaginatedResult<Item>> => {
      const { limit = 20, offset = 0 } = options
      const all = Array.from(this.items.values())
      const items = all.slice(offset, offset + limit)
      return {
        items,
        total: all.length,
        limit,
        offset,
        hasMore: offset + limit < all.length,
      }
    },

    /**
     * Count total items
     */
    count: async (): Promise<number> => {
      return this.items.size
    },
  }

  /**
   * Health check endpoint
   */
  async health(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }
  }`
    : `
  // Implement your CRUD methods here:
  // items = {
  //   create: async (input: CreateInput): Promise<Item> => { ... },
  //   get: async (id: string): Promise<Item | null> => { ... },
  //   update: async (id: string, input: UpdateInput): Promise<Item> => { ... },
  //   delete: async (id: string): Promise<boolean> => { ... },
  //   list: async (options?: ListOptions): Promise<PaginatedResult<Item>> => { ... },
  // }`

  return `import { DurableRPC } from 'rpc.do'
${importTypes}
export interface Env {
  RPC_DO: DurableObjectNamespace
}

/**
 * API Durable Object
 *
 * REST-like CRUD operations with namespaced methods.
 * Supports create, read, update, delete, and list operations.
 */
export class ApiDO extends DurableRPC {${examples}
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.RPC_DO.idFromName('default')
    const stub = env.RPC_DO.get(id)
    return stub.fetch(request)
  },
}
`
}

function generateChatTypes(): string {
  return `/**
 * Chat types
 */

export interface User {
  id: string
  username: string
  joinedAt: string
}

export interface Message {
  id: string
  userId: string
  username: string
  text: string
  timestamp: string
}

export interface ChatRoom {
  userCount: number
  messageCount: number
}

export type ChatEvent =
  | { type: 'user_joined'; user: User }
  | { type: 'user_left'; user: User }
  | { type: 'message'; message: Message }
`
}

function generateApiTypes(): string {
  return `/**
 * API types
 */

export interface Item {
  id: string
  name: string
  description?: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateItemInput {
  name: string
  description?: string
  data?: Record<string, unknown>
}

export interface UpdateItemInput {
  name?: string
  description?: string
  data?: Record<string, unknown>
}

export interface ListOptions {
  limit?: number
  offset?: number
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}
`
}

function printNextSteps(options: WizardOptions): void {
  const templateInfo = TEMPLATES[options.template]
  const className = getClassName(options.template)

  console.log(`
Project created successfully!

Template: ${templateInfo.name} - ${templateInfo.description}

Next steps:

  cd ${options.outputDir}
  npm install && npm run dev

Then visit http://localhost:8787 to see your RPC endpoint.

Files created:
  ${options.outputDir}/
  ├── src/
  │   └── index.ts          (Worker entrypoint with ${className})${options.template !== 'basic' && options.includeExamples ? `
  │   └── types/
  │       └── ${options.template}.ts      (Type definitions)` : ''}
  ├── wrangler.toml         (Cloudflare config)
  ├── package.json          (Dependencies)
  ├── tsconfig.json         (TypeScript config)
  └── do.config.ts          (rpc.do config)

Test your RPC endpoint:
  curl -X POST http://localhost:8787 \\
    -H "Content-Type: application/json" \\
    -d '{"method": "${options.template === 'basic' ? 'hello' : options.template === 'chat' ? 'join' : 'items.create'}", "params": [${options.template === 'basic' ? '"World"' : options.template === 'chat' ? '"user1", "Alice"' : '{"name": "test"}'}]}'
`)
}
