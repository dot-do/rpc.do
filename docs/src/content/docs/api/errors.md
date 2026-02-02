---
title: Error Handling
description: Error classes and handling patterns
---

rpc.do provides typed error classes for different failure scenarios.

## Error Classes

### ConnectionError

Represents connection-related errors (network failures, timeouts, auth):

```typescript
import { ConnectionError } from 'rpc.do/errors'

try {
  await $.users.get('123')
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Code:', error.code)
    console.log('Retryable:', error.retryable)

    if (error.retryable) {
      // Safe to retry
    }
  }
}
```

#### ConnectionError Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `CONNECTION_FAILED` | Network error, server unreachable | Yes |
| `CONNECTION_TIMEOUT` | Connection attempt timed out | Yes |
| `CONNECTION_LOST` | Active connection was lost | Yes |
| `REQUEST_TIMEOUT` | Request exceeded timeout | Yes |
| `HEARTBEAT_TIMEOUT` | Server not responding to pings | Yes |
| `AUTH_FAILED` | Authentication failed | No |
| `RECONNECT_FAILED` | Max reconnection attempts reached | No |
| `INSECURE_CONNECTION` | Auth over insecure ws:// | No |

#### Factory Methods

```typescript
// Create specific error types
const timeout = ConnectionError.timeout(5000)
const authFailed = ConnectionError.authFailed('Invalid token')
const lost = ConnectionError.connectionLost('WebSocket closed')
const reconnectFailed = ConnectionError.reconnectFailed(5)
const heartbeat = ConnectionError.heartbeatTimeout()
const insecure = ConnectionError.insecureConnection()
const requestTimeout = ConnectionError.requestTimeout(30000)
```

### RPCError

Represents errors returned by the server during RPC execution:

```typescript
import { RPCError } from 'rpc.do/errors'

try {
  await $.admin.deleteUser('user-123')
} catch (error) {
  if (error instanceof RPCError) {
    console.log('Message:', error.message)
    console.log('Code:', error.code)
    console.log('Data:', error.data)

    switch (error.code) {
      case 'UNAUTHORIZED':
        redirect('/login')
        break
      case 'NOT_FOUND':
        showError('User not found')
        break
      case 'VALIDATION_ERROR':
        showValidationErrors(error.data)
        break
    }
  }
}
```

#### Common RPC Error Codes

| Code | Description |
|------|-------------|
| `METHOD_NOT_FOUND` | The requested method doesn't exist |
| `INVALID_PATH` | The method path is malformed |
| `UNKNOWN_NAMESPACE` | A namespace in the path doesn't exist |
| `UNKNOWN_METHOD` | Method exists but isn't callable |
| `MODULE_ERROR` | Required module is missing |
| `VALIDATION_ERROR` | Input validation failed |
| Custom codes | Your DO can define custom codes |

### AuthenticationError

Specific error for HTTP 401 responses:

```typescript
import { AuthenticationError } from 'rpc.do/errors'

try {
  await $.protected.resource()
} catch (error) {
  if (error instanceof AuthenticationError) {
    // Redirect to login or refresh token
  }
}
```

### RateLimitError

Specific error for HTTP 429 responses:

```typescript
import { RateLimitError } from 'rpc.do/errors'

try {
  await $.api.call()
} catch (error) {
  if (error instanceof RateLimitError) {
    if (error.retryAfter) {
      console.log(`Retry after ${error.retryAfter} seconds`)
      await sleep(error.retryAfter * 1000)
    }
  }
}
```

### ProtocolVersionError

Indicates client/server protocol mismatch:

```typescript
import { ProtocolVersionError } from 'rpc.do/errors'

try {
  await $.connect()
} catch (error) {
  if (error instanceof ProtocolVersionError) {
    console.log('Client version:', error.clientVersion)
    console.log('Server version:', error.serverVersion)
    console.log('Major mismatch:', error.isMajorMismatch)

    if (error.isMajorMismatch) {
      console.log('Please update your rpc.do package')
    }
  }
}

// Check version compatibility
if (!ProtocolVersionError.areCompatible('2.0.0', '2.1.0')) {
  // Handle version mismatch
}
```

## Error Handling Patterns

### Basic Try/Catch

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

try {
  const user = await $.users.get('123')
} catch (error) {
  if (error instanceof ConnectionError) {
    if (error.retryable) {
      // Retry logic
    } else {
      // Show connection error UI
    }
  } else if (error instanceof RPCError) {
    // Handle RPC error based on code
  } else {
    // Unknown error
    throw error
  }
}
```

### With Retry Middleware

```typescript
import { RPC } from 'rpc.do'
import { retryMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://api.example.com', {
  middleware: [
    retryMiddleware({
      maxAttempts: 3,
      shouldRetry: (error) => {
        // Custom retry logic
        if (error instanceof ConnectionError) {
          return error.retryable
        }
        return false
      },
      onRetry: (error, attempt) => {
        console.log(`Retry ${attempt} after error:`, error.message)
      }
    })
  ]
})
```

### Error Boundaries (React)

```typescript
import { useRPC } from 'rpc.do/react'
import { ConnectionError, RPCError } from 'rpc.do/errors'

function UserProfile({ userId }) {
  const { data, error, isLoading } = useRPC(
    () => $.users.get(userId),
    [userId]
  )

  if (error) {
    if (error instanceof ConnectionError) {
      return <ConnectionErrorUI error={error} />
    }
    if (error instanceof RPCError && error.code === 'NOT_FOUND') {
      return <UserNotFound />
    }
    return <GenericError error={error} />
  }

  if (isLoading) return <Loading />

  return <Profile user={data} />
}
```

### Global Error Handler

```typescript
const errorHandler = {
  onError: async (method, error) => {
    // Log all errors
    console.error(`[RPC Error] ${method}:`, error)

    // Report to error tracking
    errorTracker.captureException(error, {
      tags: { rpc_method: method }
    })

    // Handle specific cases globally
    if (error instanceof ConnectionError && error.code === 'AUTH_FAILED') {
      await logout()
      redirect('/login')
    }
  }
}

const $ = RPC('https://api.example.com', {
  middleware: [errorHandler]
})
```

## Throwing Errors from Your DO

```typescript
import { RPCError } from '@dotdo/rpc'  // Server package

export class UserService extends DurableRPC {
  async deleteUser(id: string) {
    const user = await this.users.get(id)

    if (!user) {
      throw new RPCError('User not found', 'NOT_FOUND', { id })
    }

    if (!this.$.auth?.isAdmin) {
      throw new RPCError('Admin access required', 'UNAUTHORIZED')
    }

    await this.users.delete(id)
    return { deleted: true }
  }

  async createUser(data: CreateUserInput) {
    const errors = validateUser(data)
    if (errors.length > 0) {
      throw new RPCError('Validation failed', 'VALIDATION_ERROR', { errors })
    }

    // ... create user
  }
}
```

## Type Exports

All error types are exported from `rpc.do/errors`:

```typescript
import {
  // Error classes
  ConnectionError,
  RPCError,
  RpcError,  // Alias for RPCError
  AuthenticationError,
  RateLimitError,
  ProtocolVersionError,

  // Type exports
  type ConnectionErrorCode,
  type RPCErrorType,
  type RPCErrorCode,
} from 'rpc.do/errors'
```
