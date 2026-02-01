# API Surface Audit for v1.0

This document audits all public exports from `rpc.do` and `@dotdo/rpc` packages, marking their stability status for the v1.0 release.

**Legend:**
- STABLE: Covered by semver, will not change without major version bump
- STABLE (re-export): Re-exported from dependency, stability follows upstream
- DEPRECATED: Will be removed in v2.0, use alternative
- INTERNAL: Not part of public API, may change in any release

---

## Package: `rpc.do`

### Main Entry Point (`rpc.do`)

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `RPC` | function | STABLE | Primary API for creating RPC clients |
| `$` | const | STABLE | Pre-configured client for rpc.do |
| `createRPCClient` | function | DEPRECATED | Use `RPC(url, options)` instead |
| `createDOClient` | function | STABLE | Direct transport-based client creation |
| `connectDO` | function | STABLE | Convenience wrapper for DO connection |

#### Types (Main Entry)

| Export | Status | Notes |
|--------|--------|-------|
| `Transport` | STABLE | Core transport interface |
| `TransportFactory` | STABLE | Lazy transport creation |
| `RPCProxy` | STABLE | Typed proxy return type |
| `RPCFunction` | STABLE | RPC function type helper |
| `AsyncFunction` | STABLE | Async conversion helper |
| `RPCOptions` | STABLE | RPC client options |
| `RPCClientOptions` | DEPRECATED | Use `RPCOptions` |
| `RPCPromise` | DEPRECATED | Use `RpcPromise` from @dotdo/types |
| `RPCResult` | STABLE | Return type inference helper |
| `RPCInput` | STABLE | Input type inference helper |
| `DOClient` | STABLE | DO client type |
| `SqlQuery` | STABLE | SQL query builder |
| `SqlQueryResult` | STABLE | SQL result type |
| `RemoteStorage` | STABLE | Remote storage interface |
| `RemoteCollection` | STABLE | Remote collection interface |
| `RemoteCollections` | STABLE | Collections manager interface |
| `Filter` | STABLE | MongoDB-style filter type |
| `FilterOperator` | STABLE | Filter operator types |
| `QueryOptions` | STABLE | Query options type |
| `DatabaseSchema` | STABLE | DB schema introspection type |
| `TableSchema` | STABLE | Table schema type |
| `ColumnSchema` | STABLE | Column schema type |
| `IndexSchema` | STABLE | Index schema type |
| `RpcSchema` | STABLE | RPC schema type |

#### Re-exports from @dotdo/types/rpc

