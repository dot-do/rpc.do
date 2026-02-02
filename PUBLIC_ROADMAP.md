# rpc.do Public Roadmap

This document outlines the development roadmap for `rpc.do` and `@dotdo/rpc`, including our v1.0 release timeline, planned features, and long-term vision.

---

## Current Status

**Latest Version:** 0.2.4
**Stability:** Pre-release (API stabilizing)
**Production Readiness:** Suitable for early adopters; breaking changes possible until v1.0

### What's Already Shipped

- Core RPC proxy with transport-agnostic design
- Multiple transports: HTTP, WebSocket, service bindings, capnweb
- `DurableRPC` base class with WebSocket hibernation support
- SQLite access via `$.sql` tagged templates
- Key-value storage via `$.storage`
- MongoDB-style collections via `$.collection()`
- Zero-config type generation (`npx rpc.do generate`)
- Promise pipelining via `@dotdo/capnweb`
- Authentication providers (static, OAuth, cached)
- Colo awareness (location, distance, latency estimation)
- Events integration (`@dotdo/rpc/events`)

---

## v1.0 Release Timeline

**Target: Q1 2026 (March 2026)**

### Milestone 1: API Freeze (February 2026)

- [ ] Complete API audit and finalize all public exports
- [ ] Remove or stabilize all deprecated APIs
- [ ] Lock down TypeScript type signatures
- [ ] Finalize error codes and messages

### Milestone 2: Documentation Complete (February 2026)

- [ ] Getting Started guide finalized
- [ ] API Reference complete with examples
- [ ] Migration guides (from tRPC, gRPC) reviewed
- [ ] Framework integration docs (React, Vue, Svelte)

### Milestone 3: Testing & Stability (March 2026)

- [ ] E2E test coverage >80%
- [ ] Performance benchmarks established
- [ ] Security audit complete
- [ ] Beta testing with select users

### Milestone 4: v1.0 Release (Late March 2026)

- [ ] Publish `rpc.do@1.0.0` and `@dotdo/rpc@1.0.0`
- [ ] Announce semver stability commitment
- [ ] Begin v0.x maintenance mode (6-month support window)

---

## Planned Features

### v1.0 (Q1 2026)

| Feature | Status | Description |
|---------|--------|-------------|
| API Stability | In Progress | Semver commitment for all public exports |
| Improved Error Messages | Planned | Developer-friendly error descriptions |
| Enhanced Type Inference | Planned | Better TypeScript inference for RPC methods |
| Performance Optimizations | Planned | Reduced bundle size, faster proxy creation |

### v1.1 (Q2 2026)

| Feature | Status | Description |
|---------|--------|-------------|
| **Streaming Support** | Planned | Server-sent events and streaming responses |
| **Framework Adapters** | Planned | First-class React, Vue, Svelte integrations |
| Retry Policies | Planned | Configurable retry strategies for transient failures |
| Connection Pooling | Planned | Efficient connection reuse for high-throughput |

### v1.2 (Q3 2026)

| Feature | Status | Description |
|---------|--------|-------------|
| **Enhanced Validation** | Planned | Built-in Zod/Valibot schema validation |
| Observability | Planned | OpenTelemetry tracing, metrics export |
| Rate Limiting | Planned | Client-side rate limit handling |
| Offline Support | Planned | Queue operations when disconnected |

### Future Considerations (v2.0+)

- GraphQL-style subscriptions
- Edge caching layer
- Multi-region DO coordination
- Schema versioning and evolution
- Plugin architecture for custom transports

---

## 6-Month Vision (Q1-Q2 2026)

**Goal:** Establish rpc.do as the standard RPC solution for Cloudflare Durable Objects.

- **v1.0 Stability**: Ship a production-ready, semver-stable release that teams can confidently adopt
- **Framework Ecosystem**: Provide first-class integrations for popular frontend frameworks
- **Streaming**: Enable real-time data flows with streaming responses and server-sent events
- **Developer Experience**: World-class TypeScript support, helpful error messages, and comprehensive documentation

---

## 12-Month Vision (Q1-Q4 2026)

**Goal:** Expand beyond Durable Objects while maintaining our core focus.

- **Platform Expansion**: Support for additional edge runtimes (Deno Deploy, Vercel Edge)
- **Enterprise Features**: Team collaboration tools, audit logging, compliance features
- **Performance Leadership**: Industry-leading latency and throughput benchmarks
- **Community Growth**: Active contributor ecosystem, third-party plugins, tutorials

---

## Breaking Change Policy

We follow [Semantic Versioning 2.0.0](https://semver.org/) starting with v1.0.0.

### Deprecation Timeline

1. **Deprecation Notice**: Feature marked `@deprecated` with console warning
2. **Migration Period**: At least 1 minor version (e.g., v1.1 -> v1.2)
3. **Removal**: Earliest in next major version (e.g., v2.0)

### What Triggers a Major Version

- Removing a public API export
- Changing function signatures in incompatible ways
- Changing default behavior that breaks existing code
- Dropping support for Node.js LTS versions

### Exceptions

Security vulnerabilities may require immediate breaking changes. These will be:
- Documented in CHANGELOG
- Announced via GitHub Security Advisory
- Backported where feasible

For full details, see [docs/VERSIONING.md](./docs/VERSIONING.md).

---

## Feature Request Process

We welcome feature requests from the community!

### How to Request a Feature

1. **Search Existing Issues**: Check [GitHub Issues](https://github.com/dot-do/rpc.do/issues) for duplicates
2. **Open a Feature Request**: Use the "Feature Request" issue template
3. **Provide Context**: Explain your use case and why the feature would be valuable
4. **Engage in Discussion**: Respond to questions and refine the proposal

### Feature Prioritization

Features are prioritized based on:

1. **Alignment with Vision**: Does it fit our core mission?
2. **User Impact**: How many users would benefit?
3. **Implementation Complexity**: What's the effort vs. reward?
4. **Community Interest**: GitHub reactions, comments, and external demand

### Contributing

We love contributions! If you want to implement a feature:

1. Comment on the issue to express interest
2. Wait for maintainer approval (for significant changes)
3. Follow our [Contributing Guide](./CONTRIBUTING.md)
4. Submit a PR with tests and documentation

---

## Deprecated APIs (Removal in v2.0)

The following APIs are deprecated and will be removed in v2.0:

| API | Alternative | Deprecated In |
|-----|-------------|---------------|
| `createRPCClient()` | `RPC(url, options)` | v0.2.0 |
| `RPCClientOptions` | `RPCOptions` | v0.2.0 |
| `RPCPromise<T>` | `RpcPromise<T>` from @dotdo/types | v0.2.0 |
| `this.$` (in DurableRPC) | `this.sql` / `this.storage` | v0.2.0 |

For migration guidance, see [CHANGELOG.md](./CHANGELOG.md).

---

## Links

- [README](./README.md) - Project overview and quick start
- [CHANGELOG](./CHANGELOG.md) - Release history and migration notes
- [API Audit](./docs/API_AUDIT.md) - Complete public API surface
- [Versioning Policy](./docs/VERSIONING.md) - Stability guarantees
- [Getting Started](./docs/GETTING_STARTED.md) - Step-by-step tutorial
- [API Reference](./docs/API_REFERENCE.md) - Complete API documentation

---

*Last updated: February 2026*
