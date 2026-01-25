/**
 * Dashboard Worker
 *
 * Routes requests to the Stats Durable Object.
 * Supports both HTTP RPC and WebSocket connections for real-time updates.
 *
 * Routes:
 * - GET /              -> Serve static HTML dashboard
 * - GET /api/stats     -> HTTP RPC to get stats
 * - POST /api/stats    -> HTTP RPC for mutations
 * - WS /api/stats/ws   -> WebSocket for real-time subscriptions
 */

import { Stats } from './Stats'

export { Stats }

export interface Env {
  STATS: DurableObjectNamespace<Stats>
  ASSETS?: Fetcher  // For serving static files in production
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Serve static dashboard (in production, use ASSETS binding)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveStaticDashboard()
    }

    // Serve static assets
    if (url.pathname.startsWith('/assets/')) {
      return new Response('Not found', { status: 404 })
    }

    // API routes - all go to the Stats DO
    if (url.pathname.startsWith('/api/stats')) {
      // Get or create the Stats DO instance
      // Using a fixed ID for this example (single global stats instance)
      const id = env.STATS.idFromName('global')
      const stub = env.STATS.get(id)

      // Handle WebSocket upgrade
      if (url.pathname === '/api/stats/ws') {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected WebSocket', { status: 426 })
        }
        return stub.fetch(request)
      }

      // Handle HTTP RPC
      // Strip the /api/stats prefix and forward to DO
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = url.pathname.replace('/api/stats', '') || '/'

      return stub.fetch(new Request(forwardUrl.toString(), request))
    }

    return new Response('Not found', { status: 404 })
  },
}

/**
 * Serve the static HTML dashboard
 * In production, you'd use the ASSETS binding or a static site
 */
