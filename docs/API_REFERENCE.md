# API Reference

Complete reference documentation for rpc.do.

---

## Entry Points

| Entry Point | Description | Use Case |
|-------------|-------------|----------|
| `rpc.do` | Client RPC proxy + type utilities | Creating RPC clients in browser/Node.js |
| `rpc.do/server` | Server utilities (`createTarget`, `createHandler`) | Exposing any SDK/object as RPC endpoint |
| `rpc.do/expose` | `WorkerEntrypoint` wrapper | Exposing SDKs via Cloudflare service bindings |
| `rpc.do/transports` | Transport implementations | Advanced transport configuration |
| `rpc.do/auth` | oauth.do integration | Authentication providers |
| `rpc.do/errors` | Error classes | Type-safe error handling |

### Decision Tree: Which Entry Point?

```
Need to call remote RPC methods?
  -> Use `rpc.do` (default export)

Need to expose an SDK as an RPC endpoint?
  -> Via HTTP/WebSocket: Use `rpc.do/server`
  -> Via service binding: Use `rpc.do/expose`

Need oauth.do authentication?
  -> Use `rpc.do/auth`

Need custom transport behavior?
  -> Use `rpc.do/transports`

Need to handle RPC errors?
  -> Use `rpc.do/errors`
```

---

## `rpc.do` - Client Proxy (Default)

The main entry point for creating RPC clients.

```typescript
import $, { RPC, RPCProxy, RPCResult, RPCInput } from 'rpc.do'

// Pre-configured anonymous client
await $.ai.generate({ prompt: 'hello' })

// Custom client with URL
const rpc = RPC('https://my-do.workers.dev')

// Typed client
const typed = RPC<API>('https://api.example.com')
```

**Exports**: `$`, `RPC`, `createRPCClient`, `createDOClient`, `connectDO`, type utilities, transport functions (`http`, `capnweb`, `binding`, `composite`)

---

## `rpc.do/server` - Server Utilities

Wrap any object/SDK as a capnweb RpcTarget.

```typescript
import { createTarget, createHandler, RpcTarget } from 'rpc.do/server'

// Wrap SDK and create fetch handler
const target = createTarget(esbuild)
export default { fetch: createHandler(target) }
```

**Exports**: `createTarget`, `createHandler`, `RpcTarget`, `RpcSession`, `newWorkersRpcResponse`, `newHttpBatchRpcResponse`, `HibernatableWebSocketTransport`, `serialize`, `deserialize`

---

## `rpc.do/expose` - WorkerEntrypoint Wrapper

Expose SDKs via Cloudflare service bindings with capnweb pipelining.

```typescript
import { expose } from 'rpc.do/expose'

// Single SDK
export default expose((env) => new Cloudflare({ apiToken: env.CF_TOKEN }))

// Multiple SDKs
export default expose({
  sdks: {
    cf: (env) => new Cloudflare({ apiToken: env.CF_TOKEN }),
    gh: (env) => new Octokit({ auth: env.GH_TOKEN }),
  }
})
```

**Exports**: `expose`

---

## `rpc.do/transports` - Transport Implementations

Advanced transport configuration.

```typescript
import {
  http, capnweb, binding, composite,
  ReconnectingWebSocketTransport
} from 'rpc.do/transports'

// HTTP with timeout
const transport = http('https://api.example.com', { timeout: 30000 })

// WebSocket with reconnection
const wsTransport = capnweb('wss://api.example.com', {
  reconnect: true,
  reconnectOptions: { onConnect: () => console.log('Connected') }
})
```

**Exports**: `http`, `capnweb`, `binding`, `composite`, `ReconnectingWebSocketTransport`, `reconnectingWs`, `createRpcSession`

---

## `rpc.do/auth` - Authentication

Integration with oauth.do and flexible auth providers.

```typescript
import { auth, oauthProvider, cachedAuth, staticAuth, compositeAuth } from 'rpc.do/auth'

// Basic auth (globals + env + oauth.do)
const rpc = RPC(http('https://api.example.com', auth()))

// oauth.do with caching
const rpc = RPC(http('https://api.example.com', oauthProvider({ ttl: 60000 })))
```

**Exports**: `auth`, `oauthProvider`, `cachedAuth`, `staticAuth`, `compositeAuth`, `getToken`

---

## `rpc.do/errors` - Error Classes

Typed error classes for handling failures.

```typescript
import { ConnectionError, RPCError, ProtocolVersionError, AuthenticationError, RateLimitError } from 'rpc.do/errors'

try {
  await rpc.method()
} catch (error) {
  if (error instanceof ConnectionError && error.retryable) {
    // Retry the operation
  }
}
```

**Exports**: `ConnectionError`, `RPCError`, `ProtocolVersionError`, `AuthenticationError`, `RateLimitError`

---

## Transports