| Export | Status | Notes |
|--------|--------|-------|
| `RpcPromise` | STABLE (re-export) | Promise pipelining type |
| `RpcPipelined` | STABLE (re-export) | Pipelined type helper |
| `RpcArrayMethods` | STABLE (re-export) | Array pipeline methods |
| `RpcMapCallback` | STABLE (re-export) | Map callback type |
| `RpcArrayPromise` | STABLE (re-export) | Array promise type |
| `RpcPromiseEnhanced` | STABLE (re-export) | Enhanced promise type |
| `RpcStream` | STABLE (re-export) | Stream type |
| `RpcAsyncIterable` | STABLE (re-export) | Async iterable type |
| `UnwrapRpcPromise` | STABLE (re-export) | Unwrap helper |
| `MaybeRpcPromise` | STABLE (re-export) | Maybe promise type |
| `DeepUnwrapRpcPromise` | STABLE (re-export) | Deep unwrap helper |
| `IsRpcPromise` | STABLE (re-export) | Type guard helper |
| `RPCRequest` | STABLE (re-export) | JSON-RPC request type |
| `RPCResponse` | STABLE (re-export) | JSON-RPC response type |
| `RPCNotification` | STABLE (re-export) | JSON-RPC notification type |
| `RPCBatchRequest` | STABLE (re-export) | Batch request type |
| `RPCBatchResponse` | STABLE (re-export) | Batch response type |
| `RPCMetadata` | STABLE (re-export) | Metadata type |
| `RPCErrorType` | STABLE (re-export) | Error type |
| `RPCErrorCode` | STABLE (re-export) | Error code type |
| `RPCStringErrorCode` | STABLE (re-export) | String error code type |
| `MinimalTransport` | STABLE (re-export) | Minimal transport interface |
| `TypesTransportFactory` | STABLE (re-export) | Transport factory type |
| `ConnectionErrorInterface` | STABLE (re-export) | Connection error interface |
| `ConnectionErrorCodeType` | STABLE (re-export) | Connection error code type |
| `AuthenticationErrorInterface` | STABLE (re-export) | Auth error interface |
| `TypesServerMessage` | STABLE (re-export) | Server message type |
| `DOClientInterface` | STABLE (re-export) | DO client interface |
| `DOClientOptionsType` | STABLE (re-export) | DO client options type |
| `RemoteStorageInterface` | STABLE (re-export) | Remote storage interface |
| `RemoteCollectionInterface` | STABLE (re-export) | Remote collection interface |
| `SqlQueryResultType` | STABLE (re-export) | SQL result type |
| `SqlQueryType` | STABLE (re-export) | SQL query type |
| `TypedDOStubProxy` | STABLE (re-export) | Typed DO stub type |
| `RPCMiddleware` | STABLE (re-export) | Middleware type |
| `RPCClient` | STABLE (re-export) | Client type |
| `RPCServer` | STABLE (re-export) | Server type |
| `RPCClientConfig` | STABLE (re-export) | Client config type |
| `RPCServerConfig` | STABLE (re-export) | Server config type |
| `RPCMethodHandler` | STABLE (re-export) | Method handler type |
| `RPCHandlerContext` | STABLE (re-export) | Handler context type |
| `CapnWebConfig` | STABLE (re-export) | CapnWeb config type |
| `ProxyOptions` | STABLE (re-export) | Proxy options type |
| `MagicMap` | STABLE (re-export) | Magic map type |
| `MutableMagicMap` | STABLE (re-export) | Mutable magic map type |

---

### Subpath: `rpc.do/transports`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `http` | function | STABLE | HTTP transport factory |
| `binding` | function | STABLE | Service binding transport |
| `capnweb` | function | STABLE | CapnWeb transport (recommended) |
| `composite` | function | STABLE | Fallback transport composition |
| `isFunction` | function | STABLE | Type guard utility |
| `isServerMessage` | function | STABLE | Message type guard |
| `ReconnectingWebSocketTransport` | class | STABLE | Reconnecting WS transport |
| `reconnectingWs` | function | STABLE | Factory for reconnecting WS |
| `createRpcSession` | function | STABLE | RPC session factory |

#### Types (Transports)

| Export | Status | Notes |
|--------|--------|-------|
| `ServerMessage` | STABLE | Server message type |
| `AuthProvider` | STABLE | Auth provider function type |
| `HttpTransportOptions` | STABLE | HTTP options |
| `CapnwebTransportOptions` | STABLE | CapnWeb options |
| `ConnectionState` | STABLE | Connection state type |
| `ConnectionEventHandlers` | STABLE | Event handler types |
| `ReconnectingWebSocketOptions` | STABLE | Reconnecting WS options |
| `RpcSessionOptions` | STABLE | Session options |

---

### Subpath: `rpc.do/auth`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `cachedAuth` | function | STABLE | Cached auth wrapper |
| `oauthProvider` | function | STABLE | OAuth.do integration |
| `staticAuth` | function | STABLE | Static token provider |
| `compositeAuth` | function | STABLE | Multiple provider fallback |
| `getToken` | function | STABLE | Token retrieval |
| `auth` | function | STABLE | Default auth provider factory |

#### Types (Auth)

| Export | Status | Notes |
|--------|--------|-------|
| `AuthProvider` | STABLE | Auth provider type |
| `CachedAuthOptions` | STABLE | Cache options |
| `OAuthProviderOptions` | STABLE | OAuth options |

---

### Subpath: `rpc.do/errors`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `ConnectionError` | class | STABLE | Connection error class |
| `ProtocolVersionError` | class | STABLE | Protocol mismatch error |
| `AuthenticationError` | class | STABLE | Auth error class |
| `RateLimitError` | class | STABLE | Rate limit error |
| `RPCError` | class | STABLE | Generic RPC error |

