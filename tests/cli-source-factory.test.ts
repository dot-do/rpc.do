/**
 * CLI --source Flag Tests for DO() Factory Pattern (RED PHASE)
 *
 * Tests for extracting types from DO() factory pattern source files
 * using ts-morph for static type analysis.
 *
 * These tests are written for the RED phase of TDD - they should ALL FAIL initially
 * because the current extractor only supports class-based patterns
 * (classes extending DurableObject/DurableRPC/DigitalObject).
 *
 * The DO() factory pattern:
 * ```typescript
 * export default DO(async ($) => {
 *   $.on.User.created(async (user) => {})  // Setup - NOT part of API
 *   $.every.hour(async () => {})            // Setup - NOT part of API
 *
 *   return {
 *     ping: async (): Promise<'pong'> => 'pong',  // API method
 *     users: { get: async (id: string) => null }  // API namespace
 *   }
 * })
 * ```
 *
 * Run: pnpm test tests/cli-source-factory.test.ts
 *
 * RED PHASE TDD: All describe blocks are skipped until the --source flag is implemented.
 * Once implemented, remove the .skip from the describe blocks below.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve as pathResolve } from 'node:path'
import { execSync } from 'node:child_process'

// ============================================================================
// Test Fixtures - DO() Factory Pattern Source Files
// ============================================================================

/**
 * Factory pattern fixture with User types and both setup code and API
 */
const FACTORY_DO_SOURCE = `
interface User {
  id: string
  name: string
}

interface CreateUserInput {
  name: string
}

declare const DO: any

export default DO(async ($) => {
  // Setup (should NOT be in API)
  $.on.User.created(async (user) => {})
  $.every.hour(async () => {})

  // Return the RPC API (should be extracted)
  return {
    ping: async (): Promise<'pong'> => 'pong',
    greet: async (name: string): Promise<string> => \`Hello \${name}\`,
    users: {
      get: async (id: string): Promise<User | null> => null,
      create: async (data: CreateUserInput): Promise<User> => ({ id: '1', ...data }),
    }
  }
})
`

/**
 * Both class and factory patterns in same file
 */
const BOTH_PATTERNS_SOURCE = `
declare class DigitalObject {}
declare const DO: any

// Class pattern
export class MyClassDO extends DigitalObject {
  async classMethod(): Promise<string> { return 'from class' }
}

// Factory pattern
export default DO(async ($) => {
  return {
    factoryMethod: async (): Promise<string> => 'from factory'
  }
})
`

/**
 * Factory with deeply nested namespaces
 */
const NESTED_NAMESPACE_FACTORY_SOURCE = `
interface Product {
  id: string
  name: string
  price: number
}

declare const DO: any

export default DO(async ($) => {
  return {
    api: {
      v1: {
        products: {
          get: async (id: string): Promise<Product | null> => null,
          list: async (limit?: number): Promise<Product[]> => [],
        }
      }
    }
  }
})
`

/**
 * Factory with synchronous methods
 */
const SYNC_METHODS_FACTORY_SOURCE = `
declare const DO: any

export default DO(($) => {
  return {
    sync: {
      add: (a: number, b: number): number => a + b,
      multiply: (a: number, b: number): number => a * b,
    },
    async: {
      compute: async (value: number): Promise<number> => value * 2,
    }
  }
})
`

/**
 * Factory without return statement (invalid)
 */
const NO_RETURN_FACTORY_SOURCE = `
declare const DO: any

export default DO(async ($) => {
  // Missing return statement - should error
  $.on.init(async () => {})
})
`

/**
 * Factory with method shorthand syntax
 */
const METHOD_SHORTHAND_FACTORY_SOURCE = `
declare const DO: any

export default DO(async ($) => {
  return {
    // Method shorthand
    async ping() {
      return 'pong' as const
    },

    async greet(name: string) {
      return \`Hello \${name}\`
    },

    // Arrow function for comparison
    echo: async (msg: string): Promise<string> => msg
  }
})
`

/**
 * Factory with external type imports
 */
const FACTORY_TYPES_FILE = `
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
`

const FACTORY_WITH_IMPORTS_SOURCE = `
import { User, CreateUserInput, UserRole } from './types'

declare const DO: any

export default DO(async ($) => {
  return {
    users: {
      get: async (id: string): Promise<User | null> => null,
      create: async (input: CreateUserInput): Promise<User> => {
        return { id: '1', name: input.name, email: input.email, role: input.role || 'user' }
      },
      getByRole: async (role: UserRole): Promise<User[]> => []
    }
  }
})
`

