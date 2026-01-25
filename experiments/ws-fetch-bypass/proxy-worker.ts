/**
 * WebSocket Fetch Proxy Worker
 *
 * Accepts WebSocket connections and proxies fetch requests.
 * Each incoming WS message should be a JSON object:
 *   { id: string, url: string, method?: string, headers?: Record<string, string>, body?: string }
 *
 * Responses are sent back as:
 *   { id: string, status: number, headers: Record<string, string>, body: string, error?: string }
 */

export interface FetchRequest {
  id: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
  timing?: {
    start: number;
    end: number;
    duration: number;
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'ws-fetch-proxy' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request);
    }

    return new Response('WebSocket Fetch Proxy\n\nConnect via WebSocket to proxy fetch requests.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};

async function handleWebSocket(request: Request): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  server.addEventListener('message', async (event) => {
    const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);

    let req: FetchRequest;
    try {
      req = JSON.parse(data);
    } catch (e) {
      server.send(JSON.stringify({
        id: 'unknown',
        status: 0,
        headers: {},
        body: '',
        error: 'Invalid JSON in request',
      }));
      return;
    }

    const response = await proxyFetch(req);
    server.send(JSON.stringify(response));
  });

  server.addEventListener('close', () => {
    console.log('WebSocket closed');
  });

  server.addEventListener('error', (error) => {
    console.error('WebSocket error:', error);
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function proxyFetch(req: FetchRequest): Promise<FetchResponse> {
  const start = Date.now();

  try {
    const response = await fetch(req.url, {
      method: req.method || 'GET',
      headers: req.headers || {},
      body: req.body,
    });

    const end = Date.now();

    // Convert headers to plain object
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Read body as text (could be extended to handle binary)
    const body = await response.text();

    return {
      id: req.id,
      status: response.status,
      headers,
      body,
      timing: {
        start,
        end,
        duration: end - start,
      },
    };
  } catch (error) {
    const end = Date.now();
    return {
      id: req.id,
      status: 0,
      headers: {},
      body: '',
      error: error instanceof Error ? error.message : String(error),
      timing: {
        start,
        end,
        duration: end - start,
      },
    };
  }
}

interface Env {}
