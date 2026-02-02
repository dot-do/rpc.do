/**
 * CLI Doctor Command Tests
 *
 * Tests for the rpc.do doctor diagnostic command
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import type { RpcSchema } from '../src/cli/types.js'

// ============================================================================
// Mock Setup
// ============================================================================

const mockExistsSync = vi.fn<[string], boolean>()

vi.mock('node:fs', () => ({
  existsSync: (path: string) => mockExistsSync(path),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
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

function createValidSchema(): RpcSchema {
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

function getConsoleOutput(): string {
  return consoleLogSpy.mock.calls.map(c => c[0]).join('\n')
}

// ============================================================================
// Tests
// ============================================================================

describe('CLI Doctor Command', () => {
  // Import main dynamically to ensure mocks are in place
  let main: (argv?: string[]) => Promise<void>

  beforeEach(async () => {
    const module = await import('../src/cli/index.js')
    main = module.main
  })

  describe('basic functionality', () => {
    it('should print version and platform info', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('rpc.do doctor')
      expect(output).toContain('Version:')
      expect(output).toContain('Node.js:')
      expect(output).toContain('Platform:')
    })

    it('should print diagnostics section', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Diagnostics:')
    })

    it('should check for wrangler config', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('wrangler.toml')
      })

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Wrangler Config')
      expect(output).toContain('wrangler.toml found')
    })

    it('should warn when no wrangler config exists', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Wrangler Config')
      expect(output).toContain('No wrangler config found')
    })
  })

  describe('configuration detection', () => {
    it('should detect do.config.ts', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('do.config.ts')
      })

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Configuration')
      expect(output).toContain('Config file found')
    })

    it('should detect rpc.config.ts', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('rpc.config.ts')
      })

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Configuration')
      expect(output).toContain('Config file found')
    })

    it('should warn when no config file exists', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Configuration')
      expect(output).toContain('No config file found')
    })

    it('should indicate using --url flag when provided', async () => {
      mockExistsSync.mockReturnValue(false)
      // Mock both the HEAD request (connectivity) and the schema request
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(createValidSchema()),
        })

      await main(['doctor', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('Configuration')
      expect(output).toContain('Using --url flag')
      expect(output).toContain('https://example.com')
    })
  })

  describe('connectivity checks', () => {
    it('should check connectivity when URL is provided', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(createValidSchema()),
      })

      await main(['doctor', '--url', 'https://my-worker.workers.dev'])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-worker.workers.dev',
        expect.objectContaining({ method: 'HEAD' })
      )

      const output = getConsoleOutput()
      expect(output).toContain('Connectivity')
      expect(output).toContain('Reachable')
    })

    it('should handle connectivity failures', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch.mockRejectedValue(new Error('ENOTFOUND'))

      await expect(main(['doctor', '--url', 'https://invalid.example'])).rejects.toThrow(ExitError)

      const output = getConsoleOutput()
      expect(output).toContain('Connectivity')
      expect(output).toContain('Failed to connect')
      expect(exitCode).toBe(1)
    })

    it('should handle 4xx responses with warning', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await main(['doctor', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('Connectivity')
      expect(output).toContain('401')
      expect(output).toContain('authentication')
    })

    it('should handle 5xx responses as errors', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(main(['doctor', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const output = getConsoleOutput()
      expect(output).toContain('Connectivity')
      expect(output).toContain('Server error')
      expect(output).toContain('500')
      expect(exitCode).toBe(1)
    })

    it('should skip connectivity check when no URL available', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Connectivity')
      expect(output).toContain('Skipped - no URL provided')
    })
  })

  describe('schema validation', () => {
    it('should validate schema endpoint', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(createValidSchema()),
        })

      await main(['doctor', '--url', 'https://my-worker.workers.dev'])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-worker.workers.dev/__schema',
        expect.anything()
      )

      const output = getConsoleOutput()
      expect(output).toContain('Schema')
      expect(output).toContain('Valid schema')
      expect(output).toContain('method(s)')
    })

    it('should report invalid schema format', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ invalid: 'schema' }),
        })

      await expect(main(['doctor', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const output = getConsoleOutput()
      expect(output).toContain('Schema')
      expect(output).toContain('Invalid schema format')
      expect(exitCode).toBe(1)
    })

    it('should handle schema fetch failure', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })

      await expect(main(['doctor', '--url', 'https://example.com'])).rejects.toThrow(ExitError)

      const output = getConsoleOutput()
      expect(output).toContain('Schema')
      expect(output).toContain('404')
      expect(exitCode).toBe(1)
    })

    it('should skip schema check when no URL available', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Schema')
      expect(output).toContain('Skipped - no URL provided')
    })

    it('should handle URL already ending with /__schema', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(createValidSchema()),
        })

      await main(['doctor', '--url', 'https://example.com/__schema'])

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/__schema',
        expect.anything()
      )
    })
  })

  describe('summary output', () => {
    it('should report all checks passed when successful', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('wrangler.toml') || String(p).endsWith('do.config.ts')
      })
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(createValidSchema()),
        })

      await main(['doctor', '--url', 'https://example.com'])

      const output = getConsoleOutput()
      expect(output).toContain('All checks passed')
    })

    it('should report warnings count', async () => {
      mockExistsSync.mockReturnValue(false)

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('warning(s)')
    })

    it('should exit with code 1 when there are errors', async () => {
      mockExistsSync.mockReturnValue(false)
      mockFetch.mockRejectedValue(new Error('Network error'))

      await expect(main(['doctor', '--url', 'https://invalid.example'])).rejects.toThrow(ExitError)

      expect(exitCode).toBe(1)
    })
  })

  describe('wrangler.jsonc support', () => {
    it('should detect wrangler.jsonc', async () => {
      mockExistsSync.mockImplementation((p: string) => {
        return String(p).endsWith('wrangler.jsonc')
      })

      await main(['doctor'])

      const output = getConsoleOutput()
      expect(output).toContain('Wrangler Config')
      expect(output).toContain('wrangler.jsonc found')
    })
  })
})
