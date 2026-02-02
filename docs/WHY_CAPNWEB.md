# Why Capnweb? The Promise Pipelining Advantage

If you've ever built an app that chains multiple API calls together, you've felt the pain of network latency stacking up. Each call waits for the previous one, and your users wait for all of them.

**Capnweb eliminates this problem.**

---

## The Problem: Death by Round Trips

Consider a common scenario: fetching a user's latest post with its comments.

### Traditional Approach

```typescript
// Step 1: Get the user
const user = await fetch('/api/users/123').then(r => r.json())
// Wait 100ms...

// Step 2: Get their posts
const posts = await fetch(`/api/users/${user.id}/posts`).then(r => r.json())
// Wait another 100ms...

// Step 3: Get comments on the first post
const comments = await fetch(`/api/posts/${posts[0].id}/comments`).then(r => r.json())
// Wait another 100ms...

// Total: 300ms of waiting
```

Each call must complete before the next can start. With a 100ms round trip:

- 3 sequential calls = **300ms minimum latency**
- User perception: **"This app feels slow"**

```
Client                                Server
  |                                      |
  |──── GET /users/123 ─────────────────>|
  |<─────────────────── user ────────────|  100ms
  |                                      |
  |──── GET /users/123/posts ───────────>|
  |<─────────────────── posts ───────────|  100ms
  |                                      |
  |──── GET /posts/456/comments ────────>|
  |<─────────────────── comments ────────|  100ms
  |                                      |
  Total: 300ms (3 round trips)
```

---

## The Solution: Promise Pipelining

Promise pipelining lets you chain calls on **unresolved promises**. Instead of waiting for each response, you describe the entire chain upfront, and capnweb collapses it into a single round trip.

### With rpc.do

```typescript
// All three operations in ONE round trip
const comments = await $.users.get('123').posts.list()[0].comments.list()
// Total: 100ms
```

That's it. One line. One round trip. **66% latency reduction.**

```
Client                                Server
  |                                      |
  |──── Batched: get user,              |
  |     get posts,                       |
  |     get comments ───────────────────>|
  |                                      |
  |     (server chains internally)       |
  |                                      |
  |<─────────────────── comments ────────|  100ms
  |                                      |
  Total: 100ms (1 round trip)
```

---

## How It Works (Simply)

When you write:

```typescript
$.users.get('123').posts.list()
```

rpc.do doesn't execute anything immediately. Instead, it records your intent:

1. `$.users` - "I want to access users"
2. `.get('123')` - "specifically user 123"
3. `.posts` - "then their posts"
4. `.list()` - "list all of them"

Only when you `await` does rpc.do send the entire path to the server in one request. The server executes the chain locally (no network hops) and returns the final result.

---

## Real-World Benefits

### Latency Reduction

| Scenario | Traditional | With Capnweb | Improvement |
|----------|-------------|--------------|-------------|
| 3-step chain | 300ms | 100ms | **67% faster** |
| 5-step chain | 500ms | 100ms | **80% faster** |
| 10 parallel + chain | 400ms | 100ms | **75% faster** |

### Bandwidth Savings

Traditional REST returns full objects at each step, even if you only need one field from the final result. Capnweb only returns what you ask for.

```typescript
// Traditional: transfer user (2KB) + posts (15KB) + comments (8KB) = 25KB
// Capnweb: transfer comments only (8KB) = 67% bandwidth reduction
```

### Performance Numbers

rpc.do adds minimal overhead while providing these benefits:

| Metric | Value |
|--------|-------|
| Client bundle size | ~2.8 KB gzipped |
| HTTP latency overhead | < 0.3ms |
| WebSocket latency overhead | < 0.06ms |
| WebSocket throughput | 90,000+ msg/sec |

---

## Code Comparison

### Traditional Fetch

```typescript
async function getUserPostComments(userId: string) {
  // Round trip 1
  const userRes = await fetch(`/api/users/${userId}`)
  const user = await userRes.json()

  // Round trip 2
  const postsRes = await fetch(`/api/users/${user.id}/posts?active=true`)
  const posts = await postsRes.json()

  if (posts.length === 0) return []

  // Round trip 3
  const commentsRes = await fetch(`/api/posts/${posts[0].id}/comments`)
  const comments = await commentsRes.json()

  return comments
}

// Usage
const comments = await getUserPostComments('123')
```

