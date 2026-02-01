# Architecture

Technical architecture documentation for the rpc.do RPC system.

---

## Design Goals

### Transport Agnostic

The RPC system is designed to work with any transport mechanism. The same client code works whether you're using HTTP, WebSocket, Cloudflare Service Bindings, or the capnweb protocol. This is achieved through a simple `Transport` interface:

```typescript
type Transport = {
  call(method: string, args: unknown[]): Promise<unknown>
  close?(): void
}
```

All transports implement this minimal interface, enabling seamless switching between protocols without changing application code.

### Minimal Bundle Size (~3KB)

The core RPC proxy is extremely lightweight. The `@dotdo/rpc/lite` entry point provides the minimal DurableRPC implementation without colo awareness or collections, optimized for the smallest possible bundle size.

Bundle composition:
- Core RPC proxy: ~2KB
- HTTP transport: ~1KB
- WebSocket transport: ~1.5KB
- Collections (optional): ~2KB
- Colo awareness (optional): ~1KB

### Zero Code Generation

Unlike tRPC, gRPC, or GraphQL, rpc.do requires no schema compilation, code generation, or build steps. The RPC proxy uses JavaScript's Proxy to dynamically accumulate method paths at runtime:

```typescript
const $ = RPC(transport)

// No codegen needed - just call methods
await $.users.get('123')           // path: 'users.get', args: ['123']
await $.ai.models.gpt4.complete()  // path: 'ai.models.gpt4.complete', args: []
```

### Full TypeScript Type Safety

Despite having zero code generation, rpc.do provides complete type safety through TypeScript generics:

```typescript
interface MyAPI {
  users: {
    get: (id: string) => User
    create: (data: CreateUserInput) => User
  }
}

const $ = RPC<MyAPI>(transport)

// Full autocomplete and type checking
const user = await $.users.get('123')  // user: User
```

---

## Package Hierarchy

```
+------------------+     +------------------+     +------------------+
|   @dotdo/types   |     |   @dotdo/rpc     |     |     rpc.do       |
|  Core type defs  | <-- |  Server library  | <-- | Managed client   |
+------------------+     +------------------+     +------------------+
        |                        |                        |
        v                        v                        v
   Full platform            DurableRPC               oauth.do
   access & types          base class              cli.do
                           capnweb integration     https://rpc.do
```

### @dotdo/types

Core type definitions shared across the platform:

- RPC message types (JSON-RPC 2.0 compatible)
- Promise pipelining types (`RpcPromise`, `RpcPipelined`)
- Transport interfaces
- Error types and codes
- DO client interfaces

Used by all packages for consistent typing. Provides full platform access when building integrations.

### @dotdo/rpc

Abstract core library for building Durable Object RPC servers:

- `DurableRPC` - Base class for RPC-enabled Durable Objects
- `DurableRPC/lite` - Minimal version without optional features
- WebSocket hibernation support via capnweb
- HTTP batch RPC handling
- Schema introspection (`GET /__schema`)
- Collections integration (MongoDB-style on SQLite)
- Colo awareness via colo.do

Entry points:
- `@dotdo/rpc` - Full implementation
- `@dotdo/rpc/lite` - Minimal bundle
- `@dotdo/rpc/collections` - Document store
- `@dotdo/rpc/do-collections` - Digital Object semantics
- `@dotdo/rpc/events` - Event streaming integration

### rpc.do

Managed implementation and client library:

- RPC client proxy with automatic transport selection
- Built-in transports (HTTP, WebSocket, capnweb, bindings)
- oauth.do integration for authentication
- cli.do integration for CLI tools
- Hosted service at https://rpc.do

Entry points:
- `rpc.do` - Main client with DO features (sql, storage, collections)
- `rpc.do/transports` - Transport implementations
- `rpc.do/auth` - Authentication providers
- `rpc.do/errors` - Error types
- `rpc.do/server` - Server utilities
- `rpc.do/expose` - Worker entrypoint wrapper

---

## Key Components

### RPC Proxy

The RPC Proxy uses JavaScript's Proxy to accumulate method paths until invocation:

