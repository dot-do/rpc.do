# Getting Started with rpc.do

A beginner-friendly guide to using rpc.do for lightweight, transport-agnostic RPC.

---

## Quick Start (5 minutes)

### Install

```bash
npm install rpc.do
```

### Your First RPC Call (10 lines)

```typescript
import { RPC, http } from 'rpc.do'

// Create an RPC client pointing to your server
const rpc = RPC(http('https://your-api.com/rpc'))

// Call remote methods like local functions
const result = await rpc.users.getById({ id: '123' })

console.log(result)
// { id: '123', name: 'Alice', email: 'alice@example.com' }
```

That's it! The `rpc.users.getById(...)` call sends a request to your server and returns the result.

### See It Work

When you call `rpc.users.getById({ id: '123' })`, rpc.do:

1. Builds the method path: `"users.getById"`
2. Sends a POST request with `{ method: "do", path: "users.getById", args: [{ id: "123" }] }`
3. Returns the server's response as a JavaScript object

---

## Core Concepts

### What is rpc.do?

rpc.do is a lightweight library that lets you call remote functions as if they were local. Instead of manually constructing HTTP requests, you write natural JavaScript:

```typescript
// Instead of this:
const response = await fetch('/api/users/123')
const user = await response.json()

// You write this:
const user = await rpc.users.getById({ id: '123' })
```

### How the Proxy Pattern Works

rpc.do uses JavaScript's Proxy feature to create an object where any property access builds up a method path:

```typescript
const rpc = RPC(transport)

// Each property access builds the path
rpc                    // path: []
rpc.users              // path: ['users']
rpc.users.getById      // path: ['users', 'getById']

// Calling as a function triggers the RPC call
rpc.users.getById({ id: '123' })
// Sends: { method: 'do', path: 'users.getById', args: [{ id: '123' }] }
```

You can nest as deep as you want:

```typescript
await rpc.ai.models.gpt4.chat.complete({ messages: [...] })
// path: 'ai.models.gpt4.chat.complete'
```

### Transports Explained

A **transport** is how rpc.do sends your calls to the server. rpc.do supports multiple transports, so you can choose the best one for your use case:

| Transport | Best For | Example |
|-----------|----------|---------|
| `http()` | Simple request/response | REST-like APIs |
| `capnweb()` | Real-time, many small calls | Chat, live updates |
| `binding()` | Cloudflare Workers | Zero-latency worker-to-worker |
| `composite()` | Fallback chains | Try WebSocket, fall back to HTTP |

All transports use the same client code:

```typescript
// Same client code, different transports
const httpClient = RPC(http('https://api.example.com/rpc'))
const wsClient = RPC(capnweb('wss://api.example.com/rpc'))

// Both work the same way
await httpClient.users.list()
await wsClient.users.list()
```

---

## Step-by-Step: Your First Project

Let's build a complete example with a Cloudflare Worker server and a typed client.

### Step 1: Create a Cloudflare Worker

Create a new Cloudflare Worker project:

```bash
npm create cloudflare@latest my-rpc-server
cd my-rpc-server
npm install rpc.do
```

### Step 2: Define RPC Methods

Edit `src/index.ts` to create your RPC server:

```typescript
import { createRpcHandler, bearerAuth, noAuth } from 'rpc.do/server'

// Your RPC methods
const methods = {
  // Simple method
  ping: async () => {
    return { pong: true, timestamp: Date.now() }
  },

  // Method with parameters
  greet: async (args: { name: string }) => {
    return { message: `Hello, ${args.name}!` }
  },

  // Nested namespace
  math: {
    add: async (args: { a: number; b: number }) => {
      return { result: args.a + args.b }
    },
    multiply: async (args: { a: number; b: number }) => {
      return { result: args.a * args.b }
    }
  }
}

// Create the RPC handler
const handler = createRpcHandler({
  auth: noAuth(), // No authentication for this example
  dispatch: async (method, args) => {
    // Navigate to the method
    const parts = method.split('.')
    let target: any = methods

    for (const part of parts) {
      target = target[part]
      if (!target) {
        throw new Error(`Unknown method: ${method}`)
      }
    }

    if (typeof target !== 'function') {
      throw new Error(`${method} is not a function`)
    }

    return target(args[0])
  }
})

export default {
  fetch: handler
}
```

### Step 3: Create a Typed Client

In your client application, define the API types and create a typed client:

```typescript
import { RPC, http, RPCProxy } from 'rpc.do'

// Define your API shape (matches your server)
interface MyAPI {
  ping: () => { pong: boolean; timestamp: number }
  greet: (args: { name: string }) => { message: string }
  math: {
    add: (args: { a: number; b: number }) => { result: number }
    multiply: (args: { a: number; b: number }) => { result: number }
  }
}

// Create a typed client
const rpc = RPC<MyAPI>(http('https://my-rpc-server.workers.dev'))

// Now you get full TypeScript autocomplete and type checking!
```

### Step 4: Make Calls

```typescript
// Simple call
const pingResult = await rpc.ping()
console.log(pingResult)
// { pong: true, timestamp: 1706123456789 }

// Call with parameters
const greeting = await rpc.greet({ name: 'World' })
console.log(greeting)
// { message: 'Hello, World!' }

// Nested namespace
const sum = await rpc.math.add({ a: 5, b: 3 })
console.log(sum)
// { result: 8 }

const product = await rpc.math.multiply({ a: 4, b: 7 })
console.log(product)
// { result: 28 }
```

---

## Common Patterns

### Authentication

#### With a Static Token

```typescript
import { RPC, http } from 'rpc.do'

// Pass token directly
const rpc = RPC(http('https://api.example.com/rpc', 'your-api-token'))

await rpc.protected.resource()
```

