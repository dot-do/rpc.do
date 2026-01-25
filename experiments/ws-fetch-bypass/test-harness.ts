#!/usr/bin/env npx tsx
/**
 * Test Harness for WebSocket Fetch Bypass POC
 *
 * Run this script locally to test the hypothesis.
 * Requires the proxy-worker to be deployed or running via wrangler dev.
 *
 * Usage:
 *   npx tsx test-harness.ts [proxyUrl] [targetUrl] [count]
 *
 * Example:
 *   npx tsx test-harness.ts ws://localhost:8787 https://httpbin.org/delay/1 10
 */

const PROXY_URL = process.argv[2] || 'ws://localhost:8787';
const TARGET_URL = process.argv[3] || 'https://httpbin.org/delay/1';
const REQUEST_COUNT = parseInt(process.argv[4] || '10');

interface TestResult {
  name: string;
  totalRequests: number;
  successful: number;
  failed: number;
  totalTime: number;
  avgTime: number;
  errors: string[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test direct concurrent fetches
 * In a Worker context, this would hit the 6 concurrent subrequest limit.
 * In Node.js, this tests the baseline behavior.
 */
async function testDirectFetches(targetUrl: string, count: number): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST 1: Direct Concurrent Fetches (${count} requests)`);
  console.log('='.repeat(60));

  const start = Date.now();
  const errors: string[] = [];
  const durations: number[] = [];

  const promises = Array.from({ length: count }, async (_, i) => {
    const reqStart = Date.now();
    try {
      const response = await fetch(`${targetUrl}?req=${i}`);
      const duration = Date.now() - reqStart;
      durations.push(duration);
      console.log(`  [${i}] SUCCESS - ${response.status} (${duration}ms)`);
      return true;
    } catch (e) {
      const duration = Date.now() - reqStart;
      const error = e instanceof Error ? e.message : String(e);
      errors.push(`Request ${i}: ${error}`);
      console.log(`  [${i}] FAILED - ${error} (${duration}ms)`);
      return false;
    }
  });

  const results = await Promise.allSettled(promises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
  const totalTime = Date.now() - start;

  return {
    name: 'Direct Fetches',
    totalRequests: count,
    successful,
    failed: count - successful,
    totalTime,
    avgTime: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    errors,
  };
}

/**
 * WebSocket client for proxied fetches
 */
class WsProxyClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
  }>();
  private requestId = 0;
  private connected = false;

  constructor(private proxyUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`  Connecting to ${this.proxyUrl}...`);

      // Use native WebSocket (Node 18+)
      const ws = new WebSocket(this.proxyUrl);

      ws.onopen = () => {
        console.log('  Connected to proxy');
        this.ws = ws as any;
        this.connected = true;
        resolve();
      };

      ws.onmessage = (event: MessageEvent) => {
        const response = JSON.parse(event.data as string);
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          pending.resolve(response);
        }
      };

      ws.onerror = (error: Event) => {
        console.error('  WebSocket error:', error);
        reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = () => {
        console.log('  WebSocket closed');
        this.connected = false;
        for (const [id, pending] of this.pending) {
          pending.reject(new Error('Connection closed'));
        }
        this.pending.clear();
      };
    });
  }

  async fetch(url: string): Promise<{ status: number; body: string; error?: string; timing?: any }> {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected');
    }

    const id = `req-${++this.requestId}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, url, method: 'GET' }));
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

/**
 * Test fetches via WebSocket proxy
 */
async function testWsFetches(proxyUrl: string, targetUrl: string, count: number): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST 2: WebSocket Proxied Fetches (${count} requests)`);
  console.log('='.repeat(60));

  const client = new WsProxyClient(proxyUrl);
  const start = Date.now();
  const errors: string[] = [];
  const durations: number[] = [];

  try {
    await client.connect();

    console.log(`  Launching ${count} concurrent requests via WebSocket...`);

    const promises = Array.from({ length: count }, async (_, i) => {
      const reqStart = Date.now();
      try {
        const response = await client.fetch(`${targetUrl}?req=${i}`);
        const duration = Date.now() - reqStart;
        durations.push(duration);

        if (response.error) {
          errors.push(`Request ${i}: ${response.error}`);
          console.log(`  [${i}] FAILED - ${response.error} (${duration}ms)`);
          return false;
        }

        console.log(`  [${i}] SUCCESS - ${response.status} (${duration}ms, proxy: ${response.timing?.duration}ms)`);
        return true;
      } catch (e) {
        const duration = Date.now() - reqStart;
        const error = e instanceof Error ? e.message : String(e);
        errors.push(`Request ${i}: ${error}`);
        console.log(`  [${i}] FAILED - ${error} (${duration}ms)`);
        return false;
      }
    });

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const totalTime = Date.now() - start;

    return {
      name: 'WebSocket Proxied Fetches',
      totalRequests: count,
      successful,
      failed: count - successful,
      totalTime,
      avgTime: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      errors,
    };
  } finally {
    client.close();
  }
}

function printResults(direct: TestResult, ws: TestResult): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));

  console.log(`\n${direct.name}:`);
  console.log(`  Total Requests: ${direct.totalRequests}`);
  console.log(`  Successful: ${direct.successful}`);
  console.log(`  Failed: ${direct.failed}`);
  console.log(`  Total Time: ${direct.totalTime}ms`);
  console.log(`  Avg Time: ${Math.round(direct.avgTime)}ms`);

  console.log(`\n${ws.name}:`);
  console.log(`  Total Requests: ${ws.totalRequests}`);
  console.log(`  Successful: ${ws.successful}`);
  console.log(`  Failed: ${ws.failed}`);
  console.log(`  Total Time: ${ws.totalTime}ms`);
  console.log(`  Avg Time: ${Math.round(ws.avgTime)}ms`);

  console.log(`\n${'='.repeat(60)}`);
  console.log('ANALYSIS');
  console.log('='.repeat(60));

  if (direct.failed > 0 && ws.failed === 0) {
    console.log('\n✅ HYPOTHESIS CONFIRMED!');
    console.log('   WebSocket proxying bypasses the concurrent fetch limit.');
    console.log(`   - Direct fetches: ${direct.failed}/${direct.totalRequests} failed`);
    console.log(`   - WS proxied: ${ws.successful}/${ws.totalRequests} succeeded`);
  } else if (direct.failed === 0 && ws.failed === 0) {
    console.log('\n⚠️  INCONCLUSIVE');
    console.log('   Both methods succeeded. This test was run outside a Worker context.');
    console.log('   Deploy to Workers and use the client-worker to test the actual limit.');
  } else if (ws.failed > 0) {
    console.log('\n❌ HYPOTHESIS NOT CONFIRMED');
    console.log('   WebSocket proxy also experienced failures.');
    console.log('   The proxy worker itself may be hitting the same limits.');
  }

  console.log('\n');
}

async function main() {
  console.log('WebSocket Fetch Bypass - Test Harness');
  console.log('=====================================');
  console.log(`Proxy URL: ${PROXY_URL}`);
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Request Count: ${REQUEST_COUNT}`);

  try {
    // Run tests
    const directResults = await testDirectFetches(TARGET_URL, REQUEST_COUNT);

    // Small delay between tests
    await sleep(1000);

    const wsResults = await testWsFetches(PROXY_URL, TARGET_URL, REQUEST_COUNT);

    // Print summary
    printResults(directResults, wsResults);

  } catch (e) {
    console.error('\nTest failed with error:', e);
    process.exit(1);
  }
}

main();
