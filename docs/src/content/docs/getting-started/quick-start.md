---
title: Quick Start
description: Get up and running with rpc.do in 5 minutes
---

This guide will get you up and running with rpc.do in 5 minutes.

## Prerequisites

- Node.js 18+
- A Cloudflare account (for deploying Durable Objects)
- Wrangler CLI (`npm install -g wrangler`)

## 1. Create a New Project

Use the rpc.do CLI to scaffold a new project:

```bash
npx rpc.do init my-project
```

Or add to an existing Cloudflare Workers project:

```bash
npm install @dotdo/rpc rpc.do
```

## 2. Define Your Durable Object

Create a Durable Object that extends `DurableRPC`:

```typescript
// src/UserService.ts
import { DurableRPC } from '@dotdo/rpc'

interface User {
  name: string
  email: string
  active: boolean
}

export class UserService extends DurableRPC {
  // MongoDB-style collection backed by SQLite
  users = this.collection<User>('users')

  // Public methods become RPC endpoints
  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }

  async getUser(id: string) {
    return this.users.get(id)
  }

  async findActiveUsers() {
    return this.users.find({ active: true })
  }

  // Namespaces group related methods
  admin = {
    listAll: () => this.users.list(),
    count: () => this.users.count(),
    delete: (id: string) => this.users.delete(id),
  }
}
```

## 3. Configure wrangler.toml

```toml
name = "my-project"
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

## 4. Create Your Worker Entry Point

```typescript
// src/index.ts
import { router } from '@dotdo/rpc'

interface Env {
  USER_SERVICE: DurableObjectNamespace
}

export { UserService } from './UserService'

export default router<Env>({
  bindings: {
    users: 'USER_SERVICE',
  },
})
```

## 5. Generate Types

Run the CLI to generate typed client interfaces:

```bash
npx rpc.do generate
```

This reads your `wrangler.toml`, finds your DOs, and generates types to `.do/`:

```
Found wrangler config with 1 Durable Object(s):
  - UserService (binding: USER_SERVICE)

Generated 2 file(s):
  - .do/UserService.d.ts
  - .do/index.ts
```

## 6. Use the Client

Now you can call your DO from anywhere:

```typescript
// From a browser, Worker, or Node.js
import { RPC } from 'rpc.do'
import type { UserServiceAPI } from './.do'

const $ = RPC<UserServiceAPI>('https://my-project.workers.dev/users/default')

// Create a user
const user = await $.createUser('user-1', {
  name: 'Alice',
  email: 'alice@example.com',
  active: true,
})

// Query users
const activeUsers = await $.findActiveUsers()

// Use namespace methods
const count = await $.admin.count()

// Direct SQL access
const results = await $.sql`SELECT * FROM users WHERE name LIKE ${'A%'}`.all()

// Access storage
await $.storage.put('lastSync', Date.now())
```

## 7. Deploy

```bash
wrangler deploy
```

## What's Next?

- [Installation](/getting-started/installation/) - Learn about different installation options
- [API Reference](/api/rpc-client/) - Explore all RPC client features
- [Transports](/api/transports/) - Learn about HTTP, WebSocket, and service bindings
- [CLI Commands](/cli/overview/) - Discover all CLI features
