/**
 * CLI --source Flag Tests (RED PHASE)
 *
 * Tests for `npx rpc.do generate --source ./MyDO.ts` that extracts full TypeScript types
 * using ts-morph for static type analysis.
 *
 * These tests are written for the RED phase of TDD - they should ALL FAIL initially
 * because the --source flag is not yet implemented in src/cli.ts.
 *
 * The current CLI only supports --url flag which fetches runtime schema (weak types).
 * We want to add --source flag for static type extraction (full types).
 *
 * Target output (fully typed):
 * ```typescript
 * export interface GeneratedAPI {
 *   users: {
 *     get(id: string): Promise<User | null>
 *     create(data: CreateUserInput): Promise<User>
 *   }
 * }
 * ```
 *
 * Instead of current weak types:
 * ```typescript
 * export interface GeneratedAPI {
 *   users: {
 *     get(...args: any[]): Promise<any>
 *   }
 * }
 * ```
 *
 * RED PHASE TDD: All describe blocks are skipped until the --source flag is implemented.
 * Once implemented, remove the .skip from the describe blocks below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve as pathResolve } from 'node:path'
import { spawn, execSync, type ChildProcess } from 'node:child_process'

// ============================================================================
// Test Fixtures - TypeScript DO Source Files
// ============================================================================

/**
 * Basic DO with simple method signatures
 */
