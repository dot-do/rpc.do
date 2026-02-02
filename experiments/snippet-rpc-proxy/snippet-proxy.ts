/**
 * Cloudflare Snippet RPC Proxy
 *
 * Maintains persistent WebSocket connections to rpc.do backend,
 * allowing multiple client requests to reuse the same connection.
 *
 * Benefits:
 * - Snippet invocations are FREE on Cloudflare
 * - WebSocket to DO is only charged when messages are sent
 * - Amortizes connection overhead across multiple requests
 * - Reduces latency for subsequent requests on same isolate
 *
 * Pattern learned from: /projects/duckdb/packages/ducktail/snippets/
 */

// ============================================================================
// Module-level state (persists across requests on same isolate)
// ============================================================================

interface BackendConnection {
  ws: WebSocket
  createdAt: number
  messagesProxied: number
}

// Single persistent connection to rpc.do backend
let backendWs: WebSocket | null = null
let wsConnecting = false
let connectionPromise: Promise<WebSocket> | null = null

// Track connected clients for broadcasting responses
const clientConnections = new Map<string, WebSocket>()

// Statistics for monitoring
const stats = {
  isolateId: crypto.randomUUID().slice(0, 8),
  startedAt: Date.now(),
  requestsHandled: 0,
  wsUpgrades: 0,
  httpProxied: 0,
  messagesProxied: 0,
  backendConnects: 0,
  backendReconnects: 0,
  errors: 0,
}

// Configuration
const CONFIG = {
  backendEndpoint: 'wss://rpc.workers.dev/ws',
  connectionTimeoutMs: 3000,
  maxClientConnections: 100,
  enableStats: true,
}

// ============================================================================
// Backend Connection Management
// ============================================================================

/**
 * Ensure we have a connection to the backend, reusing existing if possible.
 * Prevents connection storms by tracking wsConnecting state.
 */
async function ensureBackendConnection(): Promise<WebSocket> {
  // Reuse existing connection if open
  if (backendWs && backendWs.readyState === WebSocket.OPEN) {
    return backendWs
  }

  // Wait for in-progress connection
  if (wsConnecting && connectionPromise) {
    return connectionPromise
  }

  // Start new connection
  wsConnecting = true
  connectionPromise = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(CONFIG.backendEndpoint)

    const timeout = setTimeout(() => {
      wsConnecting = false
      connectionPromise = null
      ws.close()
      stats.errors++
      reject(new Error('Backend connection timeout'))
    }, CONFIG.connectionTimeoutMs)

    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      backendWs = ws
      wsConnecting = false
      stats.backendConnects++
      if (stats.backendConnects > 1) {
        stats.backendReconnects++
      }
      console.log(`[snippet-proxy] Connected to backend (isolate: ${stats.isolateId})`)
      resolve(ws)
    })

    ws.addEventListener('message', (event) => {
      stats.messagesProxied++
      // Broadcast response to all connected clients
      // In practice, you'd route by request ID
      for (const [clientId, client] of clientConnections) {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(event.data)
          } catch {
            clientConnections.delete(clientId)
          }
        }
      }
    })

    ws.addEventListener('close', (event) => {
      clearTimeout(timeout)
      backendWs = null
      wsConnecting = false
      connectionPromise = null
      console.log(`[snippet-proxy] Backend disconnected: ${event.code} ${event.reason}`)
    })

    ws.addEventListener('error', (event) => {
      clearTimeout(timeout)
      backendWs = null
      wsConnecting = false
      connectionPromise = null
      stats.errors++
      console.error(`[snippet-proxy] Backend error:`, event)
      reject(new Error('Backend connection error'))
    })
  })

  return connectionPromise
}

// ============================================================================
// Request Handlers
// ============================================================================

/**
 * Handle WebSocket upgrade from client.
 * Connects client to the shared backend connection.
 */
async function handleWebSocketUpgrade(request: Request): Promise<Response> {
  stats.wsUpgrades++

  // Limit concurrent connections
  if (clientConnections.size >= CONFIG.maxClientConnections) {
    return new Response('Too many connections', { status: 503 })
  }

  // Ensure backend is connected
  try {
    await ensureBackendConnection()
  } catch (err) {
    return new Response('Backend unavailable', { status: 502 })
  }

  // Create WebSocket pair for client
  const { 0: client, 1: server } = new WebSocketPair()
  const clientId = crypto.randomUUID()

  server.accept()
  clientConnections.set(clientId, server)

  server.addEventListener('message', async (event) => {
    stats.messagesProxied++
    // Forward client message to backend
    if (backendWs && backendWs.readyState === WebSocket.OPEN) {
      backendWs.send(event.data)
    } else {
      // Try to reconnect
      try {
        const ws = await ensureBackendConnection()
        ws.send(event.data)
      } catch {
        server.close(1011, 'Backend unavailable')
      }
    }
  })

  server.addEventListener('close', () => {
    clientConnections.delete(clientId)
  })

  server.addEventListener('error', () => {
    clientConnections.delete(clientId)
    stats.errors++
  })

  return new Response(null, {
    status: 101,
    webSocket: client,
  })
}

/**
 * Handle HTTP RPC request by proxying to backend.
 * Uses HTTP fallback if WebSocket unavailable.
 */
async function handleHttpRequest(request: Request): Promise<Response> {
  stats.httpProxied++

  // For HTTP, just proxy the request
  // In production, you might use the WS connection for batching
  const backendUrl = request.url.replace(/^https?:\/\/[^/]+/, CONFIG.backendEndpoint.replace('wss://', 'https://').replace('/ws', ''))

  try {
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })
    return response
  } catch (err) {
    stats.errors++
    return new Response('Backend error', { status: 502 })
  }
}

/**
 * Return statistics for monitoring.
 */
function handleStats(): Response {
  const now = Date.now()
  return new Response(JSON.stringify({
    ...stats,
    uptimeMs: now - stats.startedAt,
    backendConnected: backendWs?.readyState === WebSocket.OPEN,
    activeClients: clientConnections.size,
    requestsPerSecond: stats.requestsHandled / ((now - stats.startedAt) / 1000),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// Snippet Entry Point
// ============================================================================

export default {
  async fetch(request: Request): Promise<Response> {
    stats.requestsHandled++

    const url = new URL(request.url)

    // Stats endpoint for monitoring
    if (url.pathname === '/__stats' && CONFIG.enableStats) {
      return handleStats()
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocketUpgrade(request)
    }

    // HTTP request
    return handleHttpRequest(request)
  },
}