| Transport | Description |
|-----------|-------------|
| `http(url, auth?)` | HTTP POST |
| `ws(url, auth?)` | WebSocket (basic) |
| `wsAdvanced(url, opts?)` | WebSocket with reconnection, heartbeat, first-message auth |
| `binding(env.RPC)` | CF Workers service bindings |
| `capnweb(url, opts?)` | Full capnweb RPC |
| `composite(...t)` | Fallback chain |

Import advanced transport from `rpc.do/transports/ws-advanced`.

### HTTP Transport

```typescript
import { RPC, http, auth } from 'rpc.do'

const rpc = RPC(http('https://rpc.do', auth()))

await rpc.ai.generate({ prompt: 'hello' })
```

### WebSocket Transport

```typescript
import { RPC, ws, auth } from 'rpc.do'

const rpc = RPC(ws('wss://rpc.do', auth()))
```

### Advanced WebSocket Transport

For production applications requiring robust connection handling:

```typescript
import { RPC } from 'rpc.do'
import { wsAdvanced } from 'rpc.do/transports/ws-advanced'

const transport = wsAdvanced('wss://rpc.do', {
  token: 'your-auth-token',  // First-message auth (not in URL)

  // Event handlers
  onConnect: () => console.log('Connected!'),
  onDisconnect: (reason, code) => console.log('Disconnected:', reason),
  onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
  onError: (error) => console.error('Error:', error),

  // Reconnection settings
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBackoff: 1000,      // Start at 1s
  maxReconnectBackoff: 30000,  // Max 30s
  backoffMultiplier: 2,        // Exponential backoff

  // Heartbeat settings
  heartbeatInterval: 30000,    // Ping every 30s
  heartbeatTimeout: 5000,      // Pong timeout

  // Timeouts
  connectTimeout: 10000,
  requestTimeout: 30000,
})

const rpc = RPC(transport)

// Check connection state
console.log(transport.state) // 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed'
console.log(transport.isConnected())

// Manual connection management
await transport.connect()
transport.close()
```

**Security Features:**
- First-message authentication (token not in URL)
- TLS required by default (blocks `ws://` with tokens)
- Use `allowInsecureAuth: true` only for local development

### Service Bindings (Cloudflare Workers)

```typescript
import { RPC, binding } from 'rpc.do'

export default {
  fetch: (req, env) => {
    const rpc = RPC(binding(env.RPC))
    return Response.json(await rpc.db.get({ id: '123' }))
  }
}
```

### Composite Transport (Fallback)

```typescript
import { RPC, composite, ws, http } from 'rpc.do'

// Try WebSocket first, fall back to HTTP
const rpc = RPC(composite(
  ws('wss://api.example.com/rpc'),
  http('https://api.example.com/rpc')
))
```

---

## Type Utilities

| Type | Description |
|------|-------------|
| `RPCProxy<T>` | Converts API shape to async proxy |
| `RPCPromise<T>` | Explicit promise return type |
| `RPCResult<T>` | Infer return type of RPC function |
| `RPCInput<T>` | Infer input type of RPC function |
| `RPCFunction<I, O>` | Define function signature |

### Typed API Example

```typescript
import { RPC, http, RPCProxy, RPCPromise, RPCResult, RPCInput } from 'rpc.do'

// Define your API shape
interface API {
  ai: {
    generate: (params: { prompt: string }) => { text: string }
  }
  db: {
    get: (params: { id: string }) => { data: any }
    set: (params: { id: string; data: any }) => { ok: boolean }
  }
}

// Create typed client
const rpc = RPC<API>(http('https://rpc.do'))

// Fully typed!
const result = await rpc.ai.generate({ prompt: 'hello' })
// result is { text: string }

// Type utilities
type GenerateResult = RPCResult<typeof rpc.ai.generate>  // { text: string }
type GenerateInput = RPCInput<typeof rpc.ai.generate>    // { prompt: string }
```

---

## Authentication

