/**
 * Type extraction from TypeScript DO source files using ts-morph
 *
 * Extracts full TypeScript type signatures from Durable Object classes
 * for generating strongly-typed RPC client interfaces.
 */

import { Project, MethodDeclaration, PropertyDeclaration, ClassDeclaration, SourceFile, Type, Symbol, SyntaxKind, Scope, DiagnosticCategory, ts } from 'ts-morph'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, resolve, relative } from 'node:path'
import { glob } from 'glob'

// ============================================================================
// Types
// ============================================================================

export interface ExtractedParameter {
  name: string
  type: string
  optional: boolean
}

export interface ExtractedMethod {
  name: string
  parameters: ExtractedParameter[]
  returnType: string
}

export interface ExtractedNamespace {
  name: string
  methods: ExtractedMethod[]
  typeName?: string  // For typed namespaces like Collection<Product>
}

export interface ExtractedSchema {
  className: string
  methods: ExtractedMethod[]
  namespaces: ExtractedNamespace[]
  types: ExtractedType[]
}

export interface ExtractedType {
  name: string
  declaration: string
  kind: 'interface' | 'type' | 'enum'
}

// System methods to exclude (DO lifecycle methods)
const SYSTEM_METHODS = new Set([
  'fetch',
  'alarm',
  'webSocketMessage',
  'webSocketClose',
  'webSocketError',
  'webSocketOpen',
  'constructor',
])

// Valid base classes for DOs
const DO_BASE_CLASSES = ['DurableObject', 'DurableRPC', 'DigitalObject']

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract types from a TypeScript source file containing a Durable Object class.
 *
 * @param sourcePath - Path to the source file or glob pattern
 * @returns Promise resolving to extracted schema(s)
 */
export async function extractTypes(sourcePath: string): Promise<ExtractedSchema[]> {
  // Validate input
  if (!sourcePath) {
    throw new Error('Source path is required')
  }

  // Handle glob patterns
  const files = await resolveSourceFiles(sourcePath)
  if (files.length === 0) {
    throw new Error(`No TypeScript files found matching: ${sourcePath}`)
  }

  const results: ExtractedSchema[] = []

  // Create a shared project to resolve imports across files
  const project = new Project({
    compilerOptions: {
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  })

  for (const filePath of files) {
    try {
      const schema = await extractFromFile(project, filePath)
      if (schema) {
        results.push(schema)
      }
    } catch (err: any) {
      // Re-throw with context
      throw new Error(`Error extracting from ${filePath}: ${err.message}`)
    }
  }

  return results
}

/**
 * Resolve source files from path (supports globs)
 */
async function resolveSourceFiles(sourcePath: string): Promise<string[]> {
  // Check if it's a glob pattern
  if (sourcePath.includes('*')) {
    const matches = await glob(sourcePath, {
      nodir: true,
      absolute: true,
    })
    return matches.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  }

  // Single file
  const absolutePath = resolve(process.cwd(), sourcePath)

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`)
  }

  const stats = statSync(absolutePath)
  if (stats.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${absolutePath}`)
  }

  if (!absolutePath.endsWith('.ts')) {
    throw new Error(`File must be a TypeScript file (.ts): ${absolutePath}`)
  }

  return [absolutePath]
}

/**
 * Extract schema from a single file
 */
