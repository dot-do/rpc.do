/**
 * CLI Generate Command Tests
 *
 * Tests for the generate.ts module which provides:
 * - runZeroConfigCommand: Auto-detection from wrangler config
 * - generateFromSource: Full type extraction from TypeScript source
 * - generateFromUrl: Runtime schema fetching (weak types)
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { join, resolve } from 'node:path'

// ============================================================================
// Mock Setup
// ============================================================================

const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockExistsSync = vi.fn<[string], boolean>()
const mockUnlinkSync = vi.fn()

vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  existsSync: (path: string) => mockExistsSync(path),
  unlinkSync: (path: string) => mockUnlinkSync(path),
}))

// Mock detect.ts module
const mockDetectFromWrangler = vi.fn()
const mockRunZeroConfig = vi.fn()

vi.mock('../src/detect.js', () => ({
  detectFromWrangler: (...args: unknown[]) => mockDetectFromWrangler(...args),
  runZeroConfig: (...args: unknown[]) => mockRunZeroConfig(...args),
}))

// Mock extract.ts module
const mockExtractTypes = vi.fn()
const mockGenerateDTS = vi.fn()
const mockGenerateIndex = vi.fn()

vi.mock('../src/extract.js', () => ({
  extractTypes: (...args: unknown[]) => mockExtractTypes(...args),
  generateDTS: (...args: unknown[]) => mockGenerateDTS(...args),
  generateIndex: (...args: unknown[]) => mockGenerateIndex(...args),
}))

// Mock config.ts module
const mockFetchSchema = vi.fn()

vi.mock('../src/cli/config.js', () => ({
  fetchSchema: (...args: unknown[]) => mockFetchSchema(...args),
}))

// Mock codegen.ts module
const mockGenerateClient = vi.fn()
const mockGenerateEntrypoint = vi.fn()

vi.mock('../src/cli/codegen.js', () => ({
  generateClient: (...args: unknown[]) => mockGenerateClient(...args),
  generateEntrypoint: (...args: unknown[]) => mockGenerateEntrypoint(...args),
}))

// Import after mocks
import {
  runZeroConfigCommand,
  generateFromSource,
  generateFromUrl,
} from '../src/cli/generate.js'

// ============================================================================
// Test Setup
// ============================================================================

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`)
    this.name = 'ExitError'
  }
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let processExitSpy: ReturnType<typeof vi.spyOn>
let processCwdSpy: ReturnType<typeof vi.spyOn>
let exitCode: number | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFileSync.mockReset()
  mockMkdirSync.mockReset()
  mockExistsSync.mockReset().mockReturnValue(false)
  mockUnlinkSync.mockReset()
  mockDetectFromWrangler.mockReset()
  mockRunZeroConfig.mockReset()
  mockExtractTypes.mockReset()
  mockGenerateDTS.mockReset()
  mockGenerateIndex.mockReset()
  mockFetchSchema.mockReset()
  mockGenerateClient.mockReset()
  mockGenerateEntrypoint.mockReset()

  processCwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/test/project')
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  exitCode = undefined
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    exitCode = typeof code === 'number' ? code : 0
    throw new ExitError(exitCode)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockSchema() {
  return {
    className: 'TestDO',
    methods: [
      { name: 'ping', parameters: [], returnType: "Promise<'pong'>" },
      { name: 'greet', parameters: [{ name: 'name', type: 'string', optional: false }], returnType: 'Promise<string>' },
    ],
    namespaces: [
      {
        name: 'users',
        methods: [
          { name: 'get', parameters: [{ name: 'id', type: 'string', optional: false }], returnType: 'Promise<User | null>' },
          { name: 'list', parameters: [], returnType: 'Promise<User[]>' },
        ],
      },
    ],
    types: [
      {
        name: 'User',
        declaration: 'export interface User { id: string; name: string; }',
        kind: 'interface' as const,
      },
    ],
  }
}

function createMockRpcSchema() {
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
  }
}

// ============================================================================
// runZeroConfigCommand Tests
// ============================================================================

describe('runZeroConfigCommand', () => {
  describe('successful detection from wrangler config', () => {
    it('should detect DOs from wrangler config and generate types', async () => {
      mockDetectFromWrangler.mockResolvedValue([
        { name: 'MY_DO', className: 'TestDO' },
      ])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'TestDO', filePath: '/test/src/TestDO.ts', baseClass: 'DurableObject' }],
        generated: ['/test/.do/TestDO.d.ts', '/test/.do/index.ts'],
        usedFallback: false,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(mockDetectFromWrangler).toHaveBeenCalledWith('/test/project')
      expect(mockRunZeroConfig).toHaveBeenCalledWith('/test/project', { outputDir: '.do' })
      expect(consoleLogSpy).toHaveBeenCalledWith('rpc.do - Zero-config type generation\n')
      expect(consoleLogSpy).toHaveBeenCalledWith('Found wrangler config with 1 Durable Object(s):')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - TestDO (binding: MY_DO)')
    })

    it('should use custom output directory when provided', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'TestDO', filePath: '/test/src/TestDO.ts', baseClass: 'DurableObject' }],
        generated: ['/test/custom/.do/TestDO.d.ts'],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand('custom/.do')

      expect(mockRunZeroConfig).toHaveBeenCalledWith('/test/project', { outputDir: 'custom/.do' })
    })

    it('should display detected DOs and generated files', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [
          { className: 'UserDO', filePath: '/test/src/UserDO.ts', baseClass: 'DurableRPC' },
          { className: 'TaskDO', filePath: '/test/src/TaskDO.ts', baseClass: 'DigitalObject' },
        ],
        generated: ['/test/.do/UserDO.d.ts', '/test/.do/TaskDO.d.ts', '/test/.do/index.ts'],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('Detected 2 Durable Object(s):')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - UserDO (extends DurableRPC)')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - TaskDO (extends DigitalObject)')
      expect(consoleLogSpy).toHaveBeenCalledWith('Generated 3 file(s):')
    })

    it('should display import hint after successful generation', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'MyDO', filePath: '/test/src/MyDO.ts', baseClass: 'DurableObject' }],
        generated: ['/test/.do/MyDO.d.ts'],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('Done! Import your typed client:')
      expect(consoleLogSpy).toHaveBeenCalledWith("  import type { MyDOAPI } from './.do'")
    })
  })

  describe('fallback to source scanning', () => {
    it('should scan for DO patterns when no wrangler config found', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'ScannedDO', filePath: '/test/src/ScannedDO.ts', baseClass: 'DurableObject' }],
        generated: ['/test/.do/ScannedDO.d.ts'],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('No wrangler config found, scanning for DO patterns...\n')
    })
  })

  describe('warnings handling', () => {
    it('should display warnings from detection', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'TestDO', filePath: '/test/src/TestDO.ts', baseClass: 'DurableObject' }],
        generated: ['/test/.do/TestDO.d.ts'],
        usedFallback: false,
        warnings: ['Could not find source for: MissingDO', 'Type extraction failed for ComplexDO'],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('Warnings:')
    })
  })

  describe('error handling', () => {
    it('should exit with error when no DOs found', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [],
        generated: [],
        usedFallback: true,
        warnings: [],
      })

      await expect(runZeroConfigCommand()).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('No Durable Objects found.')
      expect(consoleErrorSpy).toHaveBeenCalledWith('\nEnsure your project has:')
      expect(exitCode).toBe(1)
    })

    it('should handle detection errors gracefully', async () => {
      mockDetectFromWrangler.mockRejectedValue(new Error('Config parse error'))

      await expect(runZeroConfigCommand()).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Config parse error')
      expect(exitCode).toBe(1)
    })

    it('should handle runZeroConfig errors gracefully', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockRejectedValue(new Error('Extraction failed'))

      await expect(runZeroConfigCommand()).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Extraction failed')
      expect(exitCode).toBe(1)
    })
  })

  describe('multiple DO bindings', () => {
    it('should display all bindings from wrangler config', async () => {
      mockDetectFromWrangler.mockResolvedValue([
        { name: 'USER_DO', className: 'UserDO' },
        { name: 'TASK_DO', className: 'TaskDO' },
        { name: 'SESSION_DO', className: 'SessionDO' },
      ])
      mockRunZeroConfig.mockResolvedValue({
        detected: [
          { className: 'UserDO', filePath: '/test/src/UserDO.ts', baseClass: 'DurableRPC' },
          { className: 'TaskDO', filePath: '/test/src/TaskDO.ts', baseClass: 'DurableObject' },
          { className: 'SessionDO', filePath: '/test/src/SessionDO.ts', baseClass: 'DigitalObject' },
        ],
        generated: [],
        usedFallback: false,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('Found wrangler config with 3 Durable Object(s):')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - UserDO (binding: USER_DO)')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - TaskDO (binding: TASK_DO)')
      expect(consoleLogSpy).toHaveBeenCalledWith('  - SessionDO (binding: SESSION_DO)')
    })

    it('should generate correct import hint for multiple DOs', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [
          { className: 'UserDO', filePath: '/test/src/UserDO.ts', baseClass: 'DurableRPC' },
          { className: 'TaskDO', filePath: '/test/src/TaskDO.ts', baseClass: 'DurableObject' },
        ],
        generated: [],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "  import type { UserDOAPI, TaskDOAPI } from './.do'"
      )
    })
  })
})

// ============================================================================
// generateFromSource Tests
// ============================================================================

describe('generateFromSource', () => {
  describe('successful generation', () => {
    it('should generate types from a valid TypeScript source file', async () => {
      const mockSchema = createMockSchema()
      mockExistsSync.mockImplementation((path: string) => {
        if (path === '/test/project/src/TestDO.ts') return true
        if (path.includes('.write-test')) return true
        return false
      })
      mockExtractTypes.mockResolvedValue([mockSchema])
      mockGenerateDTS.mockReturnValue('// Generated .d.ts content')
      mockGenerateIndex.mockReturnValue('// Generated index.ts content')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts')

      expect(consoleLogSpy).toHaveBeenCalledWith('Parsing source file: src/TestDO.ts')
      expect(mockExtractTypes).toHaveBeenCalledWith('src/TestDO.ts')
      expect(mockGenerateDTS).toHaveBeenCalledWith(mockSchema)
      expect(mockGenerateIndex).toHaveBeenCalledWith([mockSchema])
      expect(mockWriteFileSync).toHaveBeenCalledTimes(3) // test file + .d.ts + index.ts
    })

    it('should use custom output directory when provided', async () => {
      const mockSchema = createMockSchema()
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([mockSchema])
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts', './custom/types')

      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/test/project/custom/types',
        { recursive: true }
      )
    })

    it('should generate files for each schema', async () => {
      const schema1 = { ...createMockSchema(), className: 'UserDO' }
      const schema2 = { ...createMockSchema(), className: 'TaskDO' }
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([schema1, schema2])
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/**/*.ts')

      expect(mockGenerateDTS).toHaveBeenCalledTimes(2)
      expect(mockGenerateDTS).toHaveBeenCalledWith(schema1)
      expect(mockGenerateDTS).toHaveBeenCalledWith(schema2)
    })

    it('should display completion message with import hint', async () => {
      const mockSchema = createMockSchema()
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([mockSchema])
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts')

      expect(consoleLogSpy).toHaveBeenCalledWith('\nDone! Generated types for 1 Durable Object(s).')
      expect(consoleLogSpy).toHaveBeenCalledWith('Import your typed client:')
      expect(consoleLogSpy).toHaveBeenCalledWith("  import type { TestDOAPI } from './.do'")
    })
  })

  describe('error handling - file not found', () => {
    it('should exit with error when source file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)

      await expect(generateFromSource('src/NonExistent.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Source file not found: src/NonExistent.ts')
      expect(exitCode).toBe(1)
    })

    it('should not check existence for glob patterns', async () => {
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockExistsSync.mockReturnValue(true)
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/**/*.ts')

      // existsSync should only be called for output dir, not source pattern
      const sourceChecks = mockExistsSync.mock.calls.filter(
        (call) => String(call[0]).includes('**')
      )
      expect(sourceChecks.length).toBe(0)
    })
  })

  describe('error handling - invalid source', () => {
    it('should exit with error for non-TypeScript files', async () => {
      mockExistsSync.mockReturnValue(true)

      await expect(generateFromSource('src/file.js')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Source must be a TypeScript file (.ts): src/file.js')
      expect(exitCode).toBe(1)
    })

    it('should exit with error when no DO classes found', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([])
      mockUnlinkSync.mockImplementation(() => {})

      await expect(generateFromSource('src/empty.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No valid Durable Object classes found.')
      expect(exitCode).toBe(1)
    })

    it('should handle syntax errors in source file', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockRejectedValue(new Error('TypeScript syntax error in file'))
      mockUnlinkSync.mockImplementation(() => {})

      await expect(generateFromSource('src/invalid.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: TypeScript syntax error in source file.')
      expect(exitCode).toBe(1)
    })

    it('should handle extraction errors for missing class', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockRejectedValue(new Error('No class extending DurableObject found'))
      mockUnlinkSync.mockImplementation(() => {})

      await expect(generateFromSource('src/noclass.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No valid Durable Object class found.')
      expect(exitCode).toBe(1)
    })

    it('should handle empty file errors', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockRejectedValue(new Error('File is empty'))
      mockUnlinkSync.mockImplementation(() => {})

      await expect(generateFromSource('src/empty.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: File is empty')
      expect(exitCode).toBe(1)
    })
  })

  describe('error handling - output directory', () => {
    it('should handle permission denied error', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      const permError = new Error('Permission denied') as NodeJS.ErrnoException
      permError.code = 'EACCES'
      mockMkdirSync.mockImplementation(() => {
        throw permError
      })

      await expect(generateFromSource('src/TestDO.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: permission denied - cannot write to output directory')
      )
      expect(exitCode).toBe(1)
    })

    it('should handle ENOENT error for output directory', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      const enoentError = new Error('No such file or directory') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      mockMkdirSync.mockImplementation(() => {
        throw enoentError
      })

      await expect(generateFromSource('src/TestDO.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: cannot write - directory does not exist')
      )
      expect(exitCode).toBe(1)
    })

    it('should handle write test failure', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockMkdirSync.mockImplementation(() => {})
      mockWriteFileSync.mockImplementation((path: string) => {
        if (String(path).includes('.write-test')) {
          throw new Error('Disk full')
        }
      })

      await expect(generateFromSource('src/TestDO.ts')).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error: cannot write to output directory')
      )
      expect(exitCode).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle multiple DOs in single file', async () => {
      const schemas = [
        { ...createMockSchema(), className: 'FirstDO' },
        { ...createMockSchema(), className: 'SecondDO' },
      ]
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue(schemas)
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/multi.ts')

      expect(consoleLogSpy).toHaveBeenCalledWith('\nDone! Generated types for 2 Durable Object(s).')
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "  import type { FirstDOAPI, SecondDOAPI } from './.do'"
      )
    })

    it('should use default output directory when not specified', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockGenerateDTS.mockReturnValue('// Generated')
      mockGenerateIndex.mockReturnValue('// Index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts')

      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/.do', { recursive: true })
    })
  })
})

