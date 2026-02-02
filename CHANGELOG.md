# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
   import { capnweb } from 'rpc.do/transports'
   const transport = capnweb('wss://example.com')

   // After (v0.2.x)
   import { capnweb } from 'rpc.do/transports'
   const transport = capnweb('wss://example.com')
   ```

2. **Simplified RPC creation**: Direct URL now preferred
   ```typescript
   // Before (v0.1.x)
   const client = createRPCClient({ baseUrl: 'https://example.com' })

   // After (v0.2.x) - recommended
   const $ = RPC('https://example.com')
   ```

3. **capnweb fork migration**: Now uses `@dotdo/capnweb` instead of `capnweb`
   ```typescript
   // Peer dependency changed
   // "@dotdo/capnweb": "^0.4.0" (was "capnweb": "^0.3.0")
   ```

---

## Package Versions

This monorepo contains two packages:

| Package | Current Version | Description |
|---------|-----------------|-------------|
| `rpc.do` | 0.2.4 | RPC client library |
| `@dotdo/rpc` | 0.2.4 | Durable Object RPC server |

Both packages follow the same versioning and will be bumped to v1.0 together.
