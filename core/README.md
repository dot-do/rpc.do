# @dotdo/rpc

Durable Object RPC server with capnweb, WebSocket hibernation, and MongoDB-style collections.

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

## License

MIT
