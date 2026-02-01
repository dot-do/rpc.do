/**
 * Zero-config DO type detection
 *
 * Automatically detects Durable Object classes from wrangler configs
 * and source file scanning for seamless type generation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { glob } from 'glob'
import { extractTypes, generateDTS, generateIndex, type ExtractedSchema } from './extract'

// ============================================================================
// Types
// ============================================================================

export interface WranglerBinding {
  name: string
  className: string
}

export interface DetectedDO {
  className: string
  filePath: string
  baseClass: string
}

export interface ScanResult {
  className?: string
  exportName?: string
  filePath: string
  pattern: 'class' | 'factory'
  baseClass?: string
  lineNumber: number
}

export interface ZeroConfigResult {
  detected: DetectedDO[]
  generated: string[]
  usedFallback: boolean
  warnings: string[]
}

// Valid base classes for DOs
const DO_BASE_CLASSES = ['DurableObject', 'DurableRPC', 'DigitalObject']

// ============================================================================
// Wrangler Config Detection
// ============================================================================

/**
 * Detect DO bindings from wrangler.toml or wrangler.jsonc
 * Prefers wrangler.jsonc over wrangler.toml when both exist
 */
export async function detectFromWrangler(dir: string): Promise<WranglerBinding[]> {
  const jsoncPath = join(dir, 'wrangler.jsonc')
  const tomlPath = join(dir, 'wrangler.toml')

  // Prefer JSONC (more modern format)
  if (existsSync(jsoncPath)) {
    return parseWranglerJsonc(jsoncPath)
  }

  // Fall back to TOML
  if (existsSync(tomlPath)) {
    return parseWranglerToml(tomlPath)
  }

  // No config found
  return []
}

/**
 * Parse wrangler.jsonc file
 * Handles single-line comments, multi-line comments, and trailing commas
 */
function parseWranglerJsonc(filePath: string): WranglerBinding[] {
  const content = readFileSync(filePath, 'utf-8')

  // Strip comments and trailing commas
  const json = stripJsoncFeatures(content)

  try {
    const config = JSON.parse(json)
    return extractBindingsFromConfig(config)
  } catch (err: any) {
    throw new Error(`Invalid JSON in ${filePath}: ${err.message}`)
  }
}

/**
 * Strip JSONC features (comments, trailing commas) to get valid JSON
 */