async function extractFromFile(project: Project, filePath: string): Promise<ExtractedSchema | null> {
  // Read and parse the file
  let sourceFile: SourceFile
  try {
    sourceFile = project.addSourceFileAtPath(filePath)
  } catch (err: any) {
    if (err.message.includes('Diagnostic')) {
      throw new Error(`TypeScript syntax error in ${filePath}: ${err.message}`)
    }
    throw err
  }

  // Check for empty file
  const text = sourceFile.getText().trim()
  if (!text) {
    throw new Error(`File is empty: ${filePath}`)
  }

  // Check for syntax errors (only pure syntax, not semantic/type errors)
  // We only want to catch actual syntax errors like missing braces, not type errors
  const syntaxDiagnostics = sourceFile.getPreEmitDiagnostics().filter((d) => {
    const code = d.getCode()
    // Filter for syntax error codes (typically 1000-1999 range)
    // See: https://github.com/microsoft/TypeScript/blob/main/src/compiler/diagnosticMessages.json
    return d.getCategory() === DiagnosticCategory.Error && code >= 1000 && code < 2000
  })
  if (syntaxDiagnostics.length > 0) {
    const firstError = syntaxDiagnostics[0]
    const messageText = firstError.getMessageText()
    const message = typeof messageText === 'string' ? messageText : messageText.getMessageText()
    throw new Error(`TypeScript syntax error in ${filePath}: ${message}`)
  }

  // Find DO class
  const doClass = findDOClass(sourceFile)
  if (!doClass) {
    throw new Error(`No DurableObject class found in ${filePath}. Expected a class extending DurableObject, DurableRPC, or DigitalObject.`)
  }

  // Extract methods and namespaces
  const methods: ExtractedMethod[] = []
  const namespaces: ExtractedNamespace[] = []
  const usedTypes = new Set<string>()

  // Process class members
  for (const member of doClass.getMembers()) {
    // Skip constructors
    if (member.getKind() === SyntaxKind.Constructor) {
      continue
    }

    // Methods
    if (member.isKind(SyntaxKind.MethodDeclaration)) {
      const method = member as MethodDeclaration
      const extracted = extractMethod(method)
      if (extracted) {
        methods.push(extracted)
        collectUsedTypes(extracted, usedTypes)
      }
    }

    // Properties (potential namespaces)
    if (member.isKind(SyntaxKind.PropertyDeclaration)) {
      const prop = member as PropertyDeclaration
      const namespace = extractNamespace(prop)
      if (namespace) {
        namespaces.push(namespace)
        // Collect types from methods
        for (const m of namespace.methods) {
          collectUsedTypes(m, usedTypes)
        }
        // Collect types from namespace type annotation (e.g., Collection<Product>)
        if (namespace.typeName) {
          extractTypeNames(namespace.typeName, usedTypes)
        }
      }
    }
  }

  // Extract type definitions used in the API
  const types = extractUsedTypes(sourceFile, usedTypes)

  return {
    className: doClass.getName() || 'UnknownDO',
    methods,
    namespaces,
    types,
  }
}

/**
 * Find a class extending DurableObject/DurableRPC/DigitalObject
 */
function findDOClass(sourceFile: SourceFile): ClassDeclaration | undefined {
  const classes = sourceFile.getClasses()

  for (const cls of classes) {
    const extendsClause = cls.getExtends()
    if (extendsClause) {
      const extendsText = extendsClause.getText()
      if (DO_BASE_CLASSES.some((base) => extendsText.includes(base))) {
        return cls
      }
    }
  }

  return undefined
}

/**
 * Extract method signature
 */
function extractMethod(method: MethodDeclaration): ExtractedMethod | null {
  const name = method.getName()

  // Skip private methods (starting with _ or having private/protected keyword)
  if (name.startsWith('_') || name.startsWith('#')) {
    return null
  }

  // Check for private/protected scope
  const scope = method.getScope()
  if (scope === Scope.Private || scope === Scope.Protected) {
    return null
  }

  // Skip system methods
  if (SYSTEM_METHODS.has(name)) {
    return null
  }

  // Extract parameters
  const parameters: ExtractedParameter[] = method.getParameters().map((param) => ({
    name: param.getName(),
    type: getTypeText(param.getType(), param.getTypeNode()?.getText()),
    optional: param.isOptional() || param.hasQuestionToken(),
  }))

  // Extract return type
  const returnType = getTypeText(method.getReturnType(), method.getReturnTypeNode()?.getText())

  return { name, parameters, returnType }
}

/**
 * Extract namespace from property with object literal containing functions
 */
