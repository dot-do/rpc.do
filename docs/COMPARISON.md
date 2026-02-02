# rpc.do vs Alternatives: Choosing the Right RPC Solution

This guide helps you decide when rpc.do is the right choice for your project—and when it is not. We believe in being honest: no tool is perfect for every situation.

## Decision Flowchart

Use this flowchart to quickly determine which RPC tool fits your needs:

```
                           START
                             │
                             ▼
            ┌─────────────────────────────────────┐
            │ Are you building on Cloudflare      │
            │ Durable Objects?                    │
            └─────────────────────────────────────┘
                      │                   │
                     YES                  NO
                      │                   │
                      ▼                   ▼
            ┌─────────────────┐   ┌─────────────────────────────────┐
            │ Use rpc.do      │   │ Do you need multi-language      │
            │ (purpose-built) │   │ support (Go, Java, Python, etc)?│
            └─────────────────┘   └─────────────────────────────────┘
                                           │               │
                                          YES              NO
                                           │               │
                                           ▼               ▼
                                  ┌─────────────┐   ┌─────────────────────────┐
                                  │ Use gRPC    │   │ Is bundle size critical │
                                  │             │   │ (edge, mobile web)?     │
                                  └─────────────┘   └─────────────────────────┘
                                                           │               │
                                                          YES              NO
                                                           │               │
                                                           ▼               ▼
                                                   ┌─────────────┐   ┌─────────────────────────┐
                                                   │ Consider    │   │ Do you need a public    │
                                                   │ rpc.do      │   │ API for third parties?  │
                                                   └─────────────┘   └─────────────────────────┘
                                                                             │               │
                                                                            YES              NO
                                                                             │               │
                                                                             ▼               ▼
                                                                    ┌─────────────┐   ┌─────────────────────────┐
                                                                    │ Use REST or │   │ Is real-time / complex  │
                                                                    │ GraphQL     │   │ querying needed?        │
                                                                    └─────────────┘   └─────────────────────────┘
                                                                                              │               │
                                                                                             YES              NO
                                                                                              │               │
                                                                                              ▼               ▼
                                                                                     ┌─────────────┐   ┌─────────────────┐
                                                                                     │ Consider    │   │ Use tRPC        │
                                                                                     │ GraphQL     │   │ (mature, large  │
                                                                                     └─────────────┘   │ ecosystem)      │
                                                                                                       └─────────────────┘
```

## Feature Comparison Table

| Feature | rpc.do | tRPC | gRPC | GraphQL |
|---------|--------|------|------|---------|
| **Bundle Size (gzipped)** | ~2.8 KB | ~14.6 KB | ~30 KB | ~12-25 KB |
| **Code Generation** | None | None | Required | Optional |
| **Schema Language** | TypeScript | TypeScript | Protobuf | SDL |
| **Transports** | HTTP, WebSocket, Bindings | HTTP | HTTP/2, gRPC-Web | HTTP |
| **Type Safety** | Full | Full | Full | Partial (codegen) |
| **Multi-Language** | TypeScript only | TypeScript only | All major languages | All major languages |
| **Real-time** | Native WebSocket | Plugin | Streaming | Subscriptions |
| **Batching** | Automatic (capnweb) | Link-based | Multiplexing | Query batching |
| **Learning Curve** | Low | Low | High | Medium |
| **Cloudflare DOs** | First-class | Manual | Limited | Manual |
| **Browser Support** | Native | Native | Proxy required | Native |
| **Validation** | Bring your own | Built-in Zod | Protobuf schema | Schema + resolvers |
| **Caching** | Manual | Manual | Manual | Normalized cache |
| **DevTools** | Browser Network | tRPC Panel | gRPC UI | GraphQL Playground |
| **Community** | Growing | Large | Massive | Massive |
| **Maturity** | New (2024) | Mature (2021) | Very Mature (2016) | Very Mature (2015) |

## Bundle Size Comparison

Bundle size matters for edge deployments and web applications. Here is how the libraries compare:

```
rpc.do          ██ 2.8 KB
tRPC            █████████ 14.6 KB
GraphQL (urql)  ████████████ ~20 KB
gRPC-Web        ██████████████████ ~30 KB

────────────────────────────────────────
0 KB            10 KB           20 KB           30 KB
```

### What You Get Per KB

| Library | Size | Features |
|---------|------|----------|
| **rpc.do (2.8 KB)** | Smallest | Proxy-based calls, multiple transports, auth, auto-reconnect |
| **tRPC (14.6 KB)** | 5x larger | Routers, procedures, middleware, React Query integration |
| **gRPC-Web (30 KB)** | 10x larger | Binary protocol, streaming, generated clients |
| **Plain fetch (0.5 KB)** | Baseline | Manual typing, no batching, no reconnection |

**rpc.do adds ~2.3 KB over plain fetch** while providing:
- Type-safe proxy-based API
- Multiple transports (HTTP, WebSocket, bindings)
- Promise pipelining via capnweb
- Automatic reconnection
- Authentication support

