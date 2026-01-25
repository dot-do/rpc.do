# Todo Example - rpc.do

A simple Todo CRUD application demonstrating how to use `@dotdo/rpc` for Durable Objects and `rpc.do` for typed RPC clients.

## Features

- **Durable Object with SQL storage**: Uses SQLite for persistent todo storage
- **Typed RPC**: Full TypeScript support for both server and client
- **Simple HTML UI**: Vanilla JS frontend with modern styling
- **HTTP transport**: Simple request/response pattern (no WebSocket needed)

## Project Structure

```
examples/todo/
├── src/
│   ├── TodoList.ts    # Durable Object with CRUD methods
│   ├── index.ts       # Worker router
│   └── client.ts      # Typed RPC client
├── public/
│   └── index.html     # Simple HTML UI
├── wrangler.toml      # Cloudflare Workers config
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Wrangler CLI (`npm install -g wrangler`)

### Install Dependencies

```bash
# From the todo example directory
cd examples/todo
pnpm install
```

Or from the repo root:

```bash
pnpm install
```

## Local Development

Start the local development server:

```bash
pnpm dev
```

This starts the Worker with:
- API at `http://localhost:8787`
- Static files served from `./public`
- Hot reload on file changes

Open `http://localhost:8787` in your browser to see the Todo app.

## API Endpoints

The Todo API is exposed via RPC at `/todos/:listId`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/todos/default` | RPC endpoint for the default list |
| GET | `/todos/default/__schema` | Get API schema |

### RPC Methods

| Method | Arguments | Returns | Description |
|--------|-----------|---------|-------------|
| `create` | `text: string` | `Todo` | Create a new todo |
| `list` | - | `Todo[]` | List all todos |
| `update` | `id: string, done: boolean` | `Todo` | Update todo status |
| `delete` | `id: string` | `{ success: boolean }` | Delete a todo |
| `get` | `id: string` | `Todo \| null` | Get a single todo |
| `clearCompleted` | - | `{ deleted: number }` | Delete all completed todos |

### Example Requests

```bash
# Create a todo
curl -X POST http://localhost:8787/todos/default \
  -H "Content-Type: application/json" \
  -d '{"path": "create", "args": ["Buy groceries"]}'

# List todos
curl -X POST http://localhost:8787/todos/default \
  -H "Content-Type: application/json" \
  -d '{"path": "list", "args": []}'

# Update a todo
curl -X POST http://localhost:8787/todos/default \
  -H "Content-Type: application/json" \
  -d '{"path": "update", "args": ["<todo-id>", true]}'

# Delete a todo
curl -X POST http://localhost:8787/todos/default \
  -H "Content-Type: application/json" \
  -d '{"path": "delete", "args": ["<todo-id>"]}'
```

## Using the Client

### In a Node.js/Browser Application

```typescript
import { createTodoClient } from './client'

const client = createTodoClient({
  baseUrl: 'https://your-worker.example.com',
  listId: 'my-list',  // Optional, defaults to 'default'
})

// Create a todo
const todo = await client.create('Buy milk')
console.log('Created:', todo)

// List all todos
const todos = await client.list()
console.log('All todos:', todos)

// Mark as done
await client.update(todo.id, true)

// Delete
await client.delete(todo.id)
```

### With Error Handling

```typescript
import { createTodoClientWithErrorHandling, TodoError } from './client'

const client = createTodoClientWithErrorHandling()

try {
  const todo = await client.create('Important task')
} catch (error) {
  if (error instanceof TodoError) {
    console.error('Todo operation failed:', error.message)
  }
}
```

## Deployment

### Deploy to Cloudflare Workers

```bash
# Login to Cloudflare (first time)
wrangler login

# Deploy to production
pnpm deploy:production
```

### Deploy to Staging

```bash
pnpm deploy:staging
```

### Environment Configuration

Edit `wrangler.toml` to configure:

- `name`: Worker name
- `routes`: Custom domains
- `compatibility_date`: Workers runtime version

## Architecture

```
┌─────────────┐     HTTP POST      ┌─────────────┐     RPC      ┌─────────────┐
│   Browser   │ ──────────────────▶│   Worker    │ ────────────▶│  TodoList   │
│   (UI)      │                    │  (Router)   │              │   (DO)      │
└─────────────┘                    └─────────────┘              └─────────────┘
                                         │                            │
                                         │                            ▼
                                         │                      ┌─────────────┐
                                         └──────────────────────│   SQLite    │
                                           Static Files         │  (Storage)  │
                                                                └─────────────┘
```

1. **Browser**: Sends HTTP POST requests with RPC payloads
2. **Worker (Router)**: Routes requests to the appropriate Durable Object
3. **TodoList (DO)**: Handles RPC methods and persists data to SQLite

## Multiple Todo Lists

Each unique `listId` creates a separate Durable Object instance with its own isolated storage:

```typescript
// Each user gets their own todo list
const userClient = createTodoClient({ listId: 'user-123' })

// Shared team list
const teamClient = createTodoClient({ listId: 'team-engineering' })

// Default list
const defaultClient = createTodoClient() // uses 'default'
```

## Related

- [rpc.do documentation](https://rpc.do)
- [@dotdo/rpc package](../../core/README.md)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
