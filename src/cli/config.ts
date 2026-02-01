/**
 * CLI Config - Configuration loading and schema fetching
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RpcDoConfig, RpcSchema } from './types.js'

/**
 * Load config from project directory
 */
export async function loadConfig(): Promise<RpcDoConfig | undefined> {
  const cwd = process.cwd()
  const candidates = [
    'do.config.ts',
    'do.config.js',
    'rpc.config.ts',
    'rpc.config.js',
    '.do/config.ts',
    '.do/config.js',
  ]

  for (const candidate of candidates) {
    const configPath = resolve(cwd, candidate)
    if (existsSync(configPath)) {
      console.log(`Using config: ${candidate}`)
      try {
        const mod = await import(pathToFileURL(configPath).href)
        return mod.default || mod
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`Error loading ${candidate}: ${message}`)
        console.error('Tip: Ensure your config file is valid JS/TS')
        process.exit(1)
      }
    }
  }

  return undefined
}

/**
 * Fetch schema from URL endpoint
 */
export async function fetchSchema(url: string): Promise<RpcSchema> {
  // Ensure we hit the __schema endpoint
  const schemaUrl = url.endsWith('/__schema') ? url : `${url.replace(/\/$/, '')}/__schema`

  const response = await fetch(schemaUrl)
  if (!response.ok) {
    console.error(`Failed to fetch schema: ${response.status} ${response.statusText}`)
    process.exit(1)
  }

  const schema = (await response.json()) as RpcSchema
  if (!schema.version || !schema.methods || !schema.namespaces) {
    console.error('Invalid schema response. Ensure the DO extends DurableRPC.')
    process.exit(1)
  }

  return schema
}

/**
 * Fetch schema without process.exit on failure (for watch mode)
 */
export async function fetchSchemaForWatch(schemaUrl: string): Promise<RpcSchema> {
  const response = await fetch(schemaUrl)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }

  const schema = (await response.json()) as RpcSchema
  if (!schema.version || !schema.methods || !schema.namespaces) {
    throw new Error('Invalid schema response')
  }

  return schema
}
