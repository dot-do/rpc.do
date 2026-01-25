# rpc.do Dashboard Example

A real-time dashboard demonstrating multi-transport RPC with [rpc.do](https://rpc.do).

## Features

- **Durable Object (Stats)**: Persistent counters with real-time WebSocket broadcasting
- **Multi-Transport Support**: WebSocket for real-time updates, HTTP fallback for reliability
- **Typed RPC Client**: Full TypeScript support with `createDashboardClient()`
- **Live Dashboard UI**: Visual demo of connection status and transport switching

## Architecture

```
Browser/Client                    Cloudflare Worker                 Durable Object
+--------------+                  +----------------+                +-------------+
|              |  WebSocket/HTTP  |                |   fetch()      |             |
|  Dashboard   | <--------------> |  index.ts      | <------------> |  Stats.ts   |
|  (index.html)|                  |  (Router)      |                |  (DurableRPC)|
|              |                  |                |                |             |
+--------------+                  +----------------+                +-------------+
     |                                                                     |
     |  1. Connect via WebSocket (primary)                                 |
     |  2. Fallback to HTTP if WS fails                                    |
     |  3. Receive real-time broadcasts                                    |
     +---------------------------------------------------------------------+
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Start local development
pnpm dev

# Open http://localhost:8787 in your browser
```

## Client Usage

### Browser (included in dashboard)

The dashboard HTML includes a JavaScript client that demonstrates:
- WebSocket connection with automatic reconnection
- HTTP fallback when WebSocket is unavailable
- Real-time counter updates via broadcasts

### TypeScript Client

```typescript
import { createDashboardClient } from './src/client'

const client = createDashboardClient({
  baseUrl: 'https://your-worker.example.com/api/stats',

  // Optional: Authentication token
  token: 'your-auth-token',

  // Handle real-time broadcasts
  onBroadcast: (msg) => {
    if (msg.type === 'counter_update') {
      console.log(`Counter ${msg.name} = ${msg.value}`)
    }
  },

  // Connection lifecycle
  onConnect: () => console.log('Connected!'),
  onDisconnect: (reason) => console.log('Disconnected:', reason),
  onReconnecting: (attempt) => console.log(`Reconnecting... (${attempt})`),
})

// RPC calls are fully typed
const stats = await client.getStats()
console.log('Counters:', stats.counters)

// Subscribe to real-time updates
await client.subscribe()

// Increment a counter (broadcasts to all subscribers)
await client.incrementCounter('page-views')

// Check transport info
const info = client.getTransportInfo()
console.log(`Using ${info.type}, connected: ${info.connected}`)

// Clean up
client.close()
```

## API Reference

### Stats Durable Object

| Method | Description |
|--------|-------------|
| `getStats()` | Get all counters and metadata |
| `subscribe()` | Subscribe to real-time updates (WebSocket) |
| `incrementCounter(name)` | Increment a named counter |
| `getCounter(name)` | Get a specific counter value |
| `resetCounter(name)` | Reset a counter to zero |

### Broadcast Events

When connected via WebSocket, the client receives these broadcast messages:

```typescript
// Counter was updated
{ type: 'counter_update', name: string, value: number, timestamp: number }

// Connection count changed
{ type: 'connection_count', count: number, timestamp: number }
```

## Transport Strategy

The client uses a **composite transport** pattern:

1. **Primary (WebSocket)**: Low-latency, real-time updates
   - Automatic reconnection with exponential backoff
   - Heartbeat every 30 seconds
   - First-message authentication (secure)

2. **Fallback (HTTP)**: Reliable when WebSocket fails
   - Used after max reconnection attempts
   - Can be forced via UI toggle

## Project Structure

```
examples/dashboard/
├── src/
│   ├── Stats.ts       # Durable Object with RPC methods
│   ├── index.ts       # Worker entry point and router
│   └── client.ts      # TypeScript client with composite transport
├── public/
│   └── index.html     # Dashboard UI (also embedded in index.ts)
├── wrangler.toml      # Cloudflare configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Deploy

```bash
# Deploy to Cloudflare Workers
pnpm deploy
```

## Learn More

- [rpc.do Documentation](https://rpc.do)
- [DurableRPC API](https://github.com/dot-do/rpc.do/tree/main/core)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
