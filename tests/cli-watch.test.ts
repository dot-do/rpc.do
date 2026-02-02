/**
 * CLI Watch Command Tests
 *
 * Tests for the rpc.do watch command that watches for changes
 * in source files or remote schemas and regenerates types.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import type { RpcSchema } from '../src/cli/types.js'
import type { ExtractedSchema } from '../src/extract.js'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock functions for fs module
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockExistsSync = vi.fn<[string], boolean>()
const mockStatSync = vi.fn()

// Mock for fs.watch (used in watch mode)
const mockWatcher = {
  close: vi.fn(),
}
const mockFsWatch = vi.fn(() => mockWatcher)

vi.mock('node:fs', () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  existsSync: (path: string) => mockExistsSync(path),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  watch: (...args: unknown[]) => mockFsWatch(...args),
}))

// Mock extractTypes from extract.js
const mockExtractTypes = vi.fn<[string], Promise<ExtractedSchema[]>>()

vi.mock('../src/extract.js', () => ({
  extractTypes: (path: string) => mockExtractTypes(path),
  generateDTS: vi.fn((schema: ExtractedSchema) => `// Generated DTS for ${schema.className}\nexport interface ${schema.className}API {}\n`),
  generateIndex: vi.fn((schemas: ExtractedSchema[]) => `// Generated Index\n${schemas.map(s => `export type { ${s.className}API } from './${s.className}'`).join('\n')}\n`),
}))

// Mock loadConfig and fetchSchemaForWatch
const mockLoadConfig = vi.fn()
const mockFetchSchemaForWatch = vi.fn()

vi.mock('../src/cli/config.js', () => ({
  loadConfig: () => mockLoadConfig(),
  fetchSchemaForWatch: (url: string) => mockFetchSchemaForWatch(url),
}))

// Mock codegen functions
vi.mock('../src/cli/codegen.js', () => ({
  generateClient: vi.fn((schema: RpcSchema) => `// Generated Client\nexport interface GeneratedAPI {}\n`),
  generateEntrypoint: vi.fn(() => `// Generated Entrypoint\nexport function createClient(transport: unknown) {}\n`),
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
let processCwdSpy: ReturnType<typeof vi.spyOn>
let exitCode: number | undefined
let sigintHandlers: Array<() => void>
let sigtermHandlers: Array<() => void>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })

  // Reset mock implementations
  mockWriteFileSync.mockReset()
  mockMkdirSync.mockReset()
  mockExistsSync.mockReset().mockReturnValue(false)
  mockStatSync.mockReset()
  mockFsWatch.mockReset().mockReturnValue(mockWatcher)
  mockWatcher.close.mockReset()
  mockExtractTypes.mockReset()
  mockLoadConfig.mockReset().mockResolvedValue(undefined)
  mockFetchSchemaForWatch.mockReset()

  // Mock fetch
  originalFetch = globalThis.fetch
  mockFetch = vi.fn()
  globalThis.fetch = mockFetch

  // Mock process.cwd
  processCwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/test/project')

  // Mock console
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  // Mock process.exit
  exitCode = undefined
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    exitCode = typeof code === 'number' ? code : 0
    throw new ExitError(exitCode)
  })

  // Capture signal handlers
  sigintHandlers = []
  sigtermHandlers = []
  vi.spyOn(process, 'on').mockImplementation((event: string, handler: () => void) => {
    if (event === 'SIGINT') sigintHandlers.push(handler)
    if (event === 'SIGTERM') sigtermHandlers.push(handler)
    return process
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
  vi.useRealTimers()
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

function createExtractedSchema(name: string = 'TestDO'): ExtractedSchema {
  return {
    className: name,
    methods: [
      { name: 'ping', parameters: [], returnType: "Promise<'pong'>" },
    ],
    namespaces: [],
    types: [],
  }
}

function getConsoleOutput(): string {
  return consoleLogSpy.mock.calls.map(c => c[0]).join('\n')
}

function getConsoleErrors(): string {
  return consoleErrorSpy.mock.calls.map(c => c[0]).join('\n')
}

/**
 * Helper to trigger shutdown and catch the expected ExitError
 */
