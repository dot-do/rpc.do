# Migrating from gRPC/Connect to rpc.do

This guide helps you migrate your existing gRPC or Connect (formerly Connect-Web) application to rpc.do. The migration can be done incrementally, allowing both systems to coexist during the transition.

## Why Migrate?

| Aspect | gRPC/Connect | rpc.do |
|--------|--------------|--------|
| Bundle size | ~100KB+ (gRPC-Web) | ~3KB |
| Code generation | Required (protoc) | None |
| Schema files | .proto required | TypeScript types only |
| Transport | HTTP/2 or gRPC-Web | HTTP, WebSocket, Cloudflare Bindings |
| Cloudflare Workers | Limited support | Native support |

### Key Benefits

- **Dramatically smaller bundle**: rpc.do is ~30x smaller than gRPC-Web, critical for edge deployments and fast-loading web apps
- **No code generation**: Eliminate the protoc toolchain, proto files, and generated stubs entirely
- **TypeScript-first**: Define your API with TypeScript interfaces instead of proto schemas
- **Cloudflare-native**: Built for Workers, Durable Objects, and Service Bindings from the ground up
- **Simpler toolchain**: No protobuf compiler, no build plugins, no generated code to version control

## Conceptual Differences

### Proto Files vs TypeScript Interfaces

gRPC requires proto files compiled into language-specific stubs:

```protobuf
// user.proto
syntax = "proto3";

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
  rpc ListUsers (ListUsersRequest) returns (stream User);
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  bool active = 4;
}

message GetUserRequest {
  string id = 1;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
}

message ListUsersRequest {
  bool active_only = 1;
}
```

rpc.do uses TypeScript interfaces directly:

```typescript
// api.ts
interface User {
  id: string
  name: string
  email: string
  active: boolean
}

type API = {
  getUser(input: { id: string }): User
  createUser(input: { name: string; email: string }): User
  listUsers(input: { activeOnly?: boolean }): User[]
}
```

### gRPC Channels vs rpc.do Transports

gRPC uses channels with specific configurations:

```typescript
// gRPC: Complex channel setup
import { createGrpcWebTransport } from '@connectrpc/connect-web'
import { createClient } from '@connectrpc/connect'
import { UserService } from './gen/user_connect'

const transport = createGrpcWebTransport({
  baseUrl: 'https://api.example.com',
  useBinaryFormat: true,
})

const client = createClient(UserService, transport)
```

rpc.do uses simple transport functions:

```typescript
// rpc.do: Simple transport selection
import { RPC, http, ws, binding } from 'rpc.do'

const rpc = RPC<API>(http('https://api.example.com'))
// or
const rpc = RPC<API>(ws('wss://api.example.com'))
// or
const rpc = RPC<API>(binding(env.MY_SERVICE))
```

### gRPC Interceptors vs rpc.do Dispatch

gRPC uses interceptors for cross-cutting concerns:

```typescript
// gRPC: Interceptor chain
const authInterceptor: Interceptor = (next) => async (req) => {
  req.header.set('Authorization', `Bearer ${await getToken()}`)
  return next(req)
}

const loggingInterceptor: Interceptor = (next) => async (req) => {
  console.log(`Calling ${req.method.name}`)
  const res = await next(req)
  console.log(`Completed ${req.method.name}`)
  return res
}

const transport = createGrpcWebTransport({
  baseUrl: 'https://api.example.com',
  interceptors: [authInterceptor, loggingInterceptor],
})
```

rpc.do handles this in the dispatch function:

```typescript
// rpc.do: Simple dispatch with middleware logic
import { createRpcHandler, RpcError } from 'rpc.do/server'

const protectedMethods = ['createUser', 'deleteUser']

createRpcHandler({
  dispatch: async (method, args, ctx) => {
    // Auth check
    if (protectedMethods.includes(method) && !ctx.user) {
      throw new RpcError('UNAUTHENTICATED', 'Authentication required')
    }

    // Logging
    console.log(`Calling ${method}`)
    const result = await handlers[method]?.(args[0], ctx)
    console.log(`Completed ${method}`)

    return result
  }
})
```

