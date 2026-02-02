/**
 * CLI Module Tests
 *
 * Tests for the rpc.do CLI codegen tool
 *
 * Testing strategy:
 * - Import and test real production functions from src/cli/ modules
 * - Use vitest hoisted mocks for fs and fetch
 * - Test CLI behavior through direct function calls with optional argv
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { join, resolve } from 'node:path'
import type { RpcSchema } from '../src/cli/types.js'
import { generateClient, generateEntrypoint } from '../src/cli/codegen.js'
import { main, parseArgs } from '../src/cli/index.js'

// ============================================================================
// Mock Setup - Define mock functions at module level
// ============================================================================

const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockExistsSync = vi.fn<[string], boolean>()

// Hoist fs mock before any imports
vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  existsSync: (path: string) => mockExistsSync(path),
}))

// ============================================================================
// Test Setup
// ============================================================================

// Custom error for process.exit to allow catching
class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
    this.name = 'ExitError'
  }
}

let originalFetch: typeof globalThis.fetch
let mockFetch: Mock
let consoleLogSpy: ReturnType<typeof vi.spyOn>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let processExitSpy: ReturnType<typeof vi.spyOn>
let processCwdSpy: ReturnType<typeof vi.spyOn>
let exitCode: number | undefined

beforeEach(() => {
  // Reset all mocks
  vi.clearAllMocks()
  mockWriteFileSync.mockReset()
  mockMkdirSync.mockReset()
  mockExistsSync.mockReset().mockReturnValue(false)

  // Mock fetch
  originalFetch = globalThis.fetch
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch

  // Mock process.cwd
  processCwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/test/project')

  // Mock console
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  // Mock process.exit to record the exit code and throw to stop execution
  exitCode = undefined
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    exitCode = typeof code === 'number' ? code : 0
    throw new ExitError(exitCode)
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ============================================================================
// Test Schemas
// ============================================================================

function createValidSchema(overrides: Partial<RpcSchema> = {}): RpcSchema {
  return {
    version: 1,
    methods: [
      { name: 'ping', path: 'ping', params: 0 },
      { name: 'echo', path: 'echo', params: 1 },
    ],
    namespaces: [
      {
        name: 'users',
        methods: [
          { name: 'get', path: 'users.get', params: 1 },
          { name: 'list', path: 'users.list', params: 0 },
        ],
      },
    ],
    ...overrides,
  }
}

// ============================================================================
// Command Parsing Tests (main())
// ============================================================================

describe('CLI Command Parsing', () => {
  describe('--help flag', () => {
    it('should print help message when --help is passed', async () => {
      await main(['--help'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('rpc.do')
      expect(output).toContain('USAGE:')
      expect(output).toContain('npx rpc.do generate')
      expect(output).toContain('--url')
      expect(output).toContain('--output')
    })

    it('should print help message when -h is passed', async () => {
      await main(['-h'])

      expect(consoleLogSpy).toHaveBeenCalled()
      const output = consoleLogSpy.mock.calls.map(c => c[0]).join('\n')
      expect(output).toContain('rpc.do')
    })
  })

  describe('unknown command handling', () => {
    it('should exit with error for unknown command', async () => {
      await expect(main(['unknown-command'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Unknown command: unknown-command')
      expect(consoleErrorSpy).toHaveBeenCalledWith('Run `npx rpc.do --help` for usage')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for invalid command', async () => {
      await expect(main(['somethingbad'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Unknown command: somethingbad')
      expect(exitCode).toBe(1)
    })
  })

  describe('generate command recognition', () => {
    it('should recognize generate command', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://example.com/api'])

      expect(mockFetch).toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Fetching schema'))
    })
  })

  describe('--url flag parsing', () => {
    it('should parse --url flag correctly', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://my-api.workers.dev'])

      expect(mockFetch).toHaveBeenCalledWith('https://my-api.workers.dev/__schema')
    })

    it('should append /__schema to URL without trailing slash', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema')
    })

    it('should append /__schema to URL with trailing slash', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com/'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema')
    })

    it('should not append /__schema if URL already ends with it', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com/__schema'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema')
    })
  })

  describe('--output flag parsing', () => {
    it('should parse --output flag correctly', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com', '--output', './custom/output'])

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('custom/output'),
        { recursive: true }
      )
    })

    it('should use default output directory when --output not provided', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('generated/rpc'),
        { recursive: true }
      )
    })
  })
})

// ============================================================================
// Config Loading Tests (loadConfig())
// ============================================================================

describe('Config Loading', () => {
  describe('load do.config.ts successfully', () => {
    it('should load do.config.ts when present', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('do.config.ts')
      })

      await expect(main(['generate'])).rejects.toThrow(ExitError)

      expect(consoleLogSpy).toHaveBeenCalledWith('Using config: do.config.ts')
      expect(exitCode).toBe(1) // Exits because import fails in test
    })
  })

  describe('load rpc.config.ts as fallback', () => {
    it('should try rpc.config.ts when do.config.ts not found', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('rpc.config.ts')
      })

      await expect(main(['generate'])).rejects.toThrow(ExitError)

      expect(consoleLogSpy).toHaveBeenCalledWith('Using config: rpc.config.ts')
    })
  })

  describe('handle missing config file gracefully', () => {
    it('should fall through to zero-config when no config and no --url', async () => {
      mockExistsSync.mockReturnValue(false)

      // With no --url and no config, production main() falls through to runZeroConfigCommand
      // which will fail trying to detect wrangler config in test environment
      await expect(main(['generate'])).rejects.toThrow()
    })
  })

  describe('handle invalid config file', () => {
    it('should display error tip when config loading fails', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('do.config.ts')
      })

      await expect(main(['generate'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error loading do.config.ts'))
      expect(consoleErrorSpy).toHaveBeenCalledWith('Tip: Ensure your config file is valid JS/TS')
      expect(exitCode).toBe(1)
    })
  })

  describe('config candidate order', () => {
    it('should check do.config.ts before do.config.js', async () => {
      const checkedPaths: string[] = []
      mockExistsSync.mockImplementation((p: string) => {
        checkedPaths.push(String(p))
        return false
      })

      // Will fall through to zero-config since no config found
      await expect(main(['generate'])).rejects.toThrow()

      const doConfigTsIdx = checkedPaths.findIndex(p => p.endsWith('do.config.ts'))
      const doConfigJsIdx = checkedPaths.findIndex(p => p.endsWith('do.config.js'))
      expect(doConfigTsIdx).toBeLessThan(doConfigJsIdx)
    })

    it('should check .do/config.ts as last resort', async () => {
      const checkedPaths: string[] = []
      mockExistsSync.mockImplementation((p: string) => {
        checkedPaths.push(String(p))
        return false
      })

      await expect(main(['generate'])).rejects.toThrow()

      expect(checkedPaths.some(p => p.includes('.do/config.ts'))).toBe(true)
    })
  })
})

// ============================================================================
// Schema Fetching Tests (fetchSchema() via main)
// ============================================================================

describe('Schema Fetching', () => {
  describe('successful HTTP fetch and parse', () => {
    it('should fetch and parse valid schema', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema')
      expect(consoleLogSpy).toHaveBeenCalledWith('Found 2 methods, 1 namespaces')
    })

    it('should handle schema with multiple namespaces', async () => {
      const schema = createValidSchema({
        namespaces: [
          { name: 'users', methods: [{ name: 'get', path: 'users.get', params: 1 }] },
          { name: 'posts', methods: [{ name: 'list', path: 'posts.list', params: 0 }] },
          { name: 'comments', methods: [{ name: 'create', path: 'comments.create', params: 2 }] },
        ],
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 2 methods, 3 namespaces')
    })
  })

  describe('handle network failures', () => {
    it('should handle fetch rejection', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow('Network error')
    })

    it('should handle timeout errors', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow('The operation was aborted')
    })
  })

  describe('handle invalid JSON response', () => {
    it('should exit with error for JSON parse failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow('Invalid JSON')
    })
  })

  describe('handle non-200 status codes', () => {
    it('should exit with error for 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({}),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch schema: 404 Not Found')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for 500 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch schema: 500 Internal Server Error')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({}),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch schema: 401 Unauthorized')
      expect(exitCode).toBe(1)
    })
  })

  describe('handle invalid schema format', () => {
    it('should exit with error for schema missing version', async () => {
      const invalidSchema = {
        methods: [],
        namespaces: [],
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidSchema),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid schema response. Ensure the DO extends DurableRPC.')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for schema missing methods', async () => {
      const invalidSchema = {
        version: 1,
        namespaces: [],
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidSchema),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid schema response. Ensure the DO extends DurableRPC.')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for schema missing namespaces', async () => {
      const invalidSchema = {
        version: 1,
        methods: [],
      }
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidSchema),
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid schema response. Ensure the DO extends DurableRPC.')
      expect(exitCode).toBe(1)
    })

    it('should exit with error for empty response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      })

      // null schema will throw a TypeError when accessing .version
      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow()
    })
  })
})

// ============================================================================
// Client Generation Tests (generateClient())
// ============================================================================

describe('Client Generation', () => {
  describe('generate TypeScript definitions from schema', () => {
    it('should generate client.d.ts with correct interface', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('client.d.ts')
      )
      expect(clientCall).toBeDefined()

      const content = clientCall![1] as string
      expect(content).toContain('// Generated by `npx rpc.do generate`')
      expect(content).toContain('export interface GeneratedAPI')
      expect(content).toContain('ping(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('echo(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('users: {')
      expect(content).toContain('get(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('list(...args: unknown[]): Promise<unknown>')
    })

    it('should generate index.ts entrypoint', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      const indexCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('index.ts')
      )
      expect(indexCall).toBeDefined()

      const content = indexCall![1] as string
      expect(content).toContain('// Generated by `npx rpc.do generate`')
      expect(content).toContain("import { RPC, type Transport } from 'rpc.do'")
      expect(content).toContain("import type { GeneratedAPI } from './client'")
      expect(content).toContain('export function createClient(transport: Transport)')
      expect(content).toContain('return RPC<GeneratedAPI>(transport)')
    })

    it('should log generated file paths', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Generated typed client:'))
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Generated entrypoint:'))
    })
  })

  describe('handle empty schema', () => {
    it('should generate valid client for schema with no methods', async () => {
      const schema = createValidSchema({
        methods: [],
        namespaces: [],
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 0 methods, 0 namespaces')

      const clientCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('client.d.ts')
      )
      expect(clientCall).toBeDefined()

      const content = clientCall![1] as string
      expect(content).toContain('export interface GeneratedAPI')
      expect(content).toContain('}')
    })

    it('should generate valid client for schema with only methods', async () => {
      const schema = createValidSchema({
        methods: [
          { name: 'doSomething', path: 'doSomething', params: 2 },
        ],
        namespaces: [],
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('client.d.ts')
      )
      const content = clientCall![1] as string
      expect(content).toContain('doSomething(...args: unknown[]): Promise<unknown>')
    })

    it('should generate valid client for schema with only namespaces', async () => {
      const schema = createValidSchema({
        methods: [],
        namespaces: [
          {
            name: 'admin',
            methods: [
              { name: 'createUser', path: 'admin.createUser', params: 1 },
            ],
          },
        ],
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('client.d.ts')
      )
      const content = clientCall![1] as string
      expect(content).toContain('admin: {')
      expect(content).toContain('createUser(...args: unknown[]): Promise<unknown>')
    })
  })

  describe('output to specified directory', () => {
    it('should create output directory recursively', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com', '--output', './deep/nested/output'])

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('deep/nested/output'),
        { recursive: true }
      )
    })

    it('should write files to custom output directory', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com', '--output', './my-types'])

      const clientPath = mockWriteFileSync.mock.calls.find(
        (call: unknown[]) => String(call[0]).endsWith('client.d.ts')
      )?.[0] as string

      expect(clientPath).toContain('my-types')
      expect(clientPath).toContain('client.d.ts')
    })
  })

  describe('completion message', () => {
    it('should print import instructions after generation', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['generate', '--url', 'https://api.example.com', '--output', './custom-rpc'])

      expect(consoleLogSpy).toHaveBeenCalledWith('\nDone! Import your typed client:')
      expect(consoleLogSpy).toHaveBeenCalledWith("  import { rpc } from './custom-rpc'")
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('missing required flags', () => {
    it('should fall through to zero-config when generate called without URL and no config', async () => {
      mockExistsSync.mockReturnValue(false)

      // With no --url and no config, production main() falls through to runZeroConfigCommand
      await expect(main(['generate'])).rejects.toThrow()
    })
  })

  describe('file system errors', () => {
    it('should handle mkdirSync failure', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow('EACCES: permission denied')
    })

    it('should handle writeFileSync failure', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      mockWriteFileSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      await expect(main(['generate', '--url', 'https://api.example.com'])).rejects.toThrow('ENOSPC: no space left on device')
    })
  })
})

// ============================================================================
// Direct Function Tests (Unit Tests) - Testing real production functions
// ============================================================================

describe('generateClient() function', () => {
  it('should generate correct TypeScript interface structure', () => {
    const schema = createValidSchema()
    const result = generateClient(schema)

    expect(result).toContain('export interface GeneratedAPI {')
    expect(result).toContain('ping(...args: unknown[]): Promise<unknown>')
    expect(result).toContain('echo(...args: unknown[]): Promise<unknown>')
    expect(result).toContain('users: {')
    expect(result).toContain('get(...args: unknown[]): Promise<unknown>')
    expect(result).toContain('list(...args: unknown[]): Promise<unknown>')
    expect(result).toContain('}')
  })

  it('should handle empty methods array', () => {
    const schema = createValidSchema({ methods: [] })
    const result = generateClient(schema)

    expect(result).toContain('export interface GeneratedAPI {')
    expect(result).toContain('users: {')
    expect(result).not.toContain('ping(')
  })

  it('should handle empty namespaces array', () => {
    const schema = createValidSchema({ namespaces: [] })
    const result = generateClient(schema)

    expect(result).toContain('export interface GeneratedAPI {')
    expect(result).toContain('ping(...args: unknown[]): Promise<unknown>')
    expect(result).not.toContain('users:')
  })

  it('should include generated comment header', () => {
    const schema = createValidSchema()
    const result = generateClient(schema)

    expect(result).toContain('// Generated by `npx rpc.do generate`')
    expect(result).toContain('// Do not edit manually')
  })
})

describe('generateEntrypoint() function', () => {
  it('should generate correct entrypoint structure', () => {
    const result = generateEntrypoint()

    expect(result).toContain("import { RPC, type Transport } from 'rpc.do'")
    expect(result).toContain("import type { GeneratedAPI } from './client'")
    expect(result).toContain('export function createClient(transport: Transport)')
    expect(result).toContain('return RPC<GeneratedAPI>(transport)')
    expect(result).toContain('export type { GeneratedAPI }')
  })

  it('should include generated comment header', () => {
    const result = generateEntrypoint()

    expect(result).toContain('// Generated by `npx rpc.do generate`')
    expect(result).toContain('// Do not edit manually')
  })

  it('should include JSDoc comment for createClient', () => {
    const result = generateEntrypoint()

    expect(result).toContain('/**')
    expect(result).toContain(' * Create a typed RPC client')
    expect(result).toContain(' */')
  })
})

