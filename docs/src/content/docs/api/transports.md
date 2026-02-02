---
title: Transports
description: HTTP, WebSocket, service bindings, and composite transports
---

rpc.do supports multiple transports for different use cases. The transport handles the actual communication between client and server.

## Overview

| Transport | Protocol | Best For |
|-----------|----------|----------|
| `http` | HTTP POST | Stateless requests, serverless |
| `capnweb` | WebSocket | Real-time, bidirectional, pipelining |
| `binding` | Service Binding | Worker-to-DO, zero latency |
| `composite` | Multiple | Fallback chains, resilience |

## HTTP Transport

Uses capnweb's HTTP batch protocol for request-response patterns.

```typescript
import { RPC, http } from 'rpc.do'

const $ = RPC(http('https://my-do.workers.dev'))
```

### Options

```typescript
interface HttpTransportOptions {
  /** Authentication token or provider function */
  auth?: string | AuthProvider

  /** Request timeout in milliseconds */
  timeout?: number
}
```

### Examples

```typescript
// Basic usage
const transport = http('https://api.example.com/rpc')

// With timeout
const transport = http('https://api.example.com/rpc', { timeout: 5000 })

// With auth (note: http uses in-band auth, warning will be shown)
const transport = http('https://api.example.com/rpc', { auth: 'my-token' })
```

## Capnweb Transport

Uses the capnweb protocol for WebSocket connections with promise pipelining.

```typescript
import { RPC, capnweb } from 'rpc.do'

const $ = RPC(capnweb('wss://my-do.workers.dev'))
```

### Options

```typescript
interface CapnwebTransportOptions {
  /** Use WebSocket (true) or HTTP batch (false) - default: true */
  websocket?: boolean

  /** Authentication token or provider */
  auth?: string | AuthProvider

  /** Enable reconnection support - default: false */
  reconnect?: boolean

  /** Reconnection options */
  reconnectOptions?: {
    maxReconnectAttempts?: number
    reconnectBackoff?: number
    maxReconnectBackoff?: number
    heartbeatInterval?: number
    onConnect?: () => void
    onDisconnect?: (reason: string) => void
    onReconnecting?: (attempt: number, maxAttempts: number) => void
    onError?: (error: Error) => void
  }

  /** Local RPC target for bidirectional RPC */
  localMain?: unknown

  /** Allow auth over insecure ws:// (local dev only) */
  allowInsecureAuth?: boolean
}
```

### Examples

```typescript
// Basic WebSocket
const transport = capnweb('wss://api.example.com/rpc')

// With reconnection
const transport = capnweb('wss://api.example.com/rpc', {
  reconnect: true,
  reconnectOptions: {
    onConnect: () => console.log('Connected!'),
    onReconnecting: (attempt) => console.log(`Reconnecting... attempt ${attempt}`),
  }
})

// With authentication
import { oauthProvider } from 'rpc.do/auth'

const transport = capnweb('wss://api.example.com/rpc', {
  auth: oauthProvider(),
  reconnect: true,
})

// HTTP batch mode (not WebSocket)
const transport = capnweb('https://api.example.com/rpc', {
  websocket: false,
})

// Bidirectional RPC
const clientHandler = {
  notify: (msg: string) => console.log('Server says:', msg)
}
const transport = capnweb('wss://api.example.com/rpc', {
  localMain: clientHandler,
  reconnect: true,
})
```

## Service Binding Transport

For zero-latency communication between Workers and Durable Objects in the same account.

```typescript
import { RPC, binding } from 'rpc.do'

export default {
  async fetch(request: Request, env: Env) {
    const $ = RPC(binding(env.MY_DO))
    const result = await $.users.get('123')
    return Response.json(result)
  }
}
```

### Benefits

- Zero network latency (same-machine calls)
- No HTTP overhead
- Direct method invocation
- Full type safety with DO's API

### Examples

```typescript
// Basic usage
const $ = RPC(binding(env.MY_SERVICE))

// Call methods
await $.users.get('123')

// Nested namespaces work too
await $.admin.users.delete('user-id')
```

## Composite Transport

Try multiple transports with automatic fallback.

```typescript
import { RPC, composite, capnweb, http } from 'rpc.do'

const $ = RPC(composite(
  capnweb('wss://api.example.com/rpc', { reconnect: true }),
  http('https://api.example.com/rpc')
))
```

### Use Cases

**WebSocket with HTTP fallback:**
```typescript
const transport = composite(
  capnweb('wss://api.example.com/rpc'),
  http('https://api.example.com/rpc')
)
```

**Multi-region failover:**
```typescript
const transport = composite(
  http('https://us-east.api.example.com/rpc'),
  http('https://eu-west.api.example.com/rpc'),
  http('https://ap-south.api.example.com/rpc')
)
```

**Local dev with production fallback:**
```typescript
const transport = composite(
  http('http://localhost:8787/rpc'),
  http('https://api.example.com/rpc')
)
```

## Transport Factory

For programmatic transport creation, use the `Transports` namespace:

```typescript
import { Transports } from 'rpc.do'

// Create from config object
const transport = Transports.create({
  type: 'http',
  url: 'https://api.example.com/rpc',
  timeout: 5000,
})

// Shorthand methods
const t1 = Transports.http('https://api.example.com/rpc')
const t2 = Transports.capnweb('wss://api.example.com/rpc', { reconnect: true })
const t3 = Transports.binding(env.MY_SERVICE)
const t4 = Transports.composite(t1, t2)

// Type guard
if (Transports.isTransport(value)) {
  // value is a valid Transport
}
```

### Transport Config Types

```typescript
// HTTP
interface HttpTransportConfig {
  type: 'http'
  url: string
  auth?: string | AuthProvider
  timeout?: number
}

// Capnweb
interface CapnwebTransportConfig {
  type: 'capnweb'
  url: string
  websocket?: boolean
  auth?: string | AuthProvider
  reconnect?: boolean
  reconnectOptions?: { ... }
}

// Binding
interface BindingTransportConfig {
  type: 'binding'
  binding: unknown
}

// Composite
interface CompositeTransportConfig {
  type: 'composite'
  transports: Transport[]
}
```

## Reconnecting WebSocket

For more control over WebSocket reconnection, use `ReconnectingWebSocketTransport` directly:

```typescript
import { ReconnectingWebSocketTransport, createRpcSession } from 'rpc.do'

const transport = new ReconnectingWebSocketTransport('wss://api.example.com', {
  auth: async () => getAccessToken(),
  maxReconnectAttempts: 10,
  reconnectBackoff: 1000,
  maxReconnectBackoff: 30000,
  heartbeatInterval: 30000,
  onConnect: () => console.log('Connected'),
  onDisconnect: (reason) => console.log('Disconnected:', reason),
  onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
  onError: (error) => console.error('Error:', error),
})

// Create RPC session with the transport
const session = await createRpcSession(transport, {
  localMain: myClientHandler,  // Optional: for bidirectional RPC
})
```

## Custom Transports

Implement the `Transport` interface for custom transports:

```typescript
interface Transport {
  call(method: string, args: unknown[]): Promise<unknown>
  close?(): void
}
```

Example:

```typescript
const myTransport: Transport = {
  async call(method, args) {
    // Your implementation here
    const response = await fetch('/custom-rpc', {
      method: 'POST',
      body: JSON.stringify({ method, args }),
    })
    return response.json()
  },
  close() {
    // Cleanup if needed
  }
}

const $ = RPC(myTransport)
```