#### Types (Errors)

| Export | Status | Notes |
|--------|--------|-------|
| `ConnectionErrorCode` | STABLE | Error code union |
| `RPCErrorType` | STABLE (re-export) | From @dotdo/types |
| `RPCErrorCode` | STABLE (re-export) | From @dotdo/types |
| `RPCStringErrorCode` | STABLE (re-export) | From @dotdo/types |

---

### Subpath: `rpc.do/extract`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `extractTypes` | function | STABLE | TypeScript type extraction |
| `generateDTS` | function | STABLE | .d.ts generation |
| `generateIndex` | function | STABLE | Index file generation |

#### Types (Extract)

| Export | Status | Notes |
|--------|--------|-------|
| `ExtractedParameter` | STABLE | Parameter schema |
| `ExtractedMethod` | STABLE | Method schema |
| `ExtractedNamespace` | STABLE | Namespace schema |
| `ExtractedSchema` | STABLE | Full schema type |
| `ExtractedType` | STABLE | Type definition schema |

---

### Subpath: `rpc.do/server`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `createTarget` | function | STABLE | Wrap object as RpcTarget |
| `createHandler` | function | STABLE | Create fetch handler |
| `RpcTarget` | class | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSession` | class | STABLE (re-export) | From @dotdo/capnweb |
| `RpcStub` | class | STABLE (re-export) | From @dotdo/capnweb |
| `newWorkersRpcResponse` | function | STABLE (re-export) | From @dotdo/capnweb |
| `newHttpBatchRpcResponse` | function | STABLE (re-export) | From @dotdo/capnweb |
| `HibernatableWebSocketTransport` | class | STABLE (re-export) | From @dotdo/capnweb |
| `TransportRegistry` | class | STABLE (re-export) | From @dotdo/capnweb |
| `serialize` | function | STABLE (re-export) | From @dotdo/capnweb |
| `deserialize` | function | STABLE (re-export) | From @dotdo/capnweb |

#### Types (Server)

| Export | Status | Notes |
|--------|--------|-------|
| `RpcCompatible` | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSessionOptions` | STABLE (re-export) | From @dotdo/capnweb |
| `RpcTransport` | STABLE (re-export) | From @dotdo/capnweb |

---

### Subpath: `rpc.do/expose`

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `expose` | function | STABLE | SDK -> WorkerEntrypoint wrapper |

#### Types (Expose)

| Export | Status | Notes |
|--------|--------|-------|
| `SDKFactory` | STABLE | SDK factory type |
| `MethodImpl` | STABLE | Method implementation type |
| `ExposeOptions` | STABLE | Single SDK options |
| `ExposeMultiOptions` | STABLE | Multi SDK options |

---

## Package: `@dotdo/rpc`