function extractNamespace(prop: PropertyDeclaration): ExtractedNamespace | null {
  const name = prop.getName()

  // Skip private properties
  if (name.startsWith('_') || name.startsWith('#')) {
    return null
  }

  const scope = prop.getScope()
  if (scope === Scope.Private || scope === Scope.Protected) {
    return null
  }

  // Get the initializer - should be an object literal
  const initializer = prop.getInitializer()

  // Handle object literals with arrow functions
  if (initializer && initializer.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const objLiteral = initializer.asKind(SyntaxKind.ObjectLiteralExpression)!
    const methods: ExtractedMethod[] = []

    for (const property of objLiteral.getProperties()) {
      if (property.isKind(SyntaxKind.PropertyAssignment)) {
        const propAssign = property.asKind(SyntaxKind.PropertyAssignment)!
        const propName = propAssign.getName()
        const init = propAssign.getInitializer()

        // Check if initializer is an arrow function
        if (init?.isKind(SyntaxKind.ArrowFunction)) {
          const arrow = init.asKind(SyntaxKind.ArrowFunction)!

          const parameters: ExtractedParameter[] = arrow.getParameters().map((param) => ({
            name: param.getName(),
            type: getTypeText(param.getType(), param.getTypeNode()?.getText()),
            optional: param.isOptional() || param.hasQuestionToken(),
          }))

          const returnType = getTypeText(arrow.getReturnType(), arrow.getReturnTypeNode()?.getText())

          methods.push({ name: propName, parameters, returnType })
        }

        // Check for method shorthand
        if (init?.isKind(SyntaxKind.MethodDeclaration)) {
          const methodDecl = init.asKind(SyntaxKind.MethodDeclaration)!
          const extracted = extractMethod(methodDecl)
          if (extracted) {
            methods.push({ ...extracted, name: propName })
          }
        }
      }

      // Handle method declaration shorthand in object literal
      if (property.isKind(SyntaxKind.MethodDeclaration)) {
        const methodDecl = property.asKind(SyntaxKind.MethodDeclaration)!
        const propName = methodDecl.getName()

        const parameters: ExtractedParameter[] = methodDecl.getParameters().map((param) => ({
          name: param.getName(),
          type: getTypeText(param.getType(), param.getTypeNode()?.getText()),
          optional: param.isOptional() || param.hasQuestionToken(),
        }))

        const returnType = getTypeText(methodDecl.getReturnType(), methodDecl.getReturnTypeNode()?.getText())

        methods.push({ name: propName, parameters, returnType })
      }
    }

    if (methods.length > 0) {
      return { name, methods }
    }
  }

  // For typed properties (e.g., products: Collection<Product>) or
  // properties with non-object initializers (e.g., products: Collection<Product> = this.createCollection('products'))
  // Try to extract namespace from the declared type
  const type = prop.getType()
  const typeNamespace = extractNamespaceFromType(name, type, prop.getTypeNode()?.getText())
  if (typeNamespace) {
    return typeNamespace
  }

  return null
}

/**
 * Extract namespace from a typed property (e.g., Collection<T>)
 */
function extractNamespaceFromType(name: string, type: Type, annotatedTypeName?: string): ExtractedNamespace | null {
  // Get the methods from the type
  const methods: ExtractedMethod[] = []

  for (const prop of type.getProperties()) {
    const declarations = prop.getDeclarations()
    if (!declarations || declarations.length === 0) continue

    const propType = prop.getValueDeclaration()?.getType() ?? prop.getTypeAtLocation(declarations[0]!)

    // Check if it's a callable signature
    const callSignatures = propType.getCallSignatures()
    if (callSignatures.length > 0) {
      const sig = callSignatures[0]

      const parameters: ExtractedParameter[] = sig.getParameters().map((param) => {
        const paramDecl = param.getValueDeclaration()
        const paramDeclarations = param.getDeclarations()
        if (!paramDecl && (!paramDeclarations || paramDeclarations.length === 0)) {
          return { name: param.getName(), type: 'unknown', optional: false }
        }
        return {
          name: param.getName(),
          type: getTypeText(paramDecl?.getType() || param.getTypeAtLocation(paramDeclarations![0]!), undefined),
          optional: paramDecl?.hasQuestionToken?.() ?? false,
        }
      })

      const returnType = getTypeText(sig.getReturnType(), undefined)

      methods.push({ name: prop.getName(), parameters, returnType })
    }
  }

  if (methods.length > 0) {
    return { name, methods, typeName: annotatedTypeName }
  }

  return null
}

/**
 * Get type text, preferring the explicit annotation over inferred type
 */
