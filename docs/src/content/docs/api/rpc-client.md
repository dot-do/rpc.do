---
title: RPC Client
description: The RPC() factory and client configuration
---

The `RPC()` factory is the main entry point for creating RPC clients.

## Basic Usage

```typescript
import { RPC } from 'rpc.do'

// Simple URL (recommended)
const $ = RPC('https://my-do.workers.dev')

// Call RPC methods
const result = await $.users.create({ name: 'Alice' })
```

## API Signature

```typescript
function RPC<T extends object = Record<string, unknown>>(
  urlOrTransport: string | Transport | TransportFactory,
  options?: RpcOptions
): RpcProxy<T> & DOClientFeatures
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `urlOrTransport` | `string \| Transport \| TransportFactory` | URL or transport instance |
| `options` | `RpcOptions` | Optional configuration |

### RpcOptions

```typescript
interface RpcOptions {
  /** Auth token or provider */
  auth?: string | (() => string | null | Promise<string | null>)

  /** Request timeout in milliseconds */
  timeout?: number

  /** Enable WebSocket reconnection (default: true for ws/wss URLs) */
  reconnect?: boolean

  /** Middleware chain for request/response hooks */
  middleware?: RpcClientMiddleware[]
}
```

## URL-Based Transport Selection

The transport is auto-selected based on the URL scheme:

```typescript
// HTTP transport (https://)
const $ = RPC('https://my-do.workers.dev')

// WebSocket transport (wss://)
const $ = RPC('wss://my-do.workers.dev')
```

## Typed Clients

Pass a type parameter for full type safety:

```typescript
interface MyAPI {
  users: {
    get: (id: string) => Promise<User>
    create: (data: CreateUserInput) => Promise<User>
    list: () => Promise<User[]>
  }
  admin: {
    count: () => Promise<number>
  }
}

const $ = RPC<MyAPI>('https://my-do.workers.dev')

// All calls are now fully typed
const user = await $.users.get('123')     // Returns User
const count = await $.admin.count()       // Returns number
```

## Authentication

```typescript
// Static token
const $ = RPC('https://my-do.workers.dev', {
  auth: 'sk_live_xxx'
})

// Dynamic token provider
const $ = RPC('https://my-do.workers.dev', {
  auth: async () => {
    const session = await getSession()
    return session?.accessToken ?? null
  }
})

// oauth.do integration
import { oauthProvider } from 'rpc.do/auth'

const $ = RPC('https://my-do.workers.dev', {
  auth: oauthProvider()
})
```

## Timeouts

```typescript
const $ = RPC('https://my-do.workers.dev', {
  timeout: 5000  // 5 second timeout
})
```

## Middleware

```typescript
import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    loggingMiddleware(),
    timingMiddleware({ threshold: 100 })
  ]
})
```

See [Middleware](/api/middleware/) for more details.

## Explicit Transports

For advanced control, pass a transport directly:

```typescript
import { RPC, http, capnweb, binding, composite } from 'rpc.do'

// HTTP transport
const $ = RPC(http('https://my-do.workers.dev'))

// capnweb WebSocket
const $ = RPC(capnweb('wss://my-do.workers.dev'))

// Service binding (zero-latency worker-to-DO)
const $ = RPC(binding(env.MY_DO))

// Fallback chain
const $ = RPC(composite(
  capnweb('wss://my-do.workers.dev'),
  http('https://my-do.workers.dev')
))
```

See [Transports](/api/transports/) for more details.

## Pre-configured Client

A pre-configured client for the rpc.do service is available:

```typescript
import { $ } from 'rpc.do'

// Anonymous request to rpc.do
await $.ai.generate({ prompt: 'hello' })
```

## Return Type

The `RPC()` function returns a `RpcProxy<T> & DOClientFeatures`:

- **RpcProxy<T>** - Proxy object that turns property access and method calls into RPC requests
- **DOClientFeatures** - Built-in SQL, storage, and collection access

### DOClientFeatures

```typescript
interface DOClientFeatures {
  /** Tagged template SQL query */
  sql: <R>(strings: TemplateStringsArray, ...values: unknown[]) => SqlQuery<R>

  /** Remote storage access */
  storage: RemoteStorage

  /** Remote collection access */
  collection: RemoteCollections

  /** Get database schema */
  dbSchema: () => Promise<DatabaseSchema>

  /** Get full RPC schema */
  schema: () => Promise<RpcSchema>
}
```

## Examples

### Basic CRUD

```typescript
const $ = RPC('https://api.example.com')

// Create
const user = await $.users.create({ name: 'Alice', email: 'alice@example.com' })

// Read
const found = await $.users.get(user.id)

// Update
await $.users.update(user.id, { name: 'Alice Smith' })

// Delete
await $.users.delete(user.id)
```

### Namespaced APIs

```typescript
const $ = RPC('https://api.example.com')

// Flat methods
await $.healthCheck()

// Namespaced methods
await $.admin.users.list()
await $.admin.users.ban('user-123')

// Deeply nested
await $.services.billing.invoices.create({ amount: 100 })
```

### Real-time with WebSocket

```typescript
const $ = RPC('wss://chat.example.com', { reconnect: true })

// Send messages
await $.room.sendMessage('Hello!')

// Subscribe to events (if your DO implements event streaming)
const events = $.room.subscribe()
for await (const event of events) {
  console.log('Event:', event)
}
```
