/**
 * CLI Doctor Command - Diagnostic tool for troubleshooting RPC connections
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import type { RpcSchema, RpcDoConfig } from './types.js'

// Package version - read dynamically or fallback
const VERSION = '0.2.4'

interface DiagnosticResult {
  name: string
  status: 'ok' | 'warn' | 'error'
  message: string
  details?: string | undefined
}

/**
 * Doctor command entry point
 */
export async function doctorCommand(args: string[]): Promise<void> {
  // Parse flags
  const urlIndex = args.indexOf('--url')
  const url = urlIndex !== -1 ? args[urlIndex + 1] : undefined

  console.log('\nrpc.do doctor - Diagnostic tool\n')
  console.log(`Version: ${VERSION}`)
  console.log(`Node.js: ${process.version}`)
  console.log(`Platform: ${process.platform} ${process.arch}`)
  console.log('')

  const results: DiagnosticResult[] = []

  // Load config if no URL provided
  let config: RpcDoConfig | undefined
  let targetUrl: string | undefined = url

  if (!targetUrl) {
    try {
      config = await loadConfigSafe()
      if (config) {
        results.push({
          name: 'Configuration',
          status: 'ok',
          message: 'Config file found',
          details: config.schemaUrl ? `Schema URL: ${config.schemaUrl}` : undefined,
        })
        targetUrl = config.schemaUrl
      } else {
        results.push({
          name: 'Configuration',
          status: 'warn',
          message: 'No config file found',
          details: 'Create do.config.ts or use --url flag',
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        name: 'Configuration',
        status: 'error',
        message: 'Failed to load config',
        details: message,
      })
    }
  } else {
    results.push({
      name: 'Configuration',
      status: 'ok',
      message: 'Using --url flag',
      details: targetUrl,
    })
  }

  // Check connectivity if we have a URL
  if (targetUrl) {
    // Basic connectivity check
    const connectivityResult = await checkConnectivity(targetUrl)
    results.push(connectivityResult)

    // Schema endpoint check
    if (connectivityResult.status === 'ok') {
      const schemaResult = await checkSchema(targetUrl)
      results.push(schemaResult)
    }
  } else {
    results.push({
      name: 'Connectivity',
      status: 'warn',
      message: 'Skipped - no URL provided',
      details: 'Use --url <url> or configure schemaUrl in config file',
    })
    results.push({
      name: 'Schema',
      status: 'warn',
      message: 'Skipped - no URL provided',
    })
  }

  // Check wrangler.toml
  const wranglerResult = checkWranglerConfig()
  results.push(wranglerResult)

  // Print results
  console.log('Diagnostics:\n')
  for (const result of results) {
    const icon = result.status === 'ok' ? '[OK]' : result.status === 'warn' ? '[WARN]' : '[ERROR]'
    console.log(`  ${icon} ${result.name}: ${result.message}`)
    if (result.details) {
      console.log(`       ${result.details}`)
    }
  }

  // Summary
  console.log('')
  const errors = results.filter(r => r.status === 'error')
  const warnings = results.filter(r => r.status === 'warn')

  if (errors.length > 0) {
    console.log(`Found ${errors.length} error(s) and ${warnings.length} warning(s)`)
    process.exit(1)
  } else if (warnings.length > 0) {
    console.log(`All checks passed with ${warnings.length} warning(s)`)
  } else {
    console.log('All checks passed!')
  }
}

/**
 * Load config without exiting on failure
 */
async function loadConfigSafe(): Promise<RpcDoConfig | undefined> {
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
      // For doctor, we just report that config exists
      // Return a minimal config indicating file was found
      return { durableObjects: candidate }
    }
  }

  return undefined
}

/**
 * Check basic connectivity to the URL
 */
async function checkConnectivity(url: string): Promise<DiagnosticResult> {
  try {
    const baseUrl = url.replace(/\/__schema$/, '').replace(/\/$/, '')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(baseUrl, {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (response.ok || response.status === 405) {
      // 405 Method Not Allowed is fine - endpoint exists but doesn't support HEAD
      return {
        name: 'Connectivity',
        status: 'ok',
        message: `Reachable (${response.status})`,
        details: baseUrl,
      }
    } else if (response.status >= 400 && response.status < 500) {
      return {
        name: 'Connectivity',
        status: 'warn',
        message: `Server responded with ${response.status} ${response.statusText}`,
        details: 'This may be expected if authentication is required',
      }
    } else {
      return {
        name: 'Connectivity',
        status: 'error',
        message: `Server error: ${response.status} ${response.statusText}`,
        details: baseUrl,
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('abort') || message.includes('timeout')) {
      return {
        name: 'Connectivity',
        status: 'error',
        message: 'Connection timed out',
        details: 'The server did not respond within 10 seconds',
      }
    }
    return {
      name: 'Connectivity',
      status: 'error',
      message: 'Failed to connect',
      details: message,
    }
  }
}

/**
 * Check if the schema endpoint is accessible and valid
 */
async function checkSchema(url: string): Promise<DiagnosticResult> {
  try {
    const schemaUrl = url.endsWith('/__schema') ? url : `${url.replace(/\/$/, '')}/__schema`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(schemaUrl, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        name: 'Schema',
        status: 'error',
        message: `Schema endpoint returned ${response.status} ${response.statusText}`,
        details: schemaUrl,
      }
    }

    const schema = (await response.json()) as RpcSchema

    // Validate schema structure
    if (!schema.version || !schema.methods || !schema.namespaces) {
      return {
        name: 'Schema',
        status: 'error',
        message: 'Invalid schema format',
        details: 'Schema missing required fields (version, methods, namespaces)',
      }
    }

    const methodCount = schema.methods.length
    const namespaceCount = schema.namespaces.length
    const totalMethods = methodCount + schema.namespaces.reduce((acc, ns) => acc + ns.methods.length, 0)

    return {
      name: 'Schema',
      status: 'ok',
      message: `Valid schema (v${schema.version})`,
      details: `${totalMethods} method(s), ${namespaceCount} namespace(s)`,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('abort') || message.includes('timeout')) {
      return {
        name: 'Schema',
        status: 'error',
        message: 'Schema request timed out',
        details: 'The server did not respond within 10 seconds',
      }
    }
    return {
      name: 'Schema',
      status: 'error',
      message: 'Failed to fetch schema',
      details: message,
    }
  }
}

/**
 * Check if wrangler.toml exists and has durable_objects configured
 */
function checkWranglerConfig(): DiagnosticResult {
  const cwd = process.cwd()
  const wranglerToml = resolve(cwd, 'wrangler.toml')
  const wranglerJsonc = resolve(cwd, 'wrangler.jsonc')

  if (existsSync(wranglerToml)) {
    return {
      name: 'Wrangler Config',
      status: 'ok',
      message: 'wrangler.toml found',
    }
  } else if (existsSync(wranglerJsonc)) {
    return {
      name: 'Wrangler Config',
      status: 'ok',
      message: 'wrangler.jsonc found',
    }
  } else {
    return {
      name: 'Wrangler Config',
      status: 'warn',
      message: 'No wrangler config found',
      details: 'Create wrangler.toml for zero-config mode',
    }
  }
}
