# @dotdo/rpc

Abstract core library for building RPC-enabled Cloudflare Durable Objects with capnweb, WebSocket hibernation, and MongoDB-style collections.

## Package Positioning

**@dotdo/rpc** is the abstract foundation of the .do platform's RPC system. It provides the base classes and utilities for building your own RPC-enabled Durable Objects with full control over implementation.

| Package | Description |
|---------|-------------|
| **@dotdo/types** | Core type definitions providing full access to the platform |
| **@dotdo/rpc** | Abstract core library (this package) - build your own RPC Durable Objects |
| **[rpc.do](https://npmjs.com/package/rpc.do)** | Managed implementation with platform integrations (oauth.do, cli.do, rpc.do service) |

**Choose @dotdo/rpc when you need:**
- Full control over your Durable Object implementation
- Custom authentication, routing, or storage patterns
- Self-hosted deployment without platform dependencies

**Choose [rpc.do](../README.md) when you want:**
- Batteries-included managed implementation
- Built-in oauth.do authentication
- Zero-config type generation via cli.do
- Integration with the rpc.do managed service

## Features

- **WebSocket Hibernation** - Zero memory cost during idle with full RPC session resumption
- **HTTP Batch RPC** - Efficient batched HTTP requests via capnweb
- **MongoDB-style Collections** - Document store on DO SQLite with filters ($eq, $gt, $in, etc.)
- **Schema Introspection** - Automatic API discovery via `GET /__schema`
- **Location Awareness** - Built-in colo.do integration for geographic insights
- **Event Streaming** - Optional integration with @dotdo/events for CDC and analytics
- **Type-safe** - Full TypeScript support with typed clients

## Installation

```bash
pnpm add @dotdo/rpc
```

## Quick Start

```typescript
import { DurableRPC } from '@dotdo/rpc'

interface User {
  name: string
  email: string
  active: boolean
}

export class UserService extends DurableRPC {
  // Collections are MongoDB-style document stores
  users = this.collection<User>('users')

  // Define RPC methods directly on the class
  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }

  async getUser(id: string) {
    return this.users.get(id)
  }

  async getActiveUsers() {
    return this.users.find({ active: true })
  }

  // Use namespaces for grouping methods
  admin = {
    listAll: () => this.users.list(),
    delete: (id: string) => this.users.delete(id),
    count: () => this.users.count(),
  }
}
```

## Entry Points

The package provides multiple entry points for different use cases:

| Entry Point | Description | Bundle Impact |
|-------------|-------------|---------------|
| `@dotdo/rpc` | Full DurableRPC with collections, colo awareness | Largest - includes colo.do data |
| `@dotdo/rpc/lite` | Minimal DurableRPC (no colo, no collections) | Smallest - core RPC only |
| `@dotdo/rpc/collections` | MongoDB-style collections on SQLite | Medium - standalone usage |
| `@dotdo/rpc/do-collections` | Digital Object semantics | Medium - requires collections |
| `@dotdo/rpc/events` | Event/CDC integration | Medium - requires @dotdo/events |

### Decision Tree: Which Entry Point?

```
Building a Durable Object?
  |
  +-> Need collections + colo awareness + all features?
  |     -> Use `@dotdo/rpc` (full)
  |
  +-> Need smallest possible bundle?
  |     -> Use `@dotdo/rpc/lite`
  |     -> Add collections separately if needed
  |
  +-> Need standalone document store (no DO)?
  |     -> Use `@dotdo/rpc/collections`
  |
  +-> Need semantic data modeling (Nouns/Verbs/Things)?
  |     -> Use `@dotdo/rpc/do-collections`
  |
  +-> Need event streaming / CDC / analytics?
        -> Use `@dotdo/rpc/events`
```

### `@dotdo/rpc` (Full)

The complete package with all features: DurableRPC, collections, colo awareness, and schema introspection.

```typescript
import { DurableRPC, router, defineConfig } from '@dotdo/rpc'
```

### `@dotdo/rpc/lite` (Minimal)

Lightweight version without colo.do or collections. Use for smallest bundle size.

```typescript
import { DurableRPC } from '@dotdo/rpc/lite'

export class MyDO extends DurableRPC {
  echo(msg: string) { return msg }
}
```

### `@dotdo/rpc/collections`

Re-exports from @dotdo/collections for standalone use.

```typescript
import { createCollection, Collections, type Filter } from '@dotdo/rpc/collections'
```

### `@dotdo/rpc/do-collections`

Digital Object semantics with Nouns, Verbs, Things, and Actions.

```typescript
import { DOCollections } from '@dotdo/rpc/do-collections'

export class MyDO extends DurableRPC {
  db = new DOCollections(this.sql)

  async createUser(data: UserData) {
    return this.db.things.create('User', data)
  }

  async linkUserToOrg(userId: string, orgId: string) {
    return this.db.relate(userId, 'memberOf', orgId)
  }
}
```

### `@dotdo/rpc/events`

Optional integration with @dotdo/events for event streaming and CDC.

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

## Key Features

### WebSocket Hibernation

DurableRPC uses Cloudflare's WebSocket hibernation API to maintain RPC sessions with zero memory cost during idle periods. Sessions automatically resume when messages arrive.

```typescript
// Client connects via WebSocket
const ws = new WebSocket('wss://your-do.workers.dev/users/user123')

// DO hibernates between messages - no memory usage
// Messages wake the DO and resume the RPC session
```

The hibernation transport (`HibernatableWebSocketTransport`) handles:
- Message queuing between wakeups
- Session state recovery
- Automatic transport re-registration

### HTTP Batch RPC

For request-response patterns, HTTP batch RPC provides efficient execution:

```typescript
// POST to the DO with capnweb batch format
const response = await fetch('https://your-do.workers.dev/users/user123', {
  method: 'POST',
  body: JSON.stringify([
    { method: 'getUser', params: ['user456'] },
    { method: 'admin.count', params: [] }
  ])
})
```

### Schema Introspection

Every DurableRPC instance exposes its API schema at `GET /` or `GET /__schema`:

```typescript
// Discover methods, namespaces, and database schema
const schema = await fetch('https://your-do.workers.dev/users/user123')
  .then(r => r.json())

// {
//   version: 1,
//   methods: [{ name: 'createUser', path: 'createUser', params: 2 }],
//   namespaces: [{ name: 'admin', methods: [...] }],
//   database: { tables: [...] },
//   colo: 'SJC'
// }
```

Use with `npx rpc.do generate` for typed client codegen.

### Collections Integration

Built-in MongoDB-style collections on SQLite:

```typescript
export class MyDO extends DurableRPC {
  users = this.collection<User>('users')

  async example() {
    // CRUD operations
    this.users.put('id1', { name: 'Alice', age: 30 })
    const user = this.users.get('id1')
    this.users.delete('id1')

    // MongoDB-style filters
    const adults = this.users.find({ age: { $gte: 18 } })
    const admins = this.users.find({ role: { $in: ['admin', 'superadmin'] } })

    // Query options
    const recent = this.users.find({}, { limit: 10, sort: '-createdAt' })

    // Aggregates
    const count = this.users.count({ active: true })
    const keys = this.users.keys()
  }
}
```

Supported filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$regex`, `$and`, `$or`

### Direct Storage Access

Access SQLite and KV storage directly:

```typescript
export class MyDO extends DurableRPC {
  async example() {
    // SQLite via tagged template
    const users = this.sql`SELECT * FROM users WHERE active = 1`.toArray()

    // KV storage
    await this.storage.put('key', 'value')
    const value = await this.storage.get('key')
  }
}
```

## Worker Router

Route requests to Durable Objects with the built-in router:

```typescript
import { router } from '@dotdo/rpc'

interface Env {
  USER_DO: DurableObjectNamespace
  ROOM_DO: DurableObjectNamespace
}

export default router<Env>({
  bindings: {
    users: 'USER_DO',
    rooms: 'ROOM_DO',
  },
  auth: async (request, env) => {
    const token = request.headers.get('Authorization')
    // Validate token...
    return { authorized: true, id: userId }
  },
  resolveId: (request, namespace) => {
    // Custom ID resolution
    return request.headers.get('X-DO-Id') || 'default'
  }
})
```

URL format: `/{namespace}/{id}/{path}`

```bash
# Routes to USER_DO with id "user123"
curl https://your-worker.workers.dev/users/user123

# Schema discovery
curl https://your-worker.workers.dev/users/user123/__schema
```

## Colo Awareness

Built-in location awareness via colo.do:

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

## Events.do Integration

Optional integration with @dotdo/events for CDC and analytics:

```typescript
import { DurableRPC } from '@dotdo/rpc'
import { createEventEmitter, CDCCollection } from '@dotdo/rpc/events'

export class MyDO extends DurableRPC {
  events = createEventEmitter(this, { cdc: true })

  // CDCCollection automatically emits change events
  users = new CDCCollection(this.collection('users'), this.events, 'users')

  async processOrder(orderId: string) {
    // Custom events
    this.events.emit({ type: 'order.processed', orderId })
  }

  // Required: forward alarms to event emitter for retry logic
  async alarm() {
    await this.events.handleAlarm()
  }
}
```

## Configuration

Use `do.config.ts` for codegen configuration:

```typescript
import { defineConfig } from '@dotdo/rpc'

export default defineConfig({
  durableObjects: './src/do/*.ts',
  output: './generated/rpc',
  schemaUrl: 'https://your-worker.workers.dev',
})
```

## API Reference

### DurableRPC

Base class for RPC-enabled Durable Objects.

| Property/Method | Description |
|-----------------|-------------|
| `sql` | SQLite tagged template for queries |
| `storage` | Durable Object KV storage API |
| `state` | Durable Object state (ctx) |
| `colo` | IATA code of the colo running this DO |
| `coloInfo` | Full colo information (city, country, coordinates) |
| `collection(name)` | Get or create a named collection |
| `broadcast(msg)` | Send message to all connected WebSocket clients |
| `connectionCount` | Number of active WebSocket connections |
| `getSchema()` | Get the RPC schema for this DO |
| `findNearestColo(colos)` | Find nearest colo from a list |
| `estimateLatencyTo(colo)` | Estimate latency to a colo in ms |
| `distanceTo(colo)` | Distance to a colo in km |
| `getColosByDistance(colos?)` | Sort colos by distance from this DO |

### router(options)

Create a Worker that routes to Durable Objects.

| Option | Description |
|--------|-------------|
| `bindings` | Map of namespace to DO binding name |
| `auth` | Auth middleware function |
| `resolveId` | Custom ID resolver function |

### RpcSchema

Schema returned by `GET /__schema`.

```typescript
interface RpcSchema {
  version: 1
  methods: Array<{ name: string; path: string; params: number }>
  namespaces: Array<{ name: string; methods: [...] }>
  database?: { tables: [...] }
  colo?: string
}
```

### Collection<T>

MongoDB-style document collection.

| Method | Description |
|--------|-------------|
| `get(id)` | Get document by ID |
| `put(id, doc)` | Insert or update document |
| `delete(id)` | Delete document |
| `has(id)` | Check if document exists |
| `find(filter?, options?)` | Query with MongoDB filters |
| `count(filter?)` | Count matching documents |
| `list(options?)` | List all documents |
| `keys()` | Get all document IDs |
| `clear()` | Delete all documents |

### DOCollections

Digital Object semantics layer.

| Property | Description |
|----------|-------------|
| `nouns` | Type definitions (define, get, list, has) |
| `verbs` | Action/relationship definitions |
| `things` | Entity instances (create, get, update, delete, find, count) |
| `actions` | Event log (log, get, find, forThing, count) |
| `relate(from, verb, to)` | Create a relationship |
| `fuzzyRelate(...)` | Semantic relationship (~> operator) |
| `traverse(from, verb)` | Follow relationships |
| `stats()` | Collection statistics |

## Entry Points Reference

### `@dotdo/rpc` - Full Package

**Exports**: `DurableRPC`, `router`, `defineConfig`, `RpcTarget`, `RpcSession`, `HibernatableWebSocketTransport`, `TransportRegistry`, `getColo`, `coloDistance`, `estimateLatency`, `nearestColo`, `sortByDistance`, `getAllColos`, `createCollection`, `Collections`, plus all types.

**Use When**: You need a production-ready DO with all features including colo awareness, collections, schema introspection, and worker routing.

### `@dotdo/rpc/lite` - Minimal Package

**Exports**: `DurableRPC`, `RpcTarget`, `RpcSession`, `HibernatableWebSocketTransport`, `TransportRegistry`

**Use When**: Bundle size is critical and you only need basic RPC. Add collections separately if needed.

**What's NOT included**:
- `this.collection()` helper (use `@dotdo/rpc/collections` directly)
- `this.colo`, `this.coloInfo`, colo methods (use `colo.do` directly)
- `router()` helper (implement your own routing)

### `@dotdo/rpc/collections` - Standalone Collections

**Exports**: Everything from `@dotdo/collections` - `createCollection`, `Collections`, `Collection`, `Filter`, `FilterOperator`, `QueryOptions`

**Use When**: You need MongoDB-style document storage on SQLite without the full DurableRPC base class.

```typescript
import { createCollection } from '@dotdo/rpc/collections'

const users = createCollection<User>(sql, 'users')
users.put('id', { name: 'Alice' })
const results = users.find({ active: true })
```

### `@dotdo/rpc/do-collections` - Semantic Data Layer

**Exports**: `DOCollections`, `Thing`, `Action`, `Noun`, `Verb`, `Relationship`, `CascadeOperator`, `SemanticMatcher`, `SemanticMatch`

**Use When**: You need higher-level semantic modeling with typed entities, relationships, and audit trails.

**Key Concepts**:
- **Nouns**: Define entity types (User, Organization)
- **Verbs**: Define relationship/action types (memberOf, created)
- **Things**: Entity instances with `$id`, `$type`, `$version`
- **Actions**: Event/audit log entries
- **Relationships**: Graph edges with cascade operators (`->`, `~>`, `<-`, `<~`)

### `@dotdo/rpc/events` - Event Streaming

**Exports**: `createEventEmitter`, `CDCCollection`, `EventEmitter`, event types (`DurableEvent`, `CollectionChangeEvent`, etc.)

**Requirements**: `@dotdo/events` must be installed as peer dependency.

**Use When**: You need CDC (Change Data Capture), event streaming, or analytics integration.

```typescript
import { createEventEmitter, CDCCollection } from '@dotdo/rpc/events'

events = createEventEmitter(this, { cdc: true })
users = new CDCCollection(this.collection('users'), this.events, 'users')
// Changes auto-emit to events.do
```

## Related Packages

| Package | Description |
|---------|-------------|
| [`rpc.do`](../README.md) | Managed client implementation with platform integrations |
| [`@dotdo/collections`](https://github.com/dot-do/collections) | Core collections library |
| [`@dotdo/events`](https://github.com/dot-do/events) | Event streaming and CDC |
| [`@dotdo/capnweb`](https://github.com/dot-do/capnweb) | Capnproto-style RPC protocol |
| [`colo.do`](https://github.com/dot-do/colo.do) | Cloudflare colo location data |
| [`@dotdo/types`](https://github.com/dot-do/types) | Core platform type definitions |

## License

MIT
