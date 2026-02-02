# CapnWeb Design in rpc.do

This document explains how rpc.do implements capnweb principles to provide efficient, capability-oriented RPC over Cloudflare Durable Objects.

---

## Table of Contents

1. [Introduction to CapnWeb Principles](#introduction-to-capnweb-principles)
2. [Promise Pipelining in rpc.do](#promise-pipelining-in-rpcdo)
3. [Batching Protocol Walkthrough](#batching-protocol-walkthrough)
4. [Pass-by-Reference Patterns](#pass-by-reference-patterns)
5. [Why CapnWeb Over Plain JSON-RPC](#why-capnweb-over-plain-json-rpc)
6. [Architectural Decision Records](#architectural-decision-records)

---

## Introduction to CapnWeb Principles

CapnWeb is a capability-based RPC protocol inspired by Cap'n Proto, designed for web environments. It brings several key concepts to the browser and edge computing:

### Core Concepts

1. **Promise Pipelining**: Chain method calls on promises without waiting for resolution. Multiple calls collapse into a single round trip.

2. **Pass-by-Reference**: Complex objects (like database handles or collections) remain on the server, with the client holding a lightweight reference.

3. **Capability Security**: Access control through references rather than ACL checks on every call.

4. **Batching**: Multiple RPC calls are automatically batched into single network requests.

### How rpc.do Uses CapnWeb

```
+------------------+     +-------------------+     +------------------+
|   rpc.do Client  |     |  capnweb Protocol |     |  @dotdo/rpc      |
|   (Proxy-based)  | --> |  (HTTP or WS)     | --> |  (DurableRPC)    |
+------------------+     +-------------------+     +------------------+
         |                        |                         |
         v                        v                         v
   Method chaining           Batched JSON            RpcTarget dispatch
   $.users.get()             over WebSocket          to DO methods
```

The `@dotdo/capnweb` library provides:
- `newHttpBatchRpcSession()` - HTTP transport with request batching
- `newWebSocketRpcSession()` - WebSocket transport with bidirectional RPC
- `RpcSession` - Session management for custom transports
- `RpcTarget` - Server-side class for exposing methods

---

## Promise Pipelining in rpc.do

Promise pipelining allows you to chain method calls on not-yet-resolved promises, avoiding sequential round trips.

### The Problem Without Pipelining

```typescript
// Traditional approach: 3 sequential round trips
const user = await db.users.get('123')          // Round trip 1
const posts = await user.posts.list()           // Round trip 2
const comments = await posts[0].comments.list() // Round trip 3
```

### With CapnWeb Pipelining

```typescript
// With pipelining: 1 round trip
const comments = await db.users.get('123').posts.list()[0].comments.list()
```

### How It Works in rpc.do

The Proxy-based architecture accumulates method paths until invocation:

```typescript
// src/do-client.ts - Method Proxy Creation
const createMethodProxy = (path: string[]): MethodProxy => {
  return new Proxy(() => {}, {
    get(_, prop: string) {
      // Reject thenable access to prevent premature resolution
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }
      // Accumulate the path segment
      return createMethodProxy([...path, prop])
    },
    apply(_, __, args: unknown[]) {
      // On function call, invoke transport with full path
      return (async () => {
        const t = await getTransport()
        return t.call(path.join('.'), args)
      })()
    },
  })
}
```

### Path Accumulation Flow

```
$.users.profiles.getById('123')

Step 1: $.users
        path = ['users']
        Returns new proxy

Step 2: $.users.profiles
        path = ['users', 'profiles']
        Returns new proxy

Step 3: $.users.profiles.getById
        path = ['users', 'profiles', 'getById']
        Returns new proxy

Step 4: $.users.profiles.getById('123')
        Invokes: transport.call('users.profiles.getById', ['123'])
```

### RpcPromise Types

rpc.do exports enhanced promise types for pipelining:

```typescript
import type { RpcPromise, RpcPipelined, RpcArrayMethods } from 'rpc.do'

// RpcPromise<T> extends Promise<T> with pipelining support
type UserPromise = RpcPromise<User>

// Can chain methods before resolution
const email = await userPromise.email  // Pipelined access
```

---

## Batching Protocol Walkthrough

rpc.do supports two batching approaches: capnweb's native batching and middleware-based batching.

### CapnWeb HTTP Batch Protocol

The `http()` transport uses `newHttpBatchRpcSession()` from capnweb:

```typescript
// src/transports.ts
export function http(url: string, options?: HttpTransportOptions): Transport {
  let sessionPromise: Promise<unknown> | null = null

  async function getSession(): Promise<unknown> {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const capnwebModule = await loadCapnweb()
        return capnwebModule.newHttpBatchRpcSession(url)
      })()
    }
    return sessionPromise
  }

  return {
    async call(method: string, args: unknown[]) {
      const session = await getSession()
      const target = navigateMethodPath(session, method)
      if (!isFunction(target)) {
        throw new RPCError(`Method not found: ${method}`, 'METHOD_NOT_FOUND')
      }
      return await target(...args)
    }
  }
}
```

### Batching Middleware

For explicit control, use the batching middleware:

```typescript
// src/middleware/batching.ts
import { withBatching } from 'rpc.do/middleware'

const transport = withBatching(http('https://api.example.com'), {
  windowMs: 10,      // Collect requests for 10ms
  maxBatchSize: 50   // Send batch when 50 requests accumulate
})

const $ = RPC(transport)

// These concurrent calls get batched into a single HTTP request
const [users, posts, comments] = await Promise.all([
  $.users.list(),
  $.posts.recent(),
  $.comments.count()
])
```

### Batch Request Format

```typescript
interface BatchedRequest {
  id: number      // Unique ID for matching response
  method: string  // RPC method path (e.g., "users.list")
  args: unknown[] // Method arguments
}

interface BatchedResponse {
  id: number           // Matches request ID
  result?: unknown     // Success result
  error?: {            // Error details
    message: string
    code?: string | number
    data?: unknown
  }
}
```

### Batch Flow Diagram

```
                        10ms window
Time ──────────────────────────────────────────────────────────────>
     |                                |
     | $.users.list()     req#1       |
     | $.posts.recent()   req#2       |
     | $.comments.count() req#3       |
     |                                |
     |      Requests accumulate       |  Batch sent
     |<------------------------------>|
                                      v
                              Single HTTP POST
                              [{id:1, method:'users.list', args:[]},
                               {id:2, method:'posts.recent', args:[]},
                               {id:3, method:'comments.count', args:[]}]
                                      |
                                      v
                              Single HTTP Response
                              [{id:1, result:[...]},
                               {id:2, result:[...]},
                               {id:3, result:42}]
                                      |
                                      v
                              Demultiplex responses
                              Resolve individual promises
```

---

## Pass-by-Reference Patterns

Pass-by-reference keeps complex objects on the server while clients hold lightweight references. In rpc.do, this manifests in `$.sql`, `$.storage`, and `$.collection`.

### SQL Pass-by-Reference

```typescript
// Client code - no actual SQL connection crosses the network
const $ = RPC('https://my-do.workers.dev')

// $.sql is a reference to the DO's SQLite database
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
```

Behind the scenes:

```typescript
// src/do-client.ts - SQL query builder
function createSqlQuery<T>(
  transport: Transport,
  strings: TemplateStringsArray,
  values: unknown[]
): SqlQuery<T> {
  // Serialize the query template + values
  const serialized = {
    strings: Array.from(strings),
    values,
  }

  return {
    async all(): Promise<T[]> {
      // Send serialized query to server's internal __sql method
      const result = await transport.call(INTERNAL_METHODS.SQL, [serialized])
      return result.results
    },
    async first(): Promise<T | null> {
      return transport.call(INTERNAL_METHODS.SQL_FIRST, [serialized])
    },
    async run(): Promise<{ rowsWritten: number }> {
      return transport.call(INTERNAL_METHODS.SQL_RUN, [serialized])
    }
  }
}
```

### Storage Pass-by-Reference

```typescript
// Client code - $.storage is a reference to DO's KV storage
const config = await $.storage.get('config')
await $.storage.put('config', { theme: 'dark' })

// Batch operations
const values = await $.storage.get(['key1', 'key2'])  // Returns Map
await $.storage.put({ key1: 'val1', key2: 'val2' })   // Batch put
```

Implementation:

```typescript
// src/do-client.ts - Storage proxy
function createStorageProxy(transport: Transport): RemoteStorage {
  return {
    async get<T>(keyOrKeys: string | string[]) {
      if (Array.isArray(keyOrKeys)) {
        const result = await transport.call(
          INTERNAL_METHODS.STORAGE_GET_MULTIPLE, [keyOrKeys]
        )
        return new Map(Object.entries(result))
      }
      return transport.call(INTERNAL_METHODS.STORAGE_GET, [keyOrKeys])
    },
    // ... put, delete, list, keys
  }
}
```

### Collection Pass-by-Reference

Collections provide MongoDB-style document operations on DO SQLite:

```typescript
// Client code - $.collection('users') is a reference
const users = $.collection<User>('users')

// All operations go through the reference
await users.put('user-123', { name: 'Alice', role: 'admin' })
const admins = await users.find({ role: 'admin', active: true })
const count = await users.count({ active: true })
```

Implementation:

```typescript
// src/do-client.ts - Collection proxy
function createCollectionProxy<T>(
  transport: Transport,
  name: string
): RemoteCollection<T> {
  return {
    async get(id: string): Promise<T | null> {
      return transport.call(INTERNAL_METHODS.COLLECTION_GET, [name, id])
    },
    async put(id: string, doc: T): Promise<void> {
      await transport.call(INTERNAL_METHODS.COLLECTION_PUT, [name, id, doc])
    },
    async find(filter?: Filter<T>, options?: QueryOptions): Promise<T[]> {
      return transport.call(INTERNAL_METHODS.COLLECTION_FIND, [name, filter, options])
    },
    // ... delete, has, count, list, keys, clear
  }
}
```

### Internal Method Protocol

All pass-by-reference features use internal method names:

```typescript
// src/constants.ts
export const INTERNAL_METHODS = {
  // SQL methods
  SQL: '__sql',
  SQL_FIRST: '__sqlFirst',
  SQL_RUN: '__sqlRun',

  // Storage methods
  STORAGE_GET: '__storageGet',
  STORAGE_GET_MULTIPLE: '__storageGetMultiple',
  STORAGE_PUT: '__storagePut',
  // ...

  // Collection methods
  COLLECTION_GET: '__collectionGet',
  COLLECTION_PUT: '__collectionPut',
  COLLECTION_FIND: '__collectionFind',
  // ...
}
```

### Pass-by-Reference Diagram

```
+------------------+                              +-------------------+
|   Client Code    |                              |   Durable Object  |
+------------------+                              +-------------------+
        |                                                  |
        |  $.sql`SELECT * FROM users`                      |
        |  ------------------------------------------>     |
        |  { strings: ['SELECT...'], values: [] }          |
        |                                                  |
        |                                    this.sql.exec()
        |                                    (SQLite)      |
        |  <------------------------------------------     |
        |  { results: [...], meta: {...} }                 |
        |                                                  |
        |  $.storage.get('config')                         |
        |  ------------------------------------------>     |
        |  ['config']                                      |
        |                                                  |
        |                               this.storage.get()
        |                               (KV Storage)       |
        |  <------------------------------------------     |
        |  { theme: 'dark' }                               |
        |                                                  |
        |  $.collection('users').find({ active: true })    |
        |  ------------------------------------------>     |
        |  ['users', { active: true }, {}]                 |
        |                                                  |
        |                      SQLite query on collection
        |                      SELECT * FROM _col_users... |
        |  <------------------------------------------     |
        |  [{ id: '123', name: 'Alice', ... }, ...]        |
        +                                                  +
```

---

## Why CapnWeb Over Plain JSON-RPC

### Performance Comparison

| Feature | JSON-RPC | CapnWeb |
|---------|----------|---------|
| Pipelining | No | Yes |
| Automatic batching | Manual | Built-in |
| Pass-by-reference | No | Yes |
| Bidirectional | Polling | WebSocket |
| Round trips for chained calls | N | 1 |

### Concrete Example

Fetching a user's active posts with their comment counts:

**Plain JSON-RPC (4 round trips):**
```typescript
const user = await rpc.call('users.get', ['123'])
const posts = await rpc.call('posts.list', [user.id, { active: true }])
const counts = await Promise.all(
  posts.map(p => rpc.call('comments.count', [p.id]))
)
// Minimum 3 sequential round trips (user, posts, then parallel comments)
```

**With CapnWeb (1 round trip):**
```typescript
const result = await $.users.get('123').posts.list({ active: true })
// Pipelining + batching = single round trip
```

### Memory Efficiency

Pass-by-reference keeps large objects on the server:

```typescript
// BAD: Transfer entire database cursor
const allUsers = await $.getAllUsers()  // 100MB JSON response

// GOOD: Keep cursor on server, paginate
const cursor = $.users.cursor({ limit: 100 })
while (await cursor.hasMore()) {
  const batch = await cursor.next()  // Only transfers 100 at a time
}
```

### WebSocket Benefits

```typescript
const $ = RPC('wss://my-do.workers.dev', {
  reconnect: true,
  auth: oauthProvider()
})

// Hibernation-aware: connection survives DO hibernation
// Bidirectional: server can push to client
// Automatic reconnect: resilient to network issues
```

---

## Architectural Decision Records

### ADR-001: Proxy-Based Dispatch vs Explicit Routers

**Context:**
Traditional RPC frameworks (tRPC, gRPC) use explicit router definitions with code generation or schema files.

**Decision:**
Use JavaScript Proxy for dynamic method accumulation at runtime.

**Rationale:**

1. **Zero Configuration**: No schema files, no codegen step, no build process.

```typescript
// tRPC: requires router definition
const appRouter = router({
  users: router({
    get: procedure.input(z.string()).query(...)
  })
})

// rpc.do: just call methods
const $ = RPC('https://example.com')
await $.users.get('123')
```

2. **Natural JavaScript**: Method calls look like local function calls.

3. **Full TypeScript Support**: Generics provide type safety without codegen.

```typescript
interface MyAPI {
  users: { get: (id: string) => User }
}
const $ = RPC<MyAPI>('https://example.com')
const user = await $.users.get('123')  // Fully typed
```

4. **Dynamic Paths**: Supports arbitrary nesting without schema changes.

```typescript
await $.deep.nested.namespace.method()  // Works without schema update
```

**Tradeoffs:**
- No compile-time schema validation (runtime errors instead)
- Requires TypeScript for type safety (no schema file to share)

### ADR-002: First-Message Auth vs URL Parameters

**Context:**
Authentication tokens need to be sent with WebSocket connections.

**Decision:**
Send auth token as the first message after connection, not in the URL.

**Rationale:**

1. **Security**: URL parameters are logged by proxies, load balancers, and servers.

```
// BAD: Token in URL (logged everywhere)
wss://api.example.com/rpc?token=sk_live_xxx

// GOOD: Token in first message (encrypted in TLS)
{
  "type": "auth",
  "token": "sk_live_xxx"
}
```

2. **Browser History**: URLs with tokens can appear in history and referrer headers.

3. **Log Sanitization**: Servers often log URLs; sanitizing auth from first message is simpler.

**Implementation:**

```typescript
// src/transports/reconnecting-ws.ts
private async sendAuth(): Promise<void> {
  if (!this.options.auth) return

  const token = await this.options.auth()
  if (!token) return

  // Security: block auth over insecure connections
  if (!this.options.allowInsecureAuth && this.url.startsWith('ws://')) {
    throw ConnectionError.insecureConnection()
  }

  // Send auth as first message
  this.ws?.send(JSON.stringify({
    type: 'auth',
    token,
  }))
}
```

**Tradeoffs:**
- Requires TLS (WSS) in production
- First message must be auth (protocol coordination with server)

### ADR-003: Separate Client/Server Packages

**Context:**
The system needs both client-side (browser, Node) and server-side (Cloudflare Workers) code.

**Decision:**
Split into `rpc.do` (client) and `@dotdo/rpc` (server) packages.

**Rationale:**

1. **Bundle Size**: Clients don't need server code (and vice versa).

```
rpc.do (client)          @dotdo/rpc (server)
~3KB gzipped             Includes DurableRPC,
                         capnweb/server,
                         cloudflare:workers
```

2. **Platform Dependencies**: Server needs Cloudflare Workers APIs.

```typescript
// Server only - uses cloudflare:workers
import { DurableObject } from 'cloudflare:workers'

// Client only - works in browser
import { RPC } from 'rpc.do'
```

3. **Tree Shaking**: Bundlers can eliminate unused code more effectively.

4. **Independent Versioning**: Client and server can evolve independently.

**Package Structure:**

```
+------------------+     +------------------+     +------------------+
|   @dotdo/types   |     |   @dotdo/rpc     |     |     rpc.do       |
|  Core type defs  | <-- |  Server library  | <-- | Client library   |
+------------------+     +------------------+     +------------------+
        |                        |                        |
        v                        v                        v
   Shared types             DurableRPC              RPC proxy
   (RpcPromise, etc)        DurableRPC/lite         Transports
                            capnweb integration     DO client
```

**Tradeoffs:**
- Shared constants duplicated (src/constants.ts in both packages)
- Type-only imports span packages (@dotdo/types)

### ADR-004: CapnWeb as Transport Layer

**Context:**
Need efficient RPC over HTTP and WebSocket with support for Durable Object hibernation.

**Decision:**
Use `@dotdo/capnweb` as the underlying protocol library.

**Rationale:**

1. **Hibernation Support**: CapnWeb's `HibernatableWebSocketTransport` works with CF's hibernation API.

2. **Promise Pipelining**: Built-in support for chaining calls on unresolved promises.

3. **Batching**: Automatic request batching reduces round trips.

4. **Bidirectional RPC**: WebSocket transport supports server-to-client calls.

**Implementation:**

```typescript
// Dynamic import prevents bundling when not used
const capnwebModule = await loadCapnweb()

// HTTP batch session
const session = capnwebModule.newHttpBatchRpcSession(url)

// WebSocket session with reconnection
const transport = new ReconnectingWebSocketTransport(url, options)
const session = new capnwebModule.RpcSession(transport, localMain)
const api = session.getRemoteMain()
```

**Tradeoffs:**
- External dependency (@dotdo/capnweb)
- Protocol complexity abstracted away (debugging can be harder)
- Dynamic import required for tree-shaking

---

## Summary

rpc.do implements capnweb principles to provide:

1. **Promise Pipelining**: Chain method calls without waiting for resolution.
2. **Automatic Batching**: Multiple calls collapse into single network requests.
3. **Pass-by-Reference**: Server objects (sql, storage, collections) accessed via lightweight client proxies.
4. **Capability Security**: Access through references, not per-call ACL checks.

The Proxy-based architecture enables natural JavaScript syntax while the capnweb protocol handles efficient network communication over HTTP or WebSocket.

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main RPC factory, proxy creation |
| `src/transports.ts` | HTTP, WebSocket, binding transports |
| `src/do-client.ts` | Pass-by-reference: sql, storage, collection |
| `src/transports/reconnecting-ws.ts` | Resilient WebSocket with first-message auth |
| `src/middleware/batching.ts` | Explicit batching middleware |
| `src/capnweb-loader.ts` | Dynamic capnweb module loading |
| `src/constants.ts` | Internal method names for pass-by-reference |
