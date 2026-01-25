# rpc.do Chat Example

A real-time chat application demonstrating rpc.do patterns with Cloudflare Workers and Durable Objects.

## Features

- Real-time messaging via WebSocket
- Persistent message history (stored in Durable Objects)
- Automatic reconnection with exponential backoff
- Typed RPC client with full TypeScript support
- Multiple chat rooms

## Architecture

```
                                    +-----------------+
  Browser/Client                    |   Worker        |
  +-------------+                   |  (Router)       |
  |             |    WebSocket      |                 |
  | ChatClient  | ----------------> | /room/:roomId   |
  | (wsAdvanced)|                   |        |        |
  +-------------+                   +--------|--------+
                                             |
                                             v
                                    +-----------------+
                                    |  ChatRoom DO    |
                                    |                 |
                                    | - join()        |
                                    | - sendMessage() |
                                    | - getHistory()  |
                                    | - leave()       |
                                    |                 |
                                    | Storage: msgs   |
                                    +-----------------+
```

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start the development server:

```bash
pnpm dev
```

3. The server will be available at `http://localhost:8787`

## Usage

### Server Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info and usage |
| `GET /health` | Health check |
| `WS /room/:roomId` | WebSocket connection to a chat room |
| `POST /room/:roomId` | HTTP RPC (limited to `getHistory`) |

### Client Usage

```typescript
import { createChatClient } from './client'

// Create a client with event handlers
const chat = createChatClient('wss://your-worker.workers.dev/room/general', {
  onMessage: (msg) => {
    console.log(`${msg.username}: ${msg.text}`)
  },
  onUserJoined: (user) => {
    console.log(`* ${user} joined the room`)
  },
  onUserLeft: (user) => {
    console.log(`* ${user} left the room`)
  },
  onConnect: () => {
    console.log('Connected!')
  },
  onDisconnect: (reason) => {
    console.log('Disconnected:', reason)
  },
  onReconnecting: (attempt) => {
    console.log(`Reconnecting... (attempt ${attempt})`)
  },
})

// Connect and join
await chat.connect()
const { recentMessages } = await chat.join('alice')

// Display recent messages
for (const msg of recentMessages) {
  console.log(`[${msg.username}] ${msg.text}`)
}

// Send a message
await chat.sendMessage('Hello, everyone!')

// Leave and disconnect
await chat.leave()
chat.disconnect()
```

### RPC Methods

| Method | Description |
|--------|-------------|
| `join(username)` | Join the room with a username. Returns recent messages. |
| `sendMessage(text)` | Send a message to the room. Must join first. |
| `getHistory(limit?)` | Get message history (default: 100, max: 1000). |
| `leave()` | Leave the room. |

### Server Events

The server pushes these events to connected clients:

```typescript
// New message
{ type: 'message', message: ChatMessage }

// User joined
{ type: 'user_joined', username: string, timestamp: number }

// User left
{ type: 'user_left', username: string, timestamp: number }
```

## Deploy

Deploy to Cloudflare:

```bash
pnpm deploy
```

## How It Works

### rpc.do Patterns Demonstrated

1. **Typed RPC Proxy**: The client uses `RPC<ChatRoomAPI>()` for fully typed method calls.

2. **wsAdvanced Transport**: Production-ready WebSocket transport with:
   - Automatic reconnection with exponential backoff
   - Heartbeat ping-pong for connection health
   - First-message authentication support
   - Connection state machine

3. **Durable Object Backend**: The `ChatRoom` class:
   - Handles WebSocket connections via `acceptWebSocket()`
   - Persists messages to Durable Object storage
   - Broadcasts events to all connected clients

4. **Message Protocol**: Uses the rpc.do JSON-RPC-like protocol:
   ```json
   // Request
   { "id": 1, "method": "do", "path": "sendMessage", "args": ["Hello!"] }

   // Response
   { "id": 1, "result": { "success": true, "message": {...} } }
   ```

### Reconnection Behavior

The client automatically handles disconnections:

1. On disconnect, enters `reconnecting` state
2. Attempts to reconnect with exponential backoff (1s, 2s, 4s, ... up to 30s)
3. On successful reconnection, automatically re-joins the room with the same username
4. Pending RPC calls are rejected with a connection error

## File Structure

```
examples/chat/
├── src/
│   ├── ChatRoom.ts    # Durable Object with RPC methods
│   ├── index.ts       # Worker router
│   └── client.ts      # Typed RPC client
├── wrangler.toml      # Cloudflare configuration
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
└── README.md          # This file
```

## License

MIT