// ============================================================================
// generateFromUrl Tests
// ============================================================================

describe('generateFromUrl', () => {
  describe('successful generation', () => {
    it('should fetch schema and generate client types', async () => {
      const mockSchema = createMockRpcSchema()
      mockFetchSchema.mockResolvedValue(mockSchema)
      mockGenerateClient.mockReturnValue('// Generated client.d.ts')
      mockGenerateEntrypoint.mockReturnValue('// Generated index.ts')

      await generateFromUrl('https://api.example.com')

      expect(consoleLogSpy).toHaveBeenCalledWith('Fetching schema from https://api.example.com...')
      expect(mockFetchSchema).toHaveBeenCalledWith('https://api.example.com')
      expect(consoleLogSpy).toHaveBeenCalledWith('Found 2 methods, 1 namespaces')
    })

    it('should generate client.d.ts and index.ts files', async () => {
      const mockSchema = createMockRpcSchema()
      mockFetchSchema.mockResolvedValue(mockSchema)
      mockGenerateClient.mockReturnValue('// client types')
      mockGenerateEntrypoint.mockReturnValue('// entrypoint')

      await generateFromUrl('https://api.example.com')

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('client.d.ts'),
        '// client types'
      )
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('index.ts'),
        '// entrypoint'
      )
    })

    it('should use default output directory', async () => {
      mockFetchSchema.mockResolvedValue(createMockRpcSchema())
      mockGenerateClient.mockReturnValue('// client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com')

      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/test/project/generated/rpc',
        { recursive: true }
      )
    })

    it('should use custom output directory when provided', async () => {
      mockFetchSchema.mockResolvedValue(createMockRpcSchema())
      mockGenerateClient.mockReturnValue('// client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com', './custom/output')

      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/test/project/custom/output',
        { recursive: true }
      )
    })

    it('should display completion message with import path', async () => {
      mockFetchSchema.mockResolvedValue(createMockRpcSchema())
      mockGenerateClient.mockReturnValue('// client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com', './my-types')

      expect(consoleLogSpy).toHaveBeenCalledWith('\nDone! Import your typed client:')
      expect(consoleLogSpy).toHaveBeenCalledWith("  import { rpc } from './my-types'")
    })
  })

  describe('schema details', () => {
    it('should display correct method and namespace counts', async () => {
      const schemaWithMultiple = {
        version: 1,
        methods: [
          { name: 'a', path: 'a', params: 0 },
          { name: 'b', path: 'b', params: 0 },
          { name: 'c', path: 'c', params: 0 },
        ],
        namespaces: [
          { name: 'users', methods: [] },
          { name: 'posts', methods: [] },
        ],
      }
      mockFetchSchema.mockResolvedValue(schemaWithMultiple)
      mockGenerateClient.mockReturnValue('// client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com')

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 3 methods, 2 namespaces')
    })

    it('should handle schema with zero methods and namespaces', async () => {
      const emptySchema = {
        version: 1,
        methods: [],
        namespaces: [],
      }
      mockFetchSchema.mockResolvedValue(emptySchema)
      mockGenerateClient.mockReturnValue('// empty client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com')

      expect(consoleLogSpy).toHaveBeenCalledWith('Found 0 methods, 0 namespaces')
    })
  })

  describe('generated file paths', () => {
    it('should log generated file paths', async () => {
      mockFetchSchema.mockResolvedValue(createMockRpcSchema())
      mockGenerateClient.mockReturnValue('// client')
      mockGenerateEntrypoint.mockReturnValue('// entry')

      await generateFromUrl('https://api.example.com')

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated typed client:')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated entrypoint:')
      )
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('generate command integration', () => {
  describe('source mode', () => {
    it('should complete full workflow for source generation', async () => {
      const mockSchema = createMockSchema()
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([mockSchema])
      mockGenerateDTS.mockReturnValue('export interface TestDOAPI {}')
      mockGenerateIndex.mockReturnValue('export type { TestDOAPI }')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts', './types')

      // Verify extraction
      expect(mockExtractTypes).toHaveBeenCalledWith('src/TestDO.ts')

      // Verify file generation
      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/types', { recursive: true })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('TestDO.d.ts'),
        'export interface TestDOAPI {}'
      )
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('index.ts'),
        'export type { TestDOAPI }'
      )
    })
  })

  describe('url mode', () => {
    it('should complete full workflow for URL generation', async () => {
      const mockSchema = createMockRpcSchema()
      mockFetchSchema.mockResolvedValue(mockSchema)
      mockGenerateClient.mockReturnValue('// client code')
      mockGenerateEntrypoint.mockReturnValue('// entry code')

      await generateFromUrl('https://my-worker.workers.dev', './rpc-types')

      // Verify fetch
      expect(mockFetchSchema).toHaveBeenCalledWith('https://my-worker.workers.dev')

      // Verify file generation
      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/rpc-types', { recursive: true })
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/test/project/rpc-types/client.d.ts',
        '// client code'
      )
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/test/project/rpc-types/index.ts',
        '// entry code'
      )
    })
  })

  describe('zero-config mode', () => {
    it('should complete full workflow for zero-config', async () => {
      mockDetectFromWrangler.mockResolvedValue([{ name: 'COUNTER', className: 'CounterDO' }])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'CounterDO', filePath: '/test/src/counter.ts', baseClass: 'DurableRPC' }],
        generated: ['/test/.do/CounterDO.d.ts', '/test/.do/index.ts'],
        usedFallback: false,
        warnings: [],
      })

      await runZeroConfigCommand()

      // Verify detection
      expect(mockDetectFromWrangler).toHaveBeenCalled()
      expect(mockRunZeroConfig).toHaveBeenCalled()

      // Verify output
      expect(consoleLogSpy).toHaveBeenCalledWith('Done! Import your typed client:')
      expect(consoleLogSpy).toHaveBeenCalledWith("  import type { CounterDOAPI } from './.do'")
    })
  })
})

