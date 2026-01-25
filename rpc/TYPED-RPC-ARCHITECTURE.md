# Typed RPC Architecture for Digital Objects

## Problem Statement

Current rpc.do CLI generates weak types from runtime introspection:
```typescript
// Generated today - not type-safe
export interface GeneratedAPI {
  users: {
    get(...args: any[]): Promise<any>
    create(...args: any[]): Promise<any>
  }
}
```

We want full TypeScript type safety:
```typescript
// Target - fully typed
export interface GeneratedAPI {
  users: {
    get(id: string): Promise<User | null>
    create(data: CreateUserInput): Promise<User>
  }
}
```

## Approaches Analysis

### 1. Static Analysis (ts-morph / TypeScript Compiler API)

**How it works:**
- Parse DO source files at build time
- Extract method signatures, return types, parameter types
- Generate .d.ts files with full type information

**Pros:**
- Full type information including generics
- Works offline, no deployment needed
- Fast - no network calls

**Cons:**
- Requires source files (not just deployed DO)
- Complex to implement properly
- Must handle imports, generics, type aliases

**Example:** Prisma uses this approach for schema -> client generation

### 2. Runtime Metadata with Decorators

**How it works:**
```typescript
class MyDO extends DigitalObject {
  @RpcMethod()
  @Returns(User)
  async getUser(@Param('id') id: string): Promise<User> { ... }
}
```

**Pros:**
- Types embedded at runtime
- Can be extracted from deployed DO
- Standard pattern (NestJS, TypeORM)

**Cons:**
- Requires experimentalDecorators
- Verbose boilerplate
- reflect-metadata dependency

### 3. Zod/Valibot Runtime Schemas

**How it works:**
```typescript
const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email()
})

class MyDO extends DigitalObject {
  users = collection('users', UserSchema)
}
```

**Pros:**
- Runtime validation + TypeScript types
- Schemas can be serialized and sent via /__schema
- Single source of truth

**Cons:**
- Requires schema definitions (extra code)
- Learning curve for schema syntax
- Bundle size for Zod/Valibot

### 4. tRPC-style Inference (Recommended Hybrid)

**How it works:**
```typescript
// DO defines methods with standard TypeScript
class MyDO extends DigitalObject {
  users = {
    get: async (id: string): Promise<User | null> => {
      return this.$.collection<User>('users').get(id)
    },
    create: async (data: CreateUserInput): Promise<User> => {
      return this.$.collection<User>('users').put(data.id, data)
    }
  }
}

// Export the type for the client
export type MyDOAPI = typeof MyDO.prototype
```

**Pros:**
- Zero runtime overhead
- Standard TypeScript - no decorators
- Types inferred from implementation

**Cons:**
- Client needs type import (not just URL)
- Requires build step for type extraction

## Recommended Architecture

### Hybrid: Static Types + Runtime Discovery

```
┌─────────────────────────────────────────────────────────────────┐
│                        Build Time                                │
│                                                                  │
│  MyDO.ts ──► ts-morph ──► .do/MyDO.d.ts (full types)           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Runtime                                   │
│                                                                  │
│  DO ──► /__schema ──► { methods, namespaces, collections }      │
│         (discovery only - method names, not full types)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Client                                    │
│                                                                  │
│  Option A: Import types directly (monorepo/shared packages)     │
│    import type { MyDOAPI } from '@myorg/do/types'               │
│    const client = RPC<MyDOAPI>(transport)                       │
│                                                                  │
│  Option B: Generate types from source (multi-repo)              │
│    npx rpc.do generate --source ./do/MyDO.ts                    │
│    import { client } from './generated/rpc'                      │
│                                                                  │
│  Option C: Generate from runtime (weak types, no source)        │
│    npx rpc.do generate --url https://my-do.workers.dev          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### DO Implementation Pattern

```typescript
// do/DigitalObject.ts - Base class
export abstract class DigitalObject extends DurableRPC {
  // Collections are automatically exposed via RPC
  protected collection<T>(name: string): Collection<T> {
    return this.$.collection<T>(name)
  }
}