## Code Transformations

### Service Definition

**Before (gRPC with protobuf):**

```protobuf
// user.proto
syntax = "proto3";

package user.v1;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
  rpc UpdateUser (UpdateUserRequest) returns (User);
  rpc DeleteUser (DeleteUserRequest) returns (Empty);
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  int32 age = 4;
}

message GetUserRequest {
  string id = 1;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  int32 age = 3;
}

message UpdateUserRequest {
  string id = 1;
  optional string name = 2;
  optional string email = 3;
  optional int32 age = 4;
}

message DeleteUserRequest {
  string id = 1;
}

message Empty {}
```

**After (rpc.do):**

```typescript
import { createRpcHandler } from '@dotdo/rpc'

interface User {
  id: string
  name: string
  email: string
  age: number
}

type API = {
  getUser(input: { id: string }): User | null
  createUser(input: { name: string; email: string; age: number }): User
  updateUser(input: { id: string; name?: string; email?: string; age?: number }): User
  deleteUser(input: { id: string }): void
}

export default createRpcHandler({
  dispatch: (method, args) => {
    switch (method) {
      case 'getUser':
        return getUserById(args[0].id)
      case 'createUser':
        return createUser(args[0])
      case 'updateUser':
        return updateUser(args[0])
      case 'deleteUser':
        return deleteUser(args[0].id)
      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }
})
```

### Client Setup

**Before (gRPC-Web/Connect):**

```typescript
import { createGrpcWebTransport } from '@connectrpc/connect-web'
import { createClient } from '@connectrpc/connect'
import { UserService } from './gen/user_connect'

// Create transport with configuration
const transport = createGrpcWebTransport({
  baseUrl: 'https://api.example.com',
  useBinaryFormat: true,
  credentials: 'include',
})

// Create typed client from generated code
const client = createClient(UserService, transport)
```

**After (rpc.do):**

```typescript
import { RPC, http } from 'rpc.do'
import type { API } from './server'

// Create typed client directly
const rpc = RPC<API>(http('https://api.example.com'))
```

### Making Calls

**Before (gRPC-Web/Connect):**

```typescript
// Unary calls
const user = await client.getUser({ id: '123' })
const newUser = await client.createUser({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
})

// Update with partial fields
await client.updateUser({
  id: '123',
  name: 'Alice Smith',
  // email and age omitted - not updated
})

// Delete
await client.deleteUser({ id: '123' })
```

**After (rpc.do):**

```typescript
// Unary calls - same patterns, simpler syntax
const user = await rpc.getUser({ id: '123' })
const newUser = await rpc.createUser({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
})

// Update with partial fields
await rpc.updateUser({
  id: '123',
  name: 'Alice Smith',
  // email and age omitted - not updated
})

// Delete
await rpc.deleteUser({ id: '123' })
```

### Streaming

gRPC provides server streaming, client streaming, and bidirectional streaming:

**gRPC Streaming:**

```typescript
// Server streaming - receive multiple responses
const stream = client.listUsers({ activeOnly: true })
for await (const user of stream) {
  console.log('User:', user)
}

// Bidirectional streaming
const bidiStream = client.chat({})
for await (const message of bidiStream) {
  console.log('Received:', message)
  bidiStream.send({ text: 'Reply' })
}
```

**rpc.do with capnweb Pipelining:**

rpc.do uses capnweb pipelining instead of traditional streaming. Pipelining allows you to chain method calls without waiting for intermediate results:

```typescript
import { RPC, capnweb } from 'rpc.do'

const rpc = RPC<API>(capnweb('wss://api.example.com'))

// Pipelining: chain calls efficiently
// The getUser result is piped directly to getOrders without round trips
const orders = await rpc.getUser({ id: '123' }).getOrders()

// For real-time updates, use WebSocket transport
const rpc = RPC<API>(ws('wss://api.example.com'))

// Implement pub/sub pattern in your dispatch
await rpc.subscribe({ channel: 'user-updates' })
```

