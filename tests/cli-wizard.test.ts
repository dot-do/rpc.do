/**
 * CLI Wizard Tests
 *
 * Tests for the interactive init wizard with mocked stdin prompts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import type { Prompter, WizardOptions, TemplateType } from '../src/cli/init.js'
import { runWizard, createProjectStructure } from '../src/cli/init.js'

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
// Mock Prompter Factory
// ============================================================================

/**
 * Creates a mock prompter that returns predefined answers in order
 */
function createMockPrompter(answers: string[]): Prompter {
  let index = 0
  const prompts: string[] = []

  return {
    async prompt(question: string): Promise<string> {
      prompts.push(question)
      return answers[index++] || ''
    },
    close() {
      // No-op
    },
    // Expose for testing
    get prompts() {
      return prompts
    },
  }
}

function getConsoleOutput(): string {
  return consoleLogSpy.mock.calls.map(c => c[0]).join('\n')
}

// ============================================================================
// runWizard() Tests
// ============================================================================

describe('runWizard()', () => {
  describe('project name prompt', () => {
    it('should use project name from args when provided', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      const options = await runWizard(['my-project'], prompter)

      expect(options.projectName).toBe('my-project')
    })

    it('should prompt for project name when not provided', async () => {
      const prompter = createMockPrompter(['custom-name', '1', 'y', ''])

      const options = await runWizard([], prompter)

      expect(options.projectName).toBe('custom-name')
      expect((prompter as unknown as { prompts: string[] }).prompts[0]).toContain('Project name')
    })

    it('should use current directory name as default when user enters empty string', async () => {
      processCwdSpy.mockReturnValue('/path/to/my-app')
      const prompter = createMockPrompter(['', '1', 'y', ''])

      const options = await runWizard([], prompter)

      expect(options.projectName).toBe('my-app')
    })

    it('should validate project name format', async () => {
      const prompter = createMockPrompter([])

      await expect(runWizard(['invalid name!'], prompter)).rejects.toThrow(ExitError)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Project name can only contain letters, numbers, hyphens, and underscores')
      )
      expect(exitCode).toBe(1)
    })

    it('should allow valid project names with hyphens and underscores', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      const options = await runWizard(['my-cool_project123'], prompter)

      expect(options.projectName).toBe('my-cool_project123')
    })
  })

  describe('template selection', () => {
    it('should default to basic template when user enters empty string', async () => {
      const prompter = createMockPrompter(['', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.template).toBe('basic')
    })

    it('should select basic template when user enters 1', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.template).toBe('basic')
    })

    it('should select chat template when user enters 2', async () => {
      const prompter = createMockPrompter(['2', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.template).toBe('chat')
    })

    it('should select api template when user enters 3', async () => {
      const prompter = createMockPrompter(['3', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.template).toBe('api')
    })

    it('should default to basic template for invalid input', async () => {
      const prompter = createMockPrompter(['999', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.template).toBe('basic')
    })

    it('should display template options', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      await runWizard(['test-project'], prompter)

      const output = getConsoleOutput()
      expect(output).toContain('Available templates:')
      expect(output).toContain('Basic')
      expect(output).toContain('Chat')
      expect(output).toContain('API')
    })
  })

  describe('include examples prompt', () => {
    it('should include examples by default (empty input)', async () => {
      const prompter = createMockPrompter(['1', '', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.includeExamples).toBe(true)
    })

    it('should include examples when user enters Y', async () => {
      const prompter = createMockPrompter(['1', 'Y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.includeExamples).toBe(true)
    })

    it('should include examples when user enters y', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.includeExamples).toBe(true)
    })

    it('should exclude examples when user enters n', async () => {
      const prompter = createMockPrompter(['1', 'n', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.includeExamples).toBe(false)
    })

    it('should exclude examples when user enters N', async () => {
      const prompter = createMockPrompter(['1', 'N', ''])

      const options = await runWizard(['test-project'], prompter)

      expect(options.includeExamples).toBe(false)
    })
  })

  describe('output directory prompt', () => {
    it('should use project name as default output directory', async () => {
      const prompter = createMockPrompter(['1', 'y', ''])

      const options = await runWizard(['my-project'], prompter)

      expect(options.outputDir).toBe('my-project')
    })

    it('should use custom output directory when provided', async () => {
      const prompter = createMockPrompter(['1', 'y', 'custom/path'])

      const options = await runWizard(['my-project'], prompter)

      expect(options.outputDir).toBe('custom/path')
    })
  })

  describe('complete wizard flow', () => {
    it('should collect all options in correct order', async () => {
      const prompter = createMockPrompter(['2', 'n', 'output-dir'])

      const options = await runWizard(['my-project'], prompter)

      expect(options).toEqual({
        projectName: 'my-project',
        template: 'chat',
        includeExamples: false,
        outputDir: 'output-dir',
      })
    })

    it('should prompt for project name first when not in args', async () => {
      const prompter = createMockPrompter(['test-name', '3', 'y', ''])

      const options = await runWizard([], prompter)

      const prompts = (prompter as unknown as { prompts: string[] }).prompts
      expect(prompts[0]).toContain('Project name')
      expect(prompts[1]).toContain('Select template')
      expect(prompts[2]).toContain('Include examples')
      expect(prompts[3]).toContain('Output directory')
      expect(options.projectName).toBe('test-name')
    })
  })
})

// ============================================================================
// createProjectStructure() Tests
// ============================================================================

describe('createProjectStructure()', () => {
  describe('basic template', () => {
    it('should create directory structure', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/test-basic', { recursive: true })
      expect(mockMkdirSync).toHaveBeenCalledWith('/test/project/test-basic/src', { recursive: true })
    })

    it('should create all required files', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      const writtenFiles = mockWriteFileSync.mock.calls.map(c => c[0])
      expect(writtenFiles).toContain('/test/project/test-basic/package.json')
      expect(writtenFiles).toContain('/test/project/test-basic/tsconfig.json')
      expect(writtenFiles).toContain('/test/project/test-basic/wrangler.toml')
      expect(writtenFiles).toContain('/test/project/test-basic/do.config.ts')
      expect(writtenFiles).toContain('/test/project/test-basic/src/index.ts')
    })

    it('should generate package.json with correct content', () => {
      const options: WizardOptions = {
        projectName: 'my-rpc-project',
        template: 'basic',
        includeExamples: true,
        outputDir: 'my-rpc-project',
      }

      createProjectStructure('/test/project/my-rpc-project', options)

      const packageJsonCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('package.json')
      )
      const content = JSON.parse(packageJsonCall![1] as string)

      expect(content.name).toBe('my-rpc-project')
      expect(content.type).toBe('module')
      expect(content.dependencies['rpc.do']).toBeDefined()
      expect(content.devDependencies.typescript).toBeDefined()
      expect(content.devDependencies.wrangler).toBeDefined()
    })

    it('should generate tsconfig.json with strict mode enabled', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      const tsconfigCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('tsconfig.json')
      )
      const content = JSON.parse(tsconfigCall![1] as string)

      expect(content.compilerOptions.strict).toBe(true)
      expect(content.compilerOptions.target).toBe('ES2022')
      expect(content.compilerOptions.module).toBe('ESNext')
    })

    it('should generate wrangler.toml with RpcDurableObject class', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      const wranglerCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('wrangler.toml')
      )
      const content = wranglerCall![1] as string

      expect(content).toContain('name = "test-basic"')
      expect(content).toContain('class_name = "RpcDurableObject"')
      expect(content).toContain('[durable_objects]')
      expect(content).toContain('[[migrations]]')
    })

    it('should generate index.ts with example methods when includeExamples is true', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      const indexCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/index.ts')
      )
      const content = indexCall![1] as string

      expect(content).toContain('class RpcDurableObject extends DurableRPC')
      expect(content).toContain('async hello(name: string)')
      expect(content).toContain('async add(a: number, b: number)')
      expect(content).toContain('math = {')
      expect(content).toContain('multiply')
      expect(content).toContain('divide')
    })

    it('should generate index.ts without example methods when includeExamples is false', () => {
      const options: WizardOptions = {
        projectName: 'test-basic',
        template: 'basic',
        includeExamples: false,
        outputDir: 'test-basic',
      }

      createProjectStructure('/test/project/test-basic', options)

      const indexCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/index.ts')
      )
      const content = indexCall![1] as string

      expect(content).toContain('class RpcDurableObject extends DurableRPC')
      expect(content).toContain('// Define your RPC methods')
      // Should not have actual method implementation (only commented example)
      expect(content).not.toMatch(/^\s+async hello\(name: string\):/m)
    })
  })

  describe('chat template', () => {
    it('should generate ChatDO class', () => {
      const options: WizardOptions = {
        projectName: 'test-chat',
        template: 'chat',
        includeExamples: true,
        outputDir: 'test-chat',
      }

      createProjectStructure('/test/project/test-chat', options)

      const indexCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/index.ts')
      )
      const content = indexCall![1] as string

      expect(content).toContain('class ChatDO extends DurableRPC')
      expect(content).toContain('async join(userId: string, username: string)')
      expect(content).toContain('async sendMessage(userId: string, text: string)')
      expect(content).toContain('async getMessages')
      expect(content).toContain('async getUsers')
    })

    it('should generate chat types file', () => {
      const options: WizardOptions = {
        projectName: 'test-chat',
        template: 'chat',
        includeExamples: true,
        outputDir: 'test-chat',
      }

      createProjectStructure('/test/project/test-chat', options)

      const typesCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/types/chat.ts')
      )

      expect(typesCall).toBeDefined()
      const content = typesCall![1] as string
      expect(content).toContain('interface User')
      expect(content).toContain('interface Message')
      expect(content).toContain('interface ChatRoom')
    })

    it('should generate wrangler.toml with ChatDO class', () => {
      const options: WizardOptions = {
        projectName: 'test-chat',
        template: 'chat',
        includeExamples: true,
        outputDir: 'test-chat',
      }

      createProjectStructure('/test/project/test-chat', options)

      const wranglerCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('wrangler.toml')
      )
      const content = wranglerCall![1] as string

      expect(content).toContain('class_name = "ChatDO"')
    })

    it('should not create types file when includeExamples is false', () => {
      const options: WizardOptions = {
        projectName: 'test-chat',
        template: 'chat',
        includeExamples: false,
        outputDir: 'test-chat',
      }

      createProjectStructure('/test/project/test-chat', options)

      const typesCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).includes('types/chat.ts')
      )

      expect(typesCall).toBeUndefined()
    })
  })

  describe('api template', () => {
    it('should generate ApiDO class with CRUD methods', () => {
      const options: WizardOptions = {
        projectName: 'test-api',
        template: 'api',
        includeExamples: true,
        outputDir: 'test-api',
      }

      createProjectStructure('/test/project/test-api', options)

      const indexCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/index.ts')
      )
      const content = indexCall![1] as string

      expect(content).toContain('class ApiDO extends DurableRPC')
      expect(content).toContain('items = {')
      expect(content).toContain('create:')
      expect(content).toContain('get:')
      expect(content).toContain('update:')
      expect(content).toContain('delete:')
      expect(content).toContain('list:')
    })

    it('should generate api types file', () => {
      const options: WizardOptions = {
        projectName: 'test-api',
        template: 'api',
        includeExamples: true,
        outputDir: 'test-api',
      }

      createProjectStructure('/test/project/test-api', options)

      const typesCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('src/types/api.ts')
      )

      expect(typesCall).toBeDefined()
      const content = typesCall![1] as string
      expect(content).toContain('interface Item')
      expect(content).toContain('interface CreateItemInput')
      expect(content).toContain('interface UpdateItemInput')
      expect(content).toContain('interface ListOptions')
      expect(content).toContain('interface PaginatedResult')
    })

    it('should generate wrangler.toml with ApiDO class', () => {
      const options: WizardOptions = {
        projectName: 'test-api',
        template: 'api',
        includeExamples: true,
        outputDir: 'test-api',
      }

      createProjectStructure('/test/project/test-api', options)

      const wranglerCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('wrangler.toml')
      )
      const content = wranglerCall![1] as string

      expect(content).toContain('class_name = "ApiDO"')
    })
  })

  describe('do.config.ts generation', () => {
    it('should generate do.config.ts with correct output path', () => {
      const options: WizardOptions = {
        projectName: 'test-project',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-project',
      }

      createProjectStructure('/test/project/test-project', options)

      const configCall = mockWriteFileSync.mock.calls.find(
        c => String(c[0]).endsWith('do.config.ts')
      )
      const content = configCall![1] as string

      expect(content).toContain("import { defineConfig } from 'rpc.do'")
      expect(content).toContain("durableObjects: './src/*.ts'")
      expect(content).toContain("output: './.do'")
    })
  })

  describe('console output', () => {
    it('should log created files', () => {
      const options: WizardOptions = {
        projectName: 'test-project',
        template: 'basic',
        includeExamples: true,
        outputDir: 'test-project',
      }

      createProjectStructure('/test/project/test-project', options)

      expect(consoleLogSpy).toHaveBeenCalledWith('  Created package.json')
      expect(consoleLogSpy).toHaveBeenCalledWith('  Created tsconfig.json')
      expect(consoleLogSpy).toHaveBeenCalledWith('  Created wrangler.toml')
      expect(consoleLogSpy).toHaveBeenCalledWith('  Created do.config.ts')
      expect(consoleLogSpy).toHaveBeenCalledWith('  Created src/index.ts')
    })

    it('should log types file for chat template', () => {
      const options: WizardOptions = {
        projectName: 'test-chat',
        template: 'chat',
        includeExamples: true,
        outputDir: 'test-chat',
      }

      createProjectStructure('/test/project/test-chat', options)

      expect(consoleLogSpy).toHaveBeenCalledWith('  Created src/types/chat.ts')
    })

    it('should log types file for api template', () => {
      const options: WizardOptions = {
        projectName: 'test-api',
        template: 'api',
        includeExamples: true,
        outputDir: 'test-api',
      }

      createProjectStructure('/test/project/test-api', options)

      expect(consoleLogSpy).toHaveBeenCalledWith('  Created src/types/api.ts')
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('CLI Wizard Integration', () => {
  it('should complete full basic project setup', async () => {
    const prompter = createMockPrompter(['1', 'y', ''])

    const options = await runWizard(['my-basic-app'], prompter)
    createProjectStructure('/test/project/my-basic-app', options)

    expect(options.projectName).toBe('my-basic-app')
    expect(options.template).toBe('basic')
    expect(options.includeExamples).toBe(true)

    const writtenFiles = mockWriteFileSync.mock.calls.map(c => c[0])
    expect(writtenFiles.length).toBe(5) // package.json, tsconfig.json, wrangler.toml, do.config.ts, index.ts
  })

  it('should complete full chat project setup', async () => {
    const prompter = createMockPrompter(['2', 'y', ''])

    const options = await runWizard(['chat-app'], prompter)
    createProjectStructure('/test/project/chat-app', options)

    expect(options.projectName).toBe('chat-app')
    expect(options.template).toBe('chat')

    const writtenFiles = mockWriteFileSync.mock.calls.map(c => c[0])
    expect(writtenFiles.length).toBe(6) // +1 for types file
    expect(writtenFiles.some(f => String(f).includes('types/chat.ts'))).toBe(true)
  })

  it('should complete full api project setup', async () => {
    const prompter = createMockPrompter(['3', 'y', ''])

    const options = await runWizard(['api-app'], prompter)
    createProjectStructure('/test/project/api-app', options)

    expect(options.projectName).toBe('api-app')
    expect(options.template).toBe('api')

    const writtenFiles = mockWriteFileSync.mock.calls.map(c => c[0])
    expect(writtenFiles.length).toBe(6) // +1 for types file
    expect(writtenFiles.some(f => String(f).includes('types/api.ts'))).toBe(true)
  })

  it('should create minimal project without examples', async () => {
    const prompter = createMockPrompter(['1', 'n', ''])

    const options = await runWizard(['minimal-app'], prompter)
    createProjectStructure('/test/project/minimal-app', options)

    expect(options.includeExamples).toBe(false)

    const indexCall = mockWriteFileSync.mock.calls.find(
      c => String(c[0]).endsWith('src/index.ts')
    )
    const content = indexCall![1] as string
    // Should not have actual method implementation (only commented example)
    expect(content).not.toMatch(/^\s+async hello\(name: string\):/m)
  })

  it('should support custom output directory', async () => {
    const prompter = createMockPrompter(['1', 'y', 'custom-output'])

    const options = await runWizard(['my-project'], prompter)

    expect(options.outputDir).toBe('custom-output')
  })
})
