/**
 * Zero-Config Type Detection Tests
 *
 * Tests for automatic DO type detection from wrangler configs and source scanning.
 * These tests should FAIL (RED phase) as the implementation doesn't exist yet.
 *
 * The zero-config system enables `npx rpc.do` to work without any arguments by:
 * 1. Detecting DO bindings from wrangler.toml or wrangler.jsonc
 * 2. Finding the source files containing those classes
 * 3. Extracting types and generating .do/*.d.ts files
 * 4. Updating tsconfig.json paths for .do/* imports
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

// ============================================================================
// RED PHASE TDD: These tests are skipped because the implementation doesn't exist yet.
// The detect module (../src/detect) needs to be implemented before these tests can run.
// Once implemented, remove the .skip from the describe blocks below.
// ============================================================================

// Import the detect module that doesn't exist yet (will fail)
// import {
//   detectFromWrangler,
//   findClassSource,
//   detectFromScan,
//   updateTsConfig,
//   type WranglerBinding,
//   type DetectedDO,
//   type ScanResult,
// } from '../src/detect'

// Placeholder types until implementation exists
type WranglerBinding = { name: string; className: string }
type DetectedDO = { className: string; filePath: string; baseClass: string }
type ScanResult = { className: string; filePath: string; pattern: string; baseClass?: string; lineNumber: number; exportName?: string }

// Placeholder functions - will be replaced by actual imports when implemented
const detectFromWrangler = async (_dir: string): Promise<WranglerBinding[]> => { throw new Error('Not implemented') }
const findClassSource = async (_className: string, _dir: string, _options?: { pattern?: string }): Promise<DetectedDO | null> => { throw new Error('Not implemented') }
const detectFromScan = async (_dir: string): Promise<ScanResult[]> => { throw new Error('Not implemented') }
const updateTsConfig = async (_dir: string, _options?: { outputDir?: string }): Promise<boolean> => { throw new Error('Not implemented') }

// ============================================================================
// Test Fixtures - Sample wrangler configs and DO source files
// ============================================================================

const SAMPLE_WRANGLER_TOML = `
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDO" },
  { name = "CHAT_DO", class_name = "ChatDO" },
]

[[migrations]]
tag = "v1"
new_classes = ["MyDO", "ChatDO"]
`

const SAMPLE_WRANGLER_JSONC = `{
  // This is a JSON with comments (jsonc)
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  /* Multi-line comment
     for durable objects config */
  "durable_objects": {
    "bindings": [
      { "name": "MY_DO", "class_name": "MyDO" },
      { "name": "CHAT_DO", "class_name": "ChatDO" }
    ]
  }
}
`

const SAMPLE_DO_CLASS = `
import { DurableObject } from '@cloudflare/workers-types'

export class MyDO extends DurableObject {
  async ping(): Promise<string> {
    return 'pong'
  }

  async echo(message: string): Promise<string> {
    return message
  }
}
`

const SAMPLE_DO_DURABLE_RPC = `
import { DurableRPC } from 'rpc.do'

export class ChatDO extends DurableRPC {
  messages: string[] = []

  async send(message: string): Promise<void> {
    this.messages.push(message)
  }

  async list(): Promise<string[]> {
    return this.messages
  }
}
`

const SAMPLE_DO_DIGITAL_OBJECT = `
import { DigitalObject } from '@dotdo/core'

export class TaskDO extends DigitalObject {
  async create(task: { title: string }): Promise<string> {
    return 'task-123'
  }
}
`

const SAMPLE_DO_FACTORY = `
import { DO } from 'rpc.do'

export const counterDO = DO(async ($) => {
  let count = 0

  return {
    increment: async () => ++count,
    decrement: async () => --count,
    get: async () => count,
  }
})
`

const SAMPLE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  },
  "include": ["src/**/*"]
}
`

