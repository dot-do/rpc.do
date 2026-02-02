---
title: Server Setup
description: Setting up DurableRPC on the server side
---

This guide covers setting up the server side of rpc.do using the `@dotdo/rpc` package.

## Basic Setup

### 1. Install Dependencies

```bash
npm install @dotdo/rpc
npm install -D @cloudflare/workers-types
```

### 2. Create a Durable Object

```typescript
// src/UserService.ts
import { DurableRPC } from '@dotdo/rpc'

interface User {
  name: string
  email: string
  role: 'user' | 'admin'
}

export class UserService extends DurableRPC {
  // MongoDB-style collection
  users = this.collection<User>('users')

  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }

  async getUser(id: string) {
    return this.users.get(id)
  }

  async findByRole(role: string) {
    return this.users.find({ role })
  }

  // Namespaced methods
  admin = {
    listAll: () => this.users.list(),
    count: () => this.users.count(),
    delete: (id: string) => this.users.delete(id),
  }
}
```

### 3. Create Worker Entry Point

```typescript
// src/index.ts
import { router } from '@dotdo/rpc'

export { UserService } from './UserService'

interface Env {
  USER_SERVICE: DurableObjectNamespace
}

export default router<Env>({
  bindings: {
    users: 'USER_SERVICE',
  },
})
```

### 4. Configure wrangler.toml

```toml
name = "my-rpc-service"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "USER_SERVICE", class_name = "UserService" }
]

[[migrations]]
tag = "v1"
new_classes = ["UserService"]
```

## DurableRPC Features

### Collections

MongoDB-style document storage on SQLite:

```typescript
export class MyDO extends DurableRPC {
  users = this.collection<User>('users')
  posts = this.collection<Post>('posts')

  async example() {
    // CRUD
    await this.users.put('user-1', { name: 'Alice', role: 'admin' })
    const user = await this.users.get('user-1')
    await this.users.delete('user-1')

    // Queries
    const admins = await this.users.find({ role: 'admin' })
    const active = await this.users.find({ active: true, role: { $in: ['user', 'admin'] } })

    // With options
    const recent = await this.posts.find({}, { limit: 10, sort: '-createdAt' })
  }
}
```

### SQL Access

Direct SQLite access via tagged templates:

```typescript
export class MyDO extends DurableRPC {
  async runQuery() {
    // Safe parameter binding
    const users = this.sql`SELECT * FROM users WHERE active = ${true}`.toArray()

    // First result
    const user = this.sql`SELECT * FROM users WHERE id = ${id}`.first()

    // Execute without results
    this.sql`UPDATE users SET name = ${name} WHERE id = ${id}`.run()
  }
}
```

### Storage

Key-value storage access:

```typescript
export class MyDO extends DurableRPC {
  async example() {
    await this.storage.put('config', { theme: 'dark' })
    const config = await this.storage.get('config')
    await this.storage.delete('config')

    // List keys
    const keys = await this.storage.list({ prefix: 'user:' })
  }
}
```

### WebSocket Broadcasting

Send messages to connected WebSocket clients:

```typescript
export class ChatRoom extends DurableRPC {
  async sendMessage(text: string, userId: string) {
    const message = { text, userId, timestamp: Date.now() }
    this.messages.put(crypto.randomUUID(), message)

    // Broadcast to all connected clients
    this.broadcast(JSON.stringify({ type: 'message', data: message }))

    return message
  }

  get onlineCount() {
    return this.connectionCount
  }
}
```

## Router Configuration

### Basic Router

```typescript
import { router } from '@dotdo/rpc'

export default router<Env>({
  bindings: {
    users: 'USER_DO',
    rooms: 'ROOM_DO',
  },
})
```

URL format: `/{namespace}/{id}/...`

- `GET /users/user-123` - Schema introspection
- `POST /users/user-123` - RPC call
- `WS /users/user-123` - WebSocket connection

### With Authentication

```typescript
export default router<Env>({
  bindings: { users: 'USER_DO' },

  auth: async (request, env) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return { authorized: false }
    }

    const user = await validateToken(token, env)
    if (!user) {
      return { authorized: false }
    }

    return {
      authorized: true,
      id: user.id,
      claims: { role: user.role }
    }
  }
})
```

### Custom ID Resolution

```typescript
export default router<Env>({
  bindings: { users: 'USER_DO' },

  resolveId: (request, namespace) => {
    // Use header for ID
    const idFromHeader = request.headers.get('X-DO-Id')
    if (idFromHeader) return idFromHeader

    // Or extract from path
    const url = new URL(request.url)
    const segments = url.pathname.split('/')
    return segments[2] || 'default'
  }
})
```

## Entry Points

### Full Package

```typescript
import { DurableRPC, router, defineConfig } from '@dotdo/rpc'
```

Includes: Collections, colo awareness, schema introspection, routing.

### Lite Package

```typescript
import { DurableRPC } from '@dotdo/rpc/lite'
```

Minimal bundle - no collections, no colo, no router.

### With Events

```typescript
import { DurableRPC } from '@dotdo/rpc'
import { createEventEmitter, CDCCollection } from '@dotdo/rpc/events'

export class MyDO extends DurableRPC {
  events = createEventEmitter(this, { cdc: true })
  users = new CDCCollection(this.collection('users'), this.events, 'users')

  async alarm() {
    await this.events.handleAlarm()
  }
}
```

## Colo Awareness

Location-aware features (requires `colo.do`):

```typescript
npm install colo.do
```

```typescript
export class MyDO extends DurableRPC {
  async getLocationInfo() {
    return {
      colo: this.colo,           // 'SJC'
      coloInfo: this.coloInfo,   // { city: 'San Jose', country: 'US', lat, lon }
    }
  }

  async findNearestReplica(colos: string[]) {
    return this.findNearestColo(colos)
  }

  async estimateLatency(targetColo: string) {
    return this.estimateLatencyTo(targetColo)
  }
}
```

## Middleware

Server-side request hooks:

```typescript
import { DurableRPC, type RpcMiddleware } from '@dotdo/rpc'

const loggingMiddleware: RpcMiddleware = {
  onRequest: async (ctx) => {
    console.log(`[${ctx.method}] called with`, ctx.args)
  },
  onResponse: async (ctx, result) => {
    console.log(`[${ctx.method}] returned`, result)
  },
  onError: async (ctx, error) => {
    console.error(`[${ctx.method}] error:`, error)
  }
}

export class MyDO extends DurableRPC {
  middleware = [loggingMiddleware]
}
```

## Schema Introspection

Every DurableRPC exposes its schema at `GET /` or `GET /__schema`:

```json
{
  "version": 1,
  "methods": [
    { "name": "createUser", "path": "createUser", "params": 2 }
  ],
  "namespaces": [
    {
      "name": "admin",
      "methods": [
        { "name": "listAll", "path": "admin.listAll", "params": 0 }
      ]
    }
  ],
  "database": {
    "tables": [
      {
        "name": "users",
        "columns": [{ "name": "id", "type": "TEXT" }]
      }
    ]
  },
  "colo": "SJC"
}
```

Use with `npx rpc.do generate` for typed client generation.
