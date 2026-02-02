# rpc.do Performance Benchmarks

Generated: 2026-01-25T07:33:59.676Z
Node.js: v22.21.1
Platform: darwin arm64

## Latency Comparison

| Transport | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Min (ms) | Max (ms) |
|-----------|----------|----------|----------|-----------|----------|----------|
| rpc.do http() | 0.243 | 0.460 | 0.959 | 0.285 | 0.212 | 1.070 |
| Plain fetch | 0.186 | 0.293 | 0.352 | 0.203 | 0.164 | 0.785 |
| rpc.do capnweb() | 0.042 | 0.108 | 0.145 | 0.058 | 0.036 | 0.643 |
| Raw WebSocket | 0.036 | 0.061 | 0.086 | 0.040 | 0.030 | 0.102 |

## Throughput

| Transport | Requests/sec | Total Requests | Duration (ms) |
|-----------|-------------|----------------|---------------|
| HTTP (no auth) | 11922.86 | 23851 | 2000.442 |
| HTTP (with auth) | 13991.08 | 27987 | 2000.346 |
| WebSocket (no auth) | 93591.45 | 187185 | 2000.022 |
| WebSocket (with auth) | 95610.23 | 191229 | 2000.089 |

## Bundle Size

| Package | Size (KB) | Gzipped (KB) |
|---------|-----------|--------------|
| rpc.do core (index.js) | 1.87 | 0.70 |
| rpc.do transports | 0.24 | 0.15 |
| rpc.do auth | 2.79 | 0.83 |
| rpc.do errors | 0.24 | 0.13 |
| rpc.do combined (core + transports + errors) | 2.34 | N/A |
| tRPC client (for comparison, approx) | ~14.6 | N/A |
| Plain fetch wrapper (minimal) | ~0.5 | N/A |

## Memory Usage

| Metric | Value |
|--------|-------|
| Baseline heap | 32.89 MB |
| After 100 connections | 41.56 MB |
| Per connection overhead | 88.76 KB |
| After 100 pending requests | 41.73 MB |
| Per pending request overhead | 1.73 KB |

## Startup Time

| Metric | Time (ms) |
|--------|-----------|
| Transport initialization | 1.806 |
| Time to first RPC call | 3.731 |

---

*Benchmarks run on local mock server. Real-world performance may vary based on network conditions.*
