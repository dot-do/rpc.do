#!/usr/bin/env tsx
/**
 * rpc.do Performance Benchmarks
 *
 * Comprehensive benchmark suite measuring:
 * - Latency (p50, p95, p99)
 * - Throughput (requests/messages per second)
 * - Bundle size comparisons
 * - Memory usage
 * - Startup time
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket as WsLib } from 'ws'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

// Dynamic imports for rpc.do modules
const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

// ============================================================================
// Types
// ============================================================================

interface LatencyResults {
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  mean: number
  samples: number
}

interface ThroughputResults {
  requestsPerSecond: number
  duration: number
  totalRequests: number
}

interface BundleSizeResults {
  name: string
  sizeBytes: number
  sizeKB: string
  gzipBytes?: number
  gzipKB?: string
}

interface MemoryResults {
  baselineHeapMB: number
  afterConnectionsHeapMB: number
  perConnectionKB: number
  afterRequestsHeapMB: number
  perPendingRequestKB: number
}

interface StartupResults {
  transportInitMs: number
  firstCallMs: number
}

interface BenchmarkResults {
  timestamp: string
  nodeVersion: string
  platform: string
  latency: {
    rpcHttp: LatencyResults
    plainFetch: LatencyResults
    rpcWs: LatencyResults
    rawWs: LatencyResults
  }
  throughput: {
    httpNoAuth: ThroughputResults
    httpWithAuth: ThroughputResults
    wsNoAuth: ThroughputResults
    wsWithAuth: ThroughputResults
  }
  bundleSize: BundleSizeResults[]
  memory: MemoryResults
  startup: StartupResults
}

// ============================================================================
// Utilities
// ============================================================================

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function computeLatencyStats(samples: number[]): LatencyResults {
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    min: Math.min(...samples),
    max: Math.max(...samples),
    mean: mean(samples),
    samples: samples.length,
  }
}

function formatMs(ms: number): string {
  return ms.toFixed(3)
}

function formatBytes(bytes: number): string {
  return (bytes / 1024).toFixed(2)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getHeapUsedMB(): number {
  if (global.gc) {
    global.gc()
  }
  return process.memoryUsage().heapUsed / 1024 / 1024
}

// ============================================================================
// Mock Server Setup
// ============================================================================

interface MockServer {
  httpUrl: string
  wsUrl: string
  close: () => Promise<void>
}

async function createMockServer(port: number): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          try {
            const { path, args } = JSON.parse(body)
            // Simple echo response
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ path, echo: args[0] }))
          } catch {
            res.writeHead(400)
            res.end('Invalid JSON')
          }
        })
      } else {
        res.writeHead(200)
        res.end('OK')
      }
    })

    const wss = new WebSocketServer({ server })

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          const { id, path, args } = msg
          ws.send(JSON.stringify({ id, result: { path, echo: args[0] } }))
        } catch {
          ws.send(JSON.stringify({ error: { message: 'Parse error' } }))
        }
      })
    })

    server.listen(port, '127.0.0.1', () => {
      resolve({
        httpUrl: `http://127.0.0.1:${port}`,
        wsUrl: `ws://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            wss.close()
            server.close(() => res())
          }),
      })
    })
  })
}

// ============================================================================
// Latency Benchmarks
// ============================================================================

async function benchmarkRpcHttpLatency(
  url: string,
  iterations: number
): Promise<LatencyResults> {
  const { RPC, http } = await import('../src/index.js')
  const rpc = RPC(http(url))
  const samples: number[] = []

  // Warmup
  for (let i = 0; i < 10; i++) {
    await rpc.test.echo({ data: 'warmup' })
  }

  // Benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await rpc.test.echo({ data: `test-${i}` })
    samples.push(performance.now() - start)
  }

  return computeLatencyStats(samples)
}

async function benchmarkPlainFetchLatency(
  url: string,
  iterations: number
): Promise<LatencyResults> {
  const samples: number[] = []

  // Warmup
  for (let i = 0; i < 10; i++) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'do', path: 'test.echo', args: [{ data: 'warmup' }] }),
    })
  }

  // Benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'do', path: 'test.echo', args: [{ data: `test-${i}` }] }),
    })
    samples.push(performance.now() - start)
  }

  return computeLatencyStats(samples)
}

async function benchmarkRpcWsLatency(
  url: string,
  iterations: number
): Promise<LatencyResults> {
  const { RPC, ws } = await import('../src/index.js')
  const rpc = RPC(ws(url))
  const samples: number[] = []

  // Warmup
  for (let i = 0; i < 10; i++) {
    await rpc.test.echo({ data: 'warmup' })
  }

  // Benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await rpc.test.echo({ data: `test-${i}` })
    samples.push(performance.now() - start)
  }

  rpc.close?.()
  return computeLatencyStats(samples)
}

async function benchmarkRawWsLatency(
  url: string,
  iterations: number
): Promise<LatencyResults> {
  const samples: number[] = []

  const ws = new WsLib(url)
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })

  let messageId = 0
  const pending = new Map<number, (v: unknown) => void>()

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    const resolver = pending.get(msg.id)
    if (resolver) {
      pending.delete(msg.id)
      resolver(msg.result)
    }
  })

  const call = (path: string, args: unknown[]): Promise<unknown> => {
    return new Promise((resolve) => {
      const id = ++messageId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method: 'do', path, args }))
    })
  }

  // Warmup
  for (let i = 0; i < 10; i++) {
    await call('test.echo', [{ data: 'warmup' }])
  }

  // Benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await call('test.echo', [{ data: `test-${i}` }])
    samples.push(performance.now() - start)
  }

  ws.close()
  return computeLatencyStats(samples)
}

// ============================================================================
// Throughput Benchmarks
// ============================================================================

async function benchmarkHttpThroughput(
  url: string,
  durationMs: number,
  withAuth: boolean
): Promise<ThroughputResults> {
  const { RPC, http } = await import('../src/index.js')
  const rpc = RPC(http(url, withAuth ? 'test-token' : undefined))

  let count = 0
  const start = performance.now()
  const end = start + durationMs

  // Run concurrent requests
  const concurrency = 10
  const workers: Promise<void>[] = []

  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (performance.now() < end) {
          await rpc.test.echo({ data: 'throughput' })
          count++
        }
      })()
    )
  }

  await Promise.all(workers)
  const elapsed = performance.now() - start

  return {
    requestsPerSecond: (count / elapsed) * 1000,
    duration: elapsed,
    totalRequests: count,
  }
}

async function benchmarkWsThroughput(
  url: string,
  durationMs: number,
  withAuth: boolean
): Promise<ThroughputResults> {
  const { RPC, ws } = await import('../src/index.js')
  const rpc = RPC(ws(url, withAuth ? 'test-token' : undefined))

  let count = 0
  const start = performance.now()
  const end = start + durationMs

  // Run concurrent requests
  const concurrency = 10
  const workers: Promise<void>[] = []

  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (performance.now() < end) {
          await rpc.test.echo({ data: 'throughput' })
          count++
        }
      })()
    )
  }

  await Promise.all(workers)
  const elapsed = performance.now() - start

  rpc.close?.()

  return {
    requestsPerSecond: (count / elapsed) * 1000,
    duration: elapsed,
    totalRequests: count,
  }
}

// ============================================================================
// Bundle Size Analysis
// ============================================================================

function analyzeBundleSize(): BundleSizeResults[] {
  const results: BundleSizeResults[] = []

  try {
    // Build if dist doesn't exist
    const distPath = join(projectRoot, 'dist')
    try {
      execSync(`ls ${distPath}`, { encoding: 'utf-8' })
    } catch {
      console.log('  Building dist...')
      execSync('pnpm build', { cwd: projectRoot, encoding: 'utf-8' })
    }

    // Analyze each module
    const modules = [
      { name: 'rpc.do core (index.js)', file: 'dist/index.js' },
      { name: 'rpc.do transports', file: 'dist/transports.js' },
      { name: 'rpc.do auth', file: 'dist/auth.js' },
      { name: 'rpc.do errors', file: 'dist/errors.js' },
    ]

    for (const mod of modules) {
      try {
        const filePath = join(projectRoot, mod.file)
        const stats = execSync(`wc -c < "${filePath}"`, { encoding: 'utf-8' })
        const sizeBytes = parseInt(stats.trim(), 10)

        // Try to get gzip size
        let gzipBytes: number | undefined
        try {
          const gzipOutput = execSync(`gzip -c "${filePath}" | wc -c`, {
            encoding: 'utf-8',
          })
          gzipBytes = parseInt(gzipOutput.trim(), 10)
        } catch {
          // gzip not available
        }

        results.push({
          name: mod.name,
          sizeBytes,
          sizeKB: formatBytes(sizeBytes),
          gzipBytes,
          gzipKB: gzipBytes ? formatBytes(gzipBytes) : undefined,
        })
      } catch {
        // File doesn't exist
      }
    }

    // Combined size (core + transports)
    try {
      const coreSize = results.find((r) => r.name.includes('core'))?.sizeBytes ?? 0
      const transportsSize = results.find((r) => r.name.includes('transports'))?.sizeBytes ?? 0
      const errorsSize = results.find((r) => r.name.includes('errors'))?.sizeBytes ?? 0
      const combinedSize = coreSize + transportsSize + errorsSize

      results.push({
        name: 'rpc.do combined (core + transports + errors)',
        sizeBytes: combinedSize,
        sizeKB: formatBytes(combinedSize),
      })
    } catch {
      // Skip combined
    }

    // Add comparison note for tRPC (approximate based on bundlephobia data)
    results.push({
      name: 'tRPC client (for comparison, approx)',
      sizeBytes: 15000,
      sizeKB: '~14.6',
    })

    results.push({
      name: 'Plain fetch wrapper (minimal)',
      sizeBytes: 500,
      sizeKB: '~0.5',
    })
  } catch (e) {
    console.error('  Bundle size analysis error:', e)
  }

  return results
}

// ============================================================================
// Memory Benchmarks
// ============================================================================

async function benchmarkMemory(wsUrl: string): Promise<MemoryResults> {
  // Force GC if available
  const baseline = getHeapUsedMB()

  const { RPC, ws } = await import('../src/index.js')

  // Create multiple connections
  const connections: ReturnType<typeof RPC>[] = []
  const connectionCount = 100

  for (let i = 0; i < connectionCount; i++) {
    connections.push(RPC(ws(wsUrl)))
  }

  // Make a call on each to ensure connection is established
  await Promise.all(connections.map((rpc) => rpc.test.echo({ data: 'init' })))

  const afterConnections = getHeapUsedMB()

  // Create pending requests (start but don't await)
  const pendingCount = 100
  const pendingPromises: Promise<unknown>[] = []

  for (let i = 0; i < pendingCount; i++) {
    pendingPromises.push(connections[0].test.echo({ data: `pending-${i}` }))
  }

  const afterRequests = getHeapUsedMB()

  // Wait for all pending
  await Promise.all(pendingPromises)

  // Clean up
  for (const rpc of connections) {
    rpc.close?.()
  }

  return {
    baselineHeapMB: baseline,
    afterConnectionsHeapMB: afterConnections,
    perConnectionKB: ((afterConnections - baseline) / connectionCount) * 1024,
    afterRequestsHeapMB: afterRequests,
    perPendingRequestKB:
      ((afterRequests - afterConnections) / pendingCount) * 1024,
  }
}

// ============================================================================
// Startup Time Benchmarks
// ============================================================================

async function benchmarkStartup(httpUrl: string): Promise<StartupResults> {
  // Measure transport initialization
  const initStart = performance.now()
  const { RPC, http } = await import('../src/index.js')
  const rpc = RPC(http(httpUrl))
  const initEnd = performance.now()

  // Measure first call (includes any lazy initialization)
  const callStart = performance.now()
  await rpc.test.echo({ data: 'first-call' })
  const callEnd = performance.now()

  return {
    transportInitMs: initEnd - initStart,
    firstCallMs: callEnd - callStart,
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

function generateMarkdownTable(results: BenchmarkResults): string {
  let md = `# rpc.do Performance Benchmarks

Generated: ${results.timestamp}
Node.js: ${results.nodeVersion}
Platform: ${results.platform}

## Latency Comparison

| Transport | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Min (ms) | Max (ms) |
|-----------|----------|----------|----------|-----------|----------|----------|
| rpc.do http() | ${formatMs(results.latency.rpcHttp.p50)} | ${formatMs(results.latency.rpcHttp.p95)} | ${formatMs(results.latency.rpcHttp.p99)} | ${formatMs(results.latency.rpcHttp.mean)} | ${formatMs(results.latency.rpcHttp.min)} | ${formatMs(results.latency.rpcHttp.max)} |
| Plain fetch | ${formatMs(results.latency.plainFetch.p50)} | ${formatMs(results.latency.plainFetch.p95)} | ${formatMs(results.latency.plainFetch.p99)} | ${formatMs(results.latency.plainFetch.mean)} | ${formatMs(results.latency.plainFetch.min)} | ${formatMs(results.latency.plainFetch.max)} |
| rpc.do ws() | ${formatMs(results.latency.rpcWs.p50)} | ${formatMs(results.latency.rpcWs.p95)} | ${formatMs(results.latency.rpcWs.p99)} | ${formatMs(results.latency.rpcWs.mean)} | ${formatMs(results.latency.rpcWs.min)} | ${formatMs(results.latency.rpcWs.max)} |
| Raw WebSocket | ${formatMs(results.latency.rawWs.p50)} | ${formatMs(results.latency.rawWs.p95)} | ${formatMs(results.latency.rawWs.p99)} | ${formatMs(results.latency.rawWs.mean)} | ${formatMs(results.latency.rawWs.min)} | ${formatMs(results.latency.rawWs.max)} |

## Throughput

| Transport | Requests/sec | Total Requests | Duration (ms) |
|-----------|-------------|----------------|---------------|
| HTTP (no auth) | ${results.throughput.httpNoAuth.requestsPerSecond.toFixed(2)} | ${results.throughput.httpNoAuth.totalRequests} | ${formatMs(results.throughput.httpNoAuth.duration)} |
| HTTP (with auth) | ${results.throughput.httpWithAuth.requestsPerSecond.toFixed(2)} | ${results.throughput.httpWithAuth.totalRequests} | ${formatMs(results.throughput.httpWithAuth.duration)} |
| WebSocket (no auth) | ${results.throughput.wsNoAuth.requestsPerSecond.toFixed(2)} | ${results.throughput.wsNoAuth.totalRequests} | ${formatMs(results.throughput.wsNoAuth.duration)} |
| WebSocket (with auth) | ${results.throughput.wsWithAuth.requestsPerSecond.toFixed(2)} | ${results.throughput.wsWithAuth.totalRequests} | ${formatMs(results.throughput.wsWithAuth.duration)} |

## Bundle Size

| Package | Size (KB) | Gzipped (KB) |
|---------|-----------|--------------|
${results.bundleSize.map((b) => `| ${b.name} | ${b.sizeKB} | ${b.gzipKB ?? 'N/A'} |`).join('\n')}

## Memory Usage

| Metric | Value |
|--------|-------|
| Baseline heap | ${results.memory.baselineHeapMB.toFixed(2)} MB |
| After 100 connections | ${results.memory.afterConnectionsHeapMB.toFixed(2)} MB |
| Per connection overhead | ${results.memory.perConnectionKB.toFixed(2)} KB |
| After 100 pending requests | ${results.memory.afterRequestsHeapMB.toFixed(2)} MB |
| Per pending request overhead | ${results.memory.perPendingRequestKB.toFixed(2)} KB |

## Startup Time

| Metric | Time (ms) |
|--------|-----------|
| Transport initialization | ${formatMs(results.startup.transportInitMs)} |
| Time to first RPC call | ${formatMs(results.startup.firstCallMs)} |

---

*Benchmarks run on local mock server. Real-world performance may vary based on network conditions.*
`

  return md
}

function printConsoleOutput(results: BenchmarkResults): void {
  console.log('\n' + '='.repeat(60))
  console.log('rpc.do Performance Benchmark Results')
  console.log('='.repeat(60))
  console.log(`Timestamp: ${results.timestamp}`)
  console.log(`Node.js: ${results.nodeVersion}`)
  console.log(`Platform: ${results.platform}`)

  console.log('\n--- Latency (ms) ---')
  console.log('Transport          p50      p95      p99      mean')
  console.log(`rpc.do http()      ${formatMs(results.latency.rpcHttp.p50).padStart(6)}   ${formatMs(results.latency.rpcHttp.p95).padStart(6)}   ${formatMs(results.latency.rpcHttp.p99).padStart(6)}   ${formatMs(results.latency.rpcHttp.mean).padStart(6)}`)
  console.log(`Plain fetch        ${formatMs(results.latency.plainFetch.p50).padStart(6)}   ${formatMs(results.latency.plainFetch.p95).padStart(6)}   ${formatMs(results.latency.plainFetch.p99).padStart(6)}   ${formatMs(results.latency.plainFetch.mean).padStart(6)}`)
  console.log(`rpc.do ws()        ${formatMs(results.latency.rpcWs.p50).padStart(6)}   ${formatMs(results.latency.rpcWs.p95).padStart(6)}   ${formatMs(results.latency.rpcWs.p99).padStart(6)}   ${formatMs(results.latency.rpcWs.mean).padStart(6)}`)
  console.log(`Raw WebSocket      ${formatMs(results.latency.rawWs.p50).padStart(6)}   ${formatMs(results.latency.rawWs.p95).padStart(6)}   ${formatMs(results.latency.rawWs.p99).padStart(6)}   ${formatMs(results.latency.rawWs.mean).padStart(6)}`)

  console.log('\n--- Throughput ---')
  console.log(`HTTP (no auth):    ${results.throughput.httpNoAuth.requestsPerSecond.toFixed(2)} req/s`)
  console.log(`HTTP (with auth):  ${results.throughput.httpWithAuth.requestsPerSecond.toFixed(2)} req/s`)
  console.log(`WS (no auth):      ${results.throughput.wsNoAuth.requestsPerSecond.toFixed(2)} msg/s`)
  console.log(`WS (with auth):    ${results.throughput.wsWithAuth.requestsPerSecond.toFixed(2)} msg/s`)

  console.log('\n--- Bundle Size ---')
  for (const b of results.bundleSize) {
    console.log(`${b.name}: ${b.sizeKB} KB${b.gzipKB ? ` (${b.gzipKB} KB gzipped)` : ''}`)
  }

  console.log('\n--- Memory ---')
  console.log(`Per connection: ${results.memory.perConnectionKB.toFixed(2)} KB`)
  console.log(`Per pending request: ${results.memory.perPendingRequestKB.toFixed(2)} KB`)

  console.log('\n--- Startup ---')
  console.log(`Transport init: ${formatMs(results.startup.transportInitMs)} ms`)
  console.log(`First call: ${formatMs(results.startup.firstCallMs)} ms`)

  console.log('\n' + '='.repeat(60))
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('rpc.do Performance Benchmarks')
  console.log('=============================\n')

  const PORT = 9876
  const LATENCY_ITERATIONS = 100
  const THROUGHPUT_DURATION = 2000 // 2 seconds

  console.log('Starting mock server...')
  const server = await createMockServer(PORT)
  console.log(`Mock server running at ${server.httpUrl}\n`)

  const results: Partial<BenchmarkResults> = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
  }

  try {
    // Latency benchmarks
    console.log('Running latency benchmarks...')
    console.log('  rpc.do http()...')
    const rpcHttpLatency = await benchmarkRpcHttpLatency(server.httpUrl, LATENCY_ITERATIONS)
    console.log('  Plain fetch...')
    const plainFetchLatency = await benchmarkPlainFetchLatency(server.httpUrl, LATENCY_ITERATIONS)
    console.log('  rpc.do ws()...')
    const rpcWsLatency = await benchmarkRpcWsLatency(server.wsUrl, LATENCY_ITERATIONS)
    console.log('  Raw WebSocket...')
    const rawWsLatency = await benchmarkRawWsLatency(server.wsUrl, LATENCY_ITERATIONS)

    results.latency = {
      rpcHttp: rpcHttpLatency,
      plainFetch: plainFetchLatency,
      rpcWs: rpcWsLatency,
      rawWs: rawWsLatency,
    }

    // Throughput benchmarks
    console.log('\nRunning throughput benchmarks...')
    console.log('  HTTP (no auth)...')
    const httpNoAuth = await benchmarkHttpThroughput(server.httpUrl, THROUGHPUT_DURATION, false)
    console.log('  HTTP (with auth)...')
    const httpWithAuth = await benchmarkHttpThroughput(server.httpUrl, THROUGHPUT_DURATION, true)
    console.log('  WebSocket (no auth)...')
    const wsNoAuth = await benchmarkWsThroughput(server.wsUrl, THROUGHPUT_DURATION, false)
    console.log('  WebSocket (with auth)...')
    const wsWithAuth = await benchmarkWsThroughput(server.wsUrl, THROUGHPUT_DURATION, true)

    results.throughput = {
      httpNoAuth,
      httpWithAuth,
      wsNoAuth,
      wsWithAuth,
    }

    // Bundle size analysis
    console.log('\nAnalyzing bundle sizes...')
    results.bundleSize = analyzeBundleSize()

    // Memory benchmarks
    console.log('\nRunning memory benchmarks...')
    results.memory = await benchmarkMemory(server.wsUrl)

    // Startup benchmarks
    console.log('\nRunning startup benchmarks...')
    results.startup = await benchmarkStartup(server.httpUrl)

    const finalResults = results as BenchmarkResults

    // Output results
    printConsoleOutput(finalResults)

    // Write JSON results
    const jsonPath = join(__dirname, 'results.json')
    writeFileSync(jsonPath, JSON.stringify(finalResults, null, 2))
    console.log(`\nJSON results written to: ${jsonPath}`)

    // Write markdown README
    const mdPath = join(__dirname, 'README.md')
    writeFileSync(mdPath, generateMarkdownTable(finalResults))
    console.log(`Markdown results written to: ${mdPath}`)

  } finally {
    console.log('\nShutting down mock server...')
    await server.close()
  }
}

main().catch(console.error)
