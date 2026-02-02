---
title: Authentication
description: Securing your RPC endpoints with tokens and oauth.do
---

rpc.do supports multiple authentication patterns for securing your RPC endpoints.

## Client-Side Authentication

### Bearer Token

The simplest approach - pass a static token:

```typescript
import { RPC } from 'rpc.do'

const $ = RPC('https://my-do.workers.dev', {
  auth: 'sk_live_xxx'
})
```

### Dynamic Token Provider

For tokens that change (e.g., from session storage):

```typescript
const $ = RPC('https://my-do.workers.dev', {
  auth: async () => {
    const session = await getSession()
    return session?.accessToken ?? null
  }
})
```

### oauth.do Integration

Use oauth.do for managed authentication:

```typescript
import { RPC } from 'rpc.do'
import { oauthProvider } from 'rpc.do/auth'

const $ = RPC('https://my-do.workers.dev', {
  auth: oauthProvider()
})
```

## Server-Side Authentication

### Using the Router

The `@dotdo/rpc` router supports authentication middleware:

```typescript
import { router } from '@dotdo/rpc'

export default router<Env>({
  bindings: {
    users: 'USER_DO',
  },
  auth: async (request, env) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return { authorized: false }
    }

    // Validate the token
    const user = await validateToken(token, env)

    if (!user) {
      return { authorized: false }
    }

    return {
      authorized: true,
      id: user.id,
      claims: { role: user.role, email: user.email }
    }
  }
})
```

### In Your Durable Object

Access auth information via `this.$.auth`:

```typescript
import { DurableRPC } from '@dotdo/rpc'

export class UserService extends DurableRPC {
  async getProfile() {
    // Auth info from router middleware
    const userId = this.$.auth?.id
    const role = this.$.auth?.claims?.role

    if (!userId) {
      throw new Error('Not authenticated')
    }

    return this.users.get(userId)
  }

  async deleteUser(targetId: string) {
    // Check admin role
    if (this.$.auth?.claims?.role !== 'admin') {
      throw new Error('Admin access required')
    }

    return this.users.delete(targetId)
  }
}
```

## WebSocket Authentication

### First-Message Auth

For WebSocket connections with reconnection, use first-message auth:

```typescript
import { RPC, capnweb } from 'rpc.do'
import { oauthProvider } from 'rpc.do/auth'

const $ = RPC(capnweb('wss://my-do.workers.dev', {
  auth: oauthProvider(),
  reconnect: true,  // Required for first-message auth
}))
```

The auth token is sent in the first message after WebSocket connection, and automatically re-sent on reconnection.

### Security Notes

- Always use `wss://` (secure WebSocket) for authenticated connections
- The client refuses to send tokens over `ws://` by default
- For local development only, use `allowInsecureAuth: true`:

```typescript
// LOCAL DEV ONLY
const $ = RPC(capnweb('ws://localhost:8787', {
  auth: 'dev-token',
  reconnect: true,
  allowInsecureAuth: true,  // Never use in production!
}))
```

## JWT Validation

Example JWT validation in the router:

```typescript
import { router } from '@dotdo/rpc'
import * as jose from 'jose'

const JWKS = jose.createRemoteJWKSet(
  new URL('https://auth.example.com/.well-known/jwks.json')
)

export default router<Env>({
  bindings: { api: 'API_DO' },

  auth: async (request, env) => {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return { authorized: false }
    }

    try {
      const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: 'https://auth.example.com',
        audience: 'my-api',
      })

      return {
        authorized: true,
        id: payload.sub,
        claims: {
          email: payload.email,
          role: payload.role,
        }
      }
    } catch (error) {
      return { authorized: false }
    }
  }
})
```

## API Keys

For service-to-service authentication:

```typescript
import { router } from '@dotdo/rpc'

export default router<Env>({
  bindings: { api: 'API_DO' },

  auth: async (request, env) => {
    const apiKey = request.headers.get('X-API-Key')

    if (!apiKey) {
      return { authorized: false }
    }

    // Validate API key against KV or D1
    const keyData = await env.API_KEYS.get(apiKey, 'json')

    if (!keyData) {
      return { authorized: false }
    }

    return {
      authorized: true,
      id: keyData.clientId,
      claims: {
        scopes: keyData.scopes,
        rateLimit: keyData.rateLimit,
      }
    }
  }
})
```

## Role-Based Access Control

### Define Roles

```typescript
type Role = 'user' | 'moderator' | 'admin'

interface AuthClaims {
  role: Role
  permissions: string[]
}
```

### Check Permissions

```typescript
import { DurableRPC, RPCError } from '@dotdo/rpc'

export class AdminService extends DurableRPC {
  private requireRole(role: Role) {
    const userRole = this.$.auth?.claims?.role as Role
    const roleHierarchy: Role[] = ['user', 'moderator', 'admin']

    if (!userRole || roleHierarchy.indexOf(userRole) < roleHierarchy.indexOf(role)) {
      throw new RPCError('Insufficient permissions', 'FORBIDDEN')
    }
  }

  async listUsers() {
    this.requireRole('moderator')
    return this.users.list()
  }

  async deleteUser(id: string) {
    this.requireRole('admin')
    return this.users.delete(id)
  }
}
```

### Permission-Based

```typescript
export class ResourceService extends DurableRPC {
  private requirePermission(permission: string) {
    const permissions = this.$.auth?.claims?.permissions as string[] ?? []

    if (!permissions.includes(permission)) {
      throw new RPCError(`Missing permission: ${permission}`, 'FORBIDDEN')
    }
  }

  async readResource(id: string) {
    this.requirePermission('resource:read')
    return this.resources.get(id)
  }

  async writeResource(id: string, data: Resource) {
    this.requirePermission('resource:write')
    return this.resources.put(id, data)
  }
}
```

## Error Handling

```typescript
import { ConnectionError, RPCError } from 'rpc.do/errors'

try {
  await $.admin.deleteUser('user-123')
} catch (error) {
  if (error instanceof ConnectionError && error.code === 'AUTH_FAILED') {
    // Token expired or invalid - redirect to login
    redirect('/login')
  }

  if (error instanceof RPCError && error.code === 'FORBIDDEN') {
    // User lacks permission
    showError('You do not have permission to perform this action')
  }
}
```