## When to Use rpc.do

rpc.do excels in these scenarios:

### 1. Cloudflare Durable Objects

This is rpc.do's primary use case. If you are building on Durable Objects, rpc.do provides first-class support:

```typescript
// Same API locally and remotely
const users = await $.sql`SELECT * FROM users WHERE active = ${true}`.all()
const config = await $.storage.get('config')
const admins = await $.collection('users').find({ role: 'admin' })
```

Benefits:
- Direct access to DO SQL, storage, and collections
- Same mental model inside and outside the DO
- WebSocket hibernation support
- Service binding transport for zero-latency worker-to-DO calls

### 2. Edge-First Applications

When every kilobyte matters:

```typescript
// ~2.8 KB total for full RPC capability
import { RPC, http } from 'rpc.do'

const $ = RPC<API>(http('https://api.example.com'))
```

Use cases:
- Cloudflare Workers with size limits
- Mobile web applications on slow networks
- Embedded widgets loaded in third-party pages

### 3. TypeScript-Only Teams

When your entire stack is TypeScript:

```typescript
// No schema files, no code generation
type API = {
  users: {
    get(id: string): User
    create(data: CreateUserInput): User
  }
}

// Client infers types automatically
const user = await $.users.get('123') // User type inferred
```

### 4. Real-Time Applications

When you need WebSocket without the complexity:

```typescript
// Seamlessly switch transports
const $ = RPC<API>(capnweb('wss://api.example.com'))

// Same API, real-time delivery
await $.notifications.subscribe({ userId: '123' })
```

### 5. Internal Microservices on Cloudflare

When building service-to-service communication on Cloudflare:

```typescript
// Zero-latency via service bindings
const $ = RPC<API>(binding(env.USER_SERVICE))

// Automatic batching via capnweb pipelining
const [user, orders] = await Promise.all([
  $.users.get(id),
  $.orders.listForUser(id)
])
```

## When NOT to Use rpc.do

Be honest with yourself. rpc.do is not the right choice for:

### 1. Multi-Language Backends

**Use gRPC instead.**

If your backend includes Go, Java, Python, or Rust services, gRPC's language-agnostic protobuf provides consistent contracts:

```protobuf
// One proto file generates clients/servers for all languages
service PaymentService {
  rpc ProcessPayment (PaymentRequest) returns (PaymentResponse);
}
```

rpc.do is TypeScript-only. Forcing other languages to consume JSON APIs manually defeats the purpose of type-safe RPC.

### 2. Public APIs for Third Parties

**Use REST or GraphQL instead.**

External developers expect:
- OpenAPI/Swagger documentation
- Language-agnostic clients
- Standard HTTP semantics
- GraphQL explorers

rpc.do's proxy-based TypeScript API does not translate well to public documentation.

### 3. Complex Query Requirements

**Use GraphQL instead.**

When clients need flexible queries:

```graphql
# GraphQL: Client controls shape
query {
  user(id: "123") {
    name
    posts(limit: 10) {
      title
      comments { author { name } }
    }
  }
}
```

rpc.do methods return fixed shapes. If you need client-controlled field selection or deep nested queries, GraphQL's resolver model is superior.

### 4. Existing Large tRPC Codebase

**Consider staying with tRPC.**

Migration cost may outweigh benefits if you have:
- Extensive tRPC middleware chains
- Heavy React Query integration via @trpc/react-query
- Team expertise in tRPC patterns
- Working production system

The ~12 KB bundle savings may not justify rewriting working code.

### 5. High-Throughput Binary Protocol Needs

**Use gRPC instead.**

For internal service-to-service with millions of requests per second:
- Protobuf binary encoding is more compact
- HTTP/2 multiplexing reduces connection overhead
- gRPC's streaming model is more mature

rpc.do uses JSON, which has higher serialization overhead.

### 6. Strict API Versioning Requirements

**Use gRPC with buf instead.**

When you need formal breaking change detection:

```bash
# gRPC + buf: Detect breaking changes in CI
buf breaking --against .git#branch=main
```

rpc.do relies on TypeScript's type system, which does not provide the same level of API evolution tooling.

## Performance Comparison

Based on benchmarks from [BENCHMARKS.md](../BENCHMARKS.md):

### Latency Overhead

| Transport | rpc.do Overhead | Notes |
|-----------|-----------------|-------|
| HTTP | +0.08ms mean | Negligible for most use cases |
| WebSocket | +0.02ms mean | Extremely low |

### Throughput

| Transport | Requests/sec |
|-----------|-------------|
| rpc.do HTTP | ~12,000 |
| rpc.do WebSocket | ~95,000 |

### Memory

| Metric | Value |
|--------|-------|
| Per WebSocket connection | 89 KB |
| Per pending request | 1.7 KB |

