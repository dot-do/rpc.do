/**
 * CLI Watch Command - Watch mode for type generation
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { watch as fsWatch } from 'node:fs'
import { extractTypes, generateDTS, generateIndex, type ExtractedSchema } from '../extract.js'
import { loadConfig, fetchSchemaForWatch } from './config.js'
import { generateClient, generateEntrypoint } from './codegen.js'
import type { RpcSchema } from './types.js'

/**
 * Watch command entry point
 */
export async function watchCommand(args: string[]): Promise<void> {
  // Parse flags
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined
  const sourceIndex = args.indexOf('--source')
  const source = sourceIndex !== -1 ? args[sourceIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const outputArg = outIndex !== -1 ? args[outIndex + 1] : undefined
  const intervalIndex = args.indexOf('--interval')
  const intervalStr = intervalIndex !== -1 ? args[intervalIndex + 1] : undefined
  const intervalArg = intervalStr ? parseInt(intervalStr, 10) : 5000

  // Check for mutually exclusive flags
  if (url && source) {
    console.error('Error: Cannot use both --source and --url together.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig()

  const sourceFile = source || config?.source
  const schemaUrl = url || config?.schemaUrl

  if (sourceFile) {
    await watchSource(sourceFile, outputArg || config?.output || './.do')
  } else if (schemaUrl) {
    await watchUrl(schemaUrl, outputArg || config?.output || './generated/rpc', intervalArg)
  } else {
    console.error('Error: No source file or schema URL provided.')
    process.exit(1)
  }
}

/**
 * Watch source files for changes (--source mode)
 */
async function watchSource(sourcePath: string, output: string): Promise<void> {
  const resolvedOutput = resolve(process.cwd(), output)
  const resolvedSource = resolve(process.cwd(), sourcePath)
  const sourceDir = dirname(resolvedSource)

  console.log(`[rpc.do] Watching ${sourcePath} for changes...`)

  // Initial generation
  try {
    const schemas = await extractTypes(sourcePath)
    await writeSourceGeneratedFiles(schemas, resolvedOutput)
    console.log('[rpc.do] Initial generation complete')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[rpc.do] Error in initial generation: ${message}`)
    // Continue watching anyway
  }

  console.log('[rpc.do] Watching for changes... (Ctrl+C to stop)')

  // Watch for file changes
  const watcher = fsWatch(sourceDir, { recursive: true }, async (eventType, filename) => {
    if (!filename?.endsWith('.ts') || filename.endsWith('.d.ts')) return

    console.log(`[rpc.do] File changed: ${filename}, regenerating...`)

    try {
      const schemas = await extractTypes(sourcePath)
      await writeSourceGeneratedFiles(schemas, resolvedOutput)
      console.log('[rpc.do] Updated types')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[rpc.do] Error: ${message}`)
    }
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[rpc.do] Stopping watch mode...')
    watcher.close()
    console.log('[rpc.do] Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Write generated files from source extraction
 */
async function writeSourceGeneratedFiles(schemas: ExtractedSchema[], outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })

  for (const schema of schemas) {
    const dtsContent = generateDTS(schema)
    const dtsPath = join(outputDir, `${schema.className}.d.ts`)
    writeFileSync(dtsPath, dtsContent)
  }

  const indexContent = generateIndex(schemas)
  const indexPath = join(outputDir, 'index.ts')
  writeFileSync(indexPath, indexContent)
}

/**
 * Watch URL for schema changes (--url mode)
 */
async function watchUrl(schemaUrl: string, output: string, interval: number): Promise<void> {
  const outputDir = resolve(process.cwd(), output)

  // Normalize schema URL
  const normalizedSchemaUrl = schemaUrl.endsWith('/__schema') ? schemaUrl : `${schemaUrl.replace(/\/$/, '')}/__schema`

  console.log(`[rpc.do] Watching ${normalizedSchemaUrl}`)

  // Initial generation
  let previousHash: string | null = null
  try {
    const schema = await fetchSchemaForWatch(normalizedSchemaUrl)
    previousHash = hashSchema(schema)
    await writeUrlGeneratedFiles(schema, outputDir)
    console.log('[rpc.do] Initial generation complete')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[rpc.do] Failed to fetch initial schema: ${message}`)
    process.exit(1)
  }

  console.log('[rpc.do] Watching for changes... (Ctrl+C to stop)')

  // Set up polling interval
  let intervalId: ReturnType<typeof setInterval> | null = null

  const poll = async () => {
    try {
      const schema = await fetchSchemaForWatch(normalizedSchemaUrl)
      const currentHash = hashSchema(schema)

      if (currentHash !== previousHash) {
        console.log('[rpc.do] Schema changed, regenerating...')
        await writeUrlGeneratedFiles(schema, outputDir)
        previousHash = currentHash
        console.log('[rpc.do] Updated client types')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[rpc.do] Error fetching schema: ${message}`)
      // Continue watching, don't exit on transient errors
    }
  }

  intervalId = setInterval(poll, interval)

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[rpc.do] Stopping watch mode...')
    if (intervalId) {
      clearInterval(intervalId)
    }
    console.log('[rpc.do] Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

/**
 * Hash a schema for change detection
 */
function hashSchema(schema: RpcSchema): string {
  const content = JSON.stringify(schema)
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Write generated files for URL-based generation
 */
async function writeUrlGeneratedFiles(schema: RpcSchema, outputDir: string): Promise<void> {
  mkdirSync(outputDir, { recursive: true })

  const code = generateClient(schema)
  const outputPath = join(outputDir, 'client.d.ts')
  writeFileSync(outputPath, code)

  const jsPath = join(outputDir, 'index.ts')
  writeFileSync(jsPath, generateEntrypoint())
}