// my-do/MyDO.ts - Concrete implementation
export class MyDO extends DigitalObject {
  // Namespace-style methods (automatically exposed)
  users = {
    get: async (id: string): Promise<User | null> => {
      return this.collection<User>('users').get(id)
    },

    create: async (data: CreateUserInput): Promise<User> => {
      const user: User = { id: crypto.randomUUID(), ...data }
      this.collection<User>('users').put(user.id, user)
      return user
    },

    list: async (options?: ListOptions): Promise<User[]> => {
      return this.collection<User>('users').find({}, options)
    }
  }

  // Top-level methods
  async ping(): Promise<'pong'> {
    return 'pong'
  }
}

// Export type for clients
export type MyDOAPI = typeof MyDO.prototype
```

### Type Extraction via ts-morph

```typescript
// rpc.do CLI internals
import { Project } from 'ts-morph'

async function extractTypes(sourcePath: string): Promise<string> {
  const project = new Project()
  const sourceFile = project.addSourceFileAtPath(sourcePath)

  // Find the DO class
  const doClass = sourceFile.getClasses()
    .find(c => c.getExtends()?.getText().includes('DigitalObject'))

  if (!doClass) throw new Error('No DigitalObject class found')

  // Extract methods and namespaces
  const methods: MethodSchema[] = []
  const namespaces: NamespaceSchema[] = []

  for (const member of doClass.getMembers()) {
    if (member.isKind(ts.SyntaxKind.PropertyDeclaration)) {
      // Check if it's a namespace (object with methods)
      const type = member.getType()
      if (isNamespace(type)) {
        namespaces.push(extractNamespace(member))
      }
    } else if (member.isKind(ts.SyntaxKind.MethodDeclaration)) {
      methods.push(extractMethod(member))
    }
  }

  // Generate .d.ts
  return generateDTS(doClass.getName(), methods, namespaces)
}
```

### Generated .d.ts Output

```typescript
// .do/MyDO.d.ts
// Generated by `npx rpc.do generate --source ./MyDO.ts`

export interface MyDOAPI {
  /** Ping the DO */
  ping(): Promise<'pong'>

  /** User operations */
  users: {
    /** Get a user by ID */
    get(id: string): Promise<User | null>

    /** Create a new user */
    create(data: CreateUserInput): Promise<User>

    /** List users with optional filtering */
    list(options?: ListOptions): Promise<User[]>
  }
}

// Re-export types used in the API
export type { User, CreateUserInput, ListOptions } from './types'
```

## Implementation Plan

### Phase 1: Core RPC Interface (do project)

1. Refactor `DigitalObject` to extend `DurableRPC` pattern
2. Remove manual `MethodRegistry` - use automatic reflection
3. Collections defined as class properties auto-exposed
4. Keep `/__schema` for runtime discovery

### Phase 2: Type Extraction (rpc.do CLI)

1. Add `--source` flag to `npx rpc.do generate`
2. Implement ts-morph type extraction
3. Generate `.do/*.d.ts` files with full types
4. Support monorepo type imports

### Phase 3: Collection Type Integration

1. `Collection<T>` generic flows through to API types
2. CRUD methods auto-typed: `get(id): T | null`, `put(id, T): void`
3. Filter types for `find()` queries

### Phase 4: Watch Mode

1. `npx rpc.do watch --source ./do/*.ts`
2. Regenerate types on file changes
3. TypeScript language service integration

## Files to Modify

### rpc.do project
- `src/cli.ts` - Add `--source` flag, ts-morph extraction
- Add `src/extract.ts` - Type extraction logic
- Update docs for new workflow

### do project
- `do/DigitalObject.ts` - Extend DurableRPC pattern
- Remove `rpc/methods.ts` manual registry
- Collections auto-exposed via class properties

## Open Questions

1. **How to handle circular type references?**
   - ts-morph can detect these, need strategy for breaking cycles

2. **Generic type serialization for /__schema?**
   - Runtime can't know `Collection<User>` is User specifically
   - May need optional schema annotations for runtime

3. **Private/internal methods?**
   - Convention: prefix with `_` or `#` private fields
   - Already handled by DurableRPC's SKIP_PROPS

4. **Cross-package type imports?**
   - Need to bundle/inline imported types
   - Or generate path mappings for tsconfig