### Main Entry Point (`@dotdo/rpc`)

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `DurableRPC` | class | STABLE | Main DO base class |
| `router` | function | STABLE | Worker -> DO routing |
| `defineConfig` | function | STABLE | Codegen config helper |
| `RpcTarget` | class | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSession` | class | STABLE (re-export) | From @dotdo/capnweb |
| `HibernatableWebSocketTransport` | class | STABLE (re-export) | From @dotdo/capnweb |
| `TransportRegistry` | class | STABLE (re-export) | From @dotdo/capnweb |
| `createCollection` | function | STABLE (re-export) | From @dotdo/collections |
| `Collections` | class | STABLE (re-export) | From @dotdo/collections |
| `getColo` | function | STABLE (re-export) | From colo.do/tiny |
| `getAllColos` | function | STABLE (re-export) | From colo.do/tiny |
| `coloDistance` | function | STABLE (re-export) | From colo.do/tiny |
| `estimateLatency` | function | STABLE (re-export) | From colo.do/tiny |
| `nearestColo` | function | STABLE (re-export) | From colo.do/tiny |
| `sortByDistance` | function | STABLE (re-export) | From colo.do/tiny |

#### Types (Main)

| Export | Status | Notes |
|--------|--------|-------|
| `RpcContext` | DEPRECATED | Use `this.sql`/`this.storage` directly |
| `ColoContext` | STABLE | Location context type |
| `WebSocketState` | STABLE | WS state enum |
| `WebSocketAttachment` | STABLE | WS attachment type |
| `SqlQueryResult` | STABLE | SQL result type |
| `SerializedSqlQuery` | INTERNAL | For transport only |
| `RouterOptions` | STABLE | Router config type |
| `RpcMethodSchema` | STABLE | Method schema type |
| `RpcNamespaceSchema` | STABLE | Namespace schema type |
| `ColumnSchema` | STABLE | Column schema type |
| `TableSchema` | STABLE | Table schema type |
| `IndexSchema` | STABLE | Index schema type |
| `DatabaseSchema` | STABLE | DB schema type |
| `RpcSchema` | STABLE | Full RPC schema type |
| `RpcDoConfig` | STABLE | Codegen config type |
| `Collection` | STABLE (re-export) | From @dotdo/collections |
| `Filter` | STABLE (re-export) | From @dotdo/collections |
| `FilterOperator` | STABLE (re-export) | From @dotdo/collections |
| `QueryOptions` | STABLE (re-export) | From @dotdo/collections |
| `ColoInfo` | STABLE (re-export) | From colo.do/tiny |
| `ColoRegion` | STABLE (re-export) | From colo.do/tiny |
| `RpcTransport` | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSessionOptions` | STABLE (re-export) | From @dotdo/capnweb |
| `Fn` | STABLE (re-export) | From @dotdo/do/types |
| `AsyncFn` | STABLE (re-export) | From @dotdo/do/types |
| `RpcFn` | STABLE (re-export) | From @dotdo/do/types |
| `RpcPromise` | STABLE (re-export) | From @dotdo/do/types |
| `FunctionTier` | STABLE (re-export) | From @dotdo/do/types |
| `TieredFunctionDef` | STABLE (re-export) | From @dotdo/do/types |
| `CodeFunction` | STABLE (re-export) | From @dotdo/do/types |
| `GenerativeFunction` | STABLE (re-export) | From @dotdo/do/types |
| `AgenticFunction` | STABLE (re-export) | From @dotdo/do/types |
| `HumanFunction` | STABLE (re-export) | From @dotdo/do/types |
| `SerializableFnCall` | STABLE (re-export) | From @dotdo/do/types |
| `FunctionEntry` | STABLE (re-export) | From @dotdo/do/types |

#### DurableRPC Class Members

| Member | Type | Status | Notes |
|--------|------|--------|-------|
| `sql` | getter | STABLE | SQLite storage |
| `storage` | getter | STABLE | DO storage |
| `state` | getter | STABLE | DO state |
| `$` | getter | DEPRECATED | Use `this.sql`/`this.storage` |
| `collection<T>(name)` | method | STABLE | Get collection by name |
| `colo` | getter | STABLE | Current colo code |
| `coloInfo` | getter | STABLE | Full colo info |
| `getSchema()` | method | STABLE | Get RPC schema |
| `broadcast(msg)` | method | STABLE | Broadcast to WS clients |
| `connectionCount` | getter | STABLE | Active WS count |
| `getColosByDistance()` | method | STABLE | Sort colos by distance |
| `findNearestColo()` | method | STABLE | Find nearest colo |
| `estimateLatencyTo()` | method | STABLE | Estimate latency |
| `distanceTo()` | method | STABLE | Calculate distance |
| `fetch(req)` | method | STABLE | HTTP handler |
| `webSocketMessage()` | method | STABLE | WS message handler |
| `webSocketClose()` | method | STABLE | WS close handler |
| `webSocketError()` | method | STABLE | WS error handler |
| `getRpcSessionOptions()` | method | STABLE | Override for custom options |
| `__sql()` | method | INTERNAL | RPC transport method |
| `__sqlFirst()` | method | INTERNAL | RPC transport method |
| `__sqlRun()` | method | INTERNAL | RPC transport method |
| `__storage*()` | methods | INTERNAL | RPC transport methods |
| `__collection*()` | methods | INTERNAL | RPC transport methods |
| `__dbSchema()` | method | INTERNAL | RPC transport method |
| `__storageKeys()` | method | INTERNAL | RPC transport method |
| `_*` | properties | INTERNAL | Private state |

