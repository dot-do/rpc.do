---
title: introspect
description: Fetch types from a running RPC server
---

The `introspect` command connects to a running RPC server, fetches its runtime schema, and generates TypeScript type definitions.

## Usage

```bash
npx rpc.do introspect --url https://my-do.workers.dev
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>` | RPC endpoint URL | Required |
| `--output <dir>` | Output directory | `.do` |

## How It Works

1. Connects to the specified URL
2. Fetches the schema from the `/__schema` endpoint
3. Parses the runtime schema (methods, namespaces, database structure)
4. Generates TypeScript type definitions

## Example

```bash
$ npx rpc.do introspect --url https://chat.workers.dev/rooms/default

Fetching schema from https://chat.workers.dev/rooms/default/__schema...

Schema retrieved:
  - 3 methods
  - 1 namespace
  - 2 database tables

Generated 2 file(s):
  - .do/ChatRoom.d.ts
  - .do/index.ts
```

## Runtime vs Source Types

| Aspect | `generate --source` | `introspect --url` |
|--------|---------------------|-------------------|
| Type Source | TypeScript source files | Runtime schema |
| Parameter Types | Full TypeScript types | `unknown` (weak) |
| Return Types | Full TypeScript types | `unknown` (weak) |
| Requires | Source code access | Running server |
| Accuracy | Complete | Limited |

**Recommendation**: Use `generate --source` when you have access to the source code. Use `introspect --url` only when:
- You're consuming a third-party RPC service
- You don't have access to the source code
- You want to verify what's deployed

## Generated Output

Runtime introspection produces weaker types because the schema only contains method names and parameter counts:

```typescript
// .do/ChatRoom.d.ts (from introspect)
export interface ChatRoomAPI {
  sendMessage(...args: unknown[]): Promise<unknown>
  getMessages(...args: unknown[]): Promise<unknown>
  users: {
    get(...args: unknown[]): Promise<unknown>
    list(...args: unknown[]): Promise<unknown>
  }
}
```

Compare to source-based generation:

```typescript
// .do/ChatRoom.d.ts (from generate)
export interface ChatRoomAPI {
  sendMessage(text: string, userId: string): Promise<Message>
  getMessages(limit?: number): Promise<Message[]>
  users: {
    get(id: string): Promise<User | null>
    list(): Promise<User[]>
  }
}
```

## Schema Endpoint

The `/__schema` endpoint returns a JSON schema:

```json
{
  "version": 1,
  "methods": [
    { "name": "sendMessage", "path": "sendMessage", "params": 2 },
    { "name": "getMessages", "path": "getMessages", "params": 1 }
  ],
  "namespaces": [
    {
      "name": "users",
      "methods": [
        { "name": "get", "path": "users.get", "params": 1 },
        { "name": "list", "path": "users.list", "params": 0 }
      ]
    }
  ],
  "database": {
    "tables": [
      {
        "name": "messages",
        "columns": [
          { "name": "id", "type": "TEXT" },
          { "name": "text", "type": "TEXT" },
          { "name": "userId", "type": "TEXT" }
        ]
      }
    ]
  },
  "colo": "SJC"
}
```

## Combining with Source Types

You can augment introspected types with manual type annotations:

```typescript
import { RPC } from 'rpc.do'

// Base types from introspection
import type { ChatRoomAPI } from './.do'

// Enhance with manual types
interface Message {
  id: string
  text: string
  userId: string
  timestamp: number
}

interface TypedChatRoomAPI extends ChatRoomAPI {
  sendMessage(text: string, userId: string): Promise<Message>
  getMessages(limit?: number): Promise<Message[]>
}

const $ = RPC<TypedChatRoomAPI>('https://chat.workers.dev')
```

## Troubleshooting

### "Failed to fetch schema"

The server may not expose a schema endpoint:

```bash
npx rpc.do doctor --url https://my-do.workers.dev
```

### "Connection refused"

Ensure the server is running and accessible:

```bash
curl https://my-do.workers.dev/__schema
```

### "Invalid schema format"

The server may not be an rpc.do-compatible service. Check the response:

```bash
curl -s https://my-do.workers.dev/__schema | jq .
```