describe('parseArgs() function', () => {
  it('should parse --url flag', () => {
    const { url, output } = parseArgs(['generate', '--url', 'https://example.com'])
    expect(url).toBe('https://example.com')
    expect(output).toBeUndefined()
  })

  it('should parse --output flag', () => {
    const { url, output } = parseArgs(['generate', '--output', './custom'])
    expect(url).toBeUndefined()
    expect(output).toBe('./custom')
  })

  it('should parse both flags', () => {
    const { url, output } = parseArgs(['generate', '--url', 'https://example.com', '--output', './types'])
    expect(url).toBe('https://example.com')
    expect(output).toBe('./types')
  })

  it('should handle flags in any order', () => {
    const { url, output } = parseArgs(['generate', '--output', './types', '--url', 'https://example.com'])
    expect(url).toBe('https://example.com')
    expect(output).toBe('./types')
  })

  it('should return undefined for missing flags', () => {
    const { url, output } = parseArgs(['generate'])
    expect(url).toBeUndefined()
    expect(output).toBeUndefined()
  })

  it('should parse --source flag', () => {
    const { source } = parseArgs(['generate', '--source', './src/MyDO.ts'])
    expect(source).toBe('./src/MyDO.ts')
  })
})

// ============================================================================
// Integration-style Tests
// ============================================================================

