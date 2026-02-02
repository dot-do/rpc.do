---
title: Error Handling
description: Patterns for handling errors in rpc.do applications
---

Proper error handling is essential for building robust RPC applications. This guide covers common patterns and best practices.

## Error Types

rpc.do provides typed error classes for different scenarios:

| Error Class | Description | Typical Cause |
|-------------|-------------|---------------|
| `ConnectionError` | Network/connection issues | Network down, timeout, auth failure |
| `RPCError` | Server-side RPC errors | Method not found, validation, business logic |
| `AuthenticationError` | HTTP 401 | Invalid or expired token |
| `RateLimitError` | HTTP 429 | Too many requests |
| `ProtocolVersionError` | Version mismatch | Client/server incompatible |

## Basic Pattern

```typescript
import { RPC } from 'rpc.do'
import { ConnectionError, RPCError } from 'rpc.do/errors'

const $ = RPC('https://api.example.com')

try {
  const user = await $.users.get('123')
} catch (error) {
  if (error instanceof ConnectionError) {
    // Network issue - might be retryable
    console.error('Connection error:', error.message)
    console.log('Retryable:', error.retryable)
  } else if (error instanceof RPCError) {
    // Server returned an error
    console.error('RPC error:', error.code, error.message)
    console.log('Additional data:', error.data)
  } else {
    // Unexpected error
    throw error
  }
}
```

## Connection Errors

### Retryable Errors

Some connection errors are safe to retry:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (error instanceof ConnectionError && error.retryable && attempt < maxAttempts) {
        console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
        delay *= 2  // Exponential backoff
        continue
      }
      throw error
    }
  }
  throw new Error('Unreachable')
}

// Usage
const user = await withRetry(() => $.users.get('123'))
```

### Using Retry Middleware

The built-in retry middleware handles this automatically:

```typescript
import { RPC } from 'rpc.do'
import { retryMiddleware } from 'rpc.do/middleware'

const $ = RPC('https://api.example.com', {
  middleware: [
    retryMiddleware({
      maxAttempts: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
      shouldRetry: (error) => {
        if (error instanceof ConnectionError) {
          return error.retryable
        }
        return false
      }
    })
  ]
})
```

## RPC Errors

### Error Codes

Handle specific error codes:

```typescript
try {
  await $.users.delete('123')
} catch (error) {
  if (error instanceof RPCError) {
    switch (error.code) {
      case 'NOT_FOUND':
        showNotification('User not found')
        break
      case 'FORBIDDEN':
        redirect('/access-denied')
        break
      case 'VALIDATION_ERROR':
        showValidationErrors(error.data as ValidationError[])
        break
      default:
        showGenericError(error.message)
    }
  }
}
```

### Throwing Errors from Server

Define meaningful error codes in your DO:

```typescript
import { DurableRPC, RPCError } from '@dotdo/rpc'

export class UserService extends DurableRPC {
  async getUser(id: string) {
    const user = await this.users.get(id)
    if (!user) {
      throw new RPCError('User not found', 'NOT_FOUND', { id })
    }
    return user
  }

  async updateUser(id: string, data: UpdateUserInput) {
    const errors = this.validateUser(data)
    if (errors.length > 0) {
      throw new RPCError('Validation failed', 'VALIDATION_ERROR', { errors })
    }

    // Check permissions
    if (!this.$.auth?.claims?.canEdit) {
      throw new RPCError('Edit permission required', 'FORBIDDEN')
    }

    // Update user
    await this.users.put(id, { ...await this.users.get(id), ...data })
    return this.users.get(id)
  }

  private validateUser(data: UpdateUserInput): ValidationError[] {
    const errors: ValidationError[] = []
    if (data.email && !data.email.includes('@')) {
      errors.push({ field: 'email', message: 'Invalid email format' })
    }
    return errors
  }
}
```

## Global Error Handler

Create a middleware for centralized error handling:

```typescript
import { RPC } from 'rpc.do'
import { ConnectionError, RPCError, AuthenticationError } from 'rpc.do/errors'

const errorHandler = {
  onError: async (method: string, error: unknown) => {
    // Log all errors
    console.error(`[RPC Error] ${method}:`, error)

    // Report to error tracking
    if (typeof Sentry !== 'undefined') {
      Sentry.captureException(error, {
        tags: { rpc_method: method },
      })
    }

    // Handle auth errors globally
    if (error instanceof AuthenticationError) {
      await refreshToken()
    }

    // Handle rate limits globally
    if (error instanceof RateLimitError) {
      showNotification('Too many requests. Please slow down.')
    }
  }
}

const $ = RPC('https://api.example.com', {
  middleware: [errorHandler]
})
```

## React Error Handling

### With useRPC Hook

```typescript
import { useRPC } from 'rpc.do/react'
import { ConnectionError, RPCError } from 'rpc.do/errors'

function UserProfile({ userId }: { userId: string }) {
  const { data: user, error, isLoading, refetch } = useRPC(
    () => $.users.get(userId),
    [userId]
  )

  if (isLoading) return <Spinner />

  if (error) {
    if (error instanceof ConnectionError) {
      return (
        <ErrorBox>
          <p>Connection failed. Please check your network.</p>
          {error.retryable && (
            <Button onClick={refetch}>Retry</Button>
          )}
        </ErrorBox>
      )
    }

    if (error instanceof RPCError && error.code === 'NOT_FOUND') {
      return <NotFound message="User not found" />
    }

    return <ErrorBox message={error.message} />
  }

  return <Profile user={user} />
}
```

### Error Boundary

```typescript
import { Component, ReactNode } from 'react'
import { RPCError } from 'rpc.do/errors'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

class RPCErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state

    if (error) {
      if (error instanceof RPCError) {
        return (
          <div className="error-boundary">
            <h2>Something went wrong</h2>
            <p>Error code: {error.code}</p>
            <p>{error.message}</p>
          </div>
        )
      }

      return this.props.fallback ?? <div>An error occurred</div>
    }

    return this.props.children
  }
}
```

## Timeout Handling

```typescript
import { RPC } from 'rpc.do'
import { ConnectionError } from 'rpc.do/errors'

const $ = RPC('https://api.example.com', {
  timeout: 10000  // 10 second timeout
})

try {
  await $.slowOperation()
} catch (error) {
  if (error instanceof ConnectionError && error.code === 'REQUEST_TIMEOUT') {
    showNotification('Request timed out. The server may be overloaded.')
  }
}
```

## Graceful Degradation

Provide fallback behavior when errors occur:

```typescript
async function getUser(id: string): Promise<User | null> {
  try {
    return await $.users.get(id)
  } catch (error) {
    if (error instanceof ConnectionError) {
      // Try cache
      const cached = await localCache.get(`user:${id}`)
      if (cached) {
        console.log('Using cached data due to connection error')
        return cached
      }
    }

    if (error instanceof RPCError && error.code === 'NOT_FOUND') {
      return null
    }

    throw error
  }
}
```

## Best Practices

1. **Always catch errors** - Never let RPC calls fail silently
2. **Use typed error classes** - Check `instanceof` for specific handling
3. **Respect retryable flag** - Only retry when `error.retryable` is true
4. **Log with context** - Include method name and arguments in logs
5. **Provide user feedback** - Show meaningful messages, not raw errors
6. **Use middleware** - Centralize common error handling logic
7. **Fail gracefully** - Have fallback behavior when possible
