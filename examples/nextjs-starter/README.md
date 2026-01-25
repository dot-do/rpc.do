# Next.js + rpc.do Starter

A minimal Next.js starter template demonstrating type-safe RPC calls with [rpc.do](https://rpc.do).

## Features

- Next.js 15 with App Router
- Edge Runtime RPC endpoint
- Full TypeScript type safety
- Server Components usage (SSR)
- Client Components usage (interactive)
- Error handling examples

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

## Project Structure

```
examples/nextjs-starter/
  app/
    api/rpc/
      route.ts          # RPC endpoint (Edge Runtime)
    layout.tsx          # Root layout
    page.tsx            # Home page with demo
  components/
    ClientDemo.tsx      # Client Component example
  lib/
    rpc.ts              # Typed RPC client
    rpc-types.ts        # API type definitions
    rpc-methods.ts      # Server-side method implementations
  package.json
  tsconfig.json
  next.config.js
```

## How It Works

### 1. Define Your API Types

Create type definitions in `lib/rpc-types.ts`:

```typescript
// Input/Output types
export interface GreetingInput {
  name: string
}

export interface GreetingOutput {
  message: string
  timestamp: string
}

// Full API interface
export interface RPCAPI {
  greeting: {
    sayHello: (input: GreetingInput) => GreetingOutput
  }
}
```

### 2. Implement Server Methods

Add implementations in `lib/rpc-methods.ts`:

```typescript
export const greetingMethods = {
  sayHello: async (input: GreetingInput): Promise<GreetingOutput> => {
    return {
      message: `Hello, ${input.name}!`,
      timestamp: new Date().toISOString(),
    }
  },
}

// Add to dispatch function
export async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const [namespace, methodName] = method.split('.')
  const input = args[0]

  switch (namespace) {
    case 'greeting':
      if (methodName === 'sayHello') {
        return greetingMethods.sayHello(input as GreetingInput)
      }
      break
  }

  throw new Error(`Unknown method: ${method}`)
}
```

### 3. Use the Client

In Server Components:

```typescript
// app/page.tsx
import { rpc } from '@/lib/rpc'

export default async function Page() {
  const result = await rpc.greeting.sayHello({ name: 'World' })
  return <div>{result.message}</div>
}
```

In Client Components:

```typescript
// components/MyComponent.tsx
'use client'
import { rpc } from '@/lib/rpc'

export function MyComponent() {
  const handleClick = async () => {
    const result = await rpc.greeting.sayHello({ name: 'Client' })
    console.log(result.message)
  }

  return <button onClick={handleClick}>Greet</button>
}
```

## Adding New RPC Methods

### Step 1: Add Types

```typescript
// lib/rpc-types.ts
export interface CreateTodoInput {
  title: string
  completed?: boolean
}

export interface CreateTodoOutput {
  id: string
  title: string
  completed: boolean
  createdAt: string
}

// Add to RPCAPI interface
export interface RPCAPI {
  // ... existing methods
  todos: {
    create: (input: CreateTodoInput) => CreateTodoOutput
    list: () => { todos: Todo[] }
  }
}
```

### Step 2: Implement Methods

```typescript
// lib/rpc-methods.ts
export const todoMethods = {
  create: async (input: CreateTodoInput): Promise<CreateTodoOutput> => {
    // In production, save to database
    return {
      id: crypto.randomUUID(),
      title: input.title,
      completed: input.completed ?? false,
      createdAt: new Date().toISOString(),
    }
  },

  list: async (): Promise<{ todos: Todo[] }> => {
    // In production, fetch from database
    return { todos: [] }
  },
}

// Add to dispatch function
case 'todos':
  if (methodName === 'create') {
    return todoMethods.create(input as CreateTodoInput)
  }
  if (methodName === 'list') {
    return todoMethods.list()
  }
  break
```

### Step 3: Use in Components

```typescript
// Full type safety!
const todo = await rpc.todos.create({ title: 'Buy milk' })
console.log(todo.id) // TypeScript knows this is a string
```

## Error Handling

```typescript
try {
  const result = await rpc.users.get({ id: 'unknown' })
} catch (error) {
  if (error instanceof Error) {
    console.error('RPC Error:', error.message)
  }
}
```

## Adding Authentication

Update the RPC route to check for auth:

```typescript
// app/api/rpc/route.ts
export async function POST(request: Request): Promise<Response> {
  // Check auth header
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token || !isValidToken(token)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ... rest of handler
}
```

Pass auth token from client:

```typescript
// lib/rpc.ts
import { createRPCClient } from 'rpc.do'
import type { RPCAPI } from './rpc-types'

export function createAuthenticatedRpc(token: string) {
  return createRPCClient<RPCAPI>({
    baseUrl: getBaseUrl(),
    auth: token,
  })
}
```

## Deployment to Vercel

### 1. Push to GitHub

```bash
git add .
git commit -m "Add Next.js rpc.do starter"
git push
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com)
2. Import your repository
3. Vercel auto-detects Next.js settings
4. Click "Deploy"

### 3. Environment Variables (if needed)

Add any required environment variables in Vercel dashboard:

- `API_TOKEN` - For authenticated RPC calls
- Database connection strings, etc.

### Edge Runtime

The RPC endpoint runs on Edge Runtime by default for optimal performance:

```typescript
// app/api/rpc/route.ts
export const runtime = 'edge'
```

This ensures:
- Low latency globally
- Automatic scaling
- No cold starts

## Learn More

- [rpc.do Documentation](https://rpc.do)
- [Next.js Documentation](https://nextjs.org/docs)
- [Edge Runtime](https://nextjs.org/docs/app/building-your-application/rendering/edge-and-nodejs-runtimes)
