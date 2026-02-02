---
title: Installation
description: Different ways to install and configure rpc.do
---

## Client Package (rpc.do)

Install the client package to connect to RPC-enabled Durable Objects:

```bash
npm install rpc.do
```

This gives you:
- `RPC()` factory for creating typed RPC clients
- Built-in transports (HTTP, WebSocket, service bindings)
- Middleware system for logging, retry, validation
- DO client features (SQL, storage, collections)
- CLI for type generation

## Server Package (@dotdo/rpc)

Install the server package to create RPC-enabled Durable Objects:

```bash
npm install @dotdo/rpc
npm install -D @cloudflare/workers-types
```

This gives you:
- `DurableRPC` base class
- WebSocket hibernation support
- MongoDB-style collections on SQLite
- Schema introspection
- Worker router

## Peer Dependencies

Some features require additional packages:

| Package | Required | What it enables |
|---------|----------|-----------------|
| `@cloudflare/workers-types` | **Yes** (dev) | TypeScript types for Workers APIs |
| `colo.do` | No | Location awareness (`this.colo`, distance/latency APIs) |
| `@dotdo/events` | No | Event streaming, CDC (Change Data Capture) |
| `@dotdo/types` | No | Full platform type definitions |

### Install by Use Case

**Basic Durable Object with RPC:**
```bash
npm install @dotdo/rpc
npm install -D @cloudflare/workers-types
```

**With location awareness:**
```bash
npm install @dotdo/rpc colo.do
```

**With event streaming/CDC:**
```bash
npm install @dotdo/rpc @dotdo/events
```

**Full-featured setup:**
```bash
npm install @dotdo/rpc colo.do @dotdo/events @dotdo/types
```

## Entry Points

### @dotdo/rpc Entry Points

| Entry Point | Description | Bundle Size |
|-------------|-------------|-------------|
| `@dotdo/rpc` | Full DurableRPC with all features | Largest |
| `@dotdo/rpc/lite` | Minimal DurableRPC (no colo, no collections) | Smallest |
| `@dotdo/rpc/collections` | Standalone collections on SQLite | Medium |
| `@dotdo/rpc/do-collections` | Digital Object semantics | Medium |
| `@dotdo/rpc/events` | Event/CDC integration | Medium |

### rpc.do Entry Points

| Entry Point | Description |
|-------------|-------------|
| `rpc.do` | Main client exports |
| `rpc.do/auth` | Authentication providers |
| `rpc.do/errors` | Error classes |
| `rpc.do/middleware` | Middleware utilities |
| `rpc.do/testing` | Test utilities |
| `rpc.do/server` | Server utilities |

## TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

## Wrangler Configuration

Example `wrangler.toml` for a Durable Object:

```toml
name = "my-rpc-service"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDurableObject" }
]

[[migrations]]
tag = "v1"
new_classes = ["MyDurableObject"]
```

## Next Steps

- [Quick Start](/getting-started/quick-start/) - Build your first RPC service
- [API Reference](/api/rpc-client/) - Explore the full API
- [Server Setup](/guides/server-setup/) - Learn about DurableRPC configuration
