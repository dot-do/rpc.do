---
title: Migrating from tRPC
description: Guide for moving from tRPC to rpc.do
---

This guide helps you migrate from tRPC to rpc.do. While both provide type-safe RPC, rpc.do is purpose-built for Cloudflare Durable Objects with different design philosophies.

## Key Differences

| Aspect | tRPC | rpc.do |
|--------|------|--------|
| Primary target | Any backend | Cloudflare Durable Objects |
| Type generation | Router definition | Source extraction |
| Schema | Define with zod | Infer from TypeScript |
| Transport | HTTP adapters | HTTP, WebSocket, bindings |
| State | Stateless | Stateful (DO) |
| Collections | BYO database | Built-in MongoDB-style |
| Real-time | Subscriptions | WebSocket hibernation |

## Migration Steps

### 1. Server: Router to DurableRPC

**tRPC Router:**

```typescript
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

export const appRouter = t.router({
  users: t.router({
    get: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return db.users.findUnique({ where: { id: input.id } })
      }),

    create: t.procedure
      .input(z.object({
        name: z.string(),
        email: z.string().email(),
      }))
      .mutation(async ({ input }) => {
        return db.users.create({ data: input })
      }),

    list: t.procedure.query(async () => {
      return db.users.findMany()
    }),
  }),
})
```

**rpc.do DurableRPC:**

```typescript
import { DurableRPC } from '@dotdo/rpc'

interface User {
  name: string
  email: string
}

export class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async getUser(id: string) {
    return this.users.get(id)
  }

  async createUser(data: { name: string; email: string }) {
    const id = crypto.randomUUID()
    await this.users.put(id, data)
    return { id, ...data }
  }

  async listUsers() {
    return this.users.list()
  }
}
```

### 2. Client: Create Hook to RPC()

**tRPC Client:**

```typescript
import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from './server'

const trpc = createTRPCReact<AppRouter>()

function UserProfile({ userId }) {
  const { data, isLoading } = trpc.users.get.useQuery({ id: userId })

  if (isLoading) return <Spinner />
  return <Profile user={data} />
}
```

**rpc.do Client:**

```typescript
import { RPC } from 'rpc.do'
import { useRPC } from 'rpc.do/react'
import type { UserServiceAPI } from './.do'

const $ = RPC<UserServiceAPI>('https://my-do.workers.dev')

function UserProfile({ userId }) {
  const { data, isLoading } = useRPC(
    () => $.getUser(userId),
    [userId]
  )

  if (isLoading) return <Spinner />
  return <Profile user={data} />
}
```

### 3. Validation

**tRPC (built-in zod):**

```typescript
t.procedure
  .input(z.object({
    email: z.string().email(),
    age: z.number().min(18),
  }))
  .mutation(async ({ input }) => { ... })
```

**rpc.do (with validation middleware):**

```typescript
import { withValidation } from 'rpc.do/middleware'
import { z } from 'zod'

const schemas = {
  'createUser': {
    input: z.object({
      email: z.string().email(),
      age: z.number().min(18),
    })
  }
}

const $ = RPC(withValidation(http('https://...'), schemas))
```

Or validate in the DO:

```typescript
export class UserService extends DurableRPC {
  async createUser(data: CreateUserInput) {
    // Validate with zod
    const result = CreateUserSchema.safeParse(data)
    if (!result.success) {
      throw new RPCError('Validation failed', 'VALIDATION_ERROR', result.error.issues)
    }

    // Proceed with validated data
    return this.users.put(crypto.randomUUID(), result.data)
  }
}
```

### 4. Context and Auth

**tRPC:**

```typescript
const t = initTRPC.context<{
  user?: { id: string; role: string }
}>().create()

t.procedure.query(({ ctx }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return { userId: ctx.user.id }
})
```

**rpc.do:**

```typescript
// In router
export default router<Env>({
  auth: async (request, env) => {
    const user = await validateAuth(request)
    return { authorized: !!user, id: user?.id, claims: { role: user?.role } }
  }
})

// In DO
export class UserService extends DurableRPC {
  async getProfile() {
    if (!this.$.auth) throw new RPCError('Unauthorized', 'UNAUTHORIZED')
    return this.users.get(this.$.auth.id)
  }
}
```

### 5. Subscriptions to WebSocket

**tRPC Subscription:**

```typescript
t.procedure.subscription(() => {
  return observable<Message>((emit) => {
    const unsubscribe = messageEmitter.on('message', emit.next)
    return () => unsubscribe()
  })
})
```

**rpc.do WebSocket:**

```typescript
// Server
export class ChatRoom extends DurableRPC {
  async sendMessage(text: string) {
    const message = { text, timestamp: Date.now() }
    this.messages.put(crypto.randomUUID(), message)
    this.broadcast(JSON.stringify({ type: 'message', data: message }))
    return message
  }
}

// Client
const $ = RPC('wss://chat.workers.dev', { reconnect: true })

// Listen to WebSocket messages
$.on('message', (event) => {
  const { type, data } = JSON.parse(event.data)
  if (type === 'message') {
    addMessage(data)
  }
})
```

### 6. Middleware

**tRPC Middleware:**

```typescript
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next({ ctx: { user: ctx.user } })
})

const protectedProcedure = t.procedure.use(isAuthed)
```

**rpc.do Middleware:**

```typescript
// Client-side
const $ = RPC('https://...', {
  middleware: [
    loggingMiddleware(),
    retryMiddleware({ maxAttempts: 3 }),
  ]
})

// Server-side (in DO)
export class UserService extends DurableRPC {
  middleware = [
    {
      onRequest: async (ctx) => {
        if (!this.$.auth) throw new RPCError('Unauthorized', 'UNAUTHORIZED')
      }
    }
  ]
}
```

## Feature Mapping

| tRPC Feature | rpc.do Equivalent |
|--------------|-------------------|
| `query` | Method returning value |
| `mutation` | Method with side effects |
| `subscription` | WebSocket + broadcast |
| `input` (zod) | TypeScript types + validation middleware |
| `output` | Return type |
| `middleware` | Client or server middleware |
| `context` | `this.$.auth` / `this.$.request` |
| `useQuery` | `useRPC()` hook |
| `useMutation` | Direct method call |

## Advantages of rpc.do

1. **Built-in state** - Durable Objects have persistent storage
2. **Collections** - MongoDB-style queries included
3. **WebSocket hibernation** - Zero cost when idle
4. **Schema introspection** - API discovery at runtime
5. **Zero-config types** - Extract from source, no schema definition
6. **Multi-transport** - HTTP, WebSocket, service bindings

## When to Keep tRPC

- You're not using Cloudflare Workers
- You need complex validation at the type level
- You prefer explicit router definition
- You have heavy investment in tRPC tooling