async function triggerShutdown(): Promise<void> {
  if (sigintHandlers.length > 0) {
    try {
      sigintHandlers[0]!()
    } catch (e) {
      if (!(e instanceof ExitError)) throw e
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CLI Watch Command', () => {
  // Import watchCommand dynamically to ensure mocks are in place
  let watchCommand: (args: string[]) => Promise<void>

  beforeEach(async () => {
    const module = await import('../src/cli/watch.js')
    watchCommand = module.watchCommand
  })

  // ==========================================================================
  // Watch Command Initialization
  // ==========================================================================
  describe('watch command initialization', () => {
    it('should parse --url flag correctly', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      // Start watch, let it initialize, then trigger shutdown
      const watchPromise = watchCommand(['--url', 'https://example.com'])

      // Let the initial fetch complete
      await vi.advanceTimersByTimeAsync(100)

      const output = getConsoleOutput()
      expect(output).toContain('Watching')
      expect(output).toContain('example.com')

      // Trigger shutdown to stop the watch
      await triggerShutdown()
    })

    it('should parse --source flag correctly', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const output = getConsoleOutput()
      expect(output).toContain('Watching')
      expect(output).toContain('MyDO.ts')

      await triggerShutdown()
    })

    it('should parse --output flag correctly', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts', '--output', './custom-output'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('custom-output'),
        { recursive: true }
      )

      await triggerShutdown()
    })

    it('should parse --interval flag for URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '10000'])

      await vi.advanceTimersByTimeAsync(100)

      // The interval was parsed - fetch should be called for initial generation
      expect(mockFetchSchemaForWatch).toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should error when both --source and --url are provided', async () => {
      await expect(
        watchCommand(['--source', './src/MyDO.ts', '--url', 'https://example.com'])
      ).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Cannot use both --source and --url together.')
      expect(exitCode).toBe(1)
    })

    it('should error when neither --source nor --url is provided and no config', async () => {
      mockLoadConfig.mockResolvedValue(undefined)

      await expect(watchCommand([])).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No source file or schema URL provided.')
      expect(exitCode).toBe(1)
    })

    it('should use source from config when not provided via flags', async () => {
      mockLoadConfig.mockResolvedValue({ source: './src/ConfigDO.ts', output: './.do' })
      mockExtractTypes.mockResolvedValue([createExtractedSchema('ConfigDO')])

      const watchPromise = watchCommand([])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockExtractTypes).toHaveBeenCalledWith('./src/ConfigDO.ts')

      await triggerShutdown()
    })

    it('should use schemaUrl from config when not provided via flags', async () => {
      const schema = createValidSchema()
      mockLoadConfig.mockResolvedValue({ schemaUrl: 'https://config-url.com' })
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand([])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFetchSchemaForWatch).toHaveBeenCalledWith('https://config-url.com/__schema')

      await triggerShutdown()
    })

    it('should normalize schema URL without /__schema suffix', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com/api'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFetchSchemaForWatch).toHaveBeenCalledWith('https://example.com/api/__schema')

      await triggerShutdown()
    })

    it('should not double-append /__schema to URL', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com/__schema'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFetchSchemaForWatch).toHaveBeenCalledWith('https://example.com/__schema')

      await triggerShutdown()
    })

    it('should strip trailing slash before appending /__schema', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com/'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFetchSchemaForWatch).toHaveBeenCalledWith('https://example.com/__schema')

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // File Change Detection (Source Mode)
  // ==========================================================================
  describe('file change detection (source mode)', () => {
    it('should set up file watcher on source directory', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFsWatch).toHaveBeenCalledWith(
        expect.stringContaining('src'),
        { recursive: true },
        expect.any(Function)
      )

      await triggerShutdown()
    })

    it('should regenerate types when .ts file changes', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      // Get the watcher callback
      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      // Reset call counts after initial generation
      mockExtractTypes.mockClear()
      mockWriteFileSync.mockClear()

      // Simulate file change
      await watchCallback('change', 'MyDO.ts')

      expect(mockExtractTypes).toHaveBeenCalled()
      expect(mockWriteFileSync).toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should ignore .d.ts file changes', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      mockExtractTypes.mockClear()

      // Simulate .d.ts file change
      await watchCallback('change', 'types.d.ts')

      // Should NOT trigger regeneration
      expect(mockExtractTypes).not.toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should ignore non-.ts file changes', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      mockExtractTypes.mockClear()

      // Simulate non-.ts file changes
      await watchCallback('change', 'readme.md')
      await watchCallback('change', 'config.json')
      await watchCallback('change', 'script.js')

      expect(mockExtractTypes).not.toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should handle null filename in watch callback', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      mockExtractTypes.mockClear()

      // Simulate callback with null filename
      await watchCallback('change', null)

      expect(mockExtractTypes).not.toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should log file change message', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      consoleLogSpy.mockClear()

      await watchCallback('change', 'MyDO.ts')

      const output = getConsoleOutput()
      expect(output).toContain('File changed')
      expect(output).toContain('MyDO.ts')

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // Schema Polling (URL Mode)
  // ==========================================================================
  describe('schema polling (URL mode)', () => {
    it('should poll for schema changes at specified interval', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '5000'])

      // Initial fetch
      await vi.advanceTimersByTimeAsync(100)
      expect(mockFetchSchemaForWatch).toHaveBeenCalledTimes(1)

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchSchemaForWatch).toHaveBeenCalledTimes(2)

      // Advance past second interval
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockFetchSchemaForWatch).toHaveBeenCalledTimes(3)

      await triggerShutdown()
    })

    it('should regenerate when schema hash changes', async () => {
      const schema1 = createValidSchema({ methods: [{ name: 'ping', path: 'ping', params: 0 }] })
      const schema2 = createValidSchema({ methods: [{ name: 'pong', path: 'pong', params: 0 }] })

      mockFetchSchemaForWatch
        .mockResolvedValueOnce(schema1)
        .mockResolvedValueOnce(schema2)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '5000'])

      // Initial fetch
      await vi.advanceTimersByTimeAsync(100)

      // Reset write counts
      mockWriteFileSync.mockClear()
      consoleLogSpy.mockClear()

      // Advance to trigger poll with changed schema
      await vi.advanceTimersByTimeAsync(5000)

      const output = getConsoleOutput()
      expect(output).toContain('Schema changed')
      expect(mockWriteFileSync).toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should not regenerate when schema is unchanged', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '5000'])

      // Initial fetch
      await vi.advanceTimersByTimeAsync(100)

      mockWriteFileSync.mockClear()
      consoleLogSpy.mockClear()

      // Advance to trigger poll (same schema)
      await vi.advanceTimersByTimeAsync(5000)

      // Should NOT log "Schema changed" or regenerate
      const output = getConsoleOutput()
      expect(output).not.toContain('Schema changed')

      await triggerShutdown()
    })

    it('should use default interval of 5000ms', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com'])

      // Let initial fetch complete
      await vi.advanceTimersByTimeAsync(100)

      // Reset and track from here
      mockFetchSchemaForWatch.mockClear()

      // Advance 4 seconds - should not trigger poll yet
      await vi.advanceTimersByTimeAsync(4000)
      expect(mockFetchSchemaForWatch).toHaveBeenCalledTimes(0)

      // Advance to 5 seconds total - should trigger poll
      await vi.advanceTimersByTimeAsync(1100)
      expect(mockFetchSchemaForWatch).toHaveBeenCalledTimes(1)

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // Rebuild Triggering
  // ==========================================================================
  describe('rebuild triggering', () => {
    it('should perform initial generation on source mode start', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockExtractTypes).toHaveBeenCalledWith('./src/MyDO.ts')
      expect(mockWriteFileSync).toHaveBeenCalled()
      expect(mockMkdirSync).toHaveBeenCalled()

      const output = getConsoleOutput()
      expect(output).toContain('Initial generation complete')

      await triggerShutdown()
    })

    it('should perform initial generation on URL mode start', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockFetchSchemaForWatch).toHaveBeenCalled()
      expect(mockWriteFileSync).toHaveBeenCalled()
      expect(mockMkdirSync).toHaveBeenCalled()

      const output = getConsoleOutput()
      expect(output).toContain('Initial generation complete')

      await triggerShutdown()
    })

    it('should create output directory recursively', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts', '--output', './deep/nested/output'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('deep/nested/output'),
        { recursive: true }
      )

      await triggerShutdown()
    })

    it('should write .d.ts files for each schema in source mode', async () => {
      mockExtractTypes.mockResolvedValue([
        createExtractedSchema('UserDO'),
        createExtractedSchema('TaskDO'),
      ])

      const watchPromise = watchCommand(['--source', './src/*.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const writeCalls = mockWriteFileSync.mock.calls.map(c => c[0] as string)
      expect(writeCalls.some(p => p.includes('UserDO.d.ts'))).toBe(true)
      expect(writeCalls.some(p => p.includes('TaskDO.d.ts'))).toBe(true)
      expect(writeCalls.some(p => p.includes('index.ts'))).toBe(true)

      await triggerShutdown()
    })

    it('should write client.d.ts and index.ts in URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com'])

      await vi.advanceTimersByTimeAsync(100)

      const writeCalls = mockWriteFileSync.mock.calls.map(c => c[0] as string)
      expect(writeCalls.some(p => p.includes('client.d.ts'))).toBe(true)
      expect(writeCalls.some(p => p.includes('index.ts'))).toBe(true)

      await triggerShutdown()
    })

    it('should log update message after successful regeneration in source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      consoleLogSpy.mockClear()

      await watchCallback('change', 'MyDO.ts')

      const output = getConsoleOutput()
      expect(output).toContain('Updated types')

      await triggerShutdown()
    })

    it('should log update message after successful regeneration in URL mode', async () => {
      const schema1 = createValidSchema({ methods: [{ name: 'a', path: 'a', params: 0 }] })
      const schema2 = createValidSchema({ methods: [{ name: 'b', path: 'b', params: 0 }] })

      mockFetchSchemaForWatch
        .mockResolvedValueOnce(schema1)
        .mockResolvedValueOnce(schema2)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '1000'])

      await vi.advanceTimersByTimeAsync(100)

      consoleLogSpy.mockClear()

      await vi.advanceTimersByTimeAsync(1000)

      const output = getConsoleOutput()
      expect(output).toContain('Updated client types')

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================
  describe('error handling', () => {
    it('should continue watching after extraction error in source mode', async () => {
      mockExtractTypes
        .mockRejectedValueOnce(new Error('Extraction failed'))
        .mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      // Should log error but continue
      const errors = getConsoleErrors()
      expect(errors).toContain('Error')

      // Watcher should still be set up
      expect(mockFsWatch).toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should continue watching after regeneration error in source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      // Make extraction fail on subsequent calls
      mockExtractTypes.mockRejectedValue(new Error('Regeneration failed'))

      const watchCallback = mockFsWatch.mock.calls[0]![2] as (event: string, filename: string | null) => Promise<void>

      consoleErrorSpy.mockClear()

      await watchCallback('change', 'MyDO.ts')

      const errors = getConsoleErrors()
      expect(errors).toContain('Error')
      expect(errors).toContain('Regeneration failed')

      // Watch should still be active (we can trigger shutdown)
      await triggerShutdown()
    })

    it('should exit on initial fetch failure in URL mode', async () => {
      mockFetchSchemaForWatch.mockRejectedValue(new Error('Network error'))

      await expect(
        watchCommand(['--url', 'https://example.com'])
      ).rejects.toThrow(ExitError)

      const errors = getConsoleErrors()
      expect(errors).toContain('Failed to fetch initial schema')
      expect(exitCode).toBe(1)
    })

    it('should continue watching after poll error in URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch
        .mockResolvedValueOnce(schema)
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '1000'])

      await vi.advanceTimersByTimeAsync(100)

      consoleErrorSpy.mockClear()

      // Trigger poll that fails
      await vi.advanceTimersByTimeAsync(1000)

      const errors = getConsoleErrors()
      expect(errors).toContain('Error fetching schema')

      // Should continue polling
      mockFetchSchemaForWatch.mockClear()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockFetchSchemaForWatch).toHaveBeenCalled()

      await triggerShutdown()
    })

    it('should handle Error instances with message extraction', async () => {
      mockExtractTypes.mockRejectedValue(new Error('Specific error message'))

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const errors = getConsoleErrors()
      expect(errors).toContain('Specific error message')

      await triggerShutdown()
    })

    it('should handle non-Error thrown values', async () => {
      mockExtractTypes.mockRejectedValue('String error')

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const errors = getConsoleErrors()
      expect(errors).toContain('String error')

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // Graceful Shutdown
  // ==========================================================================
  describe('graceful shutdown', () => {
    it('should register SIGINT handler', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      expect(sigintHandlers.length).toBeGreaterThan(0)

      await triggerShutdown()
    })

    it('should register SIGTERM handler', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      expect(sigtermHandlers.length).toBeGreaterThan(0)

      await triggerShutdown()
    })

    it('should close file watcher on SIGINT in source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      await triggerShutdown()

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('should close file watcher on SIGTERM in source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      // Use SIGTERM instead
      try {
        sigtermHandlers[0]!()
      } catch (e) {
        if (!(e instanceof ExitError)) throw e
      }

      expect(mockWatcher.close).toHaveBeenCalled()
    })

    it('should log shutdown message on SIGINT', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      consoleLogSpy.mockClear()

      await triggerShutdown()

      const output = getConsoleOutput()
      expect(output).toContain('Stopping watch mode')
      expect(output).toContain('Goodbye')
    })

    it('should exit with code 0 on graceful shutdown', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      await triggerShutdown()

      expect(exitCode).toBe(0)
    })

    it('should clear interval on shutdown in URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com', '--interval', '1000'])

      await vi.advanceTimersByTimeAsync(100)

      // Shutdown
      await triggerShutdown()

      // Reset fetch count
      mockFetchSchemaForWatch.mockClear()

      // Advance timers significantly - should NOT trigger more polls
      await vi.advanceTimersByTimeAsync(10000)

      // No additional fetch calls after shutdown
      expect(mockFetchSchemaForWatch).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Default Output Directories
  // ==========================================================================
  describe('default output directories', () => {
    it('should use .do as default output for source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.do'),
        { recursive: true }
      )

      await triggerShutdown()
    })

    it('should use ./generated/rpc as default output for URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com'])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('generated/rpc'),
        { recursive: true }
      )

      await triggerShutdown()
    })

    it('should use output from config when available', async () => {
      mockLoadConfig.mockResolvedValue({ source: './src/DO.ts', output: './custom-config-output' })
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand([])

      await vi.advanceTimersByTimeAsync(100)

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('custom-config-output'),
        { recursive: true }
      )

      await triggerShutdown()
    })
  })

  // ==========================================================================
  // Console Output
  // ==========================================================================
  describe('console output', () => {
    it('should print watching message on start for source mode', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const output = getConsoleOutput()
      expect(output).toContain('[rpc.do]')
      expect(output).toContain('Watching')
      expect(output).toContain('for changes')

      await triggerShutdown()
    })

    it('should print watching message on start for URL mode', async () => {
      const schema = createValidSchema()
      mockFetchSchemaForWatch.mockResolvedValue(schema)

      const watchPromise = watchCommand(['--url', 'https://example.com'])

      await vi.advanceTimersByTimeAsync(100)

      const output = getConsoleOutput()
      expect(output).toContain('[rpc.do]')
      expect(output).toContain('Watching')

      await triggerShutdown()
    })

    it('should print Ctrl+C instruction', async () => {
      mockExtractTypes.mockResolvedValue([createExtractedSchema()])

      const watchPromise = watchCommand(['--source', './src/MyDO.ts'])

      await vi.advanceTimersByTimeAsync(100)

      const output = getConsoleOutput()
      expect(output).toContain('Ctrl+C')

      await triggerShutdown()
    })
  })
})