/**
 * Factory with generic types
 */
const GENERIC_FACTORY_SOURCE = `
interface Collection<T> {
  get(id: string): Promise<T | null>
  list(): Promise<T[]>
  create(data: Omit<T, 'id'>): Promise<T>
}

interface Product {
  id: string
  name: string
}

interface Order {
  id: string
  total: number
}

declare const DO: any

export default DO(async ($) => {
  return {
    products: $.collection<Product>('products') as Collection<Product>,
    orders: $.collection<Order>('orders') as Collection<Order>,

    // Direct method
    getProductWithOrders: async (productId: string): Promise<{ product: Product | null; orders: Order[] }> => {
      return { product: null, orders: [] }
    }
  }
})
`

/**
 * Factory with complex union and intersection types
 */
const COMPLEX_TYPES_FACTORY_SOURCE = `
type Status = 'pending' | 'active' | 'completed' | 'cancelled'

interface BaseEntity {
  id: string
  createdAt: Date
}

type EntityWithStatus<T> = BaseEntity & T & { status: Status }

interface TaskData {
  title: string
  description?: string
}

type Task = EntityWithStatus<TaskData>

declare const DO: any

export default DO(async ($) => {
  return {
    tasks: {
      get: async (id: string): Promise<Task | null> => null,
      create: async (data: TaskData): Promise<Task> => ({} as Task),
      updateStatus: async (id: string, status: Status): Promise<Task & { previousStatus: Status }> => ({} as any),
      findByStatus: async (status: Status | Status[]): Promise<Task[]> => []
    }
  }
})
`

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Run the CLI with given arguments and return the result.
 * Uses execSync internally for reliability -- avoids race conditions
 * between file writes in the test and the spawned child process
 * not seeing the files on disk.
 */
