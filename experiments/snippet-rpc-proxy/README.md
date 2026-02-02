# Snippet RPC Proxy POC

Proof of concept for using Cloudflare Snippets to proxy RPC calls to a Durable Object backend with persistent WebSocket connections.

## Concept

Cloudflare Snippets are FREE and can maintain module-level state between invocations on the same isolate. This POC exploits that to:

1. **Amortize connection overhead** - Single persistent WebSocket to backend DO
2. **Reduce latency** - Subsequent requests reuse the existing connection
3. **Cost savings** - Snippet invocations are FREE; only DO messages are charged

## Pattern

```
Browser/Client         Snippet (FREE)           Durable Object (paid)
     │                      │                          │
     │──── WS Upgrade ─────▶│                          │
     │                      │                          │
     │                      │◀── Persistent WS ───────▶│
     │                      │   (reused across         │
     │                      │    multiple clients)     │
     │                      │                          │
     │◀──── Messages ──────▶│◀──────── Messages ──────▶│
     │                      │                          │
```

## Key Implementation Details

```typescript
// Module-level state persists across requests on same isolate
let backendWs: WebSocket | null = null
let wsConnecting = false

// Lazy connection with reuse
async function ensureBackendConnection(): Promise<WebSocket> {
  if (backendWs && backendWs.readyState === WebSocket.OPEN) {
    return backendWs  // Reuse existing connection
  }

  if (wsConnecting) {
    return connectionPromise  // Wait for in-progress connection
  }

  // Create new connection
  wsConnecting = true
  const ws = new WebSocket(CONFIG.backendEndpoint)
  // ...
}
```

## Files

- `snippet-proxy.ts` - Main snippet implementation
- `wrangler.toml` - Wrangler configuration for deployment
- `test-client.ts` - Test client for validating behavior

## Usage

```bash
# Deploy snippet
wrangler deploy

# Test
curl https://your-snippet.workers.dev/__stats
```

## Monitoring

The `/__stats` endpoint returns:

```json
{
  "isolateId": "abc12345",
  "startedAt": 1706900000000,
  "uptimeMs": 60000,
  "requestsHandled": 100,
  "wsUpgrades": 20,
  "httpProxied": 80,
  "messagesProxied": 500,
  "backendConnects": 1,
  "backendReconnects": 0,
  "errors": 0,
  "backendConnected": true,
  "activeClients": 5,
  "requestsPerSecond": 1.67
}
```

## Caveats

1. **Isolate affinity** - Requests may hit different isolates, each with its own connection
2. **Short-lived isolates** - Connections may be dropped when isolate is evicted
3. **No guarantees** - Module state is best-effort, not guaranteed to persist

## References

- Pattern from: `/projects/duckdb/packages/ducktail/snippets/ws-proxy.ts`
- Cloudflare Snippets documentation
- rpc.do WebSocket state machine: `core/src/websocket-state.ts`