**Key insight:** rpc.do's overhead is negligible. Performance differences between RPC libraries are dominated by network latency, not library overhead.

## Migration Considerations

### From tRPC to rpc.do

| Gain | Lose |
|------|------|
| 5x smaller bundle | Built-in Zod validation |
| Multiple transports | tRPC DevTools |
| Simpler mental model | @trpc/react-query wrapper |
| Cloudflare-native | Larger community |

See [MIGRATING_FROM_TRPC.md](./MIGRATING_FROM_TRPC.md) for detailed migration guide.

### From gRPC to rpc.do

| Gain | Lose |
|------|------|
| 10x smaller bundle | Multi-language support |
| No code generation | Binary protocol efficiency |
| TypeScript-first | Schema evolution tooling |
| Cloudflare-native | Mature streaming model |

See [MIGRATING_FROM_GRPC.md](./MIGRATING_FROM_GRPC.md) for detailed migration guide.

### From GraphQL to rpc.do

| Gain | Lose |
|------|------|
| Smaller bundle | Client-controlled queries |
| Simpler mental model | Normalized caching |
| No resolver boilerplate | GraphQL Playground |
| Type inference | Schema introspection |

### From REST to rpc.do

| Gain | Lose |
|------|------|
| Type safety | HTTP semantic clarity |
| Auto-batching | Browser caching |
| Multiple transports | Universal tooling |
| Cleaner client code | OpenAPI ecosystem |

## Real Scenario Examples

### Scenario 1: E-commerce Product Catalog

**Requirements:** Public API, multiple frontends (web, mobile, partners), caching important

**Recommendation: GraphQL**

GraphQL's normalized cache and flexible queries suit catalog browsing. Partners expect documented, language-agnostic APIs.

### Scenario 2: Real-Time Collaborative Editor

**Requirements:** Durable Objects for state, WebSocket for collaboration, edge latency critical

**Recommendation: rpc.do**

Perfect fit. DO state persistence, WebSocket hibernation, and edge deployment are rpc.do's strengths.

```typescript
// Editor DO with rpc.do
export class EditorDO extends DurableRPC {
  async applyOperation(op: Operation) {
    await this.storage.put('doc', this.transform(op))
    this.broadcast(op) // WebSocket to all connected clients
  }
}
```

### Scenario 3: Payment Processing Service

**Requirements:** Multi-language (Go, Python, TypeScript), strict contracts, high reliability

**Recommendation: gRPC**

Payment systems need formal contracts and language flexibility. gRPC's protobuf schema evolution and buf tooling help prevent breaking changes.

### Scenario 4: Internal Dashboard

**Requirements:** TypeScript full-stack, single team, fast iteration

**Recommendation: tRPC or rpc.do**

Both work well. Choose tRPC if you need React Query integration out of the box. Choose rpc.do if you are on Cloudflare or want the smallest bundle.

### Scenario 5: IoT Device Gateway

**Requirements:** Edge processing, thousands of WebSocket connections, minimal memory

**Recommendation: rpc.do**

Low memory per connection (89 KB), WebSocket support, and Cloudflare Workers deployment make this ideal.

### Scenario 6: Enterprise Integration Platform

**Requirements:** Connect legacy Java services, new TypeScript services, external partners

**Recommendation: gRPC for internal + REST/GraphQL for external**

Use gRPC for polyglot internal services. Expose REST or GraphQL for partners. rpc.do's TypeScript-only nature does not fit this use case.

## Summary Table

| Use Case | Best Choice | Why |
|----------|-------------|-----|
| Durable Objects | **rpc.do** | Purpose-built |
| Edge/lightweight web | **rpc.do** | Smallest bundle |
| TypeScript monorepo | **rpc.do** or tRPC | Both excellent |
| Multi-language backend | **gRPC** | Language-agnostic |
| Public API | **REST** or **GraphQL** | Standard, documented |
| Complex client queries | **GraphQL** | Flexible querying |
| High-throughput internal | **gRPC** | Binary, multiplexed |
| Real-time collaboration | **rpc.do** | WebSocket + DO |
| Existing tRPC app | **Stay with tRPC** | Migration cost |

## Conclusion

rpc.do is the best choice when:
1. You are building on Cloudflare Durable Objects
2. Bundle size is critical (edge, mobile web)
3. Your team is TypeScript-only
4. You want the simplest possible RPC setup

rpc.do is not the best choice when:
1. You need multi-language support
2. You are building public APIs
3. You need complex client-controlled queries
4. You have existing investment in other solutions

Choose the right tool for your specific needs. There is no universal "best" RPC solution.

## Further Reading

- [Getting Started Guide](./GETTING_STARTED.md)
- [Performance Benchmarks](../BENCHMARKS.md)
- [Migrating from tRPC](./MIGRATING_FROM_TRPC.md)
- [Migrating from gRPC](./MIGRATING_FROM_GRPC.md)
- [Architecture Overview](./ARCHITECTURE.md)
