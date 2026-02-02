# Error Handling Guide

This guide covers the error handling system in rpc.do, including the error class hierarchy, error codes, retry strategies, and best practices.

## Table of Contents

- [Error Class Hierarchy](#error-class-hierarchy)
- [ConnectionError](#connectionerror)
- [RPCError](#rpcerror)
- [AuthenticationError](#authenticationerror)
- [RateLimitError](#ratelimiterror)
- [ProtocolVersionError](#protocolversionerror)
- [Retryable vs Non-Retryable Errors](#retryable-vs-non-retryable-errors)
- [Middleware Error Hooks](#middleware-error-hooks)
- [Best Practices](#best-practices)
- [Code Examples](#code-examples)

---

## Error Class Hierarchy

rpc.do provides a structured error hierarchy for handling different failure scenarios:

```
Error (JavaScript built-in)
├── ConnectionError
│   ├── CONNECTION_TIMEOUT (retryable)
│   ├── AUTH_FAILED (non-retryable)
│   ├── CONNECTION_LOST (retryable)
│   ├── RECONNECT_FAILED (non-retryable)
│   ├── HEARTBEAT_TIMEOUT (retryable)
│   ├── INSECURE_CONNECTION (non-retryable)
│   ├── REQUEST_TIMEOUT (retryable)
│   ├── QUEUE_FULL (non-retryable)
│   └── CONNECTION_FAILED (retryable)
├── RPCError
│   ├── METHOD_NOT_FOUND
│   ├── INVALID_PATH
│   ├── UNKNOWN_NAMESPACE
│   ├── UNKNOWN_METHOD
│   ├── MODULE_ERROR
│   ├── REQUEST_ERROR
│   ├── UNKNOWN_ERROR
│   └── Custom codes (from your DO)
├── AuthenticationError (HTTP 401)
├── RateLimitError (HTTP 429)
└── ProtocolVersionError
```

All error classes are exported from `rpc.do/errors`:

```typescript
import {
  ConnectionError,
  RPCError,
  AuthenticationError,
  RateLimitError,
  ProtocolVersionError,
} from 'rpc.do/errors'
```

---

## ConnectionError

`ConnectionError` represents errors that occur during WebSocket connection establishment, authentication, or during an active connection.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `code` | `ConnectionErrorCode` | Error code for programmatic handling |
| `retryable` | `boolean` | Whether this error is retryable |
| `message` | `string` | Human-readable error message |

### Error Codes

#### CONNECTION_TIMEOUT (Retryable)

Thrown when a connection cannot be established within the configured timeout period.

```typescript
// When it occurs:
// - Initial WebSocket connection takes too long
// - DNS resolution is slow
// - Server is under heavy load

const error = ConnectionError.timeout(5000)
// error.code: 'CONNECTION_TIMEOUT'
// error.message: 'Connection timeout after 5000ms'
// error.retryable: true
```

#### AUTH_FAILED (Non-Retryable)

Thrown when authentication fails. Credentials need to be fixed before retrying.

```typescript
// When it occurs:
// - Invalid API token
// - Expired credentials
// - Missing authentication
// - Token revoked

const error = ConnectionError.authFailed('Invalid token')
// error.code: 'AUTH_FAILED'
// error.message: 'Invalid token'
// error.retryable: false
```

#### CONNECTION_LOST (Retryable)

Thrown when an established connection is unexpectedly terminated.

```typescript
// When it occurs:
// - WebSocket closed by server
// - Network disconnection
// - Server restart
// - Load balancer timeout

const error = ConnectionError.connectionLost('WebSocket closed unexpectedly')
// error.code: 'CONNECTION_LOST'
// error.message: 'WebSocket closed unexpectedly'
// error.retryable: true
```

#### RECONNECT_FAILED (Non-Retryable)

Thrown when the maximum number of reconnection attempts has been reached.

```typescript
// When it occurs:
// - Server is down for extended period
// - Network is completely unavailable
// - Max reconnection attempts exhausted

const error = ConnectionError.reconnectFailed(5)
// error.code: 'RECONNECT_FAILED'
// error.message: 'Failed to reconnect after 5 attempts'
// error.retryable: false
```

#### HEARTBEAT_TIMEOUT (Retryable)

Thrown when the server does not respond to ping messages within the timeout period.

```typescript
// When it occurs:
// - Server is unresponsive but connection is open
// - Network latency spike
// - Server is overloaded

const error = ConnectionError.heartbeatTimeout()
// error.code: 'HEARTBEAT_TIMEOUT'
// error.message: 'Connection heartbeat timeout - server not responding'
// error.retryable: true
```

#### INSECURE_CONNECTION (Non-Retryable)

Thrown when attempting to send auth credentials over an insecure `ws://` connection.

```typescript
// When it occurs:
// - Using ws:// with auth token
// - Security protection to prevent credential leakage

const error = ConnectionError.insecureConnection()
// error.code: 'INSECURE_CONNECTION'
// error.message: 'SECURITY ERROR: Refusing to send authentication token over insecure ws:// connection...'
// error.retryable: false

// To bypass for local development only:
const transport = capnweb('ws://localhost:8787', {
  auth: 'my-token',
  allowInsecureAuth: true,  // WARNING: Only for local dev!
})
```

#### REQUEST_TIMEOUT (Retryable)

Thrown when an individual RPC request exceeds the configured timeout.

```typescript
// When it occurs:
// - Slow server-side processing
// - Network latency
// - Server queuing requests

const error = ConnectionError.requestTimeout(5000)
// error.code: 'REQUEST_TIMEOUT'
// error.message: 'Request timeout after 5000ms'
// error.retryable: true
```

#### QUEUE_FULL (Non-Retryable)

Thrown when the message queue is full (backpressure handling).

```typescript
// When it occurs:
// - Sending messages faster than they can be processed
// - Connection is slow or disconnected
// - queueFullBehavior is set to 'error'

const error = ConnectionError.queueFull('send', 1000)
// error.code: 'QUEUE_FULL'
// error.message: 'Send queue is full (max 1000 messages)...'
// error.retryable: false
```

---

## RPCError

`RPCError` represents errors that occur during RPC method execution on the server.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `code` | `string` | Error code from server for programmatic handling |
| `data` | `unknown` | Optional additional error data (validation errors, etc.) |
| `message` | `string` | Human-readable error message |

### Common Error Codes

#### METHOD_NOT_FOUND

The requested method does not exist on the server.

```typescript
// When it occurs:
// - Typo in method name
// - Method was removed or renamed
// - Calling undefined namespace

try {
  await $.nonExistentMethod()
} catch (error) {
  if (error instanceof RPCError && error.code === 'METHOD_NOT_FOUND') {
    console.error('Method does not exist')
  }
}
```

#### INVALID_PATH

The method path is malformed.

```typescript
// When it occurs:
// - Empty method path
// - Invalid characters in path
// - Navigating non-traversable value

try {
  await transport.call('invalid..path', [])
} catch (error) {
  if (error instanceof RPCError && error.code === 'INVALID_PATH') {
    console.error('Path format is invalid')
  }
}
```

#### UNKNOWN_NAMESPACE

A namespace in the path doesn't exist.

```typescript
// When it occurs:
// - Service binding doesn't have the namespace
// - Intermediate path segment is undefined

try {
  await $.admin.nonExistent.method()
} catch (error) {
  if (error instanceof RPCError && error.code === 'UNKNOWN_NAMESPACE') {
    console.error('Namespace not found:', error.message)
  }
}
```

#### UNKNOWN_METHOD

Method exists but is not callable.

```typescript
// When it occurs:
// - Property exists but is not a function
// - Method was removed

try {
  await $.users.notAFunction()
} catch (error) {
  if (error instanceof RPCError && error.code === 'UNKNOWN_METHOD') {
    console.error('Method is not callable')
  }
}
```

### Custom Error Codes

Your Durable Object can throw custom RPCErrors:

```typescript
// In your DurableRPC class
async deleteUser(id: string) {
  const user = this.users.get(id)
  if (!user) {
    throw new RPCError('User not found', 'NOT_FOUND', { id })
  }
  if (!this.$.auth?.isAdmin) {
    throw new RPCError('Admin access required', 'UNAUTHORIZED')
  }
  // ... delete user
}

// Client-side handling
try {
  await $.deleteUser('user-123')
} catch (error) {
  if (error instanceof RPCError) {
    switch (error.code) {
      case 'NOT_FOUND':
        showError('User not found')
        break
      case 'UNAUTHORIZED':
        redirect('/login')
        break
      case 'VALIDATION_ERROR':
        showValidationErrors(error.data)
        break
    }
  }
}
```

---

## AuthenticationError

`AuthenticationError` represents HTTP 401 authentication failures.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `401` | HTTP status code |
| `message` | `string` | Error message |

```typescript
import { AuthenticationError } from 'rpc.do/errors'

try {
  await rpc.protected.resource()
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error(`Auth failed: ${error.message}`)
    // Redirect to login or refresh token
    await refreshToken()
  }
}
```

---

## RateLimitError

`RateLimitError` represents HTTP 429 Too Many Requests responses.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `429` | HTTP status code |
| `retryAfter` | `number \| undefined` | Seconds to wait before retrying |
| `message` | `string` | Error message |

```typescript
import { RateLimitError } from 'rpc.do/errors'

async function callWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof RateLimitError) {
      if (error.retryAfter) {
        console.log(`Rate limited. Retry after ${error.retryAfter} seconds`)
        await delay(error.retryAfter * 1000)
        return callWithRateLimit(fn)  // Retry
      }
      throw error  // No retry-after, can't auto-retry
    }
    throw error
  }
}
```

---

## ProtocolVersionError

`ProtocolVersionError` is thrown when the server's protocol version is incompatible with the client.

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `clientVersion` | `string` | The protocol version the client supports |
| `serverVersion` | `string` | The protocol version the server reported |
| `isMajorMismatch` | `boolean` | Whether this is a breaking version mismatch |

```typescript
import { ProtocolVersionError } from 'rpc.do/errors'

transport.on('error', (error) => {
  if (error instanceof ProtocolVersionError) {
    console.error(`Protocol mismatch: client v${error.clientVersion}, server v${error.serverVersion}`)
    if (error.isMajorMismatch) {
      console.error('BREAKING: Please update your rpc.do package')
    }
  }
})
```

---

## Retryable vs Non-Retryable Errors

Understanding which errors can be retried is crucial for building resilient applications.

### Retryable Errors

These errors are typically transient and can succeed on retry:

| Error | Code | Why Retryable |
|-------|------|---------------|
| `ConnectionError` | `CONNECTION_TIMEOUT` | Network congestion may clear |
| `ConnectionError` | `CONNECTION_LOST` | Connection can be re-established |
| `ConnectionError` | `HEARTBEAT_TIMEOUT` | Server may become responsive |
| `ConnectionError` | `REQUEST_TIMEOUT` | Server may complete faster |
| `ConnectionError` | `CONNECTION_FAILED` | Network may recover |
| `RPCError` | `UNAVAILABLE` | Server may become available |
| `RPCError` | `DEADLINE_EXCEEDED` | Request may complete in time |
| `RPCError` | `RESOURCE_EXHAUSTED` | Resources may free up |

### Non-Retryable Errors

These errors require intervention before retrying:

| Error | Code | Why Not Retryable |
|-------|------|-------------------|
| `ConnectionError` | `AUTH_FAILED` | Credentials need to be fixed |
| `ConnectionError` | `RECONNECT_FAILED` | Max attempts reached |
| `ConnectionError` | `INSECURE_CONNECTION` | Security issue |
| `ConnectionError` | `QUEUE_FULL` | Backpressure issue |
| `AuthenticationError` | - | Credentials invalid |
| `RPCError` | `METHOD_NOT_FOUND` | Code issue |
| `RPCError` | `INVALID_PATH` | Code issue |
| `RPCError` | `VALIDATION_ERROR` | Input invalid |

### Checking Retryability

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

function isRetryable(error: unknown): boolean {
  // ConnectionError has explicit retryable flag
  if (error instanceof ConnectionError) {
    return error.retryable
  }

  // RPCError: only certain codes are retryable
  if (error instanceof RPCError) {
    const code = error.code.toUpperCase()
    return (
      code === 'UNAVAILABLE' ||
      code === 'DEADLINE_EXCEEDED' ||
      code === 'RESOURCE_EXHAUSTED'
    )
  }

  // Generic network errors are typically retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    )
  }

  return false
}
```

---

## Middleware Error Hooks

rpc.do middleware can intercept errors for logging, metrics, or transformation.

### Middleware Interface

```typescript
type RpcClientMiddleware = {
  /** Called before the RPC call is made */
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  /** Called after a successful response */
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (method: string, error: unknown) => void | Promise<void>
}
```

### Error Logging Middleware

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

const errorLoggingMiddleware: RpcClientMiddleware = {
  async onError(method: string, error: unknown) {
    if (error instanceof ConnectionError) {
      console.error(`[Connection Error] ${method}:`, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      })
    } else if (error instanceof RPCError) {
      console.error(`[RPC Error] ${method}:`, {
        code: error.code,
        message: error.message,
        data: error.data,
      })
    } else {
      console.error(`[Unknown Error] ${method}:`, error)
    }
  },
}
```

### Error Metrics Middleware

```typescript
const metricsMiddleware: RpcClientMiddleware = {
  async onError(method: string, error: unknown) {
    if (error instanceof ConnectionError) {
      metrics.increment('rpc.connection_error', {
        method,
        code: error.code,
        retryable: String(error.retryable),
      })
    } else if (error instanceof RPCError) {
      metrics.increment('rpc.rpc_error', {
        method,
        code: error.code,
      })
    }
  },
}
```

### Using Middleware with RPC

```typescript
const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    errorLoggingMiddleware,
    metricsMiddleware,
  ],
})
```

---

## Best Practices

### 1. Always Use Specific Error Types

```typescript
// Bad - loses error information
try {
  await $.method()
} catch (error) {
  console.error('Something went wrong')
}

// Good - handle specific error types
try {
  await $.method()
} catch (error) {
  if (error instanceof ConnectionError) {
    handleConnectionError(error)
  } else if (error instanceof RPCError) {
    handleRPCError(error)
  } else if (error instanceof AuthenticationError) {
    handleAuthError(error)
  } else {
    handleUnknownError(error)
  }
}
```

### 2. Use the withRetry Transport Wrapper

For automatic retries with exponential backoff:

```typescript
import { http, withRetry } from 'rpc.do/transports'

const transport = withRetry(http('https://api.example.com'), {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
  jitter: true,
  onRetry: (method, error, attempt, delay) => {
    console.log(`Retrying ${method} (attempt ${attempt}) after ${delay}ms`)
  },
})

const $ = RPC(transport)
```

### 3. Configure Reconnection for WebSocket

```typescript
import { capnweb } from 'rpc.do/transports'

const transport = capnweb('wss://api.example.com/rpc', {
  reconnect: true,
  reconnectOptions: {
    maxReconnectAttempts: 10,
    reconnectBackoff: 1000,
    maxReconnectBackoff: 30000,
    onConnect: () => console.log('Connected'),
    onDisconnect: (reason) => console.log('Disconnected:', reason),
    onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
    onError: (error) => console.error('Transport error:', error),
  },
})
```

### 4. Handle Queue Backpressure

```typescript
import { reconnectingWs } from 'rpc.do/transports'

const transport = reconnectingWs('wss://api.example.com/rpc', {
  maxQueueSize: 100,
  queueFullBehavior: 'drop-oldest',  // or 'error', 'drop-newest'
})

// Monitor queue depth
setInterval(() => {
  const depth = transport.getQueueDepth()
  if (depth.send > depth.maxSize * 0.8) {
    console.warn('Send queue is 80% full, consider slowing down')
  }
}, 1000)
```

### 5. Graceful Degradation

```typescript
import { composite, capnweb, http } from 'rpc.do/transports'

// Try WebSocket first, fall back to HTTP
const transport = composite(
  capnweb('wss://api.example.com/rpc', { reconnect: true }),
  http('https://api.example.com/rpc'),
)

const $ = RPC(transport)
```

### 6. User-Friendly Error Messages

```typescript
function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof ConnectionError) {
    switch (error.code) {
      case 'CONNECTION_TIMEOUT':
        return 'Connection is taking too long. Please check your network.'
      case 'CONNECTION_LOST':
        return 'Connection was lost. Reconnecting...'
      case 'AUTH_FAILED':
        return 'Please log in again.'
      case 'RECONNECT_FAILED':
        return 'Unable to connect to server. Please try again later.'
      default:
        return 'A connection error occurred.'
    }
  }

  if (error instanceof RPCError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return 'The requested resource was not found.'
      case 'UNAUTHORIZED':
        return 'You do not have permission to perform this action.'
      case 'VALIDATION_ERROR':
        return 'Please check your input and try again.'
      default:
        return error.message
    }
  }

  if (error instanceof RateLimitError) {
    return `Too many requests. Please wait ${error.retryAfter || 'a moment'} and try again.`
  }

  return 'An unexpected error occurred.'
}
```

---

## Code Examples

### Complete Error Handling Example

```typescript
import { RPC } from 'rpc.do'
import { capnweb, withRetry } from 'rpc.do/transports'
import {
  ConnectionError,
  RPCError,
  AuthenticationError,
  RateLimitError,
} from 'rpc.do/errors'

// Configure transport with retry and reconnection
const transport = withRetry(
  capnweb('wss://api.example.com/rpc', {
    auth: () => getAuthToken(),
    reconnect: true,
    reconnectOptions: {
      maxReconnectAttempts: 5,
      onReconnecting: (attempt) => showReconnecting(attempt),
      onError: (error) => logError(error),
    },
  }),
  {
    maxAttempts: 3,
    onRetry: (method, error, attempt) => {
      console.log(`Retrying ${method}, attempt ${attempt}`)
    },
  }
)

const $ = RPC(transport)

// API call with comprehensive error handling
async function fetchUserData(userId: string) {
  try {
    return await $.users.get(userId)
  } catch (error) {
    // Connection-level errors
    if (error instanceof ConnectionError) {
      if (error.code === 'AUTH_FAILED') {
        await refreshAuth()
        return fetchUserData(userId)  // Retry with new auth
      }
      if (!error.retryable) {
        showError('Unable to connect to server')
        return null
      }
      // Retryable errors are handled by withRetry
      throw error
    }

    // RPC errors from server
    if (error instanceof RPCError) {
      if (error.code === 'NOT_FOUND') {
        return null  // User doesn't exist
      }
      if (error.code === 'VALIDATION_ERROR') {
        showValidationErrors(error.data)
        return null
      }
      throw error
    }

    // Authentication errors
    if (error instanceof AuthenticationError) {
      await logout()
      redirect('/login')
      return null
    }

    // Rate limiting
    if (error instanceof RateLimitError) {
      if (error.retryAfter) {
        await delay(error.retryAfter * 1000)
        return fetchUserData(userId)
      }
      showError('Too many requests. Please wait.')
      return null
    }

    // Unknown errors
    console.error('Unexpected error:', error)
    throw error
  }
}
```

### Error Boundary Pattern (React)

```typescript
import { Component, ReactNode } from 'react'
import { ConnectionError, RPCError } from 'rpc.do/errors'

interface Props {
  children: ReactNode
  fallback: (error: Error, retry: () => void) => ReactNode
}

interface State {
  error: Error | null
}

class RPCErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  retry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error) {
      return this.props.fallback(error, this.retry)
    }
    return this.props.children
  }
}

// Usage
function App() {
  return (
    <RPCErrorBoundary
      fallback={(error, retry) => (
        <div>
          <h2>Something went wrong</h2>
          <p>{getUserFriendlyMessage(error)}</p>
          {error instanceof ConnectionError && error.retryable && (
            <button onClick={retry}>Retry</button>
          )}
        </div>
      )}
    >
      <MyComponent />
    </RPCErrorBoundary>
  )
}
```

### Typed Error Handling with Discriminated Unions

```typescript
type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ConnectionError; type: 'connection' }
  | { success: false; error: RPCError; type: 'rpc' }
  | { success: false; error: AuthenticationError; type: 'auth' }
  | { success: false; error: Error; type: 'unknown' }

async function safeCall<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn()
    return { success: true, data }
  } catch (error) {
    if (error instanceof ConnectionError) {
      return { success: false, error, type: 'connection' }
    }
    if (error instanceof RPCError) {
      return { success: false, error, type: 'rpc' }
    }
    if (error instanceof AuthenticationError) {
      return { success: false, error, type: 'auth' }
    }
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      type: 'unknown',
    }
  }
}

// Usage with exhaustive type checking
const result = await safeCall(() => $.users.get('123'))

if (result.success) {
  console.log('User:', result.data)
} else {
  switch (result.type) {
    case 'connection':
      console.log('Connection error:', result.error.code)
      break
    case 'rpc':
      console.log('RPC error:', result.error.code)
      break
    case 'auth':
      console.log('Auth error')
      break
    case 'unknown':
      console.log('Unknown error:', result.error.message)
      break
  }
}
```

---

## Summary

| Error Class | When to Use | Retryable |
|-------------|-------------|-----------|
| `ConnectionError` | Network, transport, connection issues | Check `error.retryable` |
| `RPCError` | Server-side method execution errors | Usually no |
| `AuthenticationError` | HTTP 401 - invalid credentials | No (fix credentials) |
| `RateLimitError` | HTTP 429 - too many requests | Yes (after `retryAfter`) |
| `ProtocolVersionError` | Client/server version mismatch | No (update SDK) |

Key takeaways:

1. Always check error type with `instanceof`
2. Use `error.retryable` for `ConnectionError`
3. Use `withRetry()` transport wrapper for automatic retries
4. Configure reconnection options for WebSocket transports
5. Provide user-friendly error messages
6. Log errors with middleware for observability