// ============================================================================
// Edge Cases and Boundary Conditions
// ============================================================================

describe('edge cases', () => {
  describe('empty DO scenarios', () => {
    it('should handle DO with no methods', async () => {
      const emptySchema = {
        className: 'EmptyDO',
        methods: [],
        namespaces: [],
        types: [],
      }
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([emptySchema])
      mockGenerateDTS.mockReturnValue('export interface EmptyDOAPI {}')
      mockGenerateIndex.mockReturnValue('export type { EmptyDOAPI }')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/EmptyDO.ts')

      expect(consoleLogSpy).toHaveBeenCalledWith('\nDone! Generated types for 1 Durable Object(s).')
    })

    it('should handle DO with only namespaces (no top-level methods)', async () => {
      const namespaceOnlySchema = {
        className: 'NamespaceDO',
        methods: [],
        namespaces: [
          {
            name: 'users',
            methods: [{ name: 'list', parameters: [], returnType: 'Promise<User[]>' }],
          },
        ],
        types: [],
      }
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([namespaceOnlySchema])
      mockGenerateDTS.mockReturnValue('export interface NamespaceDOAPI {}')
      mockGenerateIndex.mockReturnValue('export type { NamespaceDOAPI }')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/NamespaceDO.ts')

      expect(mockGenerateDTS).toHaveBeenCalledWith(namespaceOnlySchema)
    })
  })

  describe('special characters in paths', () => {
    it('should handle paths with spaces', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockGenerateDTS.mockReturnValue('// generated')
      mockGenerateIndex.mockReturnValue('// index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/my project/TestDO.ts', './output dir')

      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/output dir', { recursive: true })
    })
  })

  describe('glob pattern handling', () => {
    it('should skip TypeScript file validation for glob patterns', async () => {
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockGenerateDTS.mockReturnValue('// generated')
      mockGenerateIndex.mockReturnValue('// index')
      mockExistsSync.mockReturnValue(true)
      mockUnlinkSync.mockImplementation(() => {})

      // Using a pattern that would fail the .ts check if validated as a single file
      await generateFromSource('src/**/*.ts')

      // Should not fail because glob patterns bypass single-file validation
      expect(mockExtractTypes).toHaveBeenCalledWith('src/**/*.ts')
    })
  })
})

