# Migrating from tRPC to rpc.do

This guide helps you migrate your existing tRPC application to rpc.do. The migration can be done incrementally, allowing both systems to coexist during the transition.

## Why Migrate?

| Aspect | tRPC | rpc.do |
|--------|------|--------|
| Bundle size | ~15KB | ~3KB |
| Transport | HTTP only | HTTP, WebSocket, Cloudflare Bindings, postMessage |
| Mental model | Routers, procedures, middleware | Simple dispatch function |
| Cloudflare | Adapter required | Native support |

### Key Benefits

- **Bundle size reduction**: rpc.do is ~5x smaller than tRPC, making it ideal for edge deployments
- **Transport flexibility**: Switch between HTTP, WebSocket, or Cloudflare Service Bindings without changing your API
- **Simpler mental model**: No routers, procedures, or complex middleware chains
- **Cloudflare-native**: Built for Workers, Durable Objects, and Service Bindings from the ground up

## Conceptual Differences

### tRPC Routers vs rpc.do Transports

tRPC organizes code into routers with nested procedures:

```typescript
// tRPC: Routers define structure
const userRouter = router({
  get: publicProcedure.query(...),
  create: publicProcedure.mutation(...),
})

const appRouter = router({
  user: userRouter,
})
```

rpc.do uses transports to define how calls are made, with a simple dispatch function:

```typescript
// rpc.do: Transports define communication
const rpc = RPC<API>(http('/api/rpc'))
// or
const rpc = RPC<API>(ws('wss://api.example.com'))
// or
const rpc = RPC<API>(binding(env.MY_SERVICE))
```

### tRPC Procedures vs rpc.do Methods

tRPC distinguishes between queries and mutations:

```typescript
// tRPC: Explicit procedure types
const router = router({
  getUser: publicProcedure.query(({ input }) => ...),
  createUser: publicProcedure.mutation(({ input }) => ...),
})
```

rpc.do treats everything as a method call:

```typescript
// rpc.do: Just methods
await rpc.getUser({ id: '123' })
await rpc.createUser({ name: 'Alice' })
```

### tRPC Context vs rpc.do Context

tRPC uses a context creator function:

```typescript
// tRPC: Context creation
const createContext = ({ req }) => ({
  user: getUserFromRequest(req),
})
```

rpc.do passes context directly to the dispatch function:

```typescript
// rpc.do: Context in dispatch
createRpcHandler({
  dispatch: (method, args, ctx) => {
    const user = ctx.user // Access context directly
  }
})
```

### Schema Validation Approach

tRPC has built-in Zod integration:

```typescript
// tRPC: Built-in validation
publicProcedure
  .input(z.object({ name: z.string() }))
  .query(({ input }) => ...)
```

rpc.do is validation-agnostic—add your own:

```typescript
// rpc.do: Bring your own validation
import { z } from 'zod'

const schema = z.object({ name: z.string() })

createRpcHandler({
  dispatch: (method, args) => {
    if (method === 'greeting') {
      const input = schema.parse(args[0]) // Validate manually
      return `Hello ${input.name}`
    }
  }
})
```

## Code Transformations

### tRPC Router → rpc.do Handler

**Before (tRPC):**

```typescript
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

const appRouter = t.router({
  greeting: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => `Hello ${input.name}`),

  user: t.router({
    get: t.procedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => getUserById(input.id)),

    create: t.procedure
      .input(z.object({ name: z.string(), email: z.string() }))
      .mutation(({ input }) => createUser(input)),
  }),
})

export type AppRouter = typeof appRouter
```

**After (rpc.do):**

```typescript
import { createRpcHandler } from '@dotdo/rpc'

// Define your API type
type API = {
  greeting(input: { name: string }): string
  'user.get'(input: { id: string }): User
  'user.create'(input: { name: string; email: string }): User
}

export default createRpcHandler({
  dispatch: (method, args) => {
    switch (method) {
      case 'greeting':
        return `Hello ${args[0].name}`
      case 'user.get':
        return getUserById(args[0].id)
      case 'user.create':
        return createUser(args[0])
      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }
})
```

### tRPC Client → rpc.do Client

**Before (tRPC):**

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from './server'

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc',
    }),
  ],
})

// Usage
const greeting = await trpc.greeting.query({ name: 'World' })
const user = await trpc.user.get.query({ id: '123' })
const newUser = await trpc.user.create.mutate({ name: 'Alice', email: 'alice@example.com' })
```

**After (rpc.do):**

```typescript
import { RPC, http } from '@dotdo/rpc'
import type { API } from './server'

const rpc = RPC<API>(http('http://localhost:3000/rpc'))

// Usage
const greeting = await rpc.greeting({ name: 'World' })
const user = await rpc['user.get']({ id: '123' })
const newUser = await rpc['user.create']({ name: 'Alice', email: 'alice@example.com' })
```

### tRPC Middleware → rpc.do Dispatch Wrapper

**Before (tRPC):**

```typescript
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { user: ctx.user } })
})