rpc.do integrates with [oauth.do](https://oauth.do) for authentication. Install oauth.do as an optional peer dependency:

```bash
npm install oauth.do
```

### Using oauth.do Provider

```typescript
import { RPC, http } from 'rpc.do'
import { oauthProvider } from 'rpc.do/auth'

// Basic usage - uses oauth.do getToken with caching
const rpc = RPC(http('https://rpc.do', oauthProvider()))

await rpc.ai.generate({ prompt: 'hello' })
```

### Cached Auth

Wrap any token function with caching:

```typescript
import { cachedAuth } from 'rpc.do/auth'
import { getToken } from 'oauth.do'

const auth = cachedAuth(getToken, {
  ttl: 60000,       // Cache for 1 minute
  refreshBuffer: 10000  // Refresh 10s before expiry
})

const rpc = RPC(http('https://rpc.do', auth))
```

### Fallback Tokens

```typescript
import { oauthProvider, compositeAuth, staticAuth } from 'rpc.do/auth'

// With fallback token
const rpc = RPC(http('https://rpc.do', oauthProvider({
  fallbackToken: process.env.API_TOKEN
})))

// Or use composite auth for multiple sources
const auth = compositeAuth([
  oauthProvider(),  // Try oauth.do first
  staticAuth(() => process.env.API_TOKEN),  // Fall back to env var
])
const rpc = RPC(http('https://rpc.do', auth))
```

### Direct Auth Function

The `auth()` function returns JWT or API key for `Authorization: Bearer TOKEN`:

1. `globalThis.DO_ADMIN_TOKEN` / `DO_TOKEN` (Workers)
2. `process.env.DO_ADMIN_TOKEN` / `DO_TOKEN` (Node.js)
3. `oauth.do` stored credentials

```typescript
import { RPC, http } from 'rpc.do'
import { auth } from 'rpc.do/auth'

const rpc = RPC(http('https://rpc.do', auth()))
```

### Direct Token

```typescript
const rpc = RPC(http('https://rpc.do', 'sk_live_xxx'))
```

---

## Error Handling

Import error classes from `rpc.do/errors`:

```typescript
import { ConnectionError, RPCError, ProtocolVersionError } from 'rpc.do/errors'

try {
  await rpc.some.method()
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log(`Connection error: ${error.code}`)
    if (error.retryable) {
      // Can retry the operation
    }
  } else if (error instanceof RPCError) {
    console.log(`RPC error: ${error.code}`, error.data)
  } else if (error instanceof ProtocolVersionError) {
    console.log(`Protocol mismatch: client ${error.clientVersion}, server ${error.serverVersion}`)
  }
}
```

**ConnectionError codes:**
- `CONNECTION_TIMEOUT` - Connection timed out
- `CONNECTION_FAILED` - Failed to establish connection
- `CONNECTION_LOST` - Connection was lost
- `AUTH_FAILED` - Authentication failed
- `RECONNECT_FAILED` - All reconnection attempts exhausted
- `HEARTBEAT_TIMEOUT` - Server not responding to heartbeats
- `INSECURE_CONNECTION` - Token sent over non-TLS connection

---

## Worker Deployment

Deploy as a Cloudflare Worker with built-in auth and service binding dispatch:

```typescript
// Simple - uses env bindings for dispatch
export { default } from 'rpc.do/worker'
```

Or with custom dispatch:

```typescript
import { createWorker } from 'rpc.do/worker'

export default createWorker({
  dispatch: async (method, args, env, ctx) => {
    // Custom dispatch logic
    const [service, ...path] = method.split('.')
    return env[service][path.join('.')](...args)
  }
})
```

Environment variables:
- `RPC_TOKEN` / `DO_ADMIN_TOKEN` / `DO_TOKEN` - Bearer tokens for auth

---

## Server Handler

Custom server handler for advanced use cases:

```typescript
import { createRpcHandler, bearerAuth } from 'rpc.do/server'

export default {
  fetch: createRpcHandler({
    auth: bearerAuth(async (token) => {
      if (token === env.SECRET) return { admin: true }
      return null
    }),
    dispatch: (method, args) => env[method.split('.')[0]][method.split('.').slice(1).join('.')](...args)
  })
}
```

---

## Platform Package Hierarchy

This repository is part of the .do platform ecosystem:

| Package | npm | Description |
|---------|-----|-------------|
| **@dotdo/types** | [![npm](https://img.shields.io/npm/v/@dotdo/types)](https://npmjs.com/package/@dotdo/types) | Core type definitions providing full access to the platform |
| **@dotdo/rpc** | [![npm](https://img.shields.io/npm/v/@dotdo/rpc)](https://npmjs.com/package/@dotdo/rpc) | Abstract core library for building RPC-enabled Durable Objects |
| **rpc.do** | [![npm](https://img.shields.io/npm/v/rpc.do)](https://npmjs.com/package/rpc.do) | Managed implementation with platform integrations |

### @dotdo/rpc - Abstract Foundation

**@dotdo/rpc** is the abstract core library for building your own RPC-enabled Cloudflare Durable Objects:

```typescript
import { DurableRPC } from '@dotdo/rpc'

export class MyService extends DurableRPC {
  users = this.collection<User>('users')

  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }
}
```

See the full [@dotdo/rpc documentation](../core/README.md).

### rpc.do - Managed Implementation

**rpc.do** is the managed, batteries-included implementation integrated with the .do platform:

- **[oauth.do](https://oauth.do)** - Built-in authentication with token management
- **[cli.do](https://cli.do)** - Zero-config type generation via `npx rpc.do generate`
- **[rpc.do](https://rpc.do)** - Cloud-hosted managed RPC service

---

## Related Packages

| Package | Description |
|---------|-------------|
| [`@dotdo/rpc`](../core/README.md) | Abstract DO server library (DurableRPC base class) |
| [`@dotdo/types`](https://github.com/dot-do/types) | Core platform type definitions |
| [`@dotdo/capnweb`](https://github.com/dot-do/capnweb) | Capnproto-style RPC protocol |
| [`oauth.do`](https://github.com/dot-do/oauth.do) | OAuth authentication |
| [`colo.do`](https://github.com/dot-do/colo.do) | Cloudflare colo location data |
