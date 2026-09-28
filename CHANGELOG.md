# Changelog

## 0.3.0

### Minor Changes

- 379e24a: Move to upstream `capnweb` 0.12.0 (was the `@dotdo/capnweb` 0.4.0 fork).

  Breaking for consumers:

  - The dependency is now `capnweb`. On Node, an `RpcTarget` from a second copy of capnweb (such as `@dotdo/capnweb`) is not recognised; depend on `capnweb` 0.12 directly.
  - Receive limits apply by default: messages are capped at 32 MiB and nesting depth at 256.
  - New wire types (streams, Blob, URL, typed arrays) need both ends on capnweb 0.12.
  - On Node, byte arrays come back as `Buffer`.
  - Some return types changed.

  Kept inside rpc.do: `HibernatableWebSocketTransport` and `TransportRegistry` (exported from `rpc.do/server`).

  Fixed: a call made through `http()` or `capnweb(url, { websocket: false })` while an earlier batch was in flight failed with "Batch RPC request ended".

  Added: `batchSession()`, a pipelining stub for one HTTP batch.

  Requires Node.js 20 or later (was 18). Node 18 has no global Web Crypto, and `HibernatableWebSocketTransport` and `rpc.do init` call `crypto.randomUUID()`; Node 18 reached end of life in April 2025.

### Patch Changes

- 9007966: Fixed types: `getMethod`, `createQueryFn`, `createMutationFn` and the React Query/SWR helper types now accept methods that take typed parameters (before, `MethodPaths` only listed zero-argument methods). `createSpy((x: number) => ...)` and `mockTransport({ 'users.get': (id: string) => ... })` now type-check.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING**: `rpc.do` and `@dotdo/rpc` depend on upstream `capnweb` ^0.12.0 instead of the `@dotdo/capnweb` 0.4.0 fork.
  `HibernatableWebSocketTransport` and `TransportRegistry` (the fork's one runtime addition) now ship inside
  `rpc.do/server` and `@dotdo/rpc`. Code that imported `@dotdo/capnweb` or `@dotdo/capnweb/server` should import
  from `capnweb` (or `rpc.do/server`). See capnweb's CHANGELOG 0.5.0-0.12.0 for protocol-level changes.
- `rpc.do/server` additionally re-exports `newWorkersWebSocketRpcResponse`, `nodeHttpBatchRpcResponse`, `DEFAULT_LIMITS`,
  and the `RpcLimits` and `PendingReceive` types.

### Fixed

- `http()` and `capnweb(url, { websocket: false })`: a call made in a later tick while an earlier batch was still in
  flight was sent into the spent batch session and failed with "Batch RPC request ended.". A batch session is now
  handed out only until the macrotask at which it flushes; later calls get a fresh one.

### Added

- `batchSession(url, { fetch?, headers?, sessionOptions? })`: one capnweb HTTP batch with its pipelining stub,
  `flush()`, `abort()` and `sent`, from `rpc.do` and `rpc.do/transports`.

### v1.0 Release Preparation

This release marks the v1.0 milestone, signaling API stability and production-readiness.
See [VERSIONING.md](./docs/VERSIONING.md) for our stability guarantees.

---

## [0.2.4] - 2025

### Changed

- Refactor to use capnweb throughout
- Added `rpc.do/server` with `createTarget()` and `createHandler()` for wrapping any object/SDK as an RpcTarget
- Updated `rpc.do/expose` to use capnweb RpcTarget with prototype methods

---

## [0.2.x] - 2025

### Added

- **Zero-config type generation**: `npx rpc.do generate` now auto-discovers DO classes
- **Static type extraction**: `--source` flag for TypeScript AST-based type extraction
- **Factory pattern support**: `DO()` factory pattern type extraction alongside class-based DOs
- **Modular architecture**: `@dotdo/rpc/lite` for minimal bundle size
- **DO Collections**: MongoDB-style document store on SQLite with `$.collection('name')`
- **Remote DO access**: `$.sql`, `$.storage`, `$.collection` work identically inside and outside DOs
- **Colo awareness**: Location-aware DOs with `getColo()`, `coloDistance()`, `estimateLatency()`
- **Events integration**: Optional `@dotdo/rpc/events` for CDC and event streaming
- **Extract module**: `rpc.do/extract` for TypeScript type extraction

### Changed

- **BREAKING**: Migrated to `@dotdo/capnweb` fork for promise pipelining
- **BREAKING**: All transports now use capnweb protocol (unified transport layer)
- **BREAKING**: `RPC(url)` is now the recommended API (replaces `createRPCClient`)
- Simplified RPC API - accepts URL directly without options wrapper
- Re-export types from `@dotdo/types/rpc` for cross-package compatibility

### Fixed

- Correct cascade operator semantics (`~>` is fuzzy/semantic)
- E2E tests use real DurableRPC with vitest-pool-workers

---

## [0.1.4] - 2025-01-23

### Added

- wsAdvanced transport with reconnection and heartbeat
- oauth.do integration

### Fixed

- Error handling consistency
- Added sideEffects: false for better tree-shaking

---

## [0.1.0] - Initial Release

### Added

- **Core RPC proxy**: Transport-agnostic RPC client with Proxy-based method chaining
- **Multiple transports**: HTTP, WebSocket, service bindings
- **DurableRPC base class**: WebSocket hibernation support
- **Server handler**: Worker export for RPC endpoints

---

## Migration from v0.x to v1.0

See [VERSIONING.md](./docs/VERSIONING.md) for the migration guide template.

### Key Breaking Changes in v0.2.x

1. **Transport unification**: All transports now use capnweb protocol

   ```typescript
   // Before (v0.1.x)
   import { capnweb } from "rpc.do/transports";
   const transport = capnweb("wss://example.com");

   // After (v0.2.x)
   import { capnweb } from "rpc.do/transports";
   const transport = capnweb("wss://example.com");
   ```

2. **Simplified RPC creation**: Direct URL now preferred

   ```typescript
   // Before (v0.1.x)
   const client = createRPCClient({ baseUrl: "https://example.com" });

   // After (v0.2.x) - recommended
   const $ = RPC("https://example.com");
   ```

3. **capnweb fork migration**: Now uses `@dotdo/capnweb` instead of `capnweb`
   ```typescript
   // Peer dependency changed
   // "@dotdo/capnweb": "^0.4.0" (was "capnweb": "^0.3.0")
   ```

---

## Package Versions

This monorepo contains two packages:

| Package      | Current Version | Description               |
| ------------ | --------------- | ------------------------- |
| `rpc.do`     | 0.2.4           | RPC client library        |
| `@dotdo/rpc` | 0.2.4           | Durable Object RPC server |

Both packages follow the same versioning and will be bumped to v1.0 together.