const SAMPLE_TSCONFIG_WITH_PATHS = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
`

// ============================================================================
// Test Helpers
// ============================================================================

let testDir: string

function createTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rpc-do-test-'))
  return dir
}

function cleanupTestDir(dir: string): void {
  if (dir && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createFile(dir: string, relativePath: string, content: string): string {
  const fullPath = join(dir, relativePath)
  const dirPath = join(dir, relativePath.split('/').slice(0, -1).join('/'))
  if (dirPath !== dir && !existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
  writeFileSync(fullPath, content)
  return fullPath
}

// ============================================================================
// Tests: detectFromWrangler
// ============================================================================

describe.skip('detectFromWrangler', () => {
  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('wrangler.toml parsing', () => {
    it('should parse durable_objects bindings from wrangler.toml', async () => {
      createFile(testDir, 'wrangler.toml', SAMPLE_WRANGLER_TOML)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(2)
      expect(bindings).toContainEqual({ name: 'MY_DO', className: 'MyDO' })
      expect(bindings).toContainEqual({ name: 'CHAT_DO', className: 'ChatDO' })
    })

    it('should return class names as array of strings', async () => {
      createFile(testDir, 'wrangler.toml', SAMPLE_WRANGLER_TOML)

      const bindings = await detectFromWrangler(testDir)
      const classNames = bindings.map((b) => b.className)

      expect(classNames).toEqual(['MyDO', 'ChatDO'])
    })

    it('should handle wrangler.toml with single binding', async () => {
      const singleBinding = `
[durable_objects]
bindings = [{ name = "SINGLE_DO", class_name = "SingleDO" }]
`
      createFile(testDir, 'wrangler.toml', singleBinding)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(1)
      expect(bindings[0]).toEqual({ name: 'SINGLE_DO', className: 'SingleDO' })
    })

    it('should handle wrangler.toml with no durable_objects section', async () => {
      const noBindings = `
name = "my-worker"
main = "src/index.ts"
`
      createFile(testDir, 'wrangler.toml', noBindings)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toEqual([])
    })

    it('should handle wrangler.toml with empty bindings array', async () => {
      const emptyBindings = `
[durable_objects]
bindings = []
`
      createFile(testDir, 'wrangler.toml', emptyBindings)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toEqual([])
    })
  })

  describe('wrangler.jsonc parsing', () => {
    it('should parse durable_objects bindings from wrangler.jsonc', async () => {
      createFile(testDir, 'wrangler.jsonc', SAMPLE_WRANGLER_JSONC)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(2)
      expect(bindings).toContainEqual({ name: 'MY_DO', className: 'MyDO' })
      expect(bindings).toContainEqual({ name: 'CHAT_DO', className: 'ChatDO' })
    })

    it('should strip single-line comments from jsonc', async () => {
      const jsoncWithComments = `{
  // This comment should be stripped
  "durable_objects": {
    // Another comment
    "bindings": [
      { "name": "TEST_DO", "class_name": "TestDO" } // inline comment
    ]
  }
}
`
      createFile(testDir, 'wrangler.jsonc', jsoncWithComments)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(1)
      expect(bindings[0]).toEqual({ name: 'TEST_DO', className: 'TestDO' })
    })

    it('should strip multi-line comments from jsonc', async () => {
      const jsoncWithMultilineComments = `{
  /* This is a
     multi-line
     comment */
  "durable_objects": {
    "bindings": [
      { "name": "TEST_DO", "class_name": "TestDO" }
    ]
  }
}
`
      createFile(testDir, 'wrangler.jsonc', jsoncWithMultilineComments)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(1)
    })

    it('should handle wrangler.jsonc with trailing commas', async () => {
      const jsoncWithTrailingCommas = `{
  "durable_objects": {
    "bindings": [
      { "name": "TEST_DO", "class_name": "TestDO" },
    ],
  },
}
`
      createFile(testDir, 'wrangler.jsonc', jsoncWithTrailingCommas)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(1)
      expect(bindings[0]).toEqual({ name: 'TEST_DO', className: 'TestDO' })
    })
  })

  describe('config file priority', () => {
    it('should prefer wrangler.jsonc over wrangler.toml when both exist', async () => {
      // JSONC has different binding
      createFile(testDir, 'wrangler.jsonc', `{
  "durable_objects": {
    "bindings": [{ "name": "JSONC_DO", "class_name": "JsoncDO" }]
  }
}`)
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [{ name = "TOML_DO", class_name = "TomlDO" }]
`)

      const bindings = await detectFromWrangler(testDir)

      // Should use jsonc (more modern format)
      expect(bindings[0].className).toBe('JsoncDO')
    })

    it('should fall back to wrangler.toml if wrangler.jsonc not found', async () => {
      createFile(testDir, 'wrangler.toml', SAMPLE_WRANGLER_TOML)

      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toHaveLength(2)
    })

    it('should return empty array if no wrangler config found', async () => {
      // No config files created
      const bindings = await detectFromWrangler(testDir)

      expect(bindings).toEqual([])
    })
  })

  describe('error handling', () => {
    it('should throw on invalid TOML syntax', async () => {
      createFile(testDir, 'wrangler.toml', 'invalid [ toml syntax')

      await expect(detectFromWrangler(testDir)).rejects.toThrow()
    })

    it('should throw on invalid JSON in jsonc', async () => {
      createFile(testDir, 'wrangler.jsonc', '{ invalid json }')

      await expect(detectFromWrangler(testDir)).rejects.toThrow()
    })
  })
})

