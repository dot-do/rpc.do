---
title: generate
description: Generate TypeScript types from Durable Object source files
---

The `generate` command extracts TypeScript types from your Durable Object source files and generates typed client interfaces.

## Usage

```bash
# Zero-config (reads wrangler.toml)
npx rpc.do generate

# Or just
npx rpc.do

# Explicit source file
npx rpc.do generate --source ./src/MyDO.ts

# Multiple files with glob
npx rpc.do generate --source "./src/do/*.ts"

# Custom output directory
npx rpc.do generate --output ./generated/rpc
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--source <file>` | TypeScript source file (supports globs) | Auto-detected |
| `--output <dir>` | Output directory | `.do` |

## Zero-config Mode

When run without arguments, the CLI:

1. Looks for `wrangler.toml` or `wrangler.jsonc` in the current directory
2. Reads the `[durable_objects]` bindings configuration
3. Finds the class names from the bindings
4. Searches for source files containing those class definitions
5. Extracts types using the TypeScript compiler API
6. Generates typed interfaces to `.do/`

### Example Output

```
$ npx rpc.do

Found wrangler config with 2 Durable Object(s):
  - ChatDO (binding: CHAT)
  - UserService (binding: USERS)

Generated 4 file(s):
  - .do/ChatDO.d.ts
  - .do/UserService.d.ts
  - .do/index.ts
```

## Explicit Source Mode

For more control, specify source files directly:

```bash
# Single file
npx rpc.do generate --source ./src/ChatDO.ts

# Multiple files with glob
npx rpc.do generate --source "./src/do/*.ts"

# Specific files
npx rpc.do generate --source ./src/ChatDO.ts --source ./src/UserService.ts
```

## Generated Output

### Type Definitions

For each Durable Object class, a `.d.ts` file is generated:

```typescript
// .do/ChatDO.d.ts
export interface ChatDOAPI {
  /** Send a message to the chat room */
  sendMessage(text: string, userId: string): Promise<Message>

  /** Get recent messages */
  getMessages(limit?: number): Promise<Message[]>

  /** User management namespace */
  users: {
    get(id: string): Promise<User | null>
    list(): Promise<User[]>
    count(): Promise<number>
  }
}
```

### Index File

An `index.ts` file re-exports all types:

```typescript
// .do/index.ts
export type { ChatDOAPI } from './ChatDO'
export type { UserServiceAPI } from './UserService'
```

## Using Generated Types

Import and use the generated types with `RPC()`:

```typescript
import { RPC } from 'rpc.do'
import type { ChatDOAPI } from './.do'

const $ = RPC<ChatDOAPI>('https://my-do.workers.dev')

// All calls are now fully typed
const messages = await $.getMessages(10)  // Message[]
await $.sendMessage('Hello!', 'user-123')  // Promise<Message>
const user = await $.users.get('user-123')  // User | null
```

## Type Extraction

The CLI extracts types from:

- **Public methods** - Any `async` or sync method on the class
- **Namespaces** - Object properties with methods become nested interfaces
- **Collections** - `this.collection<T>()` calls preserve the generic type
- **JSDoc comments** - Comments are preserved in generated types
- **Return types** - Inferred or explicit return types are captured
- **Parameter types** - All parameter types including optional parameters

### Supported Patterns

```typescript
export class MyDO extends DurableRPC {
  // Direct methods become top-level
  async simpleMethod(arg: string): Promise<Result> { ... }

  // Namespaces become nested interfaces
  admin = {
    listUsers: async (): Promise<User[]> => { ... },
    deleteUser: async (id: string): Promise<void> => { ... },
  }

  // Deeply nested namespaces
  api = {
    v1: {
      users: {
        get: async (id: string): Promise<User> => { ... }
      }
    }
  }

  // Collections (type is extracted from generic)
  users = this.collection<User>('users')
}
```

Generated interface:

```typescript
interface MyDOAPI {
  simpleMethod(arg: string): Promise<Result>
  admin: {
    listUsers(): Promise<User[]>
    deleteUser(id: string): Promise<void>
  }
  api: {
    v1: {
      users: {
        get(id: string): Promise<User>
      }
    }
  }
  users: Collection<User>
}
```

## Watch Mode

Automatically regenerate types when files change:

```bash
npx rpc.do watch

# With specific source
npx rpc.do watch --source "./src/do/*.ts"
```

## Integration with Build Tools

### package.json Scripts

```json
{
  "scripts": {
    "generate": "rpc.do generate",
    "generate:watch": "rpc.do watch",
    "prebuild": "rpc.do generate"
  }
}
```

### With Turbo/nx

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["generate"]
    },
    "generate": {
      "inputs": ["src/**/*.ts", "wrangler.toml"],
      "outputs": [".do/**"]
    }
  }
}
```

## Troubleshooting

### "No Durable Objects found"

Ensure your `wrangler.toml` has durable_objects bindings:

```toml
[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDurableObject" }
]
```

### "Cannot find source file"

The CLI searches for classes in common locations. Specify explicitly:

```bash
npx rpc.do generate --source ./src/durable-objects/MyDO.ts
```

### "Type extraction failed"

Ensure your TypeScript compiles successfully:

```bash
npx tsc --noEmit
```

Then retry generation.