For bulk data retrieval, use batch requests:

```typescript
// Batch multiple operations efficiently
const [users, orders, stats] = await Promise.all([
  rpc.listUsers({ activeOnly: true }),
  rpc.listOrders({ status: 'pending' }),
  rpc.getStats(),
])
```

### Error Handling

**Before (gRPC):**

```typescript
import { ConnectError, Code } from '@connectrpc/connect'

try {
  await client.getUser({ id: '123' })
} catch (error) {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.NotFound:
        console.log('User not found')
        break
      case Code.PermissionDenied:
        console.log('Access denied')
        break
      case Code.Unauthenticated:
        console.log('Not authenticated')
        break
      default:
        console.log(`Error: ${error.message}`)
    }
  }
}
```

**After (rpc.do):**

```typescript
import { RpcError } from 'rpc.do/errors'

try {
  await rpc.getUser({ id: '123' })
} catch (error) {
  if (error instanceof RpcError) {
    switch (error.code) {
      case 'NOT_FOUND':
        console.log('User not found')
        break
      case 'PERMISSION_DENIED':
        console.log('Access denied')
        break
      case 'UNAUTHENTICATED':
        console.log('Not authenticated')
        break
      default:
        console.log(`Error: ${error.message}`)
    }
  }
}
```

## Step-by-Step Migration

### 1. Install rpc.do

```bash
npm install rpc.do @dotdo/capnweb
```

### 2. Create TypeScript Interface from Proto

Convert your proto messages to TypeScript:

```typescript
// Before: user.proto
// message User {
//   string id = 1;
//   string name = 2;
//   optional string email = 3;
//   repeated string roles = 4;
// }

// After: types.ts
interface User {
  id: string
  name: string
  email?: string
  roles: string[]
}
```

### 3. Create rpc.do Handler

```typescript
import { createRpcHandler } from '@dotdo/rpc'

// Map your gRPC service methods
export default createRpcHandler({
  dispatch: (method, args) => {
    // Route based on method name
    return handlers[method]?.(...args)
  }
})
```

### 4. Run Both Systems

Mount both handlers during migration:

```typescript
// Cloudflare Workers
export default {
  fetch(request, env) {
    const url = new URL(request.url)

    // Legacy gRPC-Web endpoint
    if (url.pathname.startsWith('/grpc')) {
      return grpcHandler(request)
    }

    // New rpc.do endpoint
    if (url.pathname.startsWith('/rpc')) {
      return rpcHandler(request)
    }
  }
}
```

### 5. Migrate Clients Gradually

Update clients one service at a time:

```typescript
// Old client code
const user = await grpcClient.getUser({ id: '123' })

// New client code
const user = await rpc.getUser({ id: '123' })
```

### 6. Remove gRPC Dependencies

Once all services and clients are migrated:

```bash
npm uninstall @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf
rm -rf proto/ gen/  # Remove proto files and generated code
```

## When to Stay with gRPC

gRPC remains the better choice in these scenarios:

### Multi-Language Microservices

If your backend consists of services written in multiple languages (Go, Java, Python, Rust), gRPC's language-agnostic proto files and code generation provide consistent contracts across all services.

```protobuf
// One proto file generates clients/servers for all languages
service PaymentService {
  rpc ProcessPayment (PaymentRequest) returns (PaymentResponse);
}
```

### Strict API Contracts

When you need formal API versioning, backward compatibility checking, and breaking change detection, protobuf's schema evolution rules and tooling (like buf) excel:

```bash
# Detect breaking changes in CI
buf breaking --against .git#branch=main
```

### High-Throughput Internal Services

For internal service-to-service communication with millions of requests per second, gRPC's binary protocol and HTTP/2 multiplexing provide better performance:

- Binary serialization is more compact and faster to parse
- HTTP/2 connection multiplexing reduces connection overhead
- Bidirectional streaming for long-lived connections

