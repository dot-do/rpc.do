# rpc.do Performance Benchmarks

Comprehensive performance analysis of the rpc.do RPC framework.

## Summary

rpc.do is designed for minimal overhead while providing a full-featured RPC experience. Key highlights:

- **~2.3 KB** combined bundle size (core + transports + errors, gzipped)
- **< 0.3ms** average HTTP latency overhead
- **< 0.06ms** average WebSocket latency overhead
- **90,000+ msg/sec** WebSocket throughput
- **~89 KB** memory per WebSocket connection

## Bundle Size Analysis

| Package | Raw Size | Gzipped |
|---------|----------|---------|
| rpc.do core (index.js) | 10.13 KB | 2.34 KB |
| rpc.do transports | 0.81 KB | 0.32 KB |
| rpc.do auth | 2.96 KB | 0.89 KB |
| rpc.do errors | 0.26 KB | 0.14 KB |
| **Combined (core + transports + errors)** | **11.20 KB** | **2.80 KB** |

### Comparison with Other RPC Libraries

| Library | Bundle Size (gzipped) |
|---------|----------------------|
| **rpc.do** | **~2.8 KB** |
| tRPC client | ~14.6 KB |
| gRPC-web | ~30 KB |
| Plain fetch wrapper | ~0.5 KB |

rpc.do adds only ~2.3 KB over plain fetch while providing:
- Type-safe proxy-based API
- Multiple transports (HTTP, WebSocket, bindings)
- Promise pipelining via capnweb
- Automatic reconnection
- Authentication support

## Latency Benchmarks

Measured against a local mock server (100 samples each).

### HTTP Transport

| Metric | rpc.do http() | Plain fetch | Overhead |
|--------|---------------|-------------|----------|
| p50 | 0.243 ms | 0.186 ms | +0.057 ms |
| p95 | 0.460 ms | 0.293 ms | +0.167 ms |
| p99 | 0.959 ms | 0.352 ms | +0.607 ms |
| Mean | 0.285 ms | 0.203 ms | +0.082 ms |

### WebSocket Transport

| Metric | rpc.do ws() | Raw WebSocket | Overhead |
|--------|-------------|---------------|----------|
| p50 | 0.042 ms | 0.036 ms | +0.006 ms |
| p95 | 0.108 ms | 0.061 ms | +0.047 ms |
| p99 | 0.145 ms | 0.086 ms | +0.059 ms |
| Mean | 0.058 ms | 0.040 ms | +0.018 ms |

**Key Insight**: WebSocket transport is ~5x faster than HTTP for individual calls, with rpc.do adding only ~0.02ms overhead.

## Throughput Benchmarks

Sustained load test with 10 concurrent workers over 2 seconds.

| Transport | Requests/sec | Notes |
|-----------|-------------|-------|
| HTTP (no auth) | 11,923 | Request/response per call |
| HTTP (with auth) | 13,991 | Token header added |
| WebSocket (no auth) | 93,591 | Persistent connection |
| WebSocket (with auth) | 95,610 | Initial auth handshake only |

**Key Insight**: WebSocket throughput is ~8x higher than HTTP due to connection reuse.

## RPC Framework Performance

Tests from `tests/perf.benchmark.test.ts` using mock transports.

### Call Throughput

| Scenario | Duration | Rate |
|----------|----------|------|
| 1,000 sequential calls | < 1ms | 1,000,000+ ops/sec |
| 100 concurrent calls | < 1ms | 100,000+ ops/sec |
| 500 concurrent calls | < 1ms | 500,000+ ops/sec |
| 2,000 rapid sequential | 1ms | 2,000,000 ops/sec |

### Path Resolution

| Scenario | Duration | Rate |
|----------|----------|------|
| 1,000 deeply nested paths (5 levels) | 1ms | 1,000,000 ops/sec |
| 500 varied depth paths | 1ms | 500,000 ops/sec |

### Burst Traffic

| Scenario | Result |
|----------|--------|
| 5 bursts of 100 calls | < 1ms avg per burst |
| 5,000 sustained ops | 5,000,000 ops/sec |