#### With a Token Provider Function

```typescript
import { RPC, http } from 'rpc.do'

// Dynamic token (e.g., from localStorage or a refresh function)
const getToken = () => localStorage.getItem('authToken')

const rpc = RPC(http('https://api.example.com/rpc', getToken))

await rpc.protected.resource()
```

#### With oauth.do Integration

```typescript
import { RPC, http } from 'rpc.do'
import { oauthProvider } from 'rpc.do/auth'

// Uses oauth.do for token management
const rpc = RPC(http('https://api.example.com/rpc', oauthProvider()))

await rpc.protected.resource()
```

### Error Handling

rpc.do provides typed errors you can catch and handle:

```typescript
import { RPC, http } from 'rpc.do'
import { ConnectionError, RPCError } from 'rpc.do/errors'

const rpc = RPC(http('https://api.example.com/rpc'))

try {
  const result = await rpc.users.getById({ id: '123' })
  console.log(result)
} catch (error) {
  if (error instanceof ConnectionError) {
    // Network or connection issues
    console.error('Connection failed:', error.message)
    console.log('Error code:', error.code)
    console.log('Can retry:', error.retryable)
  } else if (error instanceof RPCError) {
    // Server returned an error
    console.error('RPC error:', error.message)
    console.log('Error code:', error.code)
    console.log('Error data:', error.data)
  } else {
    // Unexpected error
    console.error('Unexpected error:', error)
  }
}
```

**Common ConnectionError codes:**

| Code | Meaning |
|------|---------|
| `CONNECTION_TIMEOUT` | Connection took too long |
| `CONNECTION_FAILED` | Could not establish connection |
| `CONNECTION_LOST` | Connection was dropped |
| `AUTH_FAILED` | Authentication was rejected |
| `REQUEST_TIMEOUT` | Request took too long |

### TypeScript Types

rpc.do is built with TypeScript and provides full type safety:

```typescript
import { RPC, http, RPCProxy, RPCResult, RPCInput } from 'rpc.do'

// Define your API
interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string }
    create: (args: { name: string; email: string }) => { id: string }
  }
}

// Create typed client
const rpc = RPC<API>(http('https://api.example.com/rpc'))

// Full autocomplete and type checking
const user = await rpc.users.getById({ id: '123' })
// user is typed as { id: string; name: string }

// Extract types for reuse
type GetUserResult = RPCResult<typeof rpc.users.getById>
// { id: string; name: string }

type GetUserInput = RPCInput<typeof rpc.users.getById>
// { id: string }
```

### Reconnection (WebSocket)

For production WebSocket connections, use the advanced transport with automatic reconnection:

```typescript
import { RPC } from 'rpc.do'
import { wsAdvanced } from 'rpc.do/transports/ws-advanced'

const transport = wsAdvanced('wss://api.example.com/rpc', {
  // Authentication
  token: 'your-auth-token',

  // Reconnection settings
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBackoff: 1000,      // Start at 1 second
  maxReconnectBackoff: 30000,  // Max 30 seconds
  backoffMultiplier: 2,        // Double each time

  // Event handlers
  onConnect: () => {
    console.log('Connected!')
  },
  onDisconnect: (reason, code) => {
    console.log('Disconnected:', reason, code)
  },
  onReconnecting: (attempt, maxAttempts) => {
    console.log(`Reconnecting... attempt ${attempt}/${maxAttempts}`)
  },
  onError: (error) => {
    console.error('Error:', error)
  }
})

const rpc = RPC(transport)

// Check connection state
console.log(transport.state)
// 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

console.log(transport.isConnected())
// true or false

// Manual connection control
await transport.connect()
transport.close()
```

---

## Next Steps

### Examples

Try these common patterns:

```typescript
// Use the pre-configured client for rpc.do
import $ from 'rpc.do'
await $.ai.generate({ prompt: 'Hello!' })

// Create a client factory for your API
import { createRPCClient } from 'rpc.do'

const client = createRPCClient({
  baseUrl: 'https://api.example.com/rpc',
  auth: 'your-token',
  timeout: 30000
})
```

### API Reference

See the full [README](../README.md) for:

- All transport options and configurations
- Complete type system documentation
- Server-side handler creation
- Cloudflare Worker deployment

### Advanced Topics

**Service Bindings (Cloudflare Workers):**

```typescript
import { RPC, binding } from 'rpc.do'

export default {
  fetch: async (req, env) => {
    const rpc = RPC(binding(env.MY_SERVICE))
    const result = await rpc.someMethod()
    return Response.json(result)
  }
}
```

**Composite Transports (Fallback):**

```typescript
import { RPC, composite, capnweb, http } from 'rpc.do'

// Try WebSocket first, fall back to HTTP
const rpc = RPC(composite(
  capnweb('wss://api.example.com/rpc'),
  http('https://api.example.com/rpc')
))
```

**Request Timeouts:**

```typescript
import { RPC, http } from 'rpc.do'

// Set a 5-second timeout
const rpc = RPC(http('https://api.example.com/rpc', { timeout: 5000 }))

try {
  await rpc.slowMethod()
} catch (error) {
  // ConnectionError with code 'REQUEST_TIMEOUT'
}
```

---

## Summary

1. **Install:** `npm install rpc.do`
2. **Create client:** `const rpc = RPC(http('https://your-api.com/rpc'))`
3. **Call methods:** `await rpc.namespace.method({ args })`
4. **Add types:** `const rpc = RPC<API>(transport)` for full TypeScript support

rpc.do makes remote procedure calls feel like local function calls. No code generation, no schema compilation, just natural JavaScript.

Happy coding!
