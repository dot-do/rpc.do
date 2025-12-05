# rpc.do

Lightweight transport-agnostic RPC proxy.

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

`auth()` returns JWT or API key for `Authorization: Bearer TOKEN`:

1. `globalThis.DO_ADMIN_TOKEN` / `DO_TOKEN` (Workers)
2. `process.env.DO_ADMIN_TOKEN` / `DO_TOKEN` (Node.js)
3. `oauth.do` stored credentials

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
| `ws(url, auth?)` | WebSocket |
| `binding(env.RPC)` | CF Workers service bindings |
| `capnweb(url, opts?)` | Full capnweb RPC |
| `composite(...t)` | Fallback chain |

## Types

| Type | Description |
|------|-------------|
| `RPCProxy<T>` | Converts API shape to async proxy |
| `RPCPromise<T>` | Explicit promise return type |
| `RPCResult<T>` | Infer return type of RPC function |
| `RPCInput<T>` | Infer input type of RPC function |
| `RPCFunction<I, O>` | Define function signature |

## License

MIT
