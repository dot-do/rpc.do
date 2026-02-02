---
title: Migrating from gRPC
description: Guide for moving from gRPC to rpc.do
---

This guide helps you migrate from gRPC (or Connect) to rpc.do. While both provide efficient RPC, they have fundamentally different design philosophies and use cases.

## Key Differences

| Aspect | gRPC | rpc.do |
|--------|------|--------|
| Protocol | HTTP/2 + Protobuf | HTTP/WebSocket + JSON |
| Schema | .proto files | TypeScript types |
| Code generation | protoc + plugins | `npx rpc.do generate` |
| Streaming | Bidirectional | WebSocket hibernation |
| Target runtime | Any (Go, Java, etc.) | Cloudflare Workers |
| State model | Stateless | Stateful (Durable Objects) |

## When to Migrate

**Consider rpc.do when:**
- Moving to Cloudflare Workers/Durable Objects
- You want TypeScript-native development
- You need built-in persistent state
- Browser clients are primary (no gRPC-web setup)

**Keep gRPC when:**
- Multi-language services (Go, Java, Python, etc.)
- Strict performance requirements
- Heavy streaming workloads
- Established gRPC infrastructure

## Migration Steps

### 1. Schema: Proto to TypeScript

**gRPC Proto:**

```protobuf
syntax = "proto3";

package user;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
  rpc StreamUpdates(StreamRequest) returns (stream UserUpdate);
}

message User {
  string id = 1;
  string name = 2;
  string email = 3;
  UserRole role = 4;
}

enum UserRole {
  USER_ROLE_UNSPECIFIED = 0;
  USER_ROLE_USER = 1;
  USER_ROLE_ADMIN = 2;
}

message GetUserRequest {
  string id = 1;
}

message CreateUserRequest {
  string name = 1;
  string email = 2;
  UserRole role = 3;
}

message ListUsersRequest {
  int32 page_size = 1;
  string page_token = 2;
}

message ListUsersResponse {
  repeated User users = 1;
  string next_page_token = 2;
}
```

**rpc.do TypeScript:**

```typescript
// types.ts
export type UserRole = 'user' | 'admin'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface CreateUserInput {
  name: string
  email: string
  role: UserRole
}

export interface ListUsersOptions {
  pageSize?: number
  pageToken?: string
}

export interface ListUsersResult {
  users: User[]
  nextPageToken?: string
}
```

```typescript
// UserService.ts
import { DurableRPC } from '@dotdo/rpc'
import type { User, CreateUserInput, ListUsersOptions, ListUsersResult } from './types'

export class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id)
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const id = crypto.randomUUID()
    const user: User = { id, ...input }
    await this.users.put(id, user)
    return user
  }

  async listUsers(options?: ListUsersOptions): Promise<ListUsersResult> {
    const pageSize = options?.pageSize || 50
    const offset = options?.pageToken ? parseInt(options.pageToken, 10) : 0

    const users = await this.users.list({ limit: pageSize + 1, offset })

    const hasMore = users.length > pageSize
    const result = hasMore ? users.slice(0, -1) : users

    return {
      users: result,
      nextPageToken: hasMore ? String(offset + pageSize) : undefined,
    }
  }
}
```

### 2. Server: gRPC Service to DurableRPC

**gRPC Server (Go):**

```go
type server struct {
    pb.UnimplementedUserServiceServer
    db *sql.DB
}

func (s *server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
    user, err := s.db.QueryUser(ctx, req.GetId())
    if err != nil {
        return nil, status.Error(codes.NotFound, "user not found")
    }
    return user.ToProto(), nil
}

func (s *server) CreateUser(ctx context.Context, req *pb.CreateUserRequest) (*pb.User, error) {
    user := &User{
        ID:    uuid.New().String(),
        Name:  req.GetName(),
        Email: req.GetEmail(),
        Role:  pb.UserRole_name[int32(req.GetRole())],
    }
    if err := s.db.InsertUser(ctx, user); err != nil {
        return nil, status.Error(codes.Internal, "failed to create user")
    }
    return user.ToProto(), nil
}
```

**rpc.do Server (TypeScript):**

```typescript
import { DurableRPC, RPCError } from '@dotdo/rpc'

export class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async getUser(id: string): Promise<User> {
    const user = await this.users.get(id)
    if (!user) {
      throw new RPCError('user not found', 'NOT_FOUND', { id })
    }
    return user
  }

  async createUser(input: CreateUserInput): Promise<User> {
    const id = crypto.randomUUID()
    const user: User = { id, ...input }
    await this.users.put(id, user)
    return user
  }
}
```

### 3. Client: Stub to RPC()

**gRPC Client (TypeScript):**