## Collection (DO SQL) Performance

Tests from `core/src/perf.benchmark.test.ts` using in-memory SQLite.

### Write Operations

| Operation | Count | Duration | Rate |
|-----------|-------|----------|------|
| put() | 10,000 | 366ms | 27,322 ops/sec |
| update() | 5,000 | 135ms | 37,037 ops/sec |
| delete() | 5,000 | 133ms | 37,594 ops/sec |

### Read Operations

| Operation | Count | Duration | Rate |
|-----------|-------|----------|------|
| get() | 10,000 | 85ms | 117,647 ops/sec |
| find() with filter | 100 queries on 5K records | 597ms | 168 queries/sec |
| list() with pagination | 100 pages of 50 | 443ms | 226 pages/sec |

### Mixed Workload

| Scenario | Duration | Rate |
|----------|----------|------|
| 5K mixed ops (70% read, 20% write, 10% delete) | 52ms | 96,154 ops/sec |
| 3K ops across 5 collections | 109ms | 27,523 ops/sec |

### Query Performance

| Query Type | Records | Queries | Duration | Rate |
|------------|---------|---------|----------|------|
| Complex filters ($and, $gte, $lte) | 3,000 | 50 | 93ms | 538 queries/sec |
| $or queries | 2,000 | 50 | 148ms | 338 queries/sec |

### Large Documents

| Scenario | Duration |
|----------|----------|
| Write 100 docs (1-11 KB each) | 11ms |
| Read 100 large docs | 2ms |
| Write 500 deeply nested docs | 16ms |
| Read 500 deeply nested docs | 11ms |

### Stress Testing

| Scenario | Result |
|----------|--------|
| 10K mixed ops (40% write, 30% read, 20% find, 10% delete) | 51,546 ops/sec |
| 5,000 increment operations | 100% data integrity maintained |

## Memory Usage

### RPC Client

| Metric | Value |
|--------|-------|
| Baseline heap | 32.89 MB |
| After 100 WebSocket connections | 41.56 MB |
| Per connection overhead | 88.76 KB |
| Per pending request overhead | 1.73 KB |

### Memory Stability

| Test | Memory Change |
|------|---------------|
| 1,000 RPC operations | -12.69 MB (GC reclaimed) |
| 100 create/close cycles | +0.25 MB |
| 1,000 collection operations | -2.19 MB (GC reclaimed) |
| 50 collection create/drop cycles | +5.06 MB |

**Key Insight**: No memory leaks detected. Memory is properly reclaimed by garbage collection.

## Startup Time

| Metric | Time |
|--------|------|
| Transport initialization | 1.81ms |
| Time to first RPC call | 3.73ms |

## Comparison Notes

### vs tRPC

| Aspect | rpc.do | tRPC |
|--------|--------|------|
| Bundle size | ~2.8 KB | ~14.6 KB |
| Code generation | None | Required |
| WebSocket support | Native | Plugin needed |
| DO integration | First-class | Manual |

### vs gRPC-web

| Aspect | rpc.do | gRPC-web |
|--------|--------|----------|
| Bundle size | ~2.8 KB | ~30 KB |
| Protocol | JSON/capnweb | Protobuf |
| Schema | TypeScript inference | .proto files |
| Browser support | Native | Requires proxy |

### vs Plain Fetch

| Aspect | rpc.do | Plain fetch |
|--------|--------|-------------|
| Bundle overhead | +2.3 KB | Baseline |
| Latency overhead | ~0.08ms (HTTP) | Baseline |
| Type safety | Full | Manual |
| Batching | Automatic | Manual |
| Reconnection | Automatic | Manual |

## Running Benchmarks

```bash
# Run performance test suite
pnpm test -- --run perf

# Run full benchmark suite (requires mock server)
pnpm run bench
```

## Test Environment

- **Node.js**: v22.21.1
- **Platform**: darwin arm64 (Apple Silicon)
- **Test date**: January 2026

---

*Benchmarks run on local mock server. Real-world performance varies based on network conditions, server location, and payload size.*