// ============================================================================
// Tests: findClassSource
// ============================================================================

describe.skip('findClassSource', () => {
  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('class discovery', () => {
    it('should find class extending DurableObject in src/**/*.ts', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const result = await findClassSource('MyDO', testDir)

      expect(result).not.toBeNull()
      expect(result?.filePath).toBe(join(testDir, 'src/my-do.ts'))
      expect(result?.className).toBe('MyDO')
      expect(result?.baseClass).toBe('DurableObject')
    })

    it('should find class extending DurableRPC', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/chat.ts', SAMPLE_DO_DURABLE_RPC)

      const result = await findClassSource('ChatDO', testDir)

      expect(result).not.toBeNull()
      expect(result?.className).toBe('ChatDO')
      expect(result?.baseClass).toBe('DurableRPC')
    })

    it('should find class extending DigitalObject', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/task.ts', SAMPLE_DO_DIGITAL_OBJECT)

      const result = await findClassSource('TaskDO', testDir)

      expect(result).not.toBeNull()
      expect(result?.className).toBe('TaskDO')
      expect(result?.baseClass).toBe('DigitalObject')
    })

    it('should search in nested directories', async () => {
      mkdirSync(join(testDir, 'src/do/entities'), { recursive: true })
      createFile(testDir, 'src/do/entities/deep.ts', `
export class DeepDO extends DurableObject {
  async method() { return 'deep' }
}
`)

      const result = await findClassSource('DeepDO', testDir)

      expect(result).not.toBeNull()
      expect(result?.filePath).toContain('src/do/entities/deep.ts')
    })

    it('should return null if class not found', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/other.ts', 'export const foo = 1')

      const result = await findClassSource('NonExistentDO', testDir)

      expect(result).toBeNull()
    })

    it('should skip .d.ts files', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.d.ts', SAMPLE_DO_CLASS)

      const result = await findClassSource('MyDO', testDir)

      expect(result).toBeNull()
    })

    it('should skip files in node_modules', async () => {
      mkdirSync(join(testDir, 'node_modules/some-package'), { recursive: true })
      createFile(testDir, 'node_modules/some-package/do.ts', SAMPLE_DO_CLASS)

      const result = await findClassSource('MyDO', testDir)

      expect(result).toBeNull()
    })

    it('should handle multiple classes in one file', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/multi.ts', `
export class FirstDO extends DurableObject {
  async first() { return 1 }
}

export class SecondDO extends DurableObject {
  async second() { return 2 }
}
`)

      const first = await findClassSource('FirstDO', testDir)
      const second = await findClassSource('SecondDO', testDir)

      expect(first?.className).toBe('FirstDO')
      expect(second?.className).toBe('SecondDO')
      expect(first?.filePath).toBe(second?.filePath)
    })
  })

  describe('search paths', () => {
    it('should search src/**/*.ts by default', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const result = await findClassSource('MyDO', testDir)

      expect(result?.filePath).toContain('src/')
    })

    it('should allow custom search pattern', async () => {
      mkdirSync(join(testDir, 'workers'), { recursive: true })
      createFile(testDir, 'workers/my-do.ts', SAMPLE_DO_CLASS)

      const result = await findClassSource('MyDO', testDir, { pattern: 'workers/**/*.ts' })

      expect(result?.filePath).toContain('workers/')
    })
  })
})

// ============================================================================
// Tests: detectFromScan
// ============================================================================

describe.skip('detectFromScan', () => {
  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('pattern detection', () => {
    it('should find class X extends DurableObject pattern', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results).toHaveLength(1)
      expect(results[0].className).toBe('MyDO')
      expect(results[0].pattern).toBe('class')
      expect(results[0].baseClass).toBe('DurableObject')
    })

    it('should find class X extends DurableRPC pattern', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/chat.ts', SAMPLE_DO_DURABLE_RPC)

      const results = await detectFromScan(testDir)

      expect(results.some((r) => r.className === 'ChatDO')).toBe(true)
    })

    it('should find class X extends DigitalObject pattern', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/task.ts', SAMPLE_DO_DIGITAL_OBJECT)

      const results = await detectFromScan(testDir)

      expect(results.some((r) => r.className === 'TaskDO')).toBe(true)
    })

    it('should find DO(() => {...}) factory pattern', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/counter.ts', SAMPLE_DO_FACTORY)

      const results = await detectFromScan(testDir)

      expect(results.some((r) => r.pattern === 'factory')).toBe(true)
      expect(results.some((r) => r.exportName === 'counterDO')).toBe(true)
    })

    it('should find multiple DOs across multiple files', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)
      createFile(testDir, 'src/chat.ts', SAMPLE_DO_DURABLE_RPC)
      createFile(testDir, 'src/counter.ts', SAMPLE_DO_FACTORY)

      const results = await detectFromScan(testDir)

      expect(results.length).toBeGreaterThanOrEqual(3)
    })

    it('should return empty array when no DOs found', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/util.ts', 'export const add = (a: number, b: number) => a + b')

      const results = await detectFromScan(testDir)

      expect(results).toEqual([])
    })
  })

  describe('result structure', () => {
    it('should return file path for each detected DO', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results[0].filePath).toBe(join(testDir, 'src/my-do.ts'))
    })

    it('should include line number where class/factory is defined', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results[0].lineNumber).toBeGreaterThan(0)
    })
  })

  describe('exclusions', () => {
    it('should skip node_modules', async () => {
      mkdirSync(join(testDir, 'node_modules/pkg'), { recursive: true })
      createFile(testDir, 'node_modules/pkg/do.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results).toEqual([])
    })

    it('should skip .d.ts files', async () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/types.d.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results).toEqual([])
    })

    it('should skip dist folder', async () => {
      mkdirSync(join(testDir, 'dist'), { recursive: true })
      createFile(testDir, 'dist/my-do.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results).toEqual([])
    })

    it('should skip .do output folder', async () => {
      mkdirSync(join(testDir, '.do'), { recursive: true })
      createFile(testDir, '.do/generated.ts', SAMPLE_DO_CLASS)

      const results = await detectFromScan(testDir)

      expect(results).toEqual([])
    })
  })
})

// ============================================================================
// Tests: updateTsConfig
// ============================================================================

describe.skip('updateTsConfig', () => {
  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('adding paths', () => {
    it('should add .do/* to compilerOptions.paths', async () => {
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG)

      await updateTsConfig(testDir)

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths).toBeDefined()
      expect(updated.compilerOptions.paths['.do/*']).toEqual(['./.do/*'])
    })

    it('should create paths object if it does not exist', async () => {
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG)

      await updateTsConfig(testDir)

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths).toBeDefined()
    })

    it('should preserve existing paths', async () => {
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG_WITH_PATHS)

      await updateTsConfig(testDir)

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths['@/*']).toEqual(['./src/*'])
      expect(updated.compilerOptions.paths['.do/*']).toEqual(['./.do/*'])
    })

    it('should not duplicate .do/* if already present', async () => {
      const tsconfigWithDo = `{
  "compilerOptions": {
    "paths": {
      ".do/*": ["./.do/*"]
    }
  }
}
`
      createFile(testDir, 'tsconfig.json', tsconfigWithDo)

      await updateTsConfig(testDir)

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths['.do/*']).toEqual(['./.do/*'])
    })
  })

  describe('error handling', () => {
    it('should handle missing tsconfig.json gracefully', async () => {
      // No tsconfig.json created

      // Should not throw
      await expect(updateTsConfig(testDir)).resolves.not.toThrow()
    })

    it('should return false if tsconfig.json not found', async () => {
      const result = await updateTsConfig(testDir)

      expect(result).toBe(false)
    })

    it('should return true if tsconfig.json was updated', async () => {
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG)

      const result = await updateTsConfig(testDir)

      expect(result).toBe(true)
    })

    it('should handle malformed tsconfig.json', async () => {
      createFile(testDir, 'tsconfig.json', 'not valid json')

      await expect(updateTsConfig(testDir)).rejects.toThrow()
    })
  })

  describe('custom output paths', () => {
    it('should support custom output directory', async () => {
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG)

      await updateTsConfig(testDir, { outputDir: './.generated' })

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths['.generated/*']).toEqual(['./.generated/*'])
    })
  })
})

// ============================================================================
// Tests: Integration - Zero-Config CLI Flow
// ============================================================================

describe.skip('zero-config CLI', () => {
  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    cleanupTestDir(testDir)
  })

  describe('full workflow', () => {
    it('should detect wrangler config and generate types', async () => {
      // Setup: wrangler.toml + source files
      createFile(testDir, 'wrangler.toml', SAMPLE_WRANGLER_TOML)
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)
      createFile(testDir, 'src/chat-do.ts', SAMPLE_DO_DURABLE_RPC)

      // This imports the zero-config orchestrator that doesn't exist
      const { runZeroConfig } = await import('../src/detect')

      const result = await runZeroConfig(testDir)

      expect(result.detected).toHaveLength(2)
      expect(result.generated).toHaveLength(2)
    })

    it('should generate .do/*.d.ts files for each DO', async () => {
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [{ name = "MY_DO", class_name = "MyDO" }]
`)
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const { runZeroConfig } = await import('../src/detect')
      await runZeroConfig(testDir)

      expect(existsSync(join(testDir, '.do/MyDO.d.ts'))).toBe(true)
    })

    it('should generate .do/index.ts with re-exports', async () => {
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [{ name = "MY_DO", class_name = "MyDO" }]
`)
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const { runZeroConfig } = await import('../src/detect')
      await runZeroConfig(testDir)

      expect(existsSync(join(testDir, '.do/index.ts'))).toBe(true)
      const indexContent = readFileSync(join(testDir, '.do/index.ts'), 'utf-8')
      expect(indexContent).toContain('MyDOAPI')
    })

    it('should fall back to source scanning when no wrangler config', async () => {
      // No wrangler config, but has DO files
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)

      const { runZeroConfig } = await import('../src/detect')
      const result = await runZeroConfig(testDir)

      expect(result.detected).toHaveLength(1)
      expect(result.usedFallback).toBe(true)
    })

    it('should update tsconfig.json with .do/* path', async () => {
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [{ name = "MY_DO", class_name = "MyDO" }]
`)
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)
      createFile(testDir, 'tsconfig.json', SAMPLE_TSCONFIG)

      const { runZeroConfig } = await import('../src/detect')
      await runZeroConfig(testDir)

      const updated = JSON.parse(readFileSync(join(testDir, 'tsconfig.json'), 'utf-8'))
      expect(updated.compilerOptions.paths['.do/*']).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should handle empty project gracefully', async () => {
      const { runZeroConfig } = await import('../src/detect')
      const result = await runZeroConfig(testDir)

      expect(result.detected).toEqual([])
      expect(result.generated).toEqual([])
    })

    it('should handle class not found for wrangler binding', async () => {
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [{ name = "MISSING_DO", class_name = "MissingDO" }]
`)
      // No source file for MissingDO

      const { runZeroConfig } = await import('../src/detect')
      const result = await runZeroConfig(testDir)

      expect(result.warnings).toContain('Could not find source for: MissingDO')
    })

    it('should handle mixed class and factory patterns', async () => {
      createFile(testDir, 'wrangler.toml', `
[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDO" },
  { name = "COUNTER_DO", class_name = "counterDO" }
]
`)
      mkdirSync(join(testDir, 'src'), { recursive: true })
      createFile(testDir, 'src/my-do.ts', SAMPLE_DO_CLASS)
      createFile(testDir, 'src/counter.ts', SAMPLE_DO_FACTORY)

      const { runZeroConfig } = await import('../src/detect')
      const result = await runZeroConfig(testDir)

      expect(result.detected).toHaveLength(2)
    })
  })
})

// ============================================================================
// Tests: Type Definitions (compile-time checks)
// ============================================================================

describe.skip('type definitions', () => {
  it('should export WranglerBinding type', () => {
    // This is a compile-time check - if the type is wrong, the test file won't compile
    const binding: WranglerBinding = {
      name: 'MY_DO',
      className: 'MyDO',
    }
    expect(binding.name).toBe('MY_DO')
    expect(binding.className).toBe('MyDO')
  })

  it('should export DetectedDO type', () => {
    const detected: DetectedDO = {
      className: 'MyDO',
      filePath: '/path/to/my-do.ts',
      baseClass: 'DurableObject',
    }
    expect(detected.className).toBe('MyDO')
  })

  it('should export ScanResult type', () => {
    const result: ScanResult = {
      className: 'MyDO',
      filePath: '/path/to/my-do.ts',
      pattern: 'class',
      baseClass: 'DurableObject',
      lineNumber: 5,
    }
    expect(result.pattern).toBe('class')
  })
})