const BASIC_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export class TestDO extends DurableObject {
  async greet(name: string): Promise<string> {
    return \`Hello \${name}\`
  }

  async add(a: number, b: number): Promise<number> {
    return a + b
  }
}
`

/**
 * DO with namespace objects (grouped methods)
 */
const NAMESPACE_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

export interface CreateUserInput {
  name: string
  email: string
}

export class UserDO extends DurableObject {
  users = {
    get: async (id: string): Promise<User | null> => {
      // implementation
      return null
    },

    create: async (data: CreateUserInput): Promise<User> => {
      return { id: '1', ...data, createdAt: new Date() }
    },

    list: async (limit?: number): Promise<User[]> => {
      return []
    },

    delete: async (id: string): Promise<boolean> => {
      return true
    }
  }

  async ping(): Promise<'pong'> {
    return 'pong'
  }
}
`

/**
 * DO with imported types from separate file
 */
const TYPES_FILE_SOURCE = `
export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

export type UserRole = 'admin' | 'user' | 'guest'

export interface CreateUserInput {
  name: string
  email: string
  role?: UserRole
}

export interface ListOptions {
  limit?: number
  offset?: number
  sortBy?: 'name' | 'createdAt'
}
`

const DO_WITH_IMPORTS_SOURCE = `
import { DurableObject } from 'cloudflare:workers'
import { User, CreateUserInput, ListOptions } from './types'

export class ImportsDO extends DurableObject {
  users = {
    get: async (id: string): Promise<User | null> => {
      return null
    },

    create: async (input: CreateUserInput): Promise<User> => {
      return { id: '1', name: input.name, email: input.email, role: input.role || 'user' }
    },

    list: async (options?: ListOptions): Promise<User[]> => {
      return []
    }
  }
}
`

/**
 * DO with generic types like Collection<T>
 */
const GENERIC_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export interface Collection<T> {
  get(id: string): Promise<T | null>
  put(id: string, item: T): Promise<void>
  delete(id: string): Promise<boolean>
  find(query: Partial<T>): Promise<T[]>
}

export interface Product {
  id: string
  name: string
  price: number
}

export interface Order {
  id: string
  productIds: string[]
  total: number
}

export class GenericDO extends DurableObject {
  products: Collection<Product> = this.createCollection('products')
  orders: Collection<Order> = this.createCollection('orders')

  private createCollection<T>(name: string): Collection<T> {
    // implementation
    return {} as Collection<T>
  }

  async getProductWithOrders(productId: string): Promise<{ product: Product | null; orders: Order[] }> {
    return { product: null, orders: [] }
  }
}
`

/**
 * DO with private methods that should be excluded
 */
const PRIVATE_METHODS_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export class PrivateDO extends DurableObject {
  // Public method - should be included
  async publicMethod(input: string): Promise<string> {
    return this._helperMethod(input)
  }

  // Private method with underscore - should be excluded
  private async _helperMethod(input: string): Promise<string> {
    return input.toUpperCase()
  }

  // Private method with # - should be excluded
  async #internalProcess(data: any): Promise<void> {
    // internal
  }

  // Another public method
  async anotherPublic(count: number): Promise<number[]> {
    return Array.from({ length: count }, (_, i) => i)
  }

  // Protected should also be excluded
  protected async protectedMethod(): Promise<void> {
    // protected
  }
}
`

/**
 * DO with system methods that should be excluded (fetch, alarm, etc.)
 */
const SYSTEM_METHODS_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export class SystemDO extends DurableObject {
  // System method - should be excluded
  async fetch(request: Request): Promise<Response> {
    return new Response('ok')
  }

  // System method - should be excluded
  async alarm(): Promise<void> {
    // alarm handler
  }

  // System method - should be excluded
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // websocket handler
  }

  // System method - should be excluded
  async webSocketClose(ws: WebSocket): Promise<void> {
    // close handler
  }

  // System method - should be excluded
  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    // error handler
  }

  // User method - should be included
  async customMethod(input: string): Promise<{ result: string }> {
    return { result: input }
  }

  // User namespace - should be included
  api = {
    health: async (): Promise<{ status: 'ok' | 'error' }> => {
      return { status: 'ok' }
    }
  }
}
`

/**
 * DO with complex nested types
 */
const COMPLEX_TYPES_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export interface Address {
  street: string
  city: string
  country: string
  postalCode: string
}

export interface ContactInfo {
  email: string
  phone?: string
  address: Address
}

export interface Company {
  id: string
  name: string
  employees: Employee[]
  headquarters: Address
}

export interface Employee {
  id: string
  name: string
  contact: ContactInfo
  department: string
  manager?: Employee
}

export type QueryResult<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export class ComplexDO extends DurableObject {
  companies = {
    get: async (id: string): Promise<Company | null> => null,

    search: async (query: string, page?: number): Promise<QueryResult<Company>> => {
      return { data: [], total: 0, page: page || 1, pageSize: 10 }
    },

    addEmployee: async (companyId: string, employee: Omit<Employee, 'id'>): Promise<Employee> => {
      return { id: '1', ...employee } as Employee
    }
  }

  async getEmployeesByDepartment(
    companyId: string,
    department: string,
    includeManagers?: boolean
  ): Promise<Employee[]> {
    return []
  }
}
`

/**
 * DO extending DurableRPC (our base class)
 */
const DURABLE_RPC_DO_SOURCE = `
import { DurableRPC } from 'rpc.do'

export interface Task {
  id: string
  title: string
  completed: boolean
  dueDate?: Date
}

export class TaskDO extends DurableRPC {
  tasks = {
    get: async (id: string): Promise<Task | null> => null,
    create: async (title: string, dueDate?: Date): Promise<Task> => {
      return { id: '1', title, completed: false, dueDate }
    },
    complete: async (id: string): Promise<Task> => {
      return { id, title: '', completed: true }
    },
    list: async (): Promise<Task[]> => []
  }
}
`

/**
 * Invalid file - not a valid DO class
 */
const INVALID_DO_SOURCE = `
// This is not a valid DO - no class extending DurableObject
export function someFunction() {
  return 'not a DO'
}

export const someConstant = 42
`

/**
 * DO with union and intersection types
 */
const UNION_INTERSECTION_DO_SOURCE = `
import { DurableObject } from 'cloudflare:workers'

export type Status = 'pending' | 'active' | 'completed' | 'cancelled'

export interface BaseEntity {
  id: string
  createdAt: Date
  updatedAt: Date
}

export interface Timestamped {
  timestamp: number
}

export type Entity<T> = BaseEntity & T & Timestamped

export interface ProjectData {
  name: string
  description: string
  status: Status
}

export type Project = Entity<ProjectData>

export class UnionDO extends DurableObject {
  async getByStatus(status: Status | Status[]): Promise<Project[]> {
    return []
  }

  async updateStatus(id: string, status: Status): Promise<Project & { previousStatus: Status }> {
    return {} as any
  }
}
`

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Custom error for CLI process exit
 */
class CLIError extends Error {
  constructor(
    public exitCode: number,
    public stdout: string,
    public stderr: string
  ) {
    super(`CLI exited with code ${exitCode}`)
    this.name = 'CLIError'
  }
}

/**
 * Run the CLI with given arguments and return the result
 */
async function runCLI(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const cliPath = pathResolve(__dirname, '../dist/cli.js')
    const child = spawn('node', [cliPath, ...args], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code || 0 })
    })

    child.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 })
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill()
      resolve({ stdout, stderr: 'Timeout', exitCode: 124 })
    }, 30000)
  })
}

/**
 * Run CLI synchronously (for simpler tests)
 */
function runCLISync(args: string[], cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  const cliPath = pathResolve(__dirname, '../dist/cli.js')
  try {
    const result = execSync(`node ${cliPath} ${args.join(' ')}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    return { stdout: result, stderr: '', exitCode: 0 }
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.status || 1,
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('CLI --source flag', () => {
  const testDir = join(__dirname, '.test-fixtures-source')
  const outputDir = join(testDir, '.do')

  beforeEach(() => {
    // Create fresh test directory
    rmSync(testDir, { recursive: true, force: true })
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true })
  })

  // ==========================================================================
  // Test 1: CLI accepts --source flag with path to DO source file
  // ==========================================================================
  describe('accepts --source flag', () => {
    it('should accept --source flag with a file path', async () => {
      // Write a test DO file
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      // Run CLI with --source flag
      const result = await runCLI(['generate', '--source', join(testDir, 'TestDO.ts')])

      // Should not error about unknown flag
      expect(result.stderr).not.toContain('Unknown flag')
      expect(result.stderr).not.toContain('unknown option')

      // Should recognize the --source flag (even if implementation isn't complete)
      // This test fails because --source is not implemented
      expect(result.stdout).toContain('source')
    })

    it('should accept --source with --output flag together', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      const result = await runCLI([
        'generate',
        '--source',
        join(testDir, 'TestDO.ts'),
        '--output',
        outputDir,
      ])

      // Should process both flags
      expect(result.stderr).not.toContain('Cannot use --source with --url')
    })

    it('should error when both --source and --url are provided', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      const result = await runCLI([
        'generate',
        '--source',
        join(testDir, 'TestDO.ts'),
        '--url',
        'https://example.com',
      ])

      // Should error because these flags are mutually exclusive
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Cannot use both --source and --url')
    })
  })

  // ==========================================================================
  // Test 2: CLI can parse a TypeScript DO source file
  // ==========================================================================
  describe('parses TypeScript source files', () => {
    it('should parse a valid TypeScript DO file', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      // Should successfully parse and not error
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Parsing')
    })

    it('should handle TypeScript syntax errors gracefully', async () => {
      // Write invalid TypeScript
      writeFileSync(join(testDir, 'Invalid.ts'), `
        export class Broken {
          this is not valid typescript syntax {{{{
        }
      `)

      const result = await runCLI(['generate', '--source', join(testDir, 'Invalid.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('syntax error')
    })
  })

  // ==========================================================================
  // Test 3: Extracts top-level method signatures with full param and return types
  // ==========================================================================
  describe('extracts top-level method signatures', () => {
    it('should extract method with string param and return type', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)

      // Check generated .d.ts file
      const dtsPath = join(outputDir, 'TestDO.d.ts')
      expect(existsSync(dtsPath)).toBe(true)

      const dtsContent = readFileSync(dtsPath, 'utf-8')

      // Should have full type signature, NOT `(...args: any[]): Promise<any>`
      expect(dtsContent).toContain('greet(name: string): Promise<string>')
    })

    it('should extract method with multiple params', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'TestDO.d.ts'), 'utf-8')

      // Should preserve multiple parameters with their types
      expect(dtsContent).toContain('add(a: number, b: number): Promise<number>')
    })

    it('should extract literal return types', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), NAMESPACE_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'UserDO.d.ts'), 'utf-8')

      // Should preserve literal type 'pong'
      expect(dtsContent).toContain("ping(): Promise<'pong'>")
    })
  })

  // ==========================================================================
  // Test 4: Extracts namespace objects with their methods
  // ==========================================================================
  describe('extracts namespace objects', () => {
    it('should extract namespace object with methods', async () => {
      writeFileSync(join(testDir, 'UserDO.ts'), NAMESPACE_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'UserDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)

      const dtsContent = readFileSync(join(outputDir, 'UserDO.d.ts'), 'utf-8')

      // Should have users namespace
      expect(dtsContent).toContain('users: {')
      expect(dtsContent).toContain('get(id: string): Promise<User | null>')
      expect(dtsContent).toContain('create(data: CreateUserInput): Promise<User>')
      expect(dtsContent).toContain('list(limit?: number): Promise<User[]>')
      expect(dtsContent).toContain('delete(id: string): Promise<boolean>')
    })

    it('should handle multiple namespaces', async () => {
      const multiNamespaceSource = `
        import { DurableObject } from 'cloudflare:workers'

        export class MultiDO extends DurableObject {
          users = {
            list: async (): Promise<string[]> => []
          }

          posts = {
            list: async (): Promise<number[]> => []
          }

          comments = {
            count: async (): Promise<number> => 0
          }
        }
      `
      writeFileSync(join(testDir, 'MultiDO.ts'), multiNamespaceSource)

      await runCLI(['generate', '--source', join(testDir, 'MultiDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'MultiDO.d.ts'), 'utf-8')

      expect(dtsContent).toContain('users: {')
      expect(dtsContent).toContain('posts: {')
      expect(dtsContent).toContain('comments: {')
    })
  })

  // ==========================================================================
  // Test 5: Generates .do/*.d.ts files with proper type definitions
  // ==========================================================================
  describe('generates proper .d.ts files', () => {
    it('should generate .d.ts file in output directory', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      expect(existsSync(join(outputDir, 'TestDO.d.ts'))).toBe(true)
    })

    it('should generate valid TypeScript declaration file', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'TestDO.d.ts'), 'utf-8')

      // Should be a valid declaration file
      expect(dtsContent).toContain('export interface')
      expect(dtsContent).not.toContain('function implementation')
      expect(dtsContent).not.toContain('return ')
    })

    it('should include header comment indicating generation', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'TestDO.d.ts'), 'utf-8')

      expect(dtsContent).toContain('// Generated by')
      expect(dtsContent).toContain('rpc.do generate --source')
    })

    it('should generate index.ts entrypoint file', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir])

      const indexPath = join(outputDir, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)

      const indexContent = readFileSync(indexPath, 'utf-8')
      expect(indexContent).toContain("import type { TestDOAPI } from './TestDO'")
      expect(indexContent).toContain('export type { TestDOAPI }')
    })
  })

  // ==========================================================================
  // Test 6: Handles imported types (User, CreateUserInput, etc.)
  // ==========================================================================
  describe('handles imported types', () => {
    it('should resolve imported types from local files', async () => {
      // Write types file
      writeFileSync(join(testDir, 'types.ts'), TYPES_FILE_SOURCE)
      // Write DO file that imports from types
      writeFileSync(join(testDir, 'ImportsDO.ts'), DO_WITH_IMPORTS_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'ImportsDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)

      const dtsContent = readFileSync(join(outputDir, 'ImportsDO.d.ts'), 'utf-8')

      // Should include the imported types in output or reference them
      expect(dtsContent).toMatch(/User|import.*User/)
      expect(dtsContent).toMatch(/CreateUserInput|import.*CreateUserInput/)
      expect(dtsContent).toMatch(/ListOptions|import.*ListOptions/)
    })

    it('should inline or re-export imported types', async () => {
      writeFileSync(join(testDir, 'types.ts'), TYPES_FILE_SOURCE)
      writeFileSync(join(testDir, 'ImportsDO.ts'), DO_WITH_IMPORTS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ImportsDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'ImportsDO.d.ts'), 'utf-8')

      // Either the types are inlined or there's an import statement
      const hasInlinedTypes = dtsContent.includes('interface User') || dtsContent.includes('type User')
      const hasImport = dtsContent.includes("from './types'") || dtsContent.includes('from "../types"')

      expect(hasInlinedTypes || hasImport).toBe(true)
    })

    it('should handle type aliases correctly', async () => {
      writeFileSync(join(testDir, 'types.ts'), TYPES_FILE_SOURCE)
      writeFileSync(join(testDir, 'ImportsDO.ts'), DO_WITH_IMPORTS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ImportsDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'ImportsDO.d.ts'), 'utf-8')

      // Should preserve or inline the UserRole type alias
      expect(dtsContent).toMatch(/UserRole|'admin' \| 'user' \| 'guest'/)
    })
  })

  // ==========================================================================
  // Test 7: Handles generic types like Collection<T>
  // ==========================================================================
  describe('handles generic types', () => {
    it('should preserve generic type parameters', async () => {
      writeFileSync(join(testDir, 'GenericDO.ts'), GENERIC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'GenericDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)

      const dtsContent = readFileSync(join(outputDir, 'GenericDO.d.ts'), 'utf-8')

      // Should preserve generic types
      expect(dtsContent).toContain('Collection<Product>')
      expect(dtsContent).toContain('Collection<Order>')
    })

    it('should expand Collection<T> interface methods', async () => {
      writeFileSync(join(testDir, 'GenericDO.ts'), GENERIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'GenericDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'GenericDO.d.ts'), 'utf-8')

      // Should include the Collection interface or its methods
      expect(dtsContent).toMatch(/get\(id: string\): Promise<.+ \| null>/)
      expect(dtsContent).toMatch(/put\(id: string, item: .+\): Promise<void>/)
    })

    it('should handle complex return types with generics', async () => {
      writeFileSync(join(testDir, 'GenericDO.ts'), GENERIC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'GenericDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'GenericDO.d.ts'), 'utf-8')

      // Complex return type
      expect(dtsContent).toContain('getProductWithOrders(productId: string): Promise<{ product: Product | null; orders: Order[] }>')
    })
  })

  // ==========================================================================
  // Test 8: Excludes private methods (starting with _)
  // ==========================================================================
  describe('excludes private methods', () => {
    it('should exclude methods starting with underscore', async () => {
      writeFileSync(join(testDir, 'PrivateDO.ts'), PRIVATE_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'PrivateDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'PrivateDO.d.ts'), 'utf-8')

      // Should NOT include _helperMethod
      expect(dtsContent).not.toContain('_helperMethod')

      // Should include public methods
      expect(dtsContent).toContain('publicMethod')
      expect(dtsContent).toContain('anotherPublic')
    })

    it('should exclude private keyword methods', async () => {
      writeFileSync(join(testDir, 'PrivateDO.ts'), PRIVATE_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'PrivateDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'PrivateDO.d.ts'), 'utf-8')

      // Should NOT include methods with private keyword
      expect(dtsContent).not.toContain('private')
    })

    it('should exclude protected methods', async () => {
      writeFileSync(join(testDir, 'PrivateDO.ts'), PRIVATE_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'PrivateDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'PrivateDO.d.ts'), 'utf-8')

      // Should NOT include protected methods
      expect(dtsContent).not.toContain('protectedMethod')
      expect(dtsContent).not.toContain('protected')
    })

    it('should exclude # private fields', async () => {
      writeFileSync(join(testDir, 'PrivateDO.ts'), PRIVATE_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'PrivateDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'PrivateDO.d.ts'), 'utf-8')

      // Should NOT include #private methods
      expect(dtsContent).not.toContain('#internalProcess')
      expect(dtsContent).not.toContain('internalProcess')
    })
  })

  // ==========================================================================
  // Test 9: Excludes system methods (fetch, alarm, etc.)
  // ==========================================================================
  describe('excludes system methods', () => {
    it('should exclude fetch method', async () => {
      writeFileSync(join(testDir, 'SystemDO.ts'), SYSTEM_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'SystemDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'SystemDO.d.ts'), 'utf-8')

      // Should NOT include system fetch method
      expect(dtsContent).not.toMatch(/fetch\(.*Request.*\)/)
    })

    it('should exclude alarm method', async () => {
      writeFileSync(join(testDir, 'SystemDO.ts'), SYSTEM_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'SystemDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'SystemDO.d.ts'), 'utf-8')

      // Should NOT include system alarm method
      expect(dtsContent).not.toMatch(/\balarm\(\)/)
    })

    it('should exclude webSocket handlers', async () => {
      writeFileSync(join(testDir, 'SystemDO.ts'), SYSTEM_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'SystemDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'SystemDO.d.ts'), 'utf-8')

      expect(dtsContent).not.toContain('webSocketMessage')
      expect(dtsContent).not.toContain('webSocketClose')
      expect(dtsContent).not.toContain('webSocketError')
    })

    it('should include user-defined methods', async () => {
      writeFileSync(join(testDir, 'SystemDO.ts'), SYSTEM_METHODS_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'SystemDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'SystemDO.d.ts'), 'utf-8')

      // Should include user methods
      expect(dtsContent).toContain('customMethod')
      expect(dtsContent).toContain('api: {')
      expect(dtsContent).toContain('health')
    })
  })

  // ==========================================================================
  // Test 10: Errors gracefully if file not found or not a valid DO
  // ==========================================================================
  describe('error handling', () => {
    it('should error if source file not found', async () => {
      const result = await runCLI(['generate', '--source', join(testDir, 'NonExistent.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/not found|does not exist|ENOENT/)
    })

    it('should error if file is not a TypeScript file', async () => {
      writeFileSync(join(testDir, 'notts.js'), 'export const x = 1')

      const result = await runCLI(['generate', '--source', join(testDir, 'notts.js'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/TypeScript|\.ts/)
    })

    it('should error if no valid DO class found', async () => {
      writeFileSync(join(testDir, 'Invalid.ts'), INVALID_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'Invalid.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/No.*DurableObject|class.*not found|invalid/)
    })

    it('should error with helpful message for empty file', async () => {
      writeFileSync(join(testDir, 'Empty.ts'), '')

      const result = await runCLI(['generate', '--source', join(testDir, 'Empty.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/empty|no content|no class/)
    })

    it('should handle permission errors gracefully', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      // Create output directory without write permission (Unix only)
      const restrictedDir = join(testDir, 'restricted')
      mkdirSync(restrictedDir, { mode: 0o444 })

      const result = await runCLI(['generate', '--source', join(testDir, 'TestDO.ts'), '--output', restrictedDir])

      // Restore permissions for cleanup
      try {
        execSync(`chmod 755 ${restrictedDir}`)
      } catch {}

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/permission|EACCES|cannot write/)
    })
  })

  // ==========================================================================
  // Additional Tests: Complex Type Handling
  // ==========================================================================
  describe('handles complex types', () => {
    it('should handle nested object types', async () => {
      writeFileSync(join(testDir, 'ComplexDO.ts'), COMPLEX_TYPES_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ComplexDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'ComplexDO.d.ts'), 'utf-8')

      // Should include complex nested types
      expect(dtsContent).toMatch(/Company|Address|Employee|ContactInfo/)
    })

    it('should handle union types', async () => {
      writeFileSync(join(testDir, 'UnionDO.ts'), UNION_INTERSECTION_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'UnionDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'UnionDO.d.ts'), 'utf-8')

      // Should preserve union type in parameter
      expect(dtsContent).toContain('Status | Status[]')
    })

    it('should handle intersection types', async () => {
      writeFileSync(join(testDir, 'UnionDO.ts'), UNION_INTERSECTION_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'UnionDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'UnionDO.d.ts'), 'utf-8')

      // Should preserve intersection type in return
      expect(dtsContent).toMatch(/Project & \{ previousStatus: Status \}/)
    })

    it('should handle optional parameters', async () => {
      writeFileSync(join(testDir, 'UserDO.ts'), NAMESPACE_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'UserDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'UserDO.d.ts'), 'utf-8')

      // Should preserve optional parameter
      expect(dtsContent).toContain('limit?: number')
    })

    it('should handle Omit utility type', async () => {
      writeFileSync(join(testDir, 'ComplexDO.ts'), COMPLEX_TYPES_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ComplexDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'ComplexDO.d.ts'), 'utf-8')

      // Should preserve Omit utility type
      expect(dtsContent).toMatch(/Omit<Employee, ['"]id['"]>/)
    })
  })

  // ==========================================================================
  // Tests for DurableRPC base class
  // ==========================================================================
  describe('handles DurableRPC base class', () => {
    it('should recognize DurableRPC as valid base class', async () => {
      writeFileSync(join(testDir, 'TaskDO.ts'), DURABLE_RPC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'TaskDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)
      expect(existsSync(join(outputDir, 'TaskDO.d.ts'))).toBe(true)
    })

    it('should extract types from DurableRPC class', async () => {
      writeFileSync(join(testDir, 'TaskDO.ts'), DURABLE_RPC_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'TaskDO.ts'), '--output', outputDir])

      const dtsContent = readFileSync(join(outputDir, 'TaskDO.d.ts'), 'utf-8')

      expect(dtsContent).toContain('tasks: {')
      expect(dtsContent).toContain('get(id: string): Promise<Task | null>')
      expect(dtsContent).toContain('create(title: string, dueDate?: Date): Promise<Task>')
    })
  })

  // ==========================================================================
  // Test for glob patterns
  // ==========================================================================
  describe('handles glob patterns', () => {
    it('should accept glob pattern for multiple files', async () => {
      writeFileSync(join(testDir, 'UserDO.ts'), NAMESPACE_DO_SOURCE)
      writeFileSync(join(testDir, 'TaskDO.ts'), DURABLE_RPC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, '*.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)

      // Should generate types for both files
      expect(existsSync(join(outputDir, 'UserDO.d.ts'))).toBe(true)
      expect(existsSync(join(outputDir, 'TaskDO.d.ts'))).toBe(true)
    })

    it('should handle **/*.ts glob pattern', async () => {
      mkdirSync(join(testDir, 'nested'), { recursive: true })
      writeFileSync(join(testDir, 'UserDO.ts'), NAMESPACE_DO_SOURCE)
      writeFileSync(join(testDir, 'nested', 'TaskDO.ts'), DURABLE_RPC_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, '**/*.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)
    })
  })

  // ==========================================================================
  // Test for watch mode with source
  // ==========================================================================
  describe('watch mode with --source', () => {
    it('should support watch command with --source flag', async () => {
      writeFileSync(join(testDir, 'TestDO.ts'), BASIC_DO_SOURCE)

      // Start watch mode (it should start and we kill it quickly)
      const child = spawn('node', [pathResolve(__dirname, '../dist/cli.js'), 'watch', '--source', join(testDir, 'TestDO.ts'), '--output', outputDir], {
        cwd: testDir,
      })

      let stdout = ''
      child.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      // Wait a bit then kill
      await new Promise((resolve) => setTimeout(resolve, 500))
      child.kill()

      // Should have started watching
      expect(stdout).toMatch(/watching|Watching/)
    })
  })

  // ==========================================================================
  // Test for help text update
  // ==========================================================================
  describe('help text includes --source', () => {
    it('should include --source in help output', async () => {
      const result = await runCLI(['--help'])

      expect(result.stdout).toContain('--source')
      expect(result.stdout).toMatch(/--source.*<file>|--source.*<path>/)
    })

    it('should document --source and --url options', async () => {
      const result = await runCLI(['--help'])

      // Both options should be documented in help text
      expect(result.stdout).toMatch(/--source/)
      expect(result.stdout).toMatch(/--url/)
    })
  })
})