const protectedProcedure = t.procedure.use(isAuthed)
```

**After (rpc.do):**

```typescript
import { RpcError } from '@dotdo/rpc'

const protectedMethods = ['user.create', 'user.delete']

createRpcHandler({
  dispatch: (method, args, ctx) => {
    // Auth middleware equivalent
    if (protectedMethods.includes(method) && !ctx.user) {
      throw new RpcError('UNAUTHORIZED', 'Authentication required')
    }

    // Route to handlers
    return handlers[method]?.(args[0], ctx)
  }
})
```

## Step-by-Step Migration

### 1. Install rpc.do

```bash
npm install @dotdo/rpc
```

### 2. Start with One Endpoint

Pick a simple, low-risk endpoint to migrate first:

```typescript
// Keep your tRPC router
const appRouter = t.router({
  // ... existing procedures
})

// Add rpc.do handler alongside
export const rpcHandler = createRpcHandler({
  dispatch: (method, args) => {
    if (method === 'health') return { status: 'ok' }
  }
})
```

### 3. Run Both Systems

Mount both handlers on different paths:

```typescript
// Express example
app.use('/trpc', trpcHandler)
app.use('/rpc', rpcHandler)

// Cloudflare Workers example
export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/trpc')) return trpcHandler(request)
    if (url.pathname.startsWith('/rpc')) return rpcHandler(request)
  }
}
```

### 4. Migrate Clients Gradually

Update clients one at a time:

```typescript
// Old client code
const result = await trpc.greeting.query({ name: 'World' })

// New client code
const result = await rpc.greeting({ name: 'World' })
```

### 5. Remove tRPC When Done

Once all endpoints and clients are migrated:

```bash
npm uninstall @trpc/server @trpc/client
```

## What You Lose

### Built-in Zod Validation

tRPC validates input automatically. With rpc.do, add validation manually:

```typescript
import { z } from 'zod'

const schemas = {
  greeting: z.object({ name: z.string() }),
  'user.create': z.object({ name: z.string(), email: z.string().email() }),
}

createRpcHandler({
  dispatch: (method, args) => {
    const schema = schemas[method]
    if (schema) {
      const result = schema.safeParse(args[0])
      if (!result.success) {
        throw new RpcError('BAD_REQUEST', result.error.message)
      }
    }
    return handlers[method](args[0])
  }
})
```

### tRPC DevTools

The tRPC panel browser extension won't work. Use standard browser DevTools Network tab instead.

### React Query Integration

tRPC's `@trpc/react-query` wrapper is not available. Use TanStack Query directly:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query'
import { rpc } from './rpc-client'

// Before (tRPC)
const { data } = trpc.user.get.useQuery({ id: '123' })

// After (rpc.do + React Query)
const { data } = useQuery({
  queryKey: ['user', '123'],
  queryFn: () => rpc['user.get']({ id: '123' }),
})
```

## What You Gain

### Transport Flexibility

Switch transports without changing your API:

```typescript
// Development: HTTP
const rpc = RPC<API>(http('/api/rpc'))

// Production: WebSocket for real-time
const rpc = RPC<API>(ws('wss://api.example.com'))

// Cloudflare: Service Bindings for zero-latency
const rpc = RPC<API>(binding(env.MY_SERVICE))
```

### Smaller Bundle

rpc.do's minimal footprint is ideal for edge deployments where every kilobyte matters.

### Simpler Setup

No routers, no procedure builders, no link chains. Just a dispatch function:

```typescript
export default createRpcHandler({
  dispatch: (method, args) => handlers[method](...args)
})
```

### Cloudflare Native

Built for the edge from day one:

```typescript
// Durable Object RPC
export class Counter extends DurableObject {
  rpc = createRpcHandler({
    dispatch: (method, args) => {
      if (method === 'increment') {
        this.value++
        return this.value
      }
    }
  })
}

// Call from Worker
const counter = env.COUNTER.get(id)
const rpc = RPC<CounterAPI>(binding(counter))
await rpc.increment()
```

## Common Migration Patterns

### Error Handling

```typescript
// tRPC
throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })

// rpc.do
throw new RpcError('NOT_FOUND', 'User not found')
```

### Batching

```typescript
// tRPC: httpBatchLink handles automatically

// rpc.do: Use Promise.all
const [user, posts] = await Promise.all([
  rpc.getUser({ id }),
  rpc.getPosts({ userId: id }),
])
```

### Subscriptions

```typescript
// tRPC: subscription procedure type

// rpc.do: Use WebSocket transport
const rpc = RPC<API>(ws('wss://api.example.com'))
// Implement subscription logic in your dispatch
```

## Need Help?

- [rpc.do Documentation](https://rpc.do)
- [GitHub Issues](https://github.com/drivly/ai/issues)
- [Discord Community](https://discord.gg/drivly)
