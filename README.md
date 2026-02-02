# rpc.do

Access your Durable Object's SQL, storage, and collections remotely -- same API locally and over the network.

[![npm](https://img.shields.io/npm/v/rpc.do)](https://npmjs.com/package/rpc.do)
![CI](https://github.com/dot-do/rpc.do/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/dot-do/rpc.do/branch/main/graph/badge.svg)](https://codecov.io/gh/dot-do/rpc.do)

```bash
npm install rpc.do
```

## The Idea

Inside a Durable Object you write `this.sql`, `this.storage`, `this.collection('users')`. With rpc.do, the exact same API works remotely:

```typescript
import { RPC } from 'rpc.do'

const $ = RPC('https://my-do.workers.dev')

// SQL -- tagged templates with automatic parameterization
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
const user  = await $.sql`SELECT * FROM users WHERE id = ${id}`.first()
await $.sql`UPDATE users SET name = ${name} WHERE id = ${id}`.run()

// Storage -- key-value, same as this.storage inside the DO
const config = await $.storage.get('config')
await $.storage.put('config', { theme: 'dark' })

// Collections -- MongoDB-style queries on DO SQLite
const admins = await $.collection('users').find({ role: 'admin', active: true })
await $.collection('users').put('user-123', { name: 'Alice', role: 'admin' })

// Custom RPC methods -- whatever you define on your DO class
const result = await $.users.create({ name: 'Alice', email: 'alice@co.com' })
```

No code generation. No schema files. The proxy accumulates property paths at runtime and the server dispatches them to your Durable Object.

## Why rpc.do?

rpc.do is not another REST/GraphQL/tRPC alternative. It is purpose-built for Cloudflare Durable Objects.

- **Same API locally and remotely** -- `$.sql`, `$.storage`, `$.collection` mirror the DO's internal APIs so your mental model stays the same whether you are inside the DO or calling from a Worker, browser, or CLI.
- **Purpose-built for Durable Objects** -- First-class access to DO SQLite, KV storage, collections, schema introspection, and WebSocket hibernation. Not a generic RPC bolted onto DOs.
- **Built on capnweb** -- Promise pipelining, pass-by-reference, and batched calls over HTTP or WebSocket. Multiple calls in a single round trip.
- **Zero-config type generation** -- Point `npx rpc.do generate` at your DO source and get a fully typed client. No schema language to learn.
- **Lightweight** -- ~3KB core. Proxy-based, no build step, no runtime dependencies beyond your transport.

## Packages

The system is split into two packages with distinct roles:

| Package | Role | Install |
|---------|------|---------|
| [`@dotdo/rpc`](./core/README.md) | **Server** -- Extend your Durable Object with RPC, SQL, collections, events, and WebSocket hibernation | `npm i @dotdo/rpc` |
| [`rpc.do`](https://npmjs.com/package/rpc.do) | **Client** -- Connect to any `@dotdo/rpc`-powered DO from a Worker, browser, Node, or CLI | `npm i rpc.do` |

### Server: `@dotdo/rpc`

Define your Durable Object by extending `DurableRPC`. Every public method and namespace becomes callable over RPC, and the built-in SQL, storage, and collections are automatically exposed:

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
    count:   () => this.users.count(),
  }
}
```

### Client: `rpc.do`

Connect from anywhere. The client auto-selects transport from the URL scheme:

```typescript
import { RPC } from 'rpc.do'

// HTTP (https://)
const $ = RPC('https://my-do.workers.dev')

// WebSocket (wss://) -- real-time, hibernation-aware
const $ = RPC('wss://my-do.workers.dev')

// Typed client
const $ = RPC<UserServiceAPI>('https://my-do.workers.dev')
const user = await $.getActiveUsers()  // fully typed
```

## How to Connect

rpc.do supports multiple transports. The URL-based `RPC(url)` API handles the common cases automatically. For advanced scenarios, use explicit transports:

```typescript
import { RPC, http, capnweb, binding, composite } from 'rpc.do'

// HTTP -- request/response, serverless-friendly
const $ = RPC(http('https://my-do.workers.dev'))

// capnweb WebSocket -- real-time, pipelining, bidirectional
const $ = RPC(capnweb('wss://my-do.workers.dev'))

// Cloudflare Service Binding -- zero-latency worker-to-DO
const $ = RPC(binding(env.MY_DO))

// Fallback chain -- try WebSocket, fall back to HTTP
const $ = RPC(composite(
  capnweb('wss://my-do.workers.dev'),
  http('https://my-do.workers.dev')
))
```

### Authentication

```typescript
// Bearer token
const $ = RPC('https://my-do.workers.dev', { auth: 'sk_live_xxx' })

// oauth.do integration
import { oauthProvider } from 'rpc.do/auth'
const $ = RPC('https://my-do.workers.dev', { auth: oauthProvider() })
```

### Error Handling

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

try {
  await $.users.get({ id: '123' })
} catch (error) {
  if (error instanceof ConnectionError && error.retryable) {
    // Retry the operation
  }
}
```

## Documentation

- [Getting Started Guide](docs/GETTING_STARTED.md) -- Step-by-step tutorial
- [API Reference](docs/API_REFERENCE.md) -- Complete API documentation
- [Architecture](docs/ARCHITECTURE.md) -- Technical design and internals
- [Troubleshooting](docs/TROUBLESHOOTING.md) -- Common issues and solutions
- [Performance Benchmarks](BENCHMARKS.md) -- Latency, throughput, and bundle size analysis
- [rpc.do vs Alternatives](docs/COMPARISON.md) -- Decision guide for choosing RPC tools
- [Migrating from tRPC](docs/MIGRATING_FROM_TRPC.md)
- [Migrating from gRPC](docs/MIGRATING_FROM_GRPC.md)
- [React Integration](docs/REACT_INTEGRATION.md)

## License

MIT