```typescript
function createProxy(transport: Transport, path: string[] = []): any {
  return new Proxy(function() {}, {
    get(_, prop: string) {
      // Accumulate path segments
      return createProxy(transport, [...path, prop])
    },
    apply(_, __, args) {
      // On invocation, call transport with accumulated path
      const method = path.join('.')
      return transport.call(method, args)
    }
  })
}
```

This enables natural JavaScript syntax for RPC:

```typescript
$.namespace.method(arg1, arg2)
// Calls: transport.call('namespace.method', [arg1, arg2])
```

### Transports

All transports implement the same interface but use different protocols:

| Transport | Protocol | Best For |
|-----------|----------|----------|
| `http()` | HTTP POST (capnweb batch) | Request/response, serverless |
| `ws()` | WebSocket | Real-time, bidirectional |
| `capnweb()` | capnweb protocol | Full RPC features, pipelining |
| `binding()` | CF Service Bindings | Worker-to-DO, zero latency |
| `composite()` | Multiple | Fallback chains |

Example transport implementation (simplified):

```typescript
function http(url: string): Transport {
  return {
    async call(method: string, args: unknown[]) {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ method, args })
      })
      return res.json()
    }
  }
}
```

### DurableRPC

Server-side base class for Durable Objects with RPC capabilities:

```typescript
class DurableRPC extends DurableObject {
  // Direct storage accessors
  get sql(): SqlStorage
  get storage(): DurableObjectStorage
  get state(): DurableObjectState

  // Collections
  collection<T>(name: string): Collection<T>

  // Location awareness
  get colo(): string
  get coloInfo(): ColoInfo

  // WebSocket
  broadcast(message: unknown): void
  get connectionCount(): number

  // Schema
  getSchema(): RpcSchema
}
```

DurableRPC wraps capnweb's `RpcTarget` via `RpcInterface`, which:
1. Exposes user-defined methods over RPC
2. Hides internal properties (lifecycle, context, etc.)
3. Binds methods to the DO instance
4. Supports namespace objects for method grouping

### Capnweb Integration

capnweb provides the underlying RPC protocol:

- **RpcSession** - Manages RPC communication over a transport
- **RpcTarget** - Base class for exposable RPC interfaces
- **HibernatableWebSocketTransport** - WebSocket transport with hibernation
- **TransportRegistry** - Manages transport instances
- **newHttpBatchRpcResponse** - HTTP batch request handler

The integration flow:

```
DurableRPC instance
       |
       v
   RpcInterface (wraps as RpcTarget)
       |
       v
   RpcSession (manages protocol)
       |
       v
   Transport (HTTP or WebSocket)
```

---

## Data Flow Diagram

### HTTP Request Flow

```
+--------+    +----------+    +-----------+    +---------+    +------------+
| Client | -> | RPC      | -> | Transport | -> | Network | -> | Worker     |
| Code   |    | Proxy    |    | (HTTP)    |    | (HTTPS) |    | (Router)   |
+--------+    +----------+    +-----------+    +---------+    +------------+
                                                                    |
     +--------------------------------------------------------------+
     |
     v
+------------+    +-------------+    +------------+    +-------------+
| DO Stub    | -> | DO Instance | -> | RpcSession | -> | RpcInterface|
| (binding)  |    | (fetch)     |    | (capnweb)  |    | (dispatch)  |
+------------+    +-------------+    +------------+    +-------------+
                                                              |
     +--------------------------------------------------------+
     |
     v
+-------------+    +----------+    +-------------+
| User Method | -> | Response | -> | Client Code |
| Execution   |    | (JSON)   |    | (resolved)  |
+-------------+    +----------+    +-------------+
```

### WebSocket Request Flow

