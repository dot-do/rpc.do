---
title: Introduction
description: What is rpc.do and why should you use it?
---

rpc.do is a lightweight RPC library purpose-built for Cloudflare Durable Objects. It provides the same API locally and over the network, so your mental model stays consistent whether you're inside the DO or calling from a Worker, browser, or CLI.

## What Makes rpc.do Different?

rpc.do is **not** another REST/GraphQL/tRPC alternative. It is purpose-built for Cloudflare Durable Objects with features that don't exist elsewhere:

- **Same API locally and remotely** - `$.sql`, `$.storage`, `$.collection` mirror the DO's internal APIs
- **First-class DO support** - SQL, KV storage, collections, schema introspection, and WebSocket hibernation
- **Built on capnweb** - Promise pipelining, pass-by-reference, and batched calls over HTTP or WebSocket
- **Zero-config type generation** - Point `npx rpc.do generate` at your DO source and get fully typed clients
- **Lightweight** - ~3KB core, proxy-based, no build step required

## The Two Packages

The rpc.do ecosystem consists of two packages with distinct roles:

| Package | Role | Install |
|---------|------|---------|
| **@dotdo/rpc** | Server - Extend your Durable Object with RPC, SQL, collections, events, and WebSocket hibernation | `npm i @dotdo/rpc` |
| **rpc.do** | Client - Connect to any `@dotdo/rpc`-powered DO from a Worker, browser, Node, or CLI | `npm i rpc.do` |

### Server: @dotdo/rpc

Define your Durable Object by extending `DurableRPC`. Every public method and namespace becomes callable over RPC:

```typescript
import { DurableRPC } from '@dotdo/rpc'

export class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }

  async getActiveUsers() {
    return this.users.find({ active: true })
  }

  admin = {
    listAll: () => this.users.list(),
    count: () => this.users.count(),
  }
}
```

### Client: rpc.do

Connect from anywhere. The client auto-selects transport from the URL scheme:

```typescript
import { RPC } from 'rpc.do'

// HTTP (https://)
const $ = RPC('https://my-do.workers.dev')

// WebSocket (wss://) for real-time
const $ = RPC('wss://my-do.workers.dev')

// Typed client
const $ = RPC<UserServiceAPI>('https://my-do.workers.dev')
const users = await $.getActiveUsers()  // fully typed
```

## Core Features

### Remote SQL Access

Execute SQL queries on your DO's SQLite database with safe parameter binding:

```typescript
// Tagged templates prevent SQL injection
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
const user = await $.sql`SELECT * FROM users WHERE id = ${id}`.first()
await $.sql`UPDATE users SET name = ${name} WHERE id = ${id}`.run()
```

### Remote Storage

Access your DO's key-value storage remotely:

```typescript
const config = await $.storage.get('config')
await $.storage.put('config', { theme: 'dark' })
await $.storage.delete('config')
```

### Collections

MongoDB-style queries on DO SQLite:

```typescript
// Query with filters
const admins = await $.collection('users').find({ role: 'admin', active: true })

// Put/get by ID
await $.collection('users').put('user-123', { name: 'Alice', role: 'admin' })
const user = await $.collection('users').get('user-123')
```

### Custom RPC Methods

Any public method on your DO class is callable:

```typescript
// On the server
export class ChatRoom extends DurableRPC {
  async sendMessage(text: string, userId: string) {
    const message = { text, userId, timestamp: Date.now() }
    this.messages.put(crypto.randomUUID(), message)
    this.broadcast(message)  // Send to connected WebSockets
    return message
  }
}

// On the client
const message = await $.sendMessage('Hello!', 'user-123')
```

## Next Steps

- [Quick Start](/getting-started/quick-start/) - Set up your first rpc.do project
- [Installation](/getting-started/installation/) - Detailed installation instructions
- [API Reference](/api/rpc-client/) - Full API documentation
