/**
 * CLI Generate Command - Source-based and URL-based type generation
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { extractTypes, generateDTS, generateIndex } from '../extract.js'
import { runZeroConfig, detectFromWrangler } from '../detect.js'
import { fetchSchema } from './config.js'
import { generateClient, generateEntrypoint } from './codegen.js'

/**
 * Zero-config generation - detects DOs from wrangler config
 */
export async function runZeroConfigCommand(outputDir?: string): Promise<void> {
  const cwd = process.cwd()
  const output = outputDir || '.do'

  console.log('rpc.do - Zero-config type generation\n')

  try {
    // Check for wrangler config
    const bindings = await detectFromWrangler(cwd)
    if (bindings.length > 0) {
      console.log(`Found wrangler config with ${bindings.length} Durable Object(s):`)
      for (const b of bindings) {
        console.log(`  - ${b.className} (binding: ${b.name})`)
      }
      console.log('')
    } else {
      console.log('No wrangler config found, scanning for DO patterns...\n')
    }

    // Run zero-config detection and generation
    const result = await runZeroConfig(cwd, { outputDir: output })

    if (result.detected.length === 0) {
      console.error('No Durable Objects found.')
      console.error('\nEnsure your project has:')
      console.error('  1. wrangler.toml or wrangler.jsonc with durable_objects bindings')
      console.error('  2. OR TypeScript files with classes extending DurableObject/DurableRPC/DigitalObject')
      console.error('  3. OR DO() factory calls')
      process.exit(1)
    }

    // Print results
    console.log(`Detected ${result.detected.length} Durable Object(s):`)
    for (const d of result.detected) {
      console.log(`  - ${d.className} (extends ${d.baseClass})`)
      console.log(`    Source: ${d.filePath}`)
    }
    console.log('')

    if (result.generated.length > 0) {
      console.log(`Generated ${result.generated.length} file(s):`)
      for (const f of result.generated) {
        console.log(`  - ${f}`)
      }
      console.log('')
    }

    if (result.warnings.length > 0) {
      console.log('Warnings:')
      for (const w of result.warnings) {
        console.log(`  ⚠ ${w}`)
      }
      console.log('')
    }

    // Import hint
    const apiNames = result.detected.map((d) => `${d.className}API`).join(', ')
    console.log('Done! Import your typed client:')
    console.log(`  import type { ${apiNames} } from './${output}'`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${message}`)
    process.exit(1)
  }
}

/**
 * Generate types from TypeScript source files (full types)
 */
export async function generateFromSource(sourcePath: string, outputDir?: string): Promise<void> {
  const output = outputDir || './.do'
  const resolvedOutput = resolve(process.cwd(), output)

  console.log(`Parsing source file: ${sourcePath}`)

  try {
    // Check if file exists
    if (!sourcePath.includes('*') && !existsSync(resolve(process.cwd(), sourcePath))) {
      console.error(`Error: Source file not found: ${sourcePath}`)
      process.exit(1)
    }

    // Check file extension
    if (!sourcePath.includes('*') && !sourcePath.endsWith('.ts')) {
      console.error(`Error: Source must be a TypeScript file (.ts): ${sourcePath}`)
      process.exit(1)
    }

    // Extract types
    const schemas = await extractTypes(sourcePath)

    if (schemas.length === 0) {
      console.error('Error: No valid Durable Object classes found.')
      process.exit(1)
    }

    // Ensure output directory exists and is writable
    try {
      mkdirSync(resolvedOutput, { recursive: true })
      // Test write access
      const testFile = join(resolvedOutput, '.write-test')
      writeFileSync(testFile, '')
      const fs = await import('node:fs')
      fs.unlinkSync(testFile)
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
      const message = err instanceof Error ? err.message : String(err)
      if (code === 'EACCES') {
        console.error(`Error: permission denied - cannot write to output directory: ${resolvedOutput}`)
      } else if (code === 'ENOENT') {
        console.error(`Error: cannot write - directory does not exist: ${resolvedOutput}`)
      } else {
        console.error(`Error: cannot write to output directory: ${message}`)
      }
      process.exit(1)
    }

    // Generate .d.ts files for each schema
    for (const schema of schemas) {
      const dtsContent = generateDTS(schema)
      const dtsPath = join(resolvedOutput, `${schema.className}.d.ts`)
      writeFileSync(dtsPath, dtsContent)
      console.log(`Generated: ${dtsPath}`)
    }

    // Generate index.ts entrypoint
    const indexContent = generateIndex(schemas)
    const indexPath = join(resolvedOutput, 'index.ts')
    writeFileSync(indexPath, indexContent)
    console.log(`Generated: ${indexPath}`)

    console.log(`\nDone! Generated types for ${schemas.length} Durable Object(s).`)
    console.log(`Import your typed client:`)
    console.log(`  import type { ${schemas.map((s) => s.className + 'API').join(', ')} } from '${output}'`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // Handle specific error types
    if (message.includes('not found') || message.includes('ENOENT')) {
      console.error(`Error: ${message}`)
    } else if (message.includes('syntax error')) {
      console.error(`Error: TypeScript syntax error in source file.`)
      console.error(message)
    } else if (message.includes('No class extending')) {
      console.error(`Error: No valid Durable Object class found.`)
      console.error('Ensure your class extends DurableObject, DurableRPC, or DigitalObject.')
    } else if (message.includes('empty')) {
      console.error(`Error: ${message}`)
    } else {
      console.error(`Error: ${message}`)
    }
    process.exit(1)
  }
}

/**
 * Generate types from URL schema endpoint (runtime schema, weak types)
 */
export async function generateFromUrl(schemaUrl: string, outputDir?: string): Promise<void> {
  const output = outputDir || './generated/rpc'
  const resolvedOutput = resolve(process.cwd(), output)

  // Fetch schema
  console.log(`Fetching schema from ${schemaUrl}...`)
  const schema = await fetchSchema(schemaUrl)
  console.log(`Found ${schema.methods.length} methods, ${schema.namespaces.length} namespaces`)

  // Generate types
  const code = generateClient(schema)

  // Write output
  mkdirSync(resolvedOutput, { recursive: true })
  const outputPath = join(resolvedOutput, 'client.d.ts')
  writeFileSync(outputPath, code)
  console.log(`Generated typed client: ${outputPath}`)

  // Also write a JS stub that re-exports RPC with the type
  const jsPath = join(resolvedOutput, 'index.ts')
  writeFileSync(jsPath, generateEntrypoint())
  console.log(`Generated entrypoint: ${jsPath}`)

  console.log('\nDone! Import your typed client:')
  console.log(`  import { rpc } from '${output}'`)
}