// ============================================================================
// Console Output Tests
// ============================================================================

describe('console output', () => {
  describe('runZeroConfigCommand output', () => {
    it('should print header message', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'TestDO', filePath: '/test/src/TestDO.ts', baseClass: 'DurableObject' }],
        generated: [],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('rpc.do - Zero-config type generation\n')
    })

    it('should print detection source info for class-based DOs', async () => {
      mockDetectFromWrangler.mockResolvedValue([])
      mockRunZeroConfig.mockResolvedValue({
        detected: [{ className: 'TestDO', filePath: '/test/src/TestDO.ts', baseClass: 'DurableObject' }],
        generated: [],
        usedFallback: true,
        warnings: [],
      })

      await runZeroConfigCommand()

      expect(consoleLogSpy).toHaveBeenCalledWith('    Source: /test/src/TestDO.ts')
    })
  })

  describe('generateFromSource output', () => {
    it('should print generated file paths', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExtractTypes.mockResolvedValue([createMockSchema()])
      mockGenerateDTS.mockReturnValue('// generated')
      mockGenerateIndex.mockReturnValue('// index')
      mockUnlinkSync.mockImplementation(() => {})

      await generateFromSource('src/TestDO.ts')

      const logCalls = consoleLogSpy.mock.calls.map((c) => c[0])
      expect(logCalls.some((msg) => String(msg).includes('Generated:'))).toBe(true)
    })
  })
})