```typescript
import { createPromiseClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { UserService } from './gen/user_connect'

const transport = createGrpcTransport({
  httpVersion: '2',
  baseUrl: 'https://api.example.com',
})

const client = createPromiseClient(UserService, transport)

const user = await client.getUser({ id: '123' })
const created = await client.createUser({
  name: 'Alice',
  email: 'alice@example.com',
  role: UserRole.ADMIN,
})
```

**rpc.do Client:**

```typescript
import { RPC } from 'rpc.do'
import type { UserServiceAPI } from './.do'

const $ = RPC<UserServiceAPI>('https://my-do.workers.dev')

const user = await $.getUser('123')
const created = await $.createUser({
  name: 'Alice',
  email: 'alice@example.com',
  role: 'admin',
})
```

### 4. Streaming: gRPC Streams to WebSocket

**gRPC Server Streaming:**

```go
func (s *server) StreamUpdates(req *pb.StreamRequest, stream pb.UserService_StreamUpdatesServer) error {
    updates := s.subscribeToUpdates(req.GetUserId())
    for update := range updates {
        if err := stream.Send(update.ToProto()); err != nil {
            return err
        }
    }
    return nil
}
```

**rpc.do WebSocket:**

```typescript
// Server
export class UserService extends DurableRPC {
  async updateUser(id: string, data: Partial<User>) {
    const user = await this.users.get(id)
    if (!user) throw new RPCError('not found', 'NOT_FOUND')

    const updated = { ...user, ...data }
    await this.users.put(id, updated)

    // Broadcast to connected clients
    this.broadcast(JSON.stringify({
      type: 'user.updated',
      data: updated,
    }))

    return updated
  }
}

// Client
const $ = RPC('wss://my-do.workers.dev', { reconnect: true })

// Handle incoming updates
$.on('message', (event) => {
  const { type, data } = JSON.parse(event.data)
  if (type === 'user.updated') {
    handleUserUpdate(data)
  }
})
```

### 5. Error Handling

**gRPC Status Codes:**

```go
// Server
return nil, status.Error(codes.NotFound, "user not found")
return nil, status.Error(codes.PermissionDenied, "access denied")
return nil, status.Error(codes.InvalidArgument, "invalid email")

// Client
if st, ok := status.FromError(err); ok {
    switch st.Code() {
    case codes.NotFound:
        // Handle not found
    case codes.PermissionDenied:
        // Handle access denied
    }
}
```

**rpc.do Error Codes:**

```typescript
// Server
throw new RPCError('user not found', 'NOT_FOUND')
throw new RPCError('access denied', 'FORBIDDEN')
throw new RPCError('invalid email', 'VALIDATION_ERROR', { field: 'email' })

// Client
import { RPCError } from 'rpc.do/errors'

try {
  await $.getUser('123')
} catch (error) {
  if (error instanceof RPCError) {
    switch (error.code) {
      case 'NOT_FOUND':
        // Handle not found
      case 'FORBIDDEN':
        // Handle access denied
    }
  }
}
```

## Feature Mapping

| gRPC Feature | rpc.do Equivalent |
|--------------|-------------------|
| `.proto` schema | TypeScript interfaces |
| `protoc` codegen | `npx rpc.do generate` |
| Unary RPC | Async method |
| Server streaming | WebSocket broadcast |
| Client streaming | Multiple method calls |
| Bidirectional | WebSocket + hibernation |
| Interceptors | Middleware |
| Metadata | `this.$.auth` / headers |
| Status codes | Error codes |
| Deadlines | Request timeout |

## Code Generation Comparison

### gRPC

```bash
protoc --go_out=. --go-grpc_out=. user.proto
```

Generates Go structs and client/server stubs.

### rpc.do

```bash
npx rpc.do generate
```

Extracts types from TypeScript source, generates client interfaces.

## Protocol Differences

### gRPC (HTTP/2 + Protobuf)
- Binary protocol (efficient but not human-readable)
- Requires HTTP/2
- Multiplexed streams
- Browser requires gRPC-web proxy

### rpc.do (HTTP/WebSocket + JSON)
- JSON protocol (human-readable, easy to debug)
- Works with HTTP/1.1 and HTTP/2
- WebSocket for real-time
- Native browser support

## Performance Considerations

gRPC is typically faster for:
- High-throughput microservices
- Large binary payloads
- Strict latency requirements

rpc.do excels at:
- Edge computing (Cloudflare Workers)
- Stateful workloads (Durable Objects)
- Browser-native real-time
- Developer experience

## Hybrid Approach

You can use both in the same system:

```
[Browser] --rpc.do--> [Cloudflare Worker] --gRPC--> [Backend Services]
```

The Worker acts as a bridge:

```typescript
import { DurableRPC } from '@dotdo/rpc'

export class ApiGateway extends DurableRPC {
  private grpcClient: GrpcClient

  async getUser(id: string) {
    // Call gRPC backend
    return this.grpcClient.userService.getUser({ id })
  }
}
```
