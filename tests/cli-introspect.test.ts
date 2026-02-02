/**
 * CLI Introspect Command Tests
 *
 * Tests for the rpc.do introspect command that fetches schema from
 * a running RPC server and generates TypeScript type definitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import type { RpcSchema } from '../src/cli/types.js'

// ============================================================================
// Mock Setup
// ============================================================================

const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockExistsSync = vi.fn<[string], boolean>()

vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  existsSync: (path: string) => mockExistsSync(path),
}))

// ============================================================================
// Test Setup
// ============================================================================

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
let exitCode: number | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFileSync.mockReset()
  mockMkdirSync.mockReset()
  mockExistsSync.mockReset().mockReturnValue(false)

  originalFetch = globalThis.fetch
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch

  vi.spyOn(process, 'cwd').mockReturnValue('/test/project')

  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

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
// Test Helpers
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

function getConsoleOutput(): string {
  return consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
}

function getConsoleErrors(): string {
  return consoleErrorSpy.mock.calls.map((c) => c[0]).join('\n')
}

// ============================================================================
// Tests
// ============================================================================

describe('CLI Introspect Command', () => {
  let main: (argv?: string[]) => Promise<void>

  beforeEach(async () => {
    const module = await import('../src/cli/index.js')
    main = module.main
  })

  describe('command routing', () => {
    it('should route to introspect command', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('rpc.do introspect')
    })
  })

  describe('flag parsing', () => {
    it('should require --url flag', async () => {
      await expect(main(['introspect'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('--url flag is required')
      expect(exitCode).toBe(1)
    })

    it('should parse --url flag correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://my-worker.workers.dev'])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-worker.workers.dev/__schema',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
        })
      )
    })

    it('should parse --output flag correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com', '--output', './custom-types'])

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('custom-types'), { recursive: true })
    })

    it('should use default output directory when --output not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('.do'), { recursive: true })
    })

    it('should handle flags in any order', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--output', './types', '--url', 'https://example.com'])

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/__schema', expect.anything())
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('types'), { recursive: true })
    })
  })

  describe('URL normalization', () => {
    it('should append /__schema to URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://api.example.com'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema', expect.anything())
    })

    it('should handle URL with trailing slash', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://api.example.com/'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema', expect.anything())
    })

    it('should not duplicate /__schema if already present', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://api.example.com/__schema'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/__schema', expect.anything())
    })

    it('should handle URL with path segments', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://api.example.com/v1/rpc'])

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/v1/rpc/__schema', expect.anything())
    })
  })

  describe('schema fetching', () => {
    it('should fetch and parse valid schema', async () => {
      const schema = createValidSchema()
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(schema),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('Fetching schema')
      expect(output).toContain('4 method(s)')
      expect(output).toContain('1 namespace(s)')
    })

    it('should handle connection timeout', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('timed out')
      expect(exitCode).toBe(1)
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('ENOTFOUND'))

      await expect(main(['introspect', '--url', 'https://invalid.example'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('Failed to fetch schema')
      expect(exitCode).toBe(1)
    })

    it('should handle HTTP 404 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('404')
      expect(exitCode).toBe(1)
    })

    it('should handle HTTP 500 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('500')
      expect(exitCode).toBe(1)
    })

    it('should handle HTTP 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('401')
      expect(exitCode).toBe(1)
    })
  })

  describe('schema validation', () => {
    it('should reject schema missing version', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ methods: [], namespaces: [] }),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('version')
      expect(exitCode).toBe(1)
    })

    it('should reject schema missing methods array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: 1, namespaces: [] }),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('methods')
      expect(exitCode).toBe(1)
    })

    it('should reject schema missing namespaces array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: 1, methods: [] }),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('namespaces')
      expect(exitCode).toBe(1)
    })

    it('should reject invalid method structure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            version: 1,
            methods: [{ name: 'test' }], // missing path and params
            namespaces: [],
          }),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('Invalid schema')
      expect(exitCode).toBe(1)
    })

    it('should reject invalid namespace structure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            version: 1,
            methods: [],
            namespaces: [{ name: 'users' }], // missing methods array
          }),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('Invalid schema')
      expect(exitCode).toBe(1)
    })

    it('should reject null response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('Invalid schema')
      expect(exitCode).toBe(1)
    })
  })

  describe('type generation', () => {
    it('should generate client.d.ts with interface', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find((call: unknown[]) => String(call[0]).endsWith('client.d.ts'))
      expect(clientCall).toBeDefined()

      const content = clientCall![1] as string
      expect(content).toContain('// Generated by `npx rpc.do introspect`')
      expect(content).toContain('export interface IntrospectedAPI')
      expect(content).toContain('ping(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('echo(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('users: {')
      expect(content).toContain('get(...args: unknown[]): Promise<unknown>')
      expect(content).toContain('list(...args: unknown[]): Promise<unknown>')
    })

    it('should generate index.ts entrypoint', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const indexCall = mockWriteFileSync.mock.calls.find((call: unknown[]) => String(call[0]).endsWith('index.ts'))
      expect(indexCall).toBeDefined()

      const content = indexCall![1] as string
      expect(content).toContain('// Generated by `npx rpc.do introspect`')
      expect(content).toContain("import { RPC, type Transport } from 'rpc.do'")
      expect(content).toContain("import type { IntrospectedAPI } from './client'")
      expect(content).toContain('export function createClient(transport: Transport)')
      expect(content).toContain('return RPC<IntrospectedAPI>(transport)')
    })

    it('should include JSDoc comments with parameter counts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            createValidSchema({
              methods: [{ name: 'createUser', path: 'createUser', params: 3 }],
              namespaces: [],
            })
          ),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find((call: unknown[]) => String(call[0]).endsWith('client.d.ts'))
      const content = clientCall![1] as string
      expect(content).toContain('@param args - 3 parameter(s)')
    })

    it('should handle empty schema', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            version: 1,
            methods: [],
            namespaces: [],
          }),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find((call: unknown[]) => String(call[0]).endsWith('client.d.ts'))
      const content = clientCall![1] as string
      expect(content).toContain('export interface IntrospectedAPI')
      expect(content).toContain('}')
    })

    it('should handle multiple namespaces', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            createValidSchema({
              namespaces: [
                { name: 'users', methods: [{ name: 'get', path: 'users.get', params: 1 }] },
                { name: 'posts', methods: [{ name: 'create', path: 'posts.create', params: 2 }] },
                { name: 'comments', methods: [{ name: 'delete', path: 'comments.delete', params: 1 }] },
              ],
            })
          ),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const clientCall = mockWriteFileSync.mock.calls.find((call: unknown[]) => String(call[0]).endsWith('client.d.ts'))
      const content = clientCall![1] as string
      expect(content).toContain('users: {')
      expect(content).toContain('posts: {')
      expect(content).toContain('comments: {')
    })
  })

  describe('output handling', () => {
    it('should create output directory recursively', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com', '--output', './deep/nested/types'])

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('deep/nested/types'), { recursive: true })
    })

    it('should handle directory creation failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })
      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('permission denied')
      expect(exitCode).toBe(1)
    })

    it('should handle file write failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      await expect(main(['introspect', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('no space left')
      expect(exitCode).toBe(1)
    })

    it('should log generated file paths', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('Generated:')
      expect(output).toContain('client.d.ts')
      expect(output).toContain('index.ts')
    })
  })

  describe('completion message', () => {
    it('should print import instructions after generation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com', '--output', './custom-rpc'])

      const output = getConsoleOutput()
      expect(output).toContain('Done!')
      expect(output).toContain('Import your typed client')
      expect(output).toContain("import type { IntrospectedAPI } from './custom-rpc'")
    })

    it('should list generated files count', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['introspect', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('Generated 2 file(s)')
    })
  })
})

// ============================================================================
// Unit Tests for introspect module functions
// ============================================================================

describe('introspect module functions', () => {
  let normalizeSchemaUrl: (url: string) => string
  let generateIntrospectedDTS: (schema: RpcSchema) => string
  let generateIntrospectedIndex: () => string

  beforeEach(async () => {
    const module = await import('../src/cli/introspect.js')
    normalizeSchemaUrl = module.normalizeSchemaUrl
    generateIntrospectedDTS = module.generateIntrospectedDTS
    generateIntrospectedIndex = module.generateIntrospectedIndex
  })

  describe('normalizeSchemaUrl()', () => {
    it('should append /__schema to plain URL', () => {
      expect(normalizeSchemaUrl('https://example.com')).toBe('https://example.com/__schema')
    })

    it('should remove trailing slash before appending', () => {
      expect(normalizeSchemaUrl('https://example.com/')).toBe('https://example.com/__schema')
    })

    it('should not modify URL already ending with /__schema', () => {
      expect(normalizeSchemaUrl('https://example.com/__schema')).toBe('https://example.com/__schema')
    })

    it('should handle URL with path', () => {
      expect(normalizeSchemaUrl('https://example.com/api/v1')).toBe('https://example.com/api/v1/__schema')
    })

    it('should handle URL with port', () => {
      expect(normalizeSchemaUrl('http://localhost:8787')).toBe('http://localhost:8787/__schema')
    })
  })

  describe('generateIntrospectedDTS()', () => {
    it('should generate correct interface structure', () => {
      const schema = createValidSchema()
      const result = generateIntrospectedDTS(schema)

      expect(result).toContain('export interface IntrospectedAPI {')
      expect(result).toContain('ping(...args: unknown[]): Promise<unknown>')
      expect(result).toContain('echo(...args: unknown[]): Promise<unknown>')
      expect(result).toContain('users: {')
      expect(result).toContain('get(...args: unknown[]): Promise<unknown>')
      expect(result).toContain('list(...args: unknown[]): Promise<unknown>')
      expect(result).toContain('}')
    })

    it('should include generated comment header', () => {
      const schema = createValidSchema()
      const result = generateIntrospectedDTS(schema)

      expect(result).toContain('// Generated by `npx rpc.do introspect`')
      expect(result).toContain('// Do not edit manually')
    })

    it('should include documentation about weak types', () => {
      const schema = createValidSchema()
      const result = generateIntrospectedDTS(schema)

      expect(result).toContain('runtime schema introspection')
      expect(result).toContain('weak')
    })

    it('should handle empty methods array', () => {
      const schema = createValidSchema({ methods: [] })
      const result = generateIntrospectedDTS(schema)

      expect(result).toContain('export interface IntrospectedAPI {')
      expect(result).not.toContain('ping(')
    })

    it('should handle empty namespaces array', () => {
      const schema = createValidSchema({ namespaces: [] })
      const result = generateIntrospectedDTS(schema)

      expect(result).toContain('export interface IntrospectedAPI {')
      expect(result).not.toContain('users:')
    })
  })

  describe('generateIntrospectedIndex()', () => {
    it('should generate correct entrypoint structure', () => {
      const result = generateIntrospectedIndex()

      expect(result).toContain("import { RPC, type Transport } from 'rpc.do'")
      expect(result).toContain("import type { IntrospectedAPI } from './client'")
      expect(result).toContain('export function createClient(transport: Transport)')
      expect(result).toContain('return RPC<IntrospectedAPI>(transport)')
      expect(result).toContain('export type { IntrospectedAPI }')
    })

    it('should include generated comment header', () => {
      const result = generateIntrospectedIndex()

      expect(result).toContain('// Generated by `npx rpc.do introspect`')
      expect(result).toContain('// Do not edit manually')
    })

    it('should include JSDoc for createClient', () => {
      const result = generateIntrospectedIndex()

      expect(result).toContain('/**')
      expect(result).toContain('Create a typed RPC client')
      expect(result).toContain('*/')
    })
  })
})

// ============================================================================
// Help text tests
// ============================================================================

describe('CLI Help for introspect', () => {
  let main: (argv?: string[]) => Promise<void>

  beforeEach(async () => {
    const module = await import('../src/cli/index.js')
    main = module.main
  })

  it('should include introspect in help output', async () => {
    await main(['--help'])

    const output = getConsoleOutput()
    expect(output).toContain('introspect')
    expect(output).toContain('--url')
  })

  it('should show introspect command in usage section', async () => {
    await main(['--help'])

    const output = getConsoleOutput()
    expect(output).toContain('npx rpc.do introspect --url')
  })
})
