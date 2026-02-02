# rpc.do

Lightweight, transport-agnostic RPC for JavaScript/TypeScript.

[![npm](https://img.shields.io/npm/v/rpc.do)](https://npmjs.com/package/rpc.do)
![CI](https://github.com/dot-do/rpc.do/actions/workflows/ci.yml/badge.svg)

## Install

```bash
npm install rpc.do
```

## Quick Start

### Client

```typescript
import { RPC, http } from 'rpc.do'

const rpc = RPC(http('https://your-api.com/rpc'))

// Call remote methods like local functions
const user = await rpc.users.getById({ id: '123' })
const result = await rpc.math.add({ a: 5, b: 3 })
```

### Server (Cloudflare Worker)

```typescript
import { createRpcHandler, noAuth } from 'rpc.do/server'

const methods = {
  users: {
    getById: async ({ id }) => ({ id, name: 'Alice' })
  },
  math: {
    add: async ({ a, b }) => ({ result: a + b })
  }
}

export default {
  fetch: createRpcHandler({
    auth: noAuth(),
    dispatch: async (method, args) => {
      const [ns, fn] = method.split('.')
      return methods[ns][fn](args[0])
    }
  })
}
```

### With Types

```typescript
interface API {
  users: { getById: (args: { id: string }) => { id: string; name: string } }
  math: { add: (args: { a: number; b: number }) => { result: number } }
}

const rpc = RPC<API>(http('https://your-api.com/rpc'))

// Full autocomplete and type checking
const user = await rpc.users.getById({ id: '123' })
```

## Features

- **Proxy-based API** - Call remote methods with natural JavaScript syntax
- **Transport agnostic** - HTTP, WebSocket, Cloudflare Service Bindings, capnweb
- **Type safe** - Full TypeScript support with inference
- **Lightweight** - ~3KB core, no build step required
- **Cloudflare Workers** - First-class support with service bindings
- **Authentication** - Built-in oauth.do integration
- **Error handling** - Typed error classes with retry support

## Transports

```typescript
import { RPC, http, ws, binding, composite } from 'rpc.do'

// HTTP
const rpc = RPC(http('https://api.example.com'))

// WebSocket
const rpc = RPC(ws('wss://api.example.com'))

// Cloudflare Service Binding
const rpc = RPC(binding(env.MY_SERVICE))

// Fallback chain
const rpc = RPC(composite(ws('wss://...'), http('https://...')))
```

## Authentication

```typescript
// With token
const rpc = RPC(http('https://api.example.com', 'your-token'))

// With oauth.do
import { oauthProvider } from 'rpc.do/auth'
const rpc = RPC(http('https://api.example.com', oauthProvider()))
```

## Error Handling

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

try {
  await rpc.users.get({ id: '123' })
} catch (error) {
  if (error instanceof ConnectionError && error.retryable) {
    // Retry the operation
  }
}
```

## Documentation

- [Getting Started Guide](docs/GETTING_STARTED.md) - Step-by-step tutorial
- [API Reference](docs/API_REFERENCE.md) - Complete API documentation
- [Architecture](docs/ARCHITECTURE.md) - Technical design and internals
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

### Migration Guides

- [Migrating from tRPC](docs/MIGRATING_FROM_TRPC.md)
- [Migrating from gRPC](docs/MIGRATING_FROM_GRPC.md)

### Framework Integration

- [React Integration](docs/REACT_INTEGRATION.md)

## Related Packages

| Package | Description |
|---------|-------------|
| [`@dotdo/rpc`](./core/README.md) | Abstract Durable Object server library |
| [`@dotdo/types`](https://npmjs.com/package/@dotdo/types) | Core platform type definitions |
| [`oauth.do`](https://oauth.do) | OAuth authentication |

## License

MIT
