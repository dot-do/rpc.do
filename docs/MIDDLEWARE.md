# Middleware Guide

rpc.do provides a composable middleware system for both the client and server. Client middleware intercepts RPC calls before they leave the client and after responses arrive. Server middleware runs inside the Durable Object before and after method execution. Both sides share the same hook pattern (`onRequest`, `onResponse`, `onError`) but differ in the context they receive.

---

## Table of Contents

- [Overview](#overview)
- [Client Middleware](#client-middleware)
  - [RpcClientMiddleware Interface](#rpcclientmiddleware-interface)
  - [Passing Middleware to RPC()](#passing-middleware-to-rpc)
  - [withMiddleware() Transport Wrapper](#withmiddleware-transport-wrapper)
- [Built-in Client Middleware](#built-in-client-middleware)
  - [loggingMiddleware](#loggingmiddleware)
  - [timingMiddleware](#timingmiddleware)
  - [retryObserver](#retryobserver)
- [Retry Transport Wrapper: withRetry()](#retry-transport-wrapper-withretry)
  - [RetryOptions](#retryoptions)
  - [Default Retry Logic](#default-retry-logic)
  - [Custom shouldRetry](#custom-shouldretry)
- [Server-side Middleware](#server-side-middleware)
  - [ServerMiddleware Interface](#servermiddleware-interface)
  - [serverLoggingMiddleware](#serverloggingmiddleware)
  - [serverTimingMiddleware](#servertimingmiddleware)
  - [Auth Middleware Example](#auth-middleware-example)
- [Writing Custom Middleware](#writing-custom-middleware)
- [Combining Multiple Middleware](#combining-multiple-middleware)
- [getTransportSync() and Async Initialization](#gettransportsync-and-async-initialization)
- [Client vs Server Comparison](#client-vs-server-comparison)

---

## Overview

Middleware in rpc.do follows a simple hook-based pattern. Every middleware is an object with optional `onRequest`, `onResponse`, and `onError` methods. The system runs middleware in declaration order for `onRequest`/`onResponse` and propagates errors naturally.

```
Client Code  -->  [Middleware onRequest]  -->  Transport  -->  Network  -->  Server
                                                                              |
Client Code  <--  [Middleware onResponse] <--  Transport  <--  Network  <--  Server

                  [Middleware onError] is called if the transport throws
```

There are two distinct layers:

1. **Client middleware** (`RpcClientMiddleware`) -- runs in your application process, wraps transport calls.
2. **Server middleware** (`ServerMiddleware`) -- runs inside the Durable Object, wraps method execution.

---

## Client Middleware

### RpcClientMiddleware Interface

Defined in `src/index.ts`:

```typescript
export type RpcClientMiddleware = {
  /** Called before the RPC call is made */
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  /** Called after a successful response */
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (method: string, error: unknown) => void | Promise<void>
}
```

All hooks are optional and can be synchronous or asynchronous. The `method` parameter is the dot-separated RPC path (e.g. `"users.getById"`), and `args` is the array of arguments passed to the call.

### Passing Middleware to RPC()

The simplest way to use middleware is to pass an array in the `RPC()` options:

```typescript
import { RPC } from 'rpc.do'
import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'

const rpc = RPC('https://my-do.workers.dev', {
  middleware: [
    loggingMiddleware(),
    timingMiddleware({ threshold: 100 }),
  ]
})

await rpc.users.list()
// Console output:
// [RPC] Calling users.list with args: []
// [RPC Timing] users.list took 45.23ms
// [RPC] users.list returned: [{ id: '1', name: 'John' }]
```

Middleware executes in array order:
- `onRequest` hooks run first-to-last before the transport call.
- `onResponse` hooks run first-to-last after a successful response.
- `onError` hooks run first-to-last when the transport throws.

After all `onError` hooks run, the error is re-thrown so it reaches your application code.

### withMiddleware() Transport Wrapper

For advanced use cases, `withMiddleware()` wraps any transport with middleware support. This lets you create reusable, pre-configured transports:

```typescript
import { http } from 'rpc.do/transports'
import { withMiddleware, loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'

// Create a transport with middleware baked in
const transport = withMiddleware(
  http('https://api.example.com'),
  [loggingMiddleware(), timingMiddleware()]
)

// Use with RPC
const rpc = RPC(transport)

// Or share across multiple clients
const api1 = RPC(transport)
const api2 = RPC(transport)
```

You can also chain `withMiddleware()` with other transport wrappers:

```typescript
import { withMiddleware, withRetry } from 'rpc.do/middleware'

const transport = withMiddleware(
  withRetry(http('https://api.example.com'), { maxAttempts: 3 }),
  [loggingMiddleware()]
)
```

**Signature:**

```typescript
function withMiddleware(
  transport: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void },
  middleware: RpcClientMiddleware[]
): { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void }
```

If the middleware array is empty, the original transport is returned unchanged.

---

## Built-in Client Middleware

All built-in middleware is available from `rpc.do/middleware`:

```typescript
import {
  loggingMiddleware,
  timingMiddleware,
  retryObserver,
  withRetry,
  withMiddleware,
} from 'rpc.do/middleware'
```

### loggingMiddleware

Logs all RPC requests, responses, and errors.

```typescript
import { loggingMiddleware } from 'rpc.do/middleware'

// Default: logs to console with '[RPC]' prefix
const mw = loggingMiddleware()

// Custom logger and prefix
const mw = loggingMiddleware({
  log: (msg, ...args) => myLogger.info(msg, ...args),
  error: (msg, ...args) => myLogger.error(msg, ...args),
  prefix: '[API]',
})

// Minimal logging (no arguments or results in output)
const mw = loggingMiddleware({
  logArgs: false,
  logResult: false,
})
```

**LoggingOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log` | `(message: string, ...args: unknown[]) => void` | `console.log` | Logger for requests and responses |
| `error` | `(message: string, ...args: unknown[]) => void` | `console.error` | Logger for errors |
| `prefix` | `string` | `'[RPC]'` | Prefix for all log messages |
| `logArgs` | `boolean` | `true` | Whether to include call arguments in logs |
| `logResult` | `boolean` | `true` | Whether to include response data in logs |

### timingMiddleware

Tracks execution time for all RPC calls. Handles concurrent calls to the same method correctly using FIFO ordering.

```typescript
import { timingMiddleware } from 'rpc.do/middleware'

// Default: logs all timings
const mw = timingMiddleware()

// Only log slow calls (> 100ms)
const mw = timingMiddleware({ threshold: 100 })

// Collect metrics programmatically
const metrics: { method: string; durationMs: number }[] = []
const mw = timingMiddleware({
  onTiming: (method, durationMs) => {
    metrics.push({ method, durationMs })
  }
})
```

**TimingOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log` | `(message: string) => void` | `console.log` | Logger function |
| `prefix` | `string` | `'[RPC Timing]'` | Prefix for log messages |
| `threshold` | `number` | `0` | Only log calls taking longer than this (ms) |
| `onTiming` | `(method: string, durationMs: number) => void` | - | Callback for each timing measurement |
| `ttl` | `number` | `60000` | TTL in ms for timing entries (cleanup for dropped requests) |
| `cleanupInterval` | `number` | `10000` | How often to check for stale entries (ms) |

The `ttl` and `cleanupInterval` options prevent memory leaks if requests are dropped without triggering `onResponse` or `onError`.

### retryObserver

An observability-only middleware that tracks retry-eligible errors and fires callbacks. It does **not** perform actual retries -- for that, use `withRetry()` (see next section).

```typescript
import { retryObserver } from 'rpc.do/middleware'

const mw = retryObserver({
  onRetry: (method, error, attempt, delay) => {
    console.log(`[observer] ${method} attempt ${attempt}, would delay ${delay}ms`)
  }
})

const rpc = RPC('https://my-do.workers.dev', {
  middleware: [mw]
})
```

This is useful when you want retry observability (logging, metrics) without the actual retry behavior, or when retries are handled at a different layer (e.g., by the transport itself).

> **Note:** The older `retryMiddleware` export is deprecated. It is an alias for `retryObserver` and will be removed in a future version.

---

## Retry Transport Wrapper: withRetry()

`withRetry()` wraps a transport to add automatic retry with exponential backoff. Unlike middleware hooks (which only observe a single call), `withRetry()` actually re-issues failed requests.

```typescript
import { RPC } from 'rpc.do'
import { http } from 'rpc.do/transports'
import { withRetry } from 'rpc.do/middleware'

const transport = withRetry(http('https://api.example.com'), {
  maxAttempts: 5,
  initialDelay: 200,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
  onRetry: (method, error, attempt, delay) => {
    console.log(`Retrying ${method} (attempt ${attempt}, waiting ${delay}ms)`)
  },
})

const rpc = RPC(transport)
```

### RetryOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Maximum number of total attempts (including the first) |
| `initialDelay` | `number` | `100` | Delay in ms before the first retry |
| `maxDelay` | `number` | `5000` | Maximum delay between retries (caps exponential growth) |
| `backoffMultiplier` | `number` | `2` | Multiplier for exponential backoff |
| `jitter` | `boolean` | `true` | Add random jitter (0.75x to 1.25x) to prevent thundering herd |
| `shouldRetry` | `(error: unknown, attempt: number) => boolean` | (see below) | Custom function to decide if an error is retryable |
| `onRetry` | `(method: string, error: unknown, attempt: number, delay: number) => void` | - | Callback fired before each retry wait |

### Default Retry Logic

By default, `withRetry()` retries these error types:

- **ConnectionError** with `retryable: true`
- **RPCError** with codes `UNAVAILABLE`, `DEADLINE_EXCEEDED`, or `RESOURCE_EXHAUSTED`
- **Generic Error** whose message matches common network patterns (`network`, `timeout`, `econnrefused`, `enotfound`, `fetch`, `socket`, `502`, `503`, `504`)

Business logic errors (most `RPCError` instances) are not retried.

### Custom shouldRetry

Override the retry logic for your use case:

```typescript
const transport = withRetry(http('https://api.example.com'), {
  maxAttempts: 3,
  shouldRetry: (error, attempt) => {
    // Only retry ConnectionError
    if (error instanceof ConnectionError) return error.retryable
    // Never retry business logic errors
    return false
  }
})
```

---

## Server-side Middleware

Server middleware runs inside the Durable Object and has access to the request context and environment bindings.

### ServerMiddleware Interface

Defined in `core/src/middleware.ts`:

```typescript
interface MiddlewareContext {
  /** Environment bindings (from DO constructor) */
  env: unknown
  /** The current request (if available) */
  request?: Request
}

interface ServerMiddleware {
  onRequest?(method: string, args: unknown[], ctx: MiddlewareContext): void | Promise<void>
  onResponse?(method: string, result: unknown, ctx: MiddlewareContext): void | Promise<void>
  onError?(method: string, error: unknown, ctx: MiddlewareContext): void | Promise<void>
}
```

Key differences from client middleware:
- All hooks receive a `MiddlewareContext` with `env` and `request`.
- `onError` hooks run in **reverse order** (like nested catch blocks).
- Errors in `onResponse` and `onError` hooks are caught and logged, not propagated -- middleware errors never break the RPC flow.
- `onRequest` hooks _can_ throw to reject the request (useful for auth).

Apply server middleware by setting the `middleware` property on your `DurableRPC` subclass:

```typescript
import { DurableRPC, serverLoggingMiddleware, serverTimingMiddleware } from '@dotdo/rpc'

export class MyDO extends DurableRPC {
  middleware = [
    serverLoggingMiddleware(),
    serverTimingMiddleware({ threshold: 50 }),
  ]

  users = {
    get: async (id: string) => this.sql`SELECT * FROM users WHERE id = ${id}`.one(),
    list: async () => this.sql`SELECT * FROM users`.all(),
  }
}
```

### serverLoggingMiddleware

Logs RPC calls on the server side.

```typescript
import { serverLoggingMiddleware } from '@dotdo/rpc'

const mw = serverLoggingMiddleware({
  prefix: '[MyDO]',
  logArgs: true,
  logResult: false,  // Don't log potentially large result data
})
```

**ServerLoggingOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log` | `(message: string, ...args: unknown[]) => void` | `console.log` | Logger for requests and responses |
| `error` | `(message: string, ...args: unknown[]) => void` | `console.error` | Logger for errors |
| `prefix` | `string` | `'[RPC]'` | Prefix for all log messages |
| `logArgs` | `boolean` | `true` | Whether to log request arguments |
| `logResult` | `boolean` | `true` | Whether to log response data |

### serverTimingMiddleware

Tracks server-side execution time.

```typescript
import { serverTimingMiddleware } from '@dotdo/rpc'

const mw = serverTimingMiddleware({
  threshold: 100,
  onTiming: (method, durationMs) => {
    // Send to your metrics pipeline
    metrics.histogram('rpc.duration', durationMs, { method })
  },
})
```

**ServerTimingOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `log` | `(message: string) => void` | `console.log` | Logger function |
| `prefix` | `string` | `'[RPC Timing]'` | Prefix for log messages |
| `threshold` | `number` | `0` | Only log calls taking longer than this (ms) |
| `onTiming` | `(method: string, durationMs: number) => void` | - | Callback for each measurement |

### Auth Middleware Example

Server middleware can throw in `onRequest` to reject calls. This is the primary pattern for server-side authentication:

```typescript
import type { ServerMiddleware } from '@dotdo/rpc'

const authMiddleware: ServerMiddleware = {
  async onRequest(method, args, ctx) {
    const token = ctx.request?.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      throw new Error('Unauthorized: missing token')
    }
    const valid = await verifyToken(token)
    if (!valid) {
      throw new Error('Unauthorized: invalid token')
    }
  }
}

export class MyDO extends DurableRPC {
  middleware = [authMiddleware, serverLoggingMiddleware()]

  // All methods below are now protected by auth
  users = {
    get: async (id: string) => { /* ... */ },
    create: async (data: unknown) => { /* ... */ },
  }
}
```

---

## Writing Custom Middleware

A middleware is any object with one or more of the `onRequest`, `onResponse`, and `onError` hooks. Here is a complete example of a client-side request-ID middleware:

```typescript
import type { RpcClientMiddleware } from 'rpc.do'

function requestIdMiddleware(): RpcClientMiddleware {
  let counter = 0

  return {
    onRequest(method: string, args: unknown[]): void {
      const requestId = `req-${++counter}`
      console.log(`[${requestId}] --> ${method}`)
    },

    onResponse(method: string, result: unknown): void {
      console.log(`[OK] <-- ${method}`)
    },

    onError(method: string, error: unknown): void {
      console.error(`[FAIL] <-- ${method}:`, error)
    },
  }
}

const rpc = RPC('https://api.example.com', {
  middleware: [requestIdMiddleware()]
})
```

### Async Hooks

Hooks can be async. The middleware system awaits each hook before proceeding:

```typescript
function analyticsMiddleware(): RpcClientMiddleware {
  return {
    async onResponse(method: string, result: unknown): Promise<void> {
      await sendAnalytics({ event: 'rpc_call', method, success: true })
    },
    async onError(method: string, error: unknown): Promise<void> {
      await sendAnalytics({ event: 'rpc_call', method, success: false })
    },
  }
}
```

---

## Combining Multiple Middleware

Middleware composes naturally. The order in the array determines execution order:

```typescript
import { RPC } from 'rpc.do'
import { http } from 'rpc.do/transports'
import {
  withMiddleware,
  withRetry,
  loggingMiddleware,
  timingMiddleware,
  retryObserver,
} from 'rpc.do/middleware'

// Layer 1: Retry at the transport level
const retriedTransport = withRetry(http('https://api.example.com'), {
  maxAttempts: 3,
  onRetry: (method, error, attempt) => {
    console.warn(`Retry ${attempt} for ${method}`)
  },
})

// Layer 2: Observability middleware on top
const transport = withMiddleware(retriedTransport, [
  loggingMiddleware({ prefix: '[API]' }),
  timingMiddleware({ threshold: 200 }),
  retryObserver({
    onRetry: (method, _err, attempt) => {
      metrics.increment('rpc.retry', { method, attempt: String(attempt) })
    },
  }),
])

const rpc = RPC(transport)
```

Execution flow for a successful call:

```
1. loggingMiddleware.onRequest  -> logs "Calling users.list"
2. timingMiddleware.onRequest   -> records start time
3. retryObserver.onRequest      -> records retry state
4. (transport.call executes, possibly retried by withRetry)
5. retryObserver.onResponse     -> cleans up state
6. timingMiddleware.onResponse  -> logs "users.list took 42ms"
7. loggingMiddleware.onResponse -> logs "users.list returned: [...]"
```

For a failed call (after all retries exhausted):

```
1. loggingMiddleware.onRequest -> logs "Calling users.list"
2. timingMiddleware.onRequest  -> records start time
3. retryObserver.onRequest     -> records state
4. (transport.call fails after 3 attempts via withRetry)
5. retryObserver.onError       -> fires onRetry callback
6. timingMiddleware.onError    -> logs "users.list failed after 5200ms"
7. loggingMiddleware.onError   -> logs "users.list failed: ConnectionError..."
8. Error is re-thrown to your application code
```

---

## getTransportSync() and Async Initialization

Some transports (like WebSocket-based transports created via factory functions) require asynchronous initialization. The `createDOClient()` function internally manages this with two transport accessors:

- **`getTransport()`** (async) -- Used by all RPC method calls. Awaits transport creation if needed.
- **`getTransportSync()`** (sync) -- Used by features that must return synchronously, specifically the `$.sql` tagged template literal and `$.storage`/`$.collection` property access.

### The Initialization Requirement

When you pass a **TransportFactory** (a function that returns a transport) to `createDOClient()`, the transport is not created until the first call. The sync accessor `getTransportSync()` will throw if the transport has not been initialized yet:

```typescript
import { createDOClient } from 'rpc.do'

// Transport factory -- transport is created lazily
const client = createDOClient(() => capnweb('wss://my-do.workers.dev'))

// This THROWS: "Transport not initialized. Call any async method first."
client.sql`SELECT * FROM users`.all()
```

**The fix:** Call any async method first to trigger transport initialization, or pass a pre-created transport instead of a factory:

```typescript
// Option 1: Call an async method first
const client = createDOClient(() => capnweb('wss://my-do.workers.dev'))
await client.schema()  // Triggers async transport init
const users = await client.sql`SELECT * FROM users`.all()  // Now works

// Option 2: Pass a pre-created transport (no factory)
const client = createDOClient(capnweb('wss://my-do.workers.dev'))
const users = await client.sql`SELECT * FROM users`.all()  // Works immediately
```

When you use the simpler `RPC(url)` API with a plain URL string, the transport is created synchronously, so this issue does not arise:

```typescript
// No factory function, transport is created immediately
const rpc = RPC('https://my-do.workers.dev')
const users = await rpc.sql`SELECT * FROM users`.all()  // Always works
```

### Which Features Require Sync Transport?

| Feature | Transport Access | Safe with Factory? |
|---------|-----------------|-------------------|
| `$.sql\`...\`` | Sync | No -- needs prior async call |
| `$.storage.*` | Sync | No -- needs prior async call |
| `$.collection(name)` | Sync | No -- needs prior async call |
| `$.methodName()` | Async | Yes |
| `$.dbSchema()` | Async | Yes |
| `$.schema()` | Async | Yes |
| `$.close()` | Async | Yes |

---

## Client vs Server Comparison

| Aspect | Client (`RpcClientMiddleware`) | Server (`ServerMiddleware`) |
|--------|-------------------------------|----------------------------|
| Location | Runs in your app (browser/Node.js) | Runs inside the Durable Object |
| Context parameter | No | Yes (`MiddlewareContext` with `env`, `request`) |
| onRequest execution | Sequential, in array order | Sequential, in array order |
| onResponse execution | Sequential, in array order | Sequential, in array order |
| onError execution | Sequential, in array order | **Reverse order** (like catch blocks) |
| Error propagation in hooks | Errors propagate normally | Errors are caught and logged |
| Can reject requests | No (hooks are observational) | Yes (throw in `onRequest`) |
| Retry support | Via `withRetry()` transport wrapper | Not applicable (request already on server) |
| Import path | `rpc.do/middleware` | `@dotdo/rpc` |
