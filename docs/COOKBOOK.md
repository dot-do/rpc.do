# Cookbook / Recipes

Practical, copy-paste-ready patterns for common rpc.do use cases. Each recipe is self-contained and shows the imports you need.

---

## Table of Contents

1. [Setting Up a Basic Durable Object with rpc.do](#1-setting-up-a-basic-durable-object-with-rpcdo)
2. [Adding Auth to Your RPC Client](#2-adding-auth-to-your-rpc-client)
3. [Using SQL Queries Remotely](#3-using-sql-queries-remotely)
4. [Setting Up WebSocket with Reconnection](#4-setting-up-websocket-with-reconnection)
5. [Multi-Transport Fallback](#5-multi-transport-fallback)
6. [Using Middleware for Logging and Timing](#6-using-middleware-for-logging-and-timing)
7. [React Integration with useRPC Patterns](#7-react-integration-with-userpc-patterns)
8. [Typed Client with Full Type Safety](#8-typed-client-with-full-type-safety)
9. [Server-side Auth Middleware](#9-server-side-auth-middleware)
10. [Error Handling and Retry](#10-error-handling-and-retry)
11. [Exposing an SDK as an RPC Endpoint](#11-exposing-an-sdk-as-an-rpc-endpoint)
12. [Collections: MongoDB-style Document Store](#12-collections-mongodb-style-document-store)

---

## 1. Setting Up a Basic Durable Object with rpc.do

### Server (Cloudflare Worker + Durable Object)

```typescript
// src/index.ts
import { DurableRPC } from '@dotdo/rpc'

export class TaskService extends DurableRPC {
  tasks = {
    create: async (data: { title: string; done?: boolean }) => {
      const id = crypto.randomUUID()
      const task = { id, title: data.title, done: data.done ?? false }
      this.sql`INSERT INTO tasks (id, title, done) VALUES (${id}, ${data.title}, ${task.done})`.run()
      return task
    },

    get: async (id: string) => {
      return this.sql`SELECT * FROM tasks WHERE id = ${id}`.first()
    },

    list: async () => {
      return this.sql`SELECT * FROM tasks ORDER BY rowid DESC`.all()
    },

    complete: async (id: string) => {
      this.sql`UPDATE tasks SET done = 1 WHERE id = ${id}`.run()
      return { ok: true }
    },
  }
}
```

```toml
# wrangler.toml
name = "my-task-service"
main = "src/index.ts"

[[durable_objects.bindings]]
name = "TASK_SERVICE"
class_name = "TaskService"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TaskService"]
```

### Client

```typescript
import { RPC } from 'rpc.do'

const rpc = RPC('https://my-task-service.workers.dev')

// Create a task
const task = await rpc.tasks.create({ title: 'Ship v1.0' })

// List all tasks
const tasks = await rpc.tasks.list()

// Mark complete
await rpc.tasks.complete(task.id)
```

---

## 2. Adding Auth to Your RPC Client

### Static Token

```typescript
import { RPC, http } from 'rpc.do'

const rpc = RPC(http('https://api.example.com/rpc', 'sk_live_your_token_here'))
```

### Dynamic Token Provider

```typescript
import { RPC, http } from 'rpc.do'

// Token from a function (called on every request)
const rpc = RPC(http('https://api.example.com/rpc', () => {
  return localStorage.getItem('authToken')
}))
```

### oauth.do with Caching and Fallback

```typescript
import { RPC, http } from 'rpc.do'
import { oauthProvider, compositeAuth, staticAuth, cachedAuth } from 'rpc.do/auth'

// Simple: oauth.do with fallback to env var
const rpc = RPC(http('https://api.example.com/rpc', oauthProvider({
  fallbackToken: process.env.API_TOKEN,
})))

// Advanced: multiple auth sources with caching
const auth = compositeAuth([
  cachedAuth(oauthProvider(), { ttl: 300000 }),  // Cached oauth.do (5 min)
  staticAuth(() => process.env.DO_TOKEN),         // Env var fallback
])
const rpc = RPC(http('https://api.example.com/rpc', auth))
```

### WebSocket with First-Message Auth

```typescript
import { RPC } from 'rpc.do'
import { wsAdvanced } from 'rpc.do/transports/ws-advanced'

const transport = wsAdvanced('wss://api.example.com/rpc', {
  token: 'your-auth-token',  // Sent as first message, not in URL
  // allowInsecureAuth: true,  // Only for local dev with ws://
})

const rpc = RPC(transport)
```

---

## 3. Using SQL Queries Remotely

rpc.do's `$.sql` tagged template gives you the same syntax remotely that you have inside a Durable Object. Values are automatically parameterized (SQL injection safe).

```typescript
import { RPC } from 'rpc.do'

const $ = RPC('https://my-do.workers.dev')

// Query all rows
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()

// Query first row
const user = await $.sql`SELECT * FROM users WHERE id = ${userId}`.first()

// Execute a write (INSERT, UPDATE, DELETE)
const { rowsWritten } = await $.sql`
  UPDATE users SET name = ${newName} WHERE id = ${userId}
`.run()

// Get raw result with metadata
const raw = await $.sql`SELECT COUNT(*) as count FROM users`.raw()
console.log(raw.results, raw.columns)
```

### Typed SQL Results

```typescript
interface User {
  id: string
  name: string
  email: string
  active: boolean
}

const users = await $.sql<User>`SELECT * FROM users WHERE active = ${true}`.all()
// users is typed as User[]

const user = await $.sql<User>`SELECT * FROM users WHERE id = ${id}`.first()
// user is typed as User | null
```

### Database Schema Introspection

```typescript
const dbSchema = await $.dbSchema()
console.log(dbSchema.tables)
// [{ name: 'users', columns: [...], indexes: [...] }]

const rpcSchema = await $.schema()
console.log(rpcSchema.methods)
// [{ name: 'create', path: 'tasks.create', params: 1 }]
```

---

## 4. Setting Up WebSocket with Reconnection

### Basic capnweb WebSocket

```typescript
import { RPC, capnweb } from 'rpc.do'

const rpc = RPC(capnweb('wss://my-do.workers.dev', {
  reconnect: true,
  reconnectOptions: {
    onConnect: () => console.log('Connected'),
    onDisconnect: (reason) => console.log('Disconnected:', reason),
    onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
  }
}))

await rpc.users.list()
```

### Production-Grade WebSocket (wsAdvanced)

```typescript
import { RPC } from 'rpc.do'
import { wsAdvanced } from 'rpc.do/transports/ws-advanced'

const transport = wsAdvanced('wss://api.example.com/rpc', {
  // Auth
  token: process.env.API_TOKEN,

  // Reconnection
  autoReconnect: true,
  maxReconnectAttempts: 10,
  reconnectBackoff: 1000,
  maxReconnectBackoff: 30000,
  backoffMultiplier: 2,

  // Heartbeat (keep-alive)
  heartbeatInterval: 30000,
  heartbeatTimeout: 5000,

  // Timeouts
  connectTimeout: 10000,
  requestTimeout: 30000,

  // Event handlers
  onConnect: () => updateUI('connected'),
  onDisconnect: (reason, code) => updateUI('disconnected'),
  onReconnecting: (attempt, max) => updateUI(`reconnecting ${attempt}/${max}`),
  onError: (error) => reportError(error),
})

const rpc = RPC(transport)

// Check state any time
console.log(transport.state)        // 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'closed'
console.log(transport.isConnected()) // boolean

// Manual control
transport.close()
```

---

## 5. Multi-Transport Fallback

Use `composite()` to try multiple transports in order. If the first transport fails, the next one is tried automatically.

```typescript
import { RPC, composite, capnweb, http } from 'rpc.do'

// Try WebSocket first, fall back to HTTP
const rpc = RPC(composite(
  capnweb('wss://api.example.com/rpc'),
  http('https://api.example.com/rpc')
))

// Calls work regardless of which transport succeeds
const result = await rpc.users.list()
```

### With Auth on Both Transports

```typescript
import { RPC, composite, capnweb, http } from 'rpc.do'
import { oauthProvider } from 'rpc.do/auth'

const auth = oauthProvider()

const rpc = RPC(composite(
  capnweb('wss://api.example.com/rpc', auth),
  http('https://api.example.com/rpc', auth)
))
```

### Service Binding with HTTP Fallback

```typescript
import { RPC, composite, binding, http } from 'rpc.do'

export default {
  async fetch(request: Request, env: Env) {
    // Try service binding first (zero latency), fall back to HTTP
    const rpc = RPC(composite(
      binding(env.MY_SERVICE),
      http('https://my-service.workers.dev/rpc')
    ))

    const data = await rpc.getData()
    return Response.json(data)
  }
}
```

---

## 6. Using Middleware for Logging and Timing

### Basic Logging + Timing

```typescript
import { RPC } from 'rpc.do'
import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'

const rpc = RPC('https://api.example.com', {
  middleware: [
    loggingMiddleware(),
    timingMiddleware(),
  ]
})

await rpc.users.list()
// [RPC] Calling users.list with args: []
// [RPC Timing] users.list took 45.23ms
// [RPC] users.list returned: [...]
```

### Structured Logging with External Logger

```typescript
import { RPC } from 'rpc.do'
import { loggingMiddleware, timingMiddleware } from 'rpc.do/middleware'
import pino from 'pino'

const logger = pino()

const rpc = RPC('https://api.example.com', {
  middleware: [
    loggingMiddleware({
      log: (msg, ...args) => logger.info({ args }, msg),
      error: (msg, ...args) => logger.error({ args }, msg),
      prefix: '[RPC]',
      logArgs: true,
      logResult: false,  // Don't log potentially large responses
    }),
    timingMiddleware({
      threshold: 200,  // Only log calls slower than 200ms
      onTiming: (method, durationMs) => {
        logger.info({ method, durationMs }, 'RPC timing')
      },
    }),
  ]
})
```

### Retry with Observability

```typescript
import { RPC, http } from 'rpc.do'
import {
  withMiddleware,
  withRetry,
  loggingMiddleware,
  timingMiddleware,
  retryObserver,
} from 'rpc.do/middleware'

const transport = withMiddleware(
  withRetry(http('https://api.example.com'), {
    maxAttempts: 3,
    initialDelay: 200,
    maxDelay: 5000,
  }),
  [
    loggingMiddleware({ prefix: '[API]' }),
    timingMiddleware({ threshold: 100 }),
    retryObserver({
      onRetry: (method, error, attempt, delay) => {
        console.warn(`Retry #${attempt} for ${method} in ${delay}ms`)
      },
    }),
  ]
)

const rpc = RPC(transport)
```

### Custom Middleware: Request ID Header

```typescript
import type { RpcClientMiddleware } from 'rpc.do'

function requestIdMiddleware(): RpcClientMiddleware {
  let counter = 0
  return {
    onRequest(method, args) {
      const id = `req-${Date.now()}-${++counter}`
      console.log(`[${id}] ${method}(${JSON.stringify(args)})`)
    },
    onResponse(method) {
      console.log(`[OK] ${method}`)
    },
    onError(method, error) {
      console.error(`[FAIL] ${method}:`, error)
    },
  }
}
```

### Server-side: Timing + Logging on the DO

```typescript
import { DurableRPC, serverLoggingMiddleware, serverTimingMiddleware } from '@dotdo/rpc'

export class MyDO extends DurableRPC {
  middleware = [
    serverLoggingMiddleware({ prefix: '[MyDO]', logResult: false }),
    serverTimingMiddleware({
      threshold: 50,
      onTiming: (method, ms) => {
        // Record to analytics
        console.log(`METRIC rpc_duration{method="${method}"} ${ms}`)
      },
    }),
  ]

  users = {
    list: async () => this.sql`SELECT * FROM users`.all(),
  }
}
```

---

## 7. React Integration with useRPC Patterns

### With React Query (Recommended)

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RPC } from 'rpc.do'

interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string; email: string }
    list: () => { id: string; name: string }[]
    create: (args: { name: string; email: string }) => { id: string }
  }
}

const rpc = RPC<API>('https://api.example.com/rpc')

// Custom hooks
function useUser(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: () => rpc.users.getById({ id: userId }),
    enabled: !!userId,
  })
}

function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => rpc.users.list(),
  })
}

function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; email: string }) => rpc.users.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
```

### With SWR

```typescript
import useSWR from 'swr'
import { RPC } from 'rpc.do'

const rpc = RPC<API>('https://api.example.com/rpc')

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useSWR(
    ['user', userId],
    () => rpc.users.getById({ id: userId })
  )

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <div>
      <h1>{data?.name}</h1>
      <p>{data?.email}</p>
    </div>
  )
}
```

### Lightweight useRPC Hook (No Dependencies)

```typescript
import { useState, useEffect, useCallback } from 'react'

function useRPC<T>(rpcCall: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refetchCount, setRefetchCount] = useState(0)

  const refetch = useCallback(() => setRefetchCount(c => c + 1), [])

  useEffect(() => {
    let cancelled = false
    async function execute() {
      try {
        setLoading(true)
        setError(null)
        const result = await rpcCall()
        if (!cancelled) setData(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error('Unknown error'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    execute()
    return () => { cancelled = true }
  }, [...deps, refetchCount])

  return { data, loading, error, refetch }
}

// Usage
function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error, refetch } = useRPC(
    () => rpc.users.getById({ id: userId }),
    [userId]
  )

  if (loading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message} <button onClick={refetch}>Retry</button></div>
  return <div>{user?.name}</div>
}
```

### Error Handling in React

```typescript
import { ConnectionError, RPCError, AuthenticationError } from 'rpc.do/errors'

function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => rpc.users.getById({ id: userId }),
    retry: (failureCount, error) => {
      if (error instanceof AuthenticationError) return false
      if (error instanceof RPCError) return false
      if (error instanceof ConnectionError && error.retryable) return failureCount < 3
      return false
    },
  })

  if (error instanceof AuthenticationError) {
    return <LoginPrompt />
  }
  if (error instanceof ConnectionError) {
    return <div>Connection error. Check your network.</div>
  }
  if (error instanceof RPCError) {
    return <div>Error: {error.message} ({error.code})</div>
  }

  // ...render data
}
```

---

## 8. Typed Client with Full Type Safety

Define your API interface, then pass it as a generic to `RPC()`. No code generation required.

```typescript
import { RPC, http, RPCResult, RPCInput } from 'rpc.do'

// Define your API shape (return types without Promise<> wrappers)
interface API {
  users: {
    getById: (args: { id: string }) => { id: string; name: string; email: string }
    create: (args: { name: string; email: string }) => { id: string }
    list: () => { id: string; name: string }[]
    search: (args: { query: string; limit?: number }) => { id: string; name: string }[]
  }
  ai: {
    generate: (args: { prompt: string; model?: string }) => { text: string; tokens: number }
  }
}

// Create a typed client
const rpc = RPC<API>(http('https://api.example.com/rpc'))

// Full autocomplete and type checking
const user = await rpc.users.getById({ id: '123' })
//    ^-- typed as { id: string; name: string; email: string }

const results = await rpc.users.search({ query: 'alice', limit: 10 })
//    ^-- typed as { id: string; name: string }[]

// Extract types for reuse
type UserResult = RPCResult<typeof rpc.users.getById>   // { id: string; name: string; email: string }
type UserInput = RPCInput<typeof rpc.users.getById>     // { id: string }
type SearchInput = RPCInput<typeof rpc.users.search>    // { query: string; limit?: number }
```

---

## 9. Server-side Auth Middleware

Protect all methods on your Durable Object with an auth check that runs before every RPC call.

```typescript
import { DurableRPC, type ServerMiddleware } from '@dotdo/rpc'

const authMiddleware: ServerMiddleware = {
  async onRequest(method, args, ctx) {
    // Allow health checks without auth
    if (method === 'health') return

    const token = ctx.request?.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      throw new Error('Unauthorized')
    }

    // Verify against env secret
    if (token !== (ctx.env as { API_SECRET: string }).API_SECRET) {
      throw new Error('Forbidden')
    }
  }
}

const rateLimitMiddleware: ServerMiddleware = {
  onRequest(method, args, ctx) {
    // Simple in-memory rate limit (resets on hibernation)
    const ip = ctx.request?.headers.get('CF-Connecting-IP') ?? 'unknown'
    // ... rate limit logic
  }
}

export class SecureService extends DurableRPC {
  middleware = [authMiddleware, rateLimitMiddleware]

  health = async () => ({ status: 'ok' })

  users = {
    list: async () => this.sql`SELECT * FROM users`.all(),
    create: async (data: { name: string }) => {
      const id = crypto.randomUUID()
      this.sql`INSERT INTO users (id, name) VALUES (${id}, ${data.name})`.run()
      return { id }
    },
  }
}
```

---

## 10. Error Handling and Retry

### Comprehensive Error Handling

```typescript
import { RPC, http } from 'rpc.do'
import { ConnectionError, RPCError, AuthenticationError, RateLimitError } from 'rpc.do/errors'

const rpc = RPC(http('https://api.example.com/rpc', 'your-token'))

async function safeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof AuthenticationError) {
      // Token expired or invalid -- redirect to login
      window.location.href = '/login'
      throw error
    }

    if (error instanceof RateLimitError && error.retryAfter) {
      // Wait and retry
      await new Promise(r => setTimeout(r, error.retryAfter! * 1000))
      return fn()
    }

    if (error instanceof ConnectionError && error.retryable) {
      // Network issue -- could retry
      console.error(`Connection error (${error.code}): ${error.message}`)
      throw error
    }

    if (error instanceof RPCError) {
      // Business logic error from server
      console.error(`RPC error (${error.code}): ${error.message}`, error.data)
      throw error
    }

    throw error
  }
}

const user = await safeCall(() => rpc.users.getById({ id: '123' }))
```

### Automatic Retry with withRetry()

```typescript
import { RPC, http } from 'rpc.do'
import { withRetry } from 'rpc.do/middleware'
import { ConnectionError } from 'rpc.do/errors'

const transport = withRetry(http('https://api.example.com/rpc', 'your-token'), {
  maxAttempts: 3,
  initialDelay: 500,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
  shouldRetry: (error, attempt) => {
    // Only retry transient errors
    if (error instanceof ConnectionError) return error.retryable
    return false
  },
  onRetry: (method, error, attempt, delay) => {
    console.warn(`[retry] ${method} attempt ${attempt}/${3}, waiting ${delay}ms`)
  },
})

const rpc = RPC(transport)
```

---

## 11. Exposing an SDK as an RPC Endpoint

Wrap any JavaScript SDK and expose it over RPC with a single line using `rpc.do/expose`.

### Single SDK

```typescript
// src/index.ts
import { expose } from 'rpc.do/expose'
import Anthropic from '@anthropic-ai/sdk'

export default expose((env) => new Anthropic({ apiKey: env.ANTHROPIC_KEY }))
```

Now any method on the Anthropic SDK is callable via RPC:

```typescript
import { RPC, binding } from 'rpc.do'

const ai = RPC(binding(env.ANTHROPIC_SERVICE))
const response = await ai.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
})
```

### Multiple SDKs

```typescript
import { expose } from 'rpc.do/expose'
import { Cloudflare } from 'cloudflare'
import { Octokit } from '@octokit/rest'

export default expose({
  sdks: {
    cf: (env) => new Cloudflare({ apiToken: env.CF_TOKEN }),
    gh: (env) => new Octokit({ auth: env.GH_TOKEN }),
  }
})
```

```typescript
const rpc = RPC(binding(env.SDK_SERVICE))
const zones = await rpc.cf.zones.list()
const repos = await rpc.gh.repos.listForAuthenticatedUser()
```

### Using createTarget/createHandler

For more control, use the server utilities directly:

```typescript
import { createTarget, createHandler } from 'rpc.do/server'

const api = {
  math: {
    add: (a: number, b: number) => a + b,
    multiply: (a: number, b: number) => a * b,
  },
  hello: (name: string) => `Hello, ${name}!`,
}

const target = createTarget(api)
export default { fetch: createHandler(target) }
```

---

## 12. Collections: MongoDB-style Document Store

rpc.do provides a MongoDB-style document API on top of SQLite inside Durable Objects.

### Server Setup

```typescript
import { DurableRPC } from '@dotdo/rpc'

interface User {
  name: string
  email: string
  role: 'admin' | 'user'
  active: boolean
}

export class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async createUser(data: Omit<User, 'active'> & { active?: boolean }) {
    const id = crypto.randomUUID()
    await this.users.put(id, { ...data, active: data.active ?? true })
    return { id, ...data, active: data.active ?? true }
  }

  async findActiveAdmins() {
    return this.users.find({ role: 'admin', active: true })
  }
}
```

### Remote Client Usage

```typescript
import { RPC } from 'rpc.do'

const $ = RPC('https://user-service.workers.dev')

// Direct collection access
const users = $.collection<User>('users')

// CRUD
await users.put('user-1', { name: 'Alice', email: 'alice@co.com', role: 'admin', active: true })
const user = await users.get('user-1')
await users.delete('user-1')
const exists = await users.has('user-1')

// Query with filters
const admins = await users.find({ role: 'admin', active: true })
const count = await users.count({ active: true })

// Advanced filters
const recent = await users.find(
  { createdAt: { $gt: Date.now() - 86400000 } },
  { limit: 10, sort: '-createdAt' }
)

// List and metadata
const allUsers = await users.list({ limit: 100, offset: 0 })
const keys = await users.keys()
const cleared = await users.clear()

// Collection metadata
const names = await $.collection.names()
const stats = await $.collection.stats()
```
