---
"rpc.do": minor
---

Move to upstream `capnweb` 0.12.0 (was the `@dotdo/capnweb` 0.4.0 fork).

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