**Problems:**
- 3 sequential network round trips
- Error handling at each step
- Manual URL construction
- No type safety

### With rpc.do

```typescript
import { RPC } from 'rpc.do'

const $ = RPC<MyAPI>('https://api.example.com')

// One round trip, fully typed
const comments = await $.users.get('123').posts.list({ active: true })[0].comments.list()
```

**Benefits:**
- Single network round trip
- Full TypeScript inference
- Natural method syntax
- Automatic error propagation

---

## Automatic Batching

Beyond pipelining, capnweb automatically batches concurrent calls:

```typescript
// These 3 independent calls get batched into ONE HTTP request
const [users, posts, stats] = await Promise.all([
  $.users.list(),
  $.posts.recent(),
  $.stats.summary()
])
```

```
Without batching:          With capnweb batching:

Call 1 ────>               Call 1 ─┐
      <────                        ├──> Single request
Call 2 ────>               Call 2 ─┤         │
      <────                        │    <────┘
Call 3 ────>               Call 3 ─┘    Single response
      <────

3 round trips              1 round trip
```

---

## When Capnweb Matters Most

### 1. Chained API Calls

Any time result A is needed to fetch result B:

```typescript
// User -> Orders -> Order Items -> Product Details
const product = await $.users.get(id).orders.latest().items[0].product.details()
```

### 2. High-Latency Connections

- Mobile networks (100-300ms latency)
- Cross-region API calls
- Satellite/remote connections

Pipelining turns 5x latency into 1x latency.

### 3. Edge Computing

When your code runs at the edge (Cloudflare Workers), but data lives in a specific region:

```typescript
// Edge worker -> Regional Durable Object
// Minimize round trips to the data layer
const $ = RPC('https://regional-do.workers.dev')
const result = await $.complex.nested.operation()
```

### 4. Real-Time Applications

WebSocket transport with capnweb provides:

```typescript
const $ = RPC('wss://api.example.com')

// Bidirectional RPC
// Server can call client methods too
// Automatic reconnection
// 90,000+ messages/second throughput
```

### 5. Microservice Orchestration

Aggregate data from multiple services without the latency penalty:

```typescript
// Instead of sequential service calls
const dashboard = await $.aggregate({
  user: $.users.current(),
  notifications: $.notifications.unread(),
  metrics: $.analytics.today()
})
```

---

## Before and After: Visual Summary

```
BEFORE (Traditional REST)
========================

        Client                     Server
           |                          |
    t=0ms  |── GET /users/123 ───────>|
           |                          |
   t=100ms |<──────── user ───────────|
           |                          |
           |── GET /posts?user=123 ──>|
           |                          |
   t=200ms |<──────── posts ──────────|
           |                          |
           |── GET /comments?post=1 ─>|
           |                          |
   t=300ms |<──────── comments ───────|
           |                          |

   Total time: 300ms
   Requests: 3
   Data transferred: ~25KB


AFTER (With Capnweb)
====================

        Client                     Server
           |                          |
    t=0ms  |── Pipeline Request ─────>|  users.get('123')
           |                          |    .posts.list()
           |                          |    [0].comments.list()
           |                          |
           |    (server executes      |
           |     chain internally)    |
           |                          |
   t=100ms |<──────── comments ───────|
           |                          |

   Total time: 100ms (67% faster)
   Requests: 1
   Data transferred: ~8KB (67% less)
```

---

## Getting Started

```typescript
import { RPC } from 'rpc.do'

// Create a typed RPC client
const $ = RPC<MyAPI>('https://your-api.workers.dev')

// Start pipelining
const result = await $.deep.nested.method()
```

That's all it takes. No schema files. No code generation. Just type-safe, pipelined RPC.

---

## Learn More

- **[Technical Deep-Dive: CapnWeb Design](./CAPNWEB_DESIGN.md)** - Implementation details, architectural decisions, and advanced patterns
- **[Performance Benchmarks](../BENCHMARKS.md)** - Detailed performance analysis and comparisons
- **[rpc.do Documentation](../README.md)** - Full API reference and examples

---

*Capnweb brings the promise pipelining capabilities of Cap'n Proto to the web, eliminating the round-trip tax that makes distributed applications feel slow.*
