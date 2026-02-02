/**
 * CLI Command: openapi
 *
 * Export RPC schema to OpenAPI 3.0/3.1 specification.
 *
 * Usage:
 *   npx rpc.do openapi --source ./MyDO.ts --output openapi.json
 *   npx rpc.do openapi --url https://my-do.workers.dev --output openapi.json
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractTypes } from '../extract.js'
import { toOpenAPI, toOpenAPIFromExtracted, type ToOpenAPIOptions } from '../openapi.js'
import { fetchSchema } from './config.js'
import type { RpcSchema } from './types.js'

/**
 * Parse CLI arguments for openapi command
 */
export interface OpenAPICommandArgs {
  source?: string
  url?: string
  output?: string
  title?: string
  version?: string
  server?: string
  format?: '3.0' | '3.1'
}

/**
 * Parse CLI arguments for the openapi command
 */
export function parseOpenAPIArgs(args: string[]): OpenAPICommandArgs {
  const result: OpenAPICommandArgs = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const nextArg = args[i + 1]

    switch (arg) {
      case '--source':
        if (nextArg !== undefined) result.source = nextArg
        i++
        break
      case '--url':
        if (nextArg !== undefined) result.url = nextArg
        i++
        break
      case '--output':
      case '-o':
        if (nextArg !== undefined) result.output = nextArg
        i++
        break
      case '--title':
        if (nextArg !== undefined) result.title = nextArg
        i++
        break
      case '--version':
        if (nextArg !== undefined) result.version = nextArg
        i++
        break
      case '--server':
        if (nextArg !== undefined) result.server = nextArg
        i++
        break
      case '--format':
        if (nextArg === '3.0' || nextArg === '3.1') {
          result.format = nextArg
        }
        i++
        break
    }
  }

  return result
}

/**
 * Run the openapi command
 */
export async function openAPICommand(args: string[]): Promise<void> {
  const { source, url, output, title, version, server, format } = parseOpenAPIArgs(args)

  // Validate args
  if (!source && !url) {
    console.error('Error: Either --source or --url is required')
    console.error('')
    console.error('Usage:')
    console.error('  npx rpc.do openapi --source ./MyDO.ts --output openapi.json')
    console.error('  npx rpc.do openapi --url https://my-do.workers.dev --output openapi.json')
    process.exit(1)
  }

  if (source && url) {
    console.error('Error: Cannot use both --source and --url together')
    process.exit(1)
  }

  const outputPath = output ? resolve(process.cwd(), output) : resolve(process.cwd(), 'openapi.json')

  // Build OpenAPI options
  const openApiOptions: ToOpenAPIOptions = {
    version: format === '3.1' ? '3.1.0' : '3.0.3',
  }

  if (title) {
    openApiOptions.title = title
  }
  if (version) {
    openApiOptions.apiVersion = version
  }
  if (server) {
    openApiOptions.servers = [server]
  }

  let openApiJson: string

  if (source) {
    // Extract from source file
    console.log(`Extracting schema from: ${source}`)

    try {
      const schemas = await extractTypes(source)

      if (schemas.length === 0) {
        console.error('Error: No Durable Object classes found in source file')
        process.exit(1)
      }

      if (schemas.length > 1) {
        console.log(`Found ${schemas.length} Durable Objects, using first: ${schemas[0]!.className}`)
      }

      const schema = schemas[0]!

      // Use extracted schema title if not provided
      if (!openApiOptions.title) {
        openApiOptions.title = schema.className
      }

      const openApiDoc = toOpenAPIFromExtracted(schema, openApiOptions)
      openApiJson = JSON.stringify(openApiDoc, null, 2)

      console.log(`Converted ${schema.methods.length} methods and ${schema.namespaces.length} namespaces`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error extracting schema: ${message}`)
      process.exit(1)
    }
  } else {
    // Fetch from URL
    console.log(`Fetching schema from: ${url}`)

    try {
      const schema = await fetchSchema(url!)

      // Use URL as server if not provided
      if (!openApiOptions.servers && url) {
        openApiOptions.servers = [url.replace(/\/__schema$/, '')]
      }

      if (!openApiOptions.title) {
        openApiOptions.title = 'RPC API'
      }

      const openApiDoc = toOpenAPI(schema, openApiOptions)
      openApiJson = JSON.stringify(openApiDoc, null, 2)

      console.log(`Converted ${schema.methods.length} methods and ${schema.namespaces.length} namespaces`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error fetching schema: ${message}`)
      process.exit(1)
    }
  }

  // Write output file
  try {
    writeFileSync(outputPath, openApiJson, 'utf-8')
    console.log(`\nGenerated OpenAPI spec: ${outputPath}`)
    console.log('\nYou can now:')
    console.log('  - Import into Swagger UI or Swagger Editor')
    console.log('  - Generate client SDKs with openapi-generator')
    console.log('  - Use with API documentation tools')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error writing output file: ${message}`)
    process.exit(1)
  }
}