```
+--------+    +----------+    +-----------+    +---------+    +------------+
| Client | -> | RPC      | -> | Transport | -> | Network | -> | Worker     |
| Code   |    | Proxy    |    | (WS)      |    | (WSS)   |    | (Router)   |
+--------+    +----------+    +-----------+    +---------+    +------------+
                   ^                                               |
                   |               +-------------------------------+
                   |               |
                   |               v
                   |         +------------+    +-------------+
                   |         | DO Instance| -> | WS Upgrade  |
                   |         | (fetch)    |    | (101)       |
                   |         +------------+    +-------------+
                   |                                 |
                   |    +---------------------------+
                   |    |
                   |    v
                   |  +----------------------+    +-------------+
                   |  | Hibernatable WS      | -> | RpcSession  |
                   |  | Transport            |    | (capnweb)   |
                   |  +----------------------+    +-------------+
                   |                                     |
                   +-------------------------------------+
                        (bidirectional messages)
```

### Method Accumulation Flow

```
$.users.profiles.getById('123')

Step 1: $.users
        path = ['users']

Step 2: $.users.profiles
        path = ['users', 'profiles']

Step 3: $.users.profiles.getById
        path = ['users', 'profiles', 'getById']

Step 4: $.users.profiles.getById('123')
        transport.call('users.profiles.getById', ['123'])
```

---

## WebSocket Hibernation Flow

Cloudflare's WebSocket Hibernation API allows DOs to maintain WebSocket connections with zero memory cost during idle periods.

### State Diagram

```
                    +------------------+
                    |                  |
          connect   |                  |  close/error
     +------------->|     ACTIVE       |---------------+
     |              |                  |               |
     |              |  - Memory used   |               |
     |              |  - Processing    |               |
     |              |                  |               |
     |              +--------+---------+               |
     |                       |                         |
     |                       | idle                    |
     |                       | (no messages)           |
     |                       v                         |
     |              +------------------+               |
     |              |                  |               |
     |              |   HIBERNATED     |               |
     |              |                  |               |
     |              |  - Zero memory   |               |
     |              |  - WS maintained |               |
     |              |  - State frozen  |               |
     |              |                  |               |
     |              +--------+---------+               |
     |                       |                         |
     |                       | message arrives         |
     |                       | (webSocketMessage)      |
     |                       |                         |
     |              +--------v---------+               |
     |              |                  |               |
     |              |     WAKING       |               |
     |              |                  |               |
     |              |  - Reconstruct   |               |
     |              |  - Restore state |               |
     |              |  - Resume RPC    |               |
     |              |                  |               |
     |              +--------+---------+               |
     |                       |                         v
     |                       |                 +-------+-------+
     +<----------------------+                 |               |
                                               |    CLOSED     |
                                               |               |
                                               +---------------+
```

### Hibernation Implementation

```typescript
class DurableRPC extends DurableObject {
  private _transportRegistry = new TransportRegistry()
  private _sessions = new Map<WebSocket, RpcSession>()

  // Initial WebSocket setup
  handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const server = pair[1]

    // Use hibernation API
    this.ctx.acceptWebSocket(server)

    // Create and register transport
    const transport = new HibernatableWebSocketTransport(server)
    this._transportRegistry.register(transport)

    // Create RpcSession
    const session = new RpcSession(transport, this.getRpcInterface())
    this._sessions.set(server, session)

    // Store transport ID for recovery
    server.serializeAttachment({ transportId: transport.id })

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // Called when DO wakes from hibernation
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Try to recover transport from attachment
    let transport = this.recoverTransport(ws)

    // If not found, recreate (DO was hibernated)
    if (!transport) {
      transport = new HibernatableWebSocketTransport(ws)
      this._transportRegistry.register(transport)

      // Recreate session
      const session = new RpcSession(transport, this.getRpcInterface())
      this._sessions.set(ws, session)
    }

    // Feed message to transport -> capnweb processes it
    transport.enqueueMessage(message)
  }
}
```

### Key Points

1. **Zero Memory During Hibernation** - The DO instance is evicted from memory, only the WebSocket connection is maintained by Cloudflare's edge.

2. **Automatic Wake** - When a message arrives, Cloudflare instantiates the DO and calls `webSocketMessage()`.

3. **State Recovery** - Transport IDs stored in WebSocket attachments survive hibernation and allow session reconstruction.

