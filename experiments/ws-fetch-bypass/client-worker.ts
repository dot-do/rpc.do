/**
 * Client Worker - Tests fetching via WebSocket proxy
 *
 * Demonstrates bypassing the 6 concurrent subrequest limit by:
 * 1. Opening a single WebSocket to the proxy worker
 * 2. Multiplexing many fetch requests over that single connection
 */

export interface Env {
  PROXY_URL: string;
}

interface PendingRequest {
  resolve: (value: ProxiedResponse) => void;
  reject: (reason: Error) => void;
  startTime: number;
}

interface ProxiedResponse {
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

/**
 * WebSocket-based fetch client that multiplexes requests
 */
class WsFetchClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  constructor(private proxyUrl: string) {}

  async connect(): Promise<void> {
    if (this.connected && this.ws) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.proxyUrl);

      ws.addEventListener('open', () => {
        this.ws = ws;
        this.connected = true;
        this.connectPromise = null;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(event);
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        this.ws = null;
        // Reject all pending requests
        for (const [id, pending] of this.pending) {
          pending.reject(new Error('WebSocket closed'));
        }
        this.pending.clear();
      });

      ws.addEventListener('error', (error) => {
        reject(new Error('WebSocket connection failed'));
      });
    });

    return this.connectPromise;
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const response: ProxiedResponse = JSON.parse(event.data as string);
      const pending = this.pending.get(response.id);

      if (pending) {
        this.pending.delete(response.id);
        pending.resolve(response);
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  }

  async fetch(url: string, options?: RequestInit): Promise<ProxiedResponse> {
    await this.connect();

    if (!this.ws) {
      throw new Error('WebSocket not connected');
    }

    const id = `req-${++this.requestCounter}-${Date.now()}`;
    const startTime = Date.now();

    // Convert headers to plain object
    const headers: Record<string, string> = {};
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const request = {
      id,
      url,
      method: options?.method || 'GET',
      headers,
      body: options?.body as string | undefined,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, startTime });
      this.ws!.send(JSON.stringify(request));
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const testCount = parseInt(url.searchParams.get('count') || '10');
    const targetUrl = url.searchParams.get('target') || 'https://httpbin.org/delay/1';

    // Test 1: Direct concurrent fetches (should hit the limit)
    const directResults = await testDirectFetches(targetUrl, testCount);

    // Test 2: WebSocket proxied fetches (should bypass limit)
    const wsResults = await testWsFetches(env.PROXY_URL, targetUrl, testCount);

    return new Response(JSON.stringify({
      testConfig: {
        count: testCount,
        targetUrl,
        proxyUrl: env.PROXY_URL,
      },
      directFetches: directResults,
      wsFetches: wsResults,
      conclusion: analyzeResults(directResults, wsResults),
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

interface TestResult {
  totalRequests: number;
  successful: number;
  failed: number;
  totalTime: number;
  errors: string[];
  details: Array<{
    index: number;
    success: boolean;
    duration?: number;
    error?: string;
  }>;
}

async function testDirectFetches(targetUrl: string, count: number): Promise<TestResult> {
  const start = Date.now();
  const errors: string[] = [];
  const details: TestResult['details'] = [];

  // Launch all fetches concurrently
  const promises = Array.from({ length: count }, async (_, i) => {
    const reqStart = Date.now();
    try {
      const response = await fetch(`${targetUrl}?req=${i}`);
      const duration = Date.now() - reqStart;
      details.push({ index: i, success: true, duration });
      return true;
    } catch (e) {
      const duration = Date.now() - reqStart;
      const error = e instanceof Error ? e.message : String(e);
      errors.push(`Request ${i}: ${error}`);
      details.push({ index: i, success: false, duration, error });
      return false;
    }
  });

  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;

  return {
    totalRequests: count,
    successful,
    failed: count - successful,
    totalTime: Date.now() - start,
    errors,
    details: details.sort((a, b) => a.index - b.index),
  };
}

async function testWsFetches(proxyUrl: string, targetUrl: string, count: number): Promise<TestResult> {
  const client = new WsFetchClient(proxyUrl);
  const start = Date.now();
  const errors: string[] = [];
  const details: TestResult['details'] = [];

  try {
    await client.connect();

    // Launch all fetches concurrently over the single WebSocket
    const promises = Array.from({ length: count }, async (_, i) => {
      const reqStart = Date.now();
      try {
        const response = await client.fetch(`${targetUrl}?req=${i}`);
        const duration = Date.now() - reqStart;

        if (response.error) {
          errors.push(`Request ${i}: ${response.error}`);
          details.push({ index: i, success: false, duration, error: response.error });
          return false;
        }

        details.push({ index: i, success: true, duration });
        return true;
      } catch (e) {
        const duration = Date.now() - reqStart;
        const error = e instanceof Error ? e.message : String(e);
        errors.push(`Request ${i}: ${error}`);
        details.push({ index: i, success: false, duration, error });
        return false;
      }
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;

    return {
      totalRequests: count,
      successful,
      failed: count - successful,
      totalTime: Date.now() - start,
      errors,
      details: details.sort((a, b) => a.index - b.index),
    };
  } finally {
    client.close();
  }
}

function analyzeResults(direct: TestResult, ws: TestResult): string {
  const lines: string[] = [];

  lines.push(`Direct fetches: ${direct.successful}/${direct.totalRequests} succeeded in ${direct.totalTime}ms`);
  lines.push(`WS proxied fetches: ${ws.successful}/${ws.totalRequests} succeeded in ${ws.totalTime}ms`);

  if (direct.failed > 0 && ws.failed === 0) {
    lines.push('');
    lines.push('HYPOTHESIS CONFIRMED: WebSocket proxying bypasses the concurrent fetch limit!');
    lines.push(`Direct fetches failed at ${direct.totalRequests} concurrent requests.`);
    lines.push(`WebSocket proxy successfully handled all ${ws.totalRequests} concurrent requests.`);
  } else if (direct.failed === 0 && ws.failed === 0) {
    lines.push('');
    lines.push('INCONCLUSIVE: Both methods succeeded. Try increasing the count or using slower endpoints.');
  } else if (ws.failed > 0) {
    lines.push('');
    lines.push('HYPOTHESIS NOT CONFIRMED: WebSocket proxy also experienced failures.');
    lines.push('This could indicate the proxy worker itself is hitting limits.');
  }

  return lines.join('\n');
}