describe('CLI Integration', () => {
  it('should complete full generate workflow', async () => {
    const schema = createValidSchema({
      methods: [
        { name: 'health', path: 'health', params: 0 },
      ],
      namespaces: [
        {
          name: 'db',
          methods: [
            { name: 'query', path: 'db.query', params: 2 },
            { name: 'execute', path: 'db.execute', params: 1 },
          ],
        },
      ],
    })
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(schema),
    })

    await main(['generate', '--url', 'https://my-worker.workers.dev', '--output', './types/rpc'])

    // Verify all steps completed
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockMkdirSync).toHaveBeenCalledTimes(1)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2) // client.d.ts and index.ts

    // Verify generated content
    const clientContent = mockWriteFileSync.mock.calls.find(
      (c: unknown[]) => String(c[0]).endsWith('client.d.ts')
    )?.[1] as string

    expect(clientContent).toContain('health(...args: unknown[]): Promise<unknown>')
    expect(clientContent).toContain('db: {')
    expect(clientContent).toContain('query(...args: unknown[]): Promise<unknown>')
    expect(clientContent).toContain('execute(...args: unknown[]): Promise<unknown>')
  })

  it('should handle URL with path segments', async () => {
    const schema = createValidSchema()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(schema),
    })

    await main(['generate', '--url', 'https://api.example.com/v1/rpc'])

    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/v1/rpc/__schema')
  })
})
