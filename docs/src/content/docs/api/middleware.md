---
title: Middleware
description: Request/response hooks for logging, timing, retry, and validation
---

rpc.do includes a middleware system for intercepting RPC calls at the client level.

## Using Middleware

Pass middleware to the `RPC()` options:

```typescript
import { RPC } from 'rpc.do'
import { loggingMiddleware, timingMiddleware, retryMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    loggingMiddleware(),
    timingMiddleware({ threshold: 100 }),
    retryMiddleware({ maxAttempts: 3 })
  ]
})
```

## Built-in Middleware

### Logging Middleware

Logs RPC calls, responses, and errors:

```typescript
import { loggingMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://api.example.com', {
  middleware: [
    loggingMiddleware()
  ]
})

// Output:
// [RPC] users.create called with: [{name: 'Alice'}]
// [RPC] users.create returned: {id: '123', name: 'Alice'}
```

#### Options

```typescript
interface LoggingOptions {
  /** Log level: 'debug' | 'info' | 'warn' | 'error' */
  level?: string

  /** Custom logger function */
  logger?: (level: string, message: string, data?: unknown) => void

  /** Include arguments in logs (default: true) */
  logArgs?: boolean

  /** Include response in logs (default: true) */
  logResponse?: boolean
}
```

### Timing Middleware

Tracks and reports RPC call duration:

```typescript
import { timingMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://api.example.com', {
  middleware: [
    timingMiddleware({ threshold: 100 })
  ]
})

// Only logs calls taking longer than 100ms:
// [RPC Timing] users.list took 250ms
```

#### Options

```typescript
interface TimingOptions {
  /** Only log calls exceeding this threshold (ms) */
  threshold?: number

  /** Custom handler for timing data */
  onTiming?: (method: string, durationMs: number) => void
}
```

### Retry Middleware

Automatically retries failed requests:

```typescript
import { retryMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://api.example.com', {
  middleware: [
    retryMiddleware({
      maxAttempts: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
    })
  ]
})
```

#### Options

```typescript
interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number

  /** Initial delay between retries in ms (default: 1000) */
  retryDelay?: number

  /** Multiply delay by this on each retry (default: 2) */
  backoffMultiplier?: number

  /** Maximum delay between retries in ms */
  maxDelay?: number

  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: unknown) => boolean

  /** Callback on each retry attempt */
  onRetry?: (error: unknown, attempt: number) => void
}
```

## Transport Wrappers

For transport-level middleware, use `withMiddleware` and `withRetry`:

### withMiddleware

Wrap a transport with middleware:

```typescript
import { http } from 'rpc.do/transports'
import { withMiddleware, loggingMiddleware } from 'rpc.do/middleware'

const transport = withMiddleware(
  http('https://api.example.com'),
  [loggingMiddleware()]
)

const $ = RPC(transport)
```

### withRetry

Wrap a transport with retry logic:

```typescript
import { http } from 'rpc.do/transports'
import { withRetry } from 'rpc.do/middleware'

const transport = withRetry(
  http('https://api.example.com'),
  { maxAttempts: 3, retryDelay: 1000 }
)

const $ = RPC(transport)
```

## Batching Middleware

Batch multiple RPC calls into a single request:

```typescript
import { withBatching, withDebouncedBatching } from 'rpc.do/middleware'

// Immediate batching (batch calls made in the same tick)
const transport = withBatching(http('https://api.example.com'), {
  maxBatchSize: 10,
})

// Debounced batching (wait for calls to accumulate)
const transport = withDebouncedBatching(http('https://api.example.com'), {
  maxBatchSize: 10,
  debounceMs: 50,
})
```

### Batching Options

```typescript
interface BatchingOptions {
  /** Maximum calls per batch */
  maxBatchSize?: number

  /** Debounce window in ms (for withDebouncedBatching) */
  debounceMs?: number
}
```

## Validation Middleware

Validate requests and responses with Zod or similar schemas:

```typescript
import { withValidation, ValidationError } from 'rpc.do/middleware'
import { z } from 'zod'

const schemas = {
  'users.create': {
    input: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    }),
  },
}

const transport = withValidation(http('https://api.example.com'), schemas, {
  onValidationError: (method, type, error) => {
    console.error(`Validation failed for ${method} ${type}:`, error)
  }
})

try {
  await $.users.create({ name: '', email: 'invalid' })
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues)  // Zod-style validation errors
  }
}
```

### Schema Utilities

```typescript
import { prefixSchemas, mergeSchemas } from 'rpc.do/middleware'

// Prefix all schema keys with a namespace
const adminSchemas = prefixSchemas(userSchemas, 'admin')
// 'users.create' becomes 'admin.users.create'

// Merge multiple schema objects
const allSchemas = mergeSchemas(userSchemas, adminSchemas, billingSchemas)
```

## Custom Middleware

Create custom middleware by implementing `RpcClientMiddleware`:

```typescript
interface RpcClientMiddleware {
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  onError?: (method: string, error: unknown) => void | Promise<void>
}
```

### Example: Analytics Middleware

```typescript
const analyticsMiddleware: RpcClientMiddleware = {
  onRequest(method, args) {
    analytics.track('rpc_call_started', { method })
  },
  onResponse(method, result) {
    analytics.track('rpc_call_succeeded', { method })
  },
  onError(method, error) {
    analytics.track('rpc_call_failed', { method, error: String(error) })
  },
}

const $ = RPC('https://api.example.com', {
  middleware: [analyticsMiddleware]
})
```

### Example: Caching Middleware

```typescript
const cache = new Map<string, { value: unknown; expires: number }>()

const cachingMiddleware = (ttlMs: number): RpcClientMiddleware => {
  const pending = new Map<string, Promise<unknown>>()

  return {
    async onRequest(method, args) {
      const key = `${method}:${JSON.stringify(args)}`
      const cached = cache.get(key)

      if (cached && cached.expires > Date.now()) {
        // Short-circuit by throwing with the cached value
        // (You'd need to handle this specially in your transport)
      }
    },
    onResponse(method, result) {
      const key = `${method}:${JSON.stringify([])}`  // simplified
      cache.set(key, {
        value: result,
        expires: Date.now() + ttlMs,
      })
    },
  }
}
```

## Middleware Order

Middleware executes in order:
1. `onRequest` hooks run in array order (first to last)
2. The RPC call is made
3. `onResponse` or `onError` hooks run in array order

```typescript
const $ = RPC('https://api.example.com', {
  middleware: [
    loggingMiddleware(),   // 1st: log request
    timingMiddleware(),    // 2nd: start timer
    retryMiddleware(),     // 3rd: handle retries
  ]
})
```