function stripJsoncFeatures(content: string): string {
  let result = content

  // Remove multi-line comments /* ... */
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')

  // Remove single-line comments // ...
  // Be careful not to remove // inside strings
  result = result.replace(/(?<!["'])\/\/[^\n]*/g, '')

  // Remove trailing commas before ] or }
  result = result.replace(/,(\s*[}\]])/g, '$1')

  return result
}

/**
 * Parse wrangler.toml file
 * Simple parser for [durable_objects] bindings section
 */
function parseWranglerToml(filePath: string): WranglerBinding[] {
  const content = readFileSync(filePath, 'utf-8')

  // Basic TOML validation - check for invalid section headers
  // Valid: [name] or [[name]] (table array)
  // Invalid: [name with spaces without quotes] or unmatched brackets
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    // Check for malformed section headers like "invalid [ toml syntax"
    if (trimmed.includes('[') && !trimmed.startsWith('#')) {
      // Section header should be like [name] or [[name]]
      const sectionMatch = trimmed.match(/^\[+[a-zA-Z0-9_.-]+\]+$/) ||
        trimmed.match(/^\[+[a-zA-Z0-9_.-]+\]+\s*#/) // Allow trailing comments
      if (!sectionMatch && /\[/.test(trimmed)) {
        // Check if it looks like a valid inline table or assignment
        const isAssignment = /^\w+\s*=/.test(trimmed)
        if (!isAssignment) {
          throw new Error(`Invalid TOML syntax in ${filePath}`)
        }
      }
    }
  }

  // Find [durable_objects] section
  const durableObjectsMatch = content.match(/\[durable_objects\]\s*\n([\s\S]*?)(?=\n\[|\n\[\[|$)/)
  if (!durableObjectsMatch) {
    return []
  }

  const section = durableObjectsMatch[1]
  if (!section) {
    return []
  }

  // Find bindings = [ ... ]
  const bindingsMatch = section.match(/bindings\s*=\s*\[([\s\S]*?)\]/)
  if (!bindingsMatch) {
    return []
  }

  const bindingsContent = bindingsMatch[1]
  if (!bindingsContent) {
    return []
  }

  // Parse each binding: { name = "X", class_name = "Y" }
  const bindings: WranglerBinding[] = []
  const bindingRegex = /\{\s*name\s*=\s*"([^"]+)"\s*,\s*class_name\s*=\s*"([^"]+)"\s*\}/g

  let match
  while ((match = bindingRegex.exec(bindingsContent)) !== null) {
    const name = match[1]
    const className = match[2]
    if (name && className) {
      bindings.push({ name, className })
    }
  }

  return bindings
}

/**
 * Extract bindings from parsed wrangler config
 */
function extractBindingsFromConfig(config: any): WranglerBinding[] {
  const durableObjects = config.durable_objects
  if (!durableObjects || !durableObjects.bindings) {
    return []
  }

  const bindings: WranglerBinding[] = []
  for (const binding of durableObjects.bindings) {
    if (binding.name && binding.class_name) {
      bindings.push({
        name: binding.name,
        className: binding.class_name,
      })
    }
  }

  return bindings
}

// ============================================================================
// Class Source Finding
// ============================================================================

/**
 * Find the source file containing a specific DO class
 */
export async function findClassSource(
  className: string,
  dir: string,
  options?: { pattern?: string }
): Promise<DetectedDO | null> {
  const pattern = options?.pattern || 'src/**/*.ts'
  const absolutePattern = join(dir, pattern)

  const files = await glob(absolutePattern, {
    nodir: true,
    absolute: true,
    ignore: ['**/node_modules/**', '**/*.d.ts'],
  })

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8')

    // Look for class {className} extends (DurableObject|DurableRPC|DigitalObject)
    for (const baseClass of DO_BASE_CLASSES) {
      const regex = new RegExp(`class\\s+${className}\\s+extends\\s+${baseClass}\\b`)
      if (regex.test(content)) {
        return {
          className,
          filePath,
          baseClass,
        }
      }
    }
  }

  return null
}

// ============================================================================
// Source Scanning
// ============================================================================

/**
 * Scan source files for DO patterns when no wrangler config exists
 */
export async function detectFromScan(dir: string, pattern?: string): Promise<ScanResult[]> {
  const searchPattern = pattern || 'src/**/*.ts'
  const absolutePattern = join(dir, searchPattern)

  const files = await glob(absolutePattern, {
    nodir: true,
    absolute: true,
    ignore: ['**/node_modules/**', '**/*.d.ts', '**/dist/**', '**/.do/**'],
  })

  const results: ScanResult[] = []

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    // Find class-based DOs: class X extends DurableObject/DurableRPC/DigitalObject
    for (const baseClass of DO_BASE_CLASSES) {
      const classRegex = new RegExp(`class\\s+(\\w+)\\s+extends\\s+${baseClass}\\b`)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line) continue
        const match = classRegex.exec(line)
        if (match) {
          const className = match[1]
          if (className) {
            results.push({
              className,
              filePath,
              pattern: 'class',
              baseClass,
              lineNumber: i + 1,
            })
          }
        }
      }
    }

    // Find factory-based DOs: export const X = DO(...)
    const factoryRegex = /export\s+const\s+(\w+)\s*=\s*DO\s*\(/
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const match = factoryRegex.exec(line)
      if (match) {
        const exportName = match[1]
        if (exportName) {
          results.push({
            exportName,
            filePath,
            pattern: 'factory',
            lineNumber: i + 1,
          })
        }
      }
    }
  }

  return results
}

// ============================================================================
// tsconfig.json Updates
// ============================================================================

/**
 * Update tsconfig.json to add .do/* path mapping
 */
export async function updateTsConfig(
  dir: string,
  options?: { outputDir?: string }
): Promise<boolean> {
  const tsconfigPath = join(dir, 'tsconfig.json')

  if (!existsSync(tsconfigPath)) {
    return false
  }

  const content = readFileSync(tsconfigPath, 'utf-8')
  let config: any

  try {
    config = JSON.parse(content)
  } catch (err: any) {
    throw new Error(`Invalid JSON in tsconfig.json: ${err.message}`)
  }

  // Ensure compilerOptions exists
  if (!config.compilerOptions) {
    config.compilerOptions = {}
  }

  // Ensure paths exists
  if (!config.compilerOptions.paths) {
    config.compilerOptions.paths = {}
  }

  const outputDir = options?.outputDir || './.do'
  const pathKey = outputDir.replace(/^\.\//, '').replace(/\/$/, '') + '/*'
  const pathValue = [outputDir.replace(/\/$/, '') + '/*']

  // Check if already present
  if (config.compilerOptions.paths[pathKey]) {
    return false // No update needed
  }

  // Add the path mapping
  config.compilerOptions.paths[pathKey] = pathValue

  // Write back with nice formatting
  writeFileSync(tsconfigPath, JSON.stringify(config, null, 2) + '\n')

  return true
}

// ============================================================================
// Zero-Config Orchestration
// ============================================================================

export interface ZeroConfigOptions {
  outputDir?: string
  pattern?: string
}

/**
 * Run full zero-config detection and type generation
 */
export async function runZeroConfig(dir: string, options: ZeroConfigOptions = {}): Promise<ZeroConfigResult> {
  const outputDirName = options.outputDir || '.do'

  const result: ZeroConfigResult = {
    detected: [],
    generated: [],
    usedFallback: false,
    warnings: [],
  }

  // Step 1: Try to detect from wrangler config
  const bindings = await detectFromWrangler(dir)

  let classesToProcess: { className: string; filePath: string }[] = []

  if (bindings.length > 0) {
    // Find source files for each binding
    for (const binding of bindings) {
      const source = await findClassSource(binding.className, dir)
      if (source) {
        classesToProcess.push({
          className: binding.className,
          filePath: source.filePath,
        })
        result.detected.push(source)
      } else {
        // Try scanning for factory pattern
        const scanResults = await detectFromScan(dir)
        const factoryMatch = scanResults.find(
          (r) => r.pattern === 'factory' && r.exportName === binding.className
        )
        if (factoryMatch) {
          classesToProcess.push({
            className: binding.className,
            filePath: factoryMatch.filePath,
          })
          result.detected.push({
            className: binding.className,
            filePath: factoryMatch.filePath,
            baseClass: 'DO',
          })
        } else {
          result.warnings.push(`Could not find source for: ${binding.className}`)
        }
      }
    }
  } else {
    // Step 2: Fall back to source scanning
    result.usedFallback = true
    const scanResults = await detectFromScan(dir)

    for (const scan of scanResults) {
      if (scan.pattern === 'class' && scan.className && scan.baseClass) {
        classesToProcess.push({
          className: scan.className,
          filePath: scan.filePath,
        })
        result.detected.push({
          className: scan.className,
          filePath: scan.filePath,
          baseClass: scan.baseClass,
        })
      } else if (scan.pattern === 'factory' && scan.exportName) {
        classesToProcess.push({
          className: scan.exportName,
          filePath: scan.filePath,
        })
        result.detected.push({
          className: scan.exportName,
          filePath: scan.filePath,
          baseClass: 'DO',
        })
      }
    }
  }

  // Step 3: Generate types for each detected DO
  if (classesToProcess.length > 0) {
    const outputDir = join(dir, outputDirName)

    // Ensure output directory exists
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const schemas: ExtractedSchema[] = []

    for (const { className, filePath } of classesToProcess) {
      try {
        const extracted = await extractTypes(filePath)
        // Find the matching schema for this class
        const schema = extracted.find((s) => s.className === className) || extracted[0]
        if (schema) {
          schemas.push(schema)

          // Generate .d.ts file
          const dtsContent = generateDTS(schema)
          const dtsPath = join(outputDir, `${className}.d.ts`)
          writeFileSync(dtsPath, dtsContent)
          result.generated.push(dtsPath)
        }
      } catch (err: any) {
        result.warnings.push(`Failed to extract types from ${filePath}: ${err.message}`)
      }
    }

    // Generate index.ts with re-exports
    if (schemas.length > 0) {
      const indexContent = generateIndex(schemas)
      const indexPath = join(outputDir, 'index.ts')
      writeFileSync(indexPath, indexContent)
    }
  }

  // Step 4: Update tsconfig.json
  await updateTsConfig(dir, { outputDir: outputDirName })

  return result
}