### Existing gRPC Infrastructure

If you have significant investment in gRPC infrastructure (service mesh, observability, load balancing), migration may not be worth the effort:

- Envoy proxies with gRPC support
- gRPC-specific tracing and metrics
- Health checking and load balancing configurations

## What You Lose

### Binary Protocol Efficiency

gRPC uses protobuf binary encoding which is more compact than JSON:

```typescript
// rpc.do uses JSON - slightly larger payloads
// Consider this if bandwidth is critical
```

### Schema Evolution Tools

Protobuf tooling helps manage API evolution:

```bash
# No equivalent in rpc.do - use TypeScript carefully
buf lint
buf breaking
```

### Generated Documentation

Proto files can generate API documentation automatically. With rpc.do, document your TypeScript interfaces manually or use tools like TypeDoc.

### IDE Support for Proto Files

IDEs have excellent proto file support (syntax highlighting, validation, go-to-definition for imports). You trade this for TypeScript's type system.

## What You Gain

### Simpler Development Workflow

```bash
# gRPC workflow
1. Edit .proto file
2. Run protoc or buf generate
3. Commit generated files
4. Update client and server code

# rpc.do workflow
1. Edit TypeScript interface
2. TypeScript compiler validates everything
```

### Faster Iteration

No code generation step means faster feedback loops:

```typescript
// Change the interface
type API = {
  getUser(input: { id: string }): User
  getUserWithDetails(input: { id: string; includeOrders?: boolean }): UserDetails  // New!
}

// Immediately use it - no generation step
const details = await rpc.getUserWithDetails({ id: '123', includeOrders: true })
```

### Cloudflare Workers Native

rpc.do is built for edge computing:

```typescript
// Zero-latency RPC between Workers via service bindings
const rpc = RPC<API>(binding(env.USER_SERVICE))

// Durable Objects with RPC built-in
export class UserDO extends DurableRPC {
  async getUser(id: string) {
    return this.users.get(id)
  }
}
```

### Smaller Client Bundle

The ~3KB bundle size versus ~100KB+ for gRPC-Web makes a significant difference for web applications, especially on mobile networks.

## Common Migration Patterns

### Nested Messages to Interfaces

```protobuf
// gRPC
message Order {
  string id = 1;
  message LineItem {
    string product_id = 1;
    int32 quantity = 2;
  }
  repeated LineItem items = 3;
}
```

```typescript
// rpc.do
interface LineItem {
  productId: string
  quantity: number
}

interface Order {
  id: string
  items: LineItem[]
}
```

### Enums

```protobuf
// gRPC
enum Status {
  STATUS_UNSPECIFIED = 0;
  STATUS_PENDING = 1;
  STATUS_ACTIVE = 2;
  STATUS_CANCELLED = 3;
}
```

```typescript
// rpc.do - use union types
type Status = 'pending' | 'active' | 'cancelled'

// Or use const enum for numeric values
const enum Status {
  Pending = 1,
  Active = 2,
  Cancelled = 3,
}
```

### Oneof Fields

```protobuf
// gRPC
message PaymentMethod {
  oneof method {
    CreditCard credit_card = 1;
    BankAccount bank_account = 2;
  }
}
```

```typescript
// rpc.do - use discriminated unions
type PaymentMethod =
  | { type: 'credit_card'; creditCard: CreditCard }
  | { type: 'bank_account'; bankAccount: BankAccount }
```

### Well-Known Types

```protobuf
// gRPC
import "google/protobuf/timestamp.proto";

message Event {
  google.protobuf.Timestamp created_at = 1;
}
```

```typescript
// rpc.do - use native types or ISO strings
interface Event {
  createdAt: Date | string  // ISO 8601 string recommended for JSON
}
```

## Need Help?

- [rpc.do Documentation](https://rpc.do)
- [Getting Started Guide](./GETTING_STARTED.md)
- [GitHub Issues](https://github.com/drivly/ai/issues)
- [Discord Community](https://discord.gg/drivly)
