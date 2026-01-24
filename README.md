# rpc.do

![CI](https://github.com/dot-do/rpc.do/actions/workflows/ci.yml/badge.svg)

Lightweight transport-agnostic RPC proxy.

## Why rpc.do?

**Ergonomic Proxy-based API** - Call remote procedures with natural JavaScript syntax. No code generation, no schema compilation, just `$.ai.generate({ prompt: 'hello' })`.

**Transport Agnostic** - Same client code works across HTTP, WebSocket, Cloudflare Service Bindings, and capnweb. Switch transports without changing your application logic.

**Cloudflare Workers First-Class Support** - Built for the edge. Service bindings transport enables zero-latency RPC between Workers. Deploy the included Worker export for instant RPC endpoints.

**Lightweight Alternative to tRPC/gRPC** - No build step required. No protobuf compilation. No router boilerplate. Just a ~3KB proxy that works everywhere.

## How it works

rpc.do uses JavaScript Proxies to create an infinitely nested namespace that accumulates method paths:

```typescript
const rpc = RPC(transport)

// When you write:
rpc.ai.models.gpt4.generate({ prompt: 'hello' })

// The proxy accumulates: ['ai', 'models', 'gpt4', 'generate']
// Then calls: transport('ai.models.gpt4.generate', [{ prompt: 'hello' }])
```

**Method Path Accumulation** - Each property access returns a new proxy that extends the path. Function invocation triggers the actual RPC call with the accumulated path as the method name.

**Transport Abstraction** - Transports are simple functions: `(method: string, args: any[]) => Promise<any>`. This makes it trivial to implement custom transports or compose existing ones.

## Install

```bash
npm install rpc.do
```

## Quick Start

```typescript
import $ from 'rpc.do'
// or: import { $ } from 'rpc.do'

await $.ai.generate({ prompt: 'hello' })
await $.db.get({ id: '123' })
```

## Custom Transport

```typescript
import { RPC, http, auth } from 'rpc.do'

const rpc = RPC(http('https://rpc.do', auth()))

await rpc.ai.generate({ prompt: 'hello' })
```

### WebSocket

```typescript
import { RPC, ws, auth } from 'rpc.do'

const rpc = RPC(ws('wss://rpc.do', auth()))
```

### Advanced WebSocket Transport

For production applications requiring robust connection handling, use the advanced WebSocket transport:

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

### Direct Token

```typescript
const rpc = RPC(http('https://rpc.do', 'sk_live_xxx'))
```

## Typed API

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

## Auth

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

## Worker

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

## Server

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

## Types

| Type | Description |
|------|-------------|
| `RPCProxy<T>` | Converts API shape to async proxy |
| `RPCPromise<T>` | Explicit promise return type |
| `RPCResult<T>` | Infer return type of RPC function |
| `RPCInput<T>` | Infer input type of RPC function |
| `RPCFunction<I, O>` | Define function signature |

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

## License

MIT
