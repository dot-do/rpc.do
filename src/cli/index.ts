/**
 * rpc.do CLI - Generate typed RPC clients from Durable Object schemas
 *
 * Zero-config usage (recommended):
 *   npx rpc.do                                 # Auto-detects DOs from wrangler config
 *
 * Explicit usage:
 *   npx rpc.do generate --source ./MyDO.ts     # Extracts full types from source
 *   npx rpc.do generate --url <schema-url>     # Fetches runtime schema (weak types)
 *
 * Zero-config workflow:
 *   1. Define your DOs (extending DurableRPC/DigitalObject)
 *   2. Configure wrangler.toml with durable_objects bindings
 *   3. Run `npx rpc.do`
 *   4. Import typed clients from .do/
 */

import { loadConfig } from './config.js'
import { runZeroConfigCommand, generateFromSource, generateFromUrl } from './generate.js'
import { initProject } from './init.js'
import { watchCommand } from './watch.js'
import { doctorCommand } from './doctor.js'
import { printHelp } from './help.js'

/**
 * Parse CLI flags from an args array.
 * Extracts --url, --output, and --source values.
 */
export function parseArgs(args: string[]): { url: string | undefined; output: string | undefined; source: string | undefined } {
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined
  const outIndex = args.indexOf('--output')
  const output = outIndex !== -1 ? args[outIndex + 1] : undefined
  const sourceIndex = args.indexOf('--source')
  const source = sourceIndex !== -1 ? args[sourceIndex + 1] : undefined
  return { url, output, source }
}

/**
 * CLI entry point. Accepts an optional argv array for testing.
 * When called without arguments, reads from process.argv.
 */
export async function main(argv?: string[]): Promise<void> {
  const args = argv ?? process.argv.slice(2)
  const command = args[0]

  if (command === '--help' || command === '-h') {
    printHelp()
    return
  }

  if (command === 'init') {
    await initProject(args.slice(1))
    return
  }

  if (command === 'watch') {
    await watchCommand(args.slice(1))
    return
  }

  if (command === 'doctor') {
    await doctorCommand(args.slice(1))
    return
  }

  // Zero-config: just run `npx rpc.do` with no args
  if (!command) {
    await runZeroConfigCommand()
    return
  }

  if (command !== 'generate') {
    console.error(`Unknown command: ${command}`)
    console.error('Run `npx rpc.do --help` for usage')
    process.exit(1)
  }

  // Parse flags
  const { url, output: outputArg, source } = parseArgs(args)

  // Check for mutually exclusive flags
  if (url && source) {
    console.error('Error: Cannot use both --source and --url together.')
    console.error('Use --source for full types from TypeScript source, OR --url for runtime schema.')
    process.exit(1)
  }

  // Load config
  const config = await loadConfig()

  // Determine mode: source-based, URL-based, or zero-config
  const sourceFile = source || config?.source
  const schemaUrl = url || config?.schemaUrl

  if (sourceFile) {
    // Source-based generation (full types)
    await generateFromSource(sourceFile, outputArg || config?.output)
  } else if (schemaUrl) {
    // URL-based generation (runtime schema, weak types)
    await generateFromUrl(schemaUrl, outputArg || config?.output)
  } else {
    // No explicit source/url - try zero-config
    await runZeroConfigCommand(outputArg || config?.output)
  }
}