4. **Seamless RPC** - Client code is unaware of hibernation; RPC calls work identically.

---

## Extension Points

### Custom Transports

Implement the `Transport` interface to create custom transports:

```typescript
import type { Transport } from 'rpc.do'

function customTransport(options: CustomOptions): Transport {
  return {
    async call(method: string, args: unknown[]) {
      // Your implementation here
      // - Send the method and args to the server
      // - Return the response
    },
    close() {
      // Optional: cleanup resources
    }
  }
}

// Usage
const $ = RPC(customTransport({ /* options */ }))
```

Example: Redis transport

```typescript
function redis(client: RedisClient, channel: string): Transport {
  const pending = new Map<string, { resolve: Function, reject: Function }>()

  client.subscribe(`${channel}:response`, (message) => {
    const { id, result, error } = JSON.parse(message)
    const handler = pending.get(id)
    if (handler) {
      pending.delete(id)
      error ? handler.reject(error) : handler.resolve(result)
    }
  })

  return {
    async call(method, args) {
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        client.publish(`${channel}:request`, JSON.stringify({ id, method, args }))
      })
    },
    close() {
      client.unsubscribe(`${channel}:response`)
    }
  }
}
```

### Custom Auth Providers

Auth providers supply authentication tokens for RPC calls:

```typescript
import type { AuthProvider } from 'rpc.do/transports'

// Simple static token
const staticAuth: AuthProvider = () => 'my-static-token'

// Async token provider (e.g., refresh tokens)
const dynamicAuth: AuthProvider = async () => {
  const token = await refreshTokenIfNeeded()
  return token
}

// Usage with transports
const transport = http(url, { auth: dynamicAuth })
const $ = RPC(transport)
```

Built-in oauth.do provider:

```typescript
import { oauthProvider } from 'rpc.do/auth'

// Automatically manages OAuth tokens via oauth.do
const $ = RPC('https://api.example.com', {
  auth: oauthProvider()
})
```

### DurableRPC Subclassing

Extend DurableRPC to add custom functionality:

```typescript
import { DurableRPC } from '@dotdo/rpc'

// Base class with common functionality
abstract class MyBaseDO extends DurableRPC {
  // Add authentication
  private async validateAuth(token: string): Promise<User | null> {
    // Your auth logic
  }

  // Override to add auth middleware
  protected override getRpcSessionOptions() {
    return {
      ...super.getRpcSessionOptions(),
      beforeCall: async (method: string, args: unknown[]) => {
        const token = this._currentRequest?.headers.get('Authorization')
        if (!token) throw new Error('Unauthorized')
        const user = await this.validateAuth(token)
        if (!user) throw new Error('Invalid token')
        return { user }  // Available in methods via this context
      }
    }
  }
}

// Specific implementation
export class UserService extends MyBaseDO {
  users = this.collection<User>('users')

  async getProfile(userId: string) {
    return this.users.get(userId)
  }
}
```

Custom collections with validation:

```typescript
class ValidatedCollection<T> {
  constructor(
    private collection: Collection<T>,
    private schema: ZodSchema<T>
  ) {}

  put(id: string, doc: T): void {
    const validated = this.schema.parse(doc)
    this.collection.put(id, validated)
  }

  get(id: string): T | null {
    return this.collection.get(id)
  }

  // ... other methods
}

export class MyDO extends DurableRPC {
  private _users = this.collection<User>('users')
  users = new ValidatedCollection(this._users, UserSchema)
}
```

Custom event hooks:

```typescript
import { DurableRPC } from '@dotdo/rpc'
import { createEventEmitter } from '@dotdo/rpc/events'

export class MyDO extends DurableRPC {
  events = createEventEmitter(this, { cdc: true })

  async createUser(data: UserInput) {
    const user = { id: crypto.randomUUID(), ...data }
    this.collection('users').put(user.id, user)

    // Emit custom event
    this.events.emit({
      type: 'user.created',
      userId: user.id,
      timestamp: Date.now()
    })

    return user
  }

  async alarm() {
    // Handle event delivery retries
    await this.events.handleAlarm()
  }
}
```