async function runCLI(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cliPath = pathResolve(__dirname, '../dist/cli.js')
  // Quote each argument to prevent shell glob expansion and handle paths with spaces
  const quotedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')
  try {
    const result = execSync(`node '${cliPath}' ${quotedArgs}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 30000,
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
// Test Suite for DO() Factory Pattern
// ============================================================================

describe('CLI --source flag with DO() factory pattern', { timeout: 15000, retry: 2 }, () => {
  const testDir = join(__dirname, '.test-fixtures-factory')
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
  // Test 1: Extractor finds DO() call expression in source file
  // ==========================================================================
  describe('finds DO() call expression', () => {
    it('should recognize DO() factory pattern as valid DO source', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      // Should NOT error about "No DurableObject class found"
      expect(result.stderr).not.toContain('No DurableObject class found')
      expect(result.stderr).not.toContain('No.*class.*found')
      expect(result.exitCode).toBe(0)
    })

    it('should find DO() even with different callback signatures', async () => {
      // Non-async callback
      const syncCallbackSource = `
        declare const DO: any
        export default DO(($) => {
          return { ping: (): string => 'pong' }
        })
      `
      writeFileSync(join(testDir, 'SyncFactoryDO.ts'), syncCallbackSource)

      const result = await runCLI(['generate', '--source', join(testDir, 'SyncFactoryDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)
    })

    it('should generate .d.ts file for factory pattern', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      // Should generate a .d.ts file (name derived from filename or 'FactoryDOAPI')
      const files = existsSync(outputDir) ? require('node:fs').readdirSync(outputDir) : []
      const dtsFiles = files.filter((f: string) => f.endsWith('.d.ts'))
      expect(dtsFiles.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // Test 2: Extracts return type of the factory callback
  // ==========================================================================
  describe('extracts return type of factory callback', () => {
    it('should extract methods from returned object literal', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])
      expect(result.exitCode).toBe(0)

      // Find the generated .d.ts file
      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      expect(dtsFile).toBeDefined()

      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should have the ping method
      expect(dtsContent).toContain('ping')
      // Should have the greet method
      expect(dtsContent).toContain('greet')
    })

    it('should extract full type signatures from returned methods', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should have full type signatures, NOT (...args: any[]): Promise<any>
      expect(dtsContent).toContain('greet(name: string): Promise<string>')
      expect(dtsContent).not.toContain('(...args: any[])')
    })
  })

  // ==========================================================================
  // Test 3: Handles return type with methods (ping: async () => 'pong')
  // ==========================================================================
  describe('handles return type with methods', () => {
    it('should extract literal return types', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should preserve literal type 'pong'
      expect(dtsContent).toContain("ping(): Promise<'pong'>")
    })

    it('should handle method shorthand syntax', async () => {
      writeFileSync(join(testDir, 'ShorthandDO.ts'), METHOD_SHORTHAND_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ShorthandDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should extract method shorthand
      expect(dtsContent).toContain('ping()')
      expect(dtsContent).toContain('greet(name: string)')
    })

    it('should handle synchronous methods in factory', async () => {
      writeFileSync(join(testDir, 'SyncMethodsDO.ts'), SYNC_METHODS_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'SyncMethodsDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should handle sync methods with non-Promise return types
      expect(dtsContent).toContain('add(a: number, b: number): number')
      expect(dtsContent).toContain('multiply(a: number, b: number): number')
    })
  })

  // ==========================================================================
  // Test 4: Handles return type with namespaces (users: { get: ... })
  // ==========================================================================
  describe('handles return type with namespaces', () => {
    it('should extract namespace objects from factory return', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should have users namespace
      expect(dtsContent).toContain('users: {')
      expect(dtsContent).toContain('get(id: string): Promise<User | null>')
      expect(dtsContent).toContain('create(data: CreateUserInput): Promise<User>')
    })

    it('should handle deeply nested namespaces', async () => {
      writeFileSync(join(testDir, 'NestedDO.ts'), NESTED_NAMESPACE_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'NestedDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should handle nested structure
      expect(dtsContent).toContain('api: {')
      expect(dtsContent).toContain('v1: {')
      expect(dtsContent).toContain('products: {')
    })

    it('should handle mixed top-level and namespace methods', async () => {
      writeFileSync(join(testDir, 'GenericDO.ts'), GENERIC_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'GenericDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should have both top-level method and namespaces
      expect(dtsContent).toContain('getProductWithOrders')
      expect(dtsContent).toContain('products')
      expect(dtsContent).toContain('orders')
    })
  })

  // ==========================================================================
  // Test 5: Resolves referenced types (User, CreateUserInput)
  // ==========================================================================
  describe('resolves referenced types', () => {
    it('should include local interface definitions', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should include User and CreateUserInput interfaces
      expect(dtsContent).toMatch(/interface User|type User/)
      expect(dtsContent).toMatch(/interface CreateUserInput|type CreateUserInput/)
    })

    it('should resolve imported types from local files', async () => {
      writeFileSync(join(testDir, 'types.ts'), FACTORY_TYPES_FILE)
      writeFileSync(join(testDir, 'FactoryWithImports.ts'), FACTORY_WITH_IMPORTS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryWithImports.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should include or reference imported types
      expect(dtsContent).toMatch(/User|import.*User/)
      expect(dtsContent).toMatch(/CreateUserInput|import.*CreateUserInput/)
      expect(dtsContent).toMatch(/UserRole|import.*UserRole/)
    })

    it('should handle generic types in factory return', async () => {
      writeFileSync(join(testDir, 'GenericDO.ts'), GENERIC_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'GenericDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should preserve generic types
      expect(dtsContent).toMatch(/Collection<Product>/)
      expect(dtsContent).toMatch(/Collection<Order>/)
    })

    it('should handle complex union and intersection types', async () => {
      writeFileSync(join(testDir, 'ComplexDO.ts'), COMPLEX_TYPES_FACTORY_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'ComplexDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should handle Status union type
      expect(dtsContent).toMatch(/Status \| Status\[\]/)
      // Should handle intersection return type
      expect(dtsContent).toMatch(/Task & \{ previousStatus: Status \}/)
    })
  })

  // ==========================================================================
  // Test 6: Excludes setup code ($.on, $.every) from extracted API
  // ==========================================================================
  describe('excludes setup code from API', () => {
    it('should not include $.on handlers in extracted API', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should NOT include $.on handlers
      expect(dtsContent).not.toContain('$.on')
      expect(dtsContent).not.toContain('on: {')
      expect(dtsContent).not.toContain('User.created')
    })

    it('should not include $.every schedulers in extracted API', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should NOT include $.every schedulers
      expect(dtsContent).not.toContain('$.every')
      expect(dtsContent).not.toContain('every: {')
      expect(dtsContent).not.toContain('hour')
    })

    it('should only extract what is in the return statement', async () => {
      const mixedSetupSource = `
        declare const DO: any

        export default DO(async ($) => {
          // Setup - lots of it
          $.on.User.created(async (user) => {})
          $.on.User.updated(async (user) => {})
          $.on.Order.placed(async (order) => {})
          $.every.minute(async () => {})
          $.every.hour(async () => {})
          $.every.day(async () => {})

          const internalHelper = () => {}
          const state = { counter: 0 }

          // Only this should be in the API
          return {
            getCount: async (): Promise<number> => state.counter
          }
        })
      `
      writeFileSync(join(testDir, 'MixedSetupDO.ts'), mixedSetupSource)

      await runCLI(['generate', '--source', join(testDir, 'MixedSetupDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should ONLY have getCount
      expect(dtsContent).toContain('getCount')
      expect(dtsContent).not.toContain('internalHelper')
      expect(dtsContent).not.toContain('state')
      expect(dtsContent).not.toContain('counter')
    })
  })

  // ==========================================================================
  // Test 7: Generates proper .d.ts with exported API interface
  // ==========================================================================
  describe('generates proper .d.ts files', () => {
    it('should generate valid TypeScript declaration file', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should be valid declaration file
      expect(dtsContent).toContain('export interface')
      expect(dtsContent).not.toContain('function implementation')
      expect(dtsContent).not.toContain('return ')
      expect(dtsContent).not.toContain('=> {')
    })

    it('should include header comment indicating generation', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      expect(dtsContent).toContain('// Generated by')
      expect(dtsContent).toContain('rpc.do generate --source')
    })

    it('should export the API interface', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      // Should have exported interface (FactoryDOAPI or similar)
      expect(dtsContent).toMatch(/export interface \w+API/)
    })

    it('should generate index.ts entrypoint', async () => {
      writeFileSync(join(testDir, 'FactoryDO.ts'), FACTORY_DO_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'FactoryDO.ts'), '--output', outputDir])

      const indexPath = join(outputDir, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)

      const indexContent = readFileSync(indexPath, 'utf-8')
      expect(indexContent).toContain('import type')
      expect(indexContent).toContain('export type')
    })
  })

  // ==========================================================================
  // Test 8: Works alongside class extension pattern (both in same file)
  // ==========================================================================
  describe('works alongside class extension pattern', () => {
    it('should extract both class and factory patterns from same file', async () => {
      writeFileSync(join(testDir, 'BothPatternsDO.ts'), BOTH_PATTERNS_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'BothPatternsDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(0)
    })

    it('should generate types for class pattern', async () => {
      writeFileSync(join(testDir, 'BothPatternsDO.ts'), BOTH_PATTERNS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'BothPatternsDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFiles = files.filter((f: string) => f.endsWith('.d.ts'))

      // Should have class pattern types
      const allContent = dtsFiles.map((f: string) => readFileSync(join(outputDir, f), 'utf-8')).join('\n')
      expect(allContent).toContain('classMethod')
    })

    it('should generate types for factory pattern', async () => {
      writeFileSync(join(testDir, 'BothPatternsDO.ts'), BOTH_PATTERNS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'BothPatternsDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFiles = files.filter((f: string) => f.endsWith('.d.ts'))

      // Should have factory pattern types
      const allContent = dtsFiles.map((f: string) => readFileSync(join(outputDir, f), 'utf-8')).join('\n')
      expect(allContent).toContain('factoryMethod')
    })

    it('should keep class and factory APIs separate', async () => {
      writeFileSync(join(testDir, 'BothPatternsDO.ts'), BOTH_PATTERNS_SOURCE)

      await runCLI(['generate', '--source', join(testDir, 'BothPatternsDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFiles = files.filter((f: string) => f.endsWith('.d.ts'))

      // Should have separate interfaces or files
      // Either different files OR different interface names
      expect(dtsFiles.length).toBeGreaterThanOrEqual(1)

      if (dtsFiles.length === 1) {
        // If single file, should have two interfaces
        const content = readFileSync(join(outputDir, dtsFiles[0]!), 'utf-8')
        const interfaceMatches = content.match(/export interface \w+API/g)
        expect(interfaceMatches?.length).toBeGreaterThanOrEqual(2)
      }
    })
  })

  // ==========================================================================
  // Test 9: Errors gracefully if no return statement in factory
  // ==========================================================================
  describe('errors gracefully for invalid factory patterns', () => {
    it('should error if factory has no return statement', async () => {
      writeFileSync(join(testDir, 'NoReturnDO.ts'), NO_RETURN_FACTORY_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'NoReturnDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/return|no.*api|empty.*api|missing.*return/i)
    })

    it('should error with helpful message for factory returning non-object', async () => {
      const invalidReturnSource = `
        declare const DO: any
        export default DO(async ($) => {
          return 'not an object'
        })
      `
      writeFileSync(join(testDir, 'InvalidReturnDO.ts'), invalidReturnSource)

      const result = await runCLI(['generate', '--source', join(testDir, 'InvalidReturnDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/object|invalid.*return|expected.*object/i)
    })

    it('should error for factory returning empty object', async () => {
      const emptyReturnSource = `
        declare const DO: any
        export default DO(async ($) => {
          return {}
        })
      `
      writeFileSync(join(testDir, 'EmptyReturnDO.ts'), emptyReturnSource)

      const result = await runCLI(['generate', '--source', join(testDir, 'EmptyReturnDO.ts'), '--output', outputDir])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toMatch(/empty|no.*methods|no.*api/i)
    })

    it('should provide context about DO() factory pattern in error', async () => {
      writeFileSync(join(testDir, 'NoReturnDO.ts'), NO_RETURN_FACTORY_SOURCE)

      const result = await runCLI(['generate', '--source', join(testDir, 'NoReturnDO.ts'), '--output', outputDir])

      // Error message should mention factory pattern
      expect(result.stderr).toMatch(/factory|DO\(\)|callback/i)
    })
  })

  // ==========================================================================
  // Additional edge cases
  // ==========================================================================
  describe('edge cases', () => {
    it('should handle factory with only namespaces (no top-level methods)', async () => {
      const namespacesOnlySource = `
        declare const DO: any
        export default DO(async ($) => {
          return {
            users: {
              list: async (): Promise<string[]> => [],
            },
            posts: {
              count: async (): Promise<number> => 0,
            }
          }
        })
      `
      writeFileSync(join(testDir, 'NamespacesOnlyDO.ts'), namespacesOnlySource)

      await runCLI(['generate', '--source', join(testDir, 'NamespacesOnlyDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      expect(dtsContent).toContain('users: {')
      expect(dtsContent).toContain('posts: {')
    })

    it('should handle factory with only top-level methods (no namespaces)', async () => {
      const methodsOnlySource = `
        declare const DO: any
        export default DO(async ($) => {
          return {
            ping: async (): Promise<'pong'> => 'pong',
            echo: async (msg: string): Promise<string> => msg,
          }
        })
      `
      writeFileSync(join(testDir, 'MethodsOnlyDO.ts'), methodsOnlySource)

      await runCLI(['generate', '--source', join(testDir, 'MethodsOnlyDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFile = files.find((f: string) => f.endsWith('.d.ts'))
      const dtsContent = readFileSync(join(outputDir, dtsFile!), 'utf-8')

      expect(dtsContent).toContain('ping')
      expect(dtsContent).toContain('echo')
    })

    it('should handle DO factory that is not the default export', async () => {
      const namedExportSource = `
        declare const DO: any
        export const myDO = DO(async ($) => {
          return {
            ping: async (): Promise<'pong'> => 'pong',
          }
        })
      `
      writeFileSync(join(testDir, 'NamedExportDO.ts'), namedExportSource)

      const result = await runCLI(['generate', '--source', join(testDir, 'NamedExportDO.ts'), '--output', outputDir])

      // Should still find and extract the DO() factory
      expect(result.exitCode).toBe(0)
    })

    it('should handle multiple DO() calls in same file', async () => {
      const multipleFactoriesSource = `
        declare const DO: any

        export const userDO = DO(async ($) => {
          return {
            getUser: async (id: string): Promise<string> => id,
          }
        })

        export const postDO = DO(async ($) => {
          return {
            getPost: async (id: string): Promise<string> => id,
          }
        })
      `
      writeFileSync(join(testDir, 'MultipleFactoriesDO.ts'), multipleFactoriesSource)

      await runCLI(['generate', '--source', join(testDir, 'MultipleFactoriesDO.ts'), '--output', outputDir])

      const files = require('node:fs').readdirSync(outputDir)
      const dtsFiles = files.filter((f: string) => f.endsWith('.d.ts'))
      const allContent = dtsFiles.map((f: string) => readFileSync(join(outputDir, f), 'utf-8')).join('\n')

      // Should extract both
      expect(allContent).toContain('getUser')
      expect(allContent).toContain('getPost')
    })
  })
})