function getTypeText(type: Type, annotatedType?: string): string {
  // Prefer explicit annotation
  if (annotatedType) {
    return annotatedType
  }

  // Get the type text
  let text = type.getText()

  // Simplify import paths for cleaner output
  // e.g., import("./types").User => User
  text = text.replace(/import\("[^"]+"\)\./g, '')

  return text
}

/**
 * Collect type names used in method signatures
 */
function collectUsedTypes(method: ExtractedMethod, usedTypes: Set<string>): void {
  // Extract type names from return type
  extractTypeNames(method.returnType, usedTypes)

  // Extract type names from parameters
  for (const param of method.parameters) {
    extractTypeNames(param.type, usedTypes)
  }
}

/**
 * Extract type names from a type string
 */
function extractTypeNames(typeStr: string, usedTypes: Set<string>): void {
  // Match PascalCase identifiers that are likely custom types
  const matches = typeStr.match(/\b[A-Z][a-zA-Z0-9]*\b/g)
  if (matches) {
    for (const match of matches) {
      // Skip built-in types
      if (!isBuiltInType(match)) {
        usedTypes.add(match)
      }
    }
  }
}

/**
 * Check if a type name is a built-in type
 */
function isBuiltInType(name: string): boolean {
  const builtIns = new Set([
    'String',
    'Number',
    'Boolean',
    'Object',
    'Array',
    'Promise',
    'Date',
    'Error',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Request',
    'Response',
    'WebSocket',
    'Partial',
    'Required',
    'Readonly',
    'Pick',
    'Omit',
    'Record',
    'Exclude',
    'Extract',
    'ReturnType',
    'Parameters',
    'Awaited',
  ])
  return builtIns.has(name)
}

/**
 * Extract type definitions used in the API
 */
function extractUsedTypes(sourceFile: SourceFile, usedTypes: Set<string>): ExtractedType[] {
  const types: ExtractedType[] = []
  const extractedNames = new Set<string>()

  // Get interfaces
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName()
    if (usedTypes.has(name) && !extractedNames.has(name)) {
      types.push({
        name,
        declaration: iface.getText(),
        kind: 'interface',
      })
      extractedNames.add(name)
    }
  }

  // Get type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    const name = typeAlias.getName()
    if (usedTypes.has(name) && !extractedNames.has(name)) {
      types.push({
        name,
        declaration: typeAlias.getText(),
        kind: 'type',
      })
      extractedNames.add(name)
    }
  }

  // Get enums
  for (const enumDecl of sourceFile.getEnums()) {
    const name = enumDecl.getName()
    if (usedTypes.has(name) && !extractedNames.has(name)) {
      types.push({
        name,
        declaration: enumDecl.getText(),
        kind: 'enum',
      })
      extractedNames.add(name)
    }
  }

  // Also check imported types and inline them
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue()
    // Skip external modules
    if (!moduleSpec.startsWith('.')) continue

    // Try to resolve the import
    const importedSourceFile = importDecl.getModuleSpecifierSourceFile()
    if (!importedSourceFile) continue

    // Extract types from imported file
    for (const iface of importedSourceFile.getInterfaces()) {
      const name = iface.getName()
      if (usedTypes.has(name) && !extractedNames.has(name)) {
        types.push({
          name,
          declaration: iface.getText(),
          kind: 'interface',
        })
        extractedNames.add(name)
      }
    }

    for (const typeAlias of importedSourceFile.getTypeAliases()) {
      const name = typeAlias.getName()
      if (usedTypes.has(name) && !extractedNames.has(name)) {
        types.push({
          name,
          declaration: typeAlias.getText(),
          kind: 'type',
        })
        extractedNames.add(name)
      }
    }
  }

  return types
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate .d.ts content from extracted schema
 */
export function generateDTS(schema: ExtractedSchema): string {
  const lines: string[] = [
    '// Generated by `npx rpc.do generate --source`',
    '// Do not edit manually',
    '',
  ]

  // Add type definitions
  if (schema.types.length > 0) {
    for (const type of schema.types) {
      lines.push(type.declaration.startsWith('export ') ? type.declaration : `export ${type.declaration}`)
      lines.push('')
    }
  }

  // Generate API interface
  lines.push(`export interface ${schema.className}API {`)

  // Top-level methods
  for (const method of schema.methods) {
    lines.push(`  ${formatMethodSignature(method)}`)
  }

  // Namespaces
  for (const ns of schema.namespaces) {
    // If namespace has a typeName, use it directly
    if (ns.typeName) {
      lines.push(`  ${ns.name}: ${ns.typeName}`)
    } else {
      lines.push(`  ${ns.name}: {`)
      for (const method of ns.methods) {
        lines.push(`    ${formatMethodSignature(method)}`)
      }
      lines.push(`  }`)
    }
  }

  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Format method signature for .d.ts
 */
function formatMethodSignature(method: ExtractedMethod): string {
  const params = method.parameters.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
  return `${method.name}(${params}): ${method.returnType}`
}

/**
 * Generate index.ts entrypoint
 */
export function generateIndex(schemas: ExtractedSchema[]): string {
  const lines: string[] = [
    '// Generated by `npx rpc.do generate --source`',
    '// Do not edit manually',
    '',
  ]

  // Import types from each schema
  for (const schema of schemas) {
    lines.push(`import type { ${schema.className}API } from './${schema.className}'`)
  }

  lines.push('')

  // Re-export
  for (const schema of schemas) {
    lines.push(`export type { ${schema.className}API }`)
  }

  lines.push('')

  return lines.join('\n')
}