function serveStaticDashboard(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>rpc.do Dashboard Example</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --card-bg: #1a1a1a;
      --border: #333;
      --text: #fff;
      --text-muted: #888;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #22c55e;
      --warning: #f59e0b;
      --error: #ef4444;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .connection-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--error);
    }

    .status-dot.connected { background: var(--success); }
    .status-dot.connecting { background: var(--warning); animation: pulse 1s infinite; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .transport-info {
      display: flex;
      gap: 1rem;
      font-size: 0.75rem;
    }

    .transport-badge {
      padding: 0.25rem 0.5rem;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
    }

    .transport-badge.active {
      border-color: var(--accent);
      color: var(--accent);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .counters-section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .counters-section h2 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text-muted);
    }

    .counter-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    button {
      padding: 0.75rem 1.5rem;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    button:hover { background: var(--accent-hover); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .counter-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .counter-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: var(--bg);
      border-radius: 6px;
    }

    .counter-name { font-weight: 500; }
    .counter-value {
      font-variant-numeric: tabular-nums;
      color: var(--accent);
    }

    .log-section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.5rem;
    }

    .log-section h2 {
      font-size: 1rem;
      margin-bottom: 1rem;
      color: var(--text-muted);
    }

    .log-entries {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
    }

    .log-entry {
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--border);
    }

    .log-entry:last-child { border-bottom: none; }

    .log-time { color: var(--text-muted); }
    .log-type { color: var(--accent); }
    .log-message { color: var(--text); }

    .empty-state {
      color: var(--text-muted);
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>rpc.do Dashboard</h1>
      <div>
        <div class="connection-status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Disconnected</span>
        </div>
        <div class="transport-info">
          <span class="transport-badge" id="ws-badge">WebSocket</span>
          <span class="transport-badge" id="http-badge">HTTP Fallback</span>
        </div>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Connected Clients</div>
        <div class="stat-value" id="connection-count">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last Updated</div>
        <div class="stat-value" id="last-updated">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Transport</div>
        <div class="stat-value" id="current-transport">-</div>
      </div>
    </div>

    <div class="counters-section">
      <h2>Counters</h2>
      <div class="counter-buttons">
        <button onclick="incrementCounter('clicks')">Click Me</button>
        <button onclick="incrementCounter('api-calls')">API Call</button>
        <button onclick="incrementCounter('events')">Event</button>
        <button onclick="incrementCounter('custom')">Custom</button>
      </div>
      <div class="counter-list" id="counter-list">
        <div class="empty-state">No counters yet. Click a button above!</div>
      </div>
    </div>

    <div class="log-section">
      <h2>Event Log</h2>
      <div class="log-entries" id="log-entries">
        <div class="empty-state">Waiting for events...</div>
      </div>
    </div>
  </div>

  <script>
    // State
    let ws = null;
    let counters = {};
    let useWebSocket = true;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    // DOM Elements
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const wsBadge = document.getElementById('ws-badge');
    const httpBadge = document.getElementById('http-badge');
    const connectionCount = document.getElementById('connection-count');
    const lastUpdated = document.getElementById('last-updated');
    const currentTransport = document.getElementById('current-transport');
    const counterList = document.getElementById('counter-list');
    const logEntries = document.getElementById('log-entries');

    // Initialize
    init();

    function init() {
      log('info', 'Initializing dashboard...');
      connectWebSocket();
    }

    // WebSocket Connection
    function connectWebSocket() {
      if (ws && ws.readyState === WebSocket.OPEN) return;

      updateStatus('connecting');
      log('info', 'Connecting to WebSocket...');

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(protocol + '//' + location.host + '/api/stats/ws');

      ws.onopen = () => {
        updateStatus('connected');
        setActiveTransport('ws');
        reconnectAttempts = 0;
        log('success', 'WebSocket connected');

        // Subscribe to get initial stats
        ws.send(JSON.stringify({
          id: 'sub-' + Date.now(),
          method: 'do',
          path: 'subscribe',
          args: []
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle RPC response
          if (data.id) {
            if (data.result) {
              if (data.result.stats) {
                updateStats(data.result.stats);
              } else if (data.result.success !== undefined) {
                // Increment response - already handled by broadcast
              }
            } else if (data.error) {
              log('error', 'RPC Error: ' + data.error.message);
            }
            return;
          }

          // Handle broadcast events
          if (data.type === 'counter_update') {
            counters[data.name] = data.value;
            renderCounters();
            log('event', 'Counter "' + data.name + '" = ' + data.value);
          } else if (data.type === 'connection_count') {
            connectionCount.textContent = data.count;
          }
        } catch (e) {
          log('error', 'Failed to parse message: ' + e.message);
        }
      };

      ws.onclose = (event) => {
        updateStatus('disconnected');
        log('warning', 'WebSocket closed: ' + (event.reason || 'Connection lost'));

        // Attempt reconnection
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          log('info', 'Reconnecting in ' + (delay/1000) + 's (attempt ' + reconnectAttempts + ')');
          setTimeout(connectWebSocket, delay);
        } else {
          log('error', 'Max reconnection attempts reached. Falling back to HTTP.');
          useWebSocket = false;
          setActiveTransport('http');
          fetchStatsViaHttp();
        }
      };

      ws.onerror = () => {
        log('error', 'WebSocket error');
      };
    }

    // HTTP Fallback
    async function fetchStatsViaHttp() {
      try {
        const response = await fetch('/api/stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'do', path: 'getStats', args: [] })
        });
        const data = await response.json();
        updateStats(data);
        log('info', 'Stats fetched via HTTP');
      } catch (e) {
        log('error', 'HTTP fetch failed: ' + e.message);
      }
    }

    // Increment Counter
    async function incrementCounter(name) {
      log('action', 'Incrementing counter: ' + name);

      if (useWebSocket && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          id: 'inc-' + Date.now(),
          method: 'do',
          path: 'incrementCounter',
          args: [name]
        }));
      } else {
        // HTTP fallback
        try {
          const response = await fetch('/api/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'do', path: 'incrementCounter', args: [name] })
          });
          const data = await response.json();
          if (data.success) {
            counters[data.name] = data.value;
            renderCounters();
            log('success', 'Counter incremented via HTTP');
          }
        } catch (e) {
          log('error', 'Increment failed: ' + e.message);
        }
      }
    }

    // UI Updates
    function updateStatus(status) {
      statusDot.className = 'status-dot ' + status;
      statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    function setActiveTransport(transport) {
      wsBadge.classList.toggle('active', transport === 'ws');
      httpBadge.classList.toggle('active', transport === 'http');
      currentTransport.textContent = transport === 'ws' ? 'WS' : 'HTTP';
    }

    function updateStats(stats) {
      counters = stats.counters || {};
      connectionCount.textContent = stats.connectionCount;
      lastUpdated.textContent = formatTime(stats.lastUpdated);
      renderCounters();
    }

    function renderCounters() {
      const entries = Object.entries(counters);
      if (entries.length === 0) {
        counterList.innerHTML = '<div class="empty-state">No counters yet. Click a button above!</div>';
        return;
      }

      counterList.innerHTML = entries
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) =>
          '<div class="counter-item">' +
            '<span class="counter-name">' + escapeHtml(name) + '</span>' +
            '<span class="counter-value">' + value + '</span>' +
          '</div>'
        ).join('');
    }

    function log(type, message) {
      const time = new Date().toLocaleTimeString();
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML =
        '<span class="log-time">[' + time + ']</span> ' +
        '<span class="log-type">[' + type.toUpperCase() + ']</span> ' +
        '<span class="log-message">' + escapeHtml(message) + '</span>';

      // Remove empty state if present
      const emptyState = logEntries.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      logEntries.insertBefore(entry, logEntries.firstChild);

      // Keep only last 50 entries
      while (logEntries.children.length > 50) {
        logEntries.removeChild(logEntries.lastChild);
      }
    }

    function formatTime(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