---

### Subpath: `@dotdo/rpc/lite`

Minimal DurableRPC without colo.do or collections.

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `DurableRPC` | class | STABLE | Minimal DO base class |
| `RpcTarget` | class | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSession` | class | STABLE (re-export) | From @dotdo/capnweb |
| `HibernatableWebSocketTransport` | class | STABLE (re-export) | From @dotdo/capnweb |
| `TransportRegistry` | class | STABLE (re-export) | From @dotdo/capnweb |

#### Types (Lite)

| Export | Status | Notes |
|--------|--------|-------|
| `RpcMethodSchema` | STABLE | Method schema |
| `RpcNamespaceSchema` | STABLE | Namespace schema |
| `LiteRpcSchema` | STABLE | Lite schema type |
| `RpcTransport` | STABLE (re-export) | From @dotdo/capnweb |
| `RpcSessionOptions` | STABLE (re-export) | From @dotdo/capnweb |
| `Fn` | STABLE (re-export) | From @dotdo/do/types |
| `AsyncFn` | STABLE (re-export) | From @dotdo/do/types |
| `RpcFn` | STABLE (re-export) | From @dotdo/do/types |
| `RpcPromise` | STABLE (re-export) | From @dotdo/do/types |

---

### Subpath: `@dotdo/rpc/collections`

Re-exports from `@dotdo/collections`.

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `*` | all | STABLE (re-export) | All from @dotdo/collections |

---

### Subpath: `@dotdo/rpc/events`

Optional integration with `@dotdo/events`.

| Export | Type | Status | Notes |
|--------|------|--------|-------|
| `createEventEmitter` | function | STABLE | Factory for DurableRPC |
| `EventEmitter` | class | STABLE (re-export) | From @dotdo/events |
| `CDCCollection` | class | STABLE (re-export) | From @dotdo/events |

#### Types (Events)

| Export | Status | Notes |
|--------|--------|-------|
| `CreateEventEmitterOptions` | STABLE | Factory options |
| `DurableRpcContext` | STABLE | Context interface |
| `DurableEvent` | STABLE (re-export) | From @dotdo/events |
| `EventEmitterOptions` | STABLE (re-export) | From @dotdo/events |
| `EventBatch` | STABLE (re-export) | From @dotdo/events |
| `BaseEvent` | STABLE (re-export) | From @dotdo/events |
| `RpcCallEvent` | STABLE (re-export) | From @dotdo/events |
| `CollectionChangeEvent` | STABLE (re-export) | From @dotdo/events |
| `LifecycleEvent` | STABLE (re-export) | From @dotdo/events |
| `WebSocketEvent` | STABLE (re-export) | From @dotdo/events |
| `EventsCollection` | STABLE (re-export) | From @dotdo/events |

---

## Summary

### Stability Counts

| Status | Count |
|--------|-------|
| STABLE | ~90 |
| STABLE (re-export) | ~60 |
| DEPRECATED | 4 |
| INTERNAL | ~15 |

### Items Marked for Deprecation (v2.0 removal)

1. `createRPCClient` - Use `RPC(url, options)` instead
2. `RPCClientOptions` - Use `RPCOptions` instead
3. `RPCPromise<T>` - Use `RpcPromise<T>` from @dotdo/types
4. `RpcContext` / `this.$` - Use `this.sql` and `this.storage` directly

### Items Marked Internal

All methods/properties prefixed with `__` or `_` are internal:
- `__sql`, `__sqlFirst`, `__sqlRun` - RPC transport internals
- `__storage*` methods - RPC transport internals
- `__collection*` methods - RPC transport internals
- `__dbSchema`, `__storageKeys` - RPC transport internals
- `_transportRegistry`, `_sessions`, `_rpcInterface`, etc. - Private state
