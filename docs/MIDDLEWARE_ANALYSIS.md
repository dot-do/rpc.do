# Middleware Analysis and Consolidation Plan

This document analyzes the middleware implementations in rpc.do (client-side) and @dotdo/rpc (server-side), identifies differences, and proposes a consolidation strategy.

## Current State

### Client Middleware (`rpc.do`)

**Location:** `src/middleware/`

The client middleware system provides hooks for intercepting RPC calls before they are sent and after responses are received. It is designed for logging, timing, retry logic, and other cross-cutting concerns on the client side.

**Files:**
- `src/middleware/index.ts` - Main exports and `withMiddleware` transport wrapper
- `src/middleware/logging.ts` - Logging middleware implementation
- `src/middleware/timing.ts` - Performance timing middleware
- `src/middleware/retry.ts` - Retry logic with exponential backoff

**Core Type (defined in `src/index.ts`):**
```typescript
export type RpcClientMiddleware = {
  onRequest?: (method: string, args: unknown[]) => void | Promise<void>
  onResponse?: (method: string, result: unknown) => void | Promise<void>
  onError?: (method: string, error: unknown) => void | Promise<void>
}
```

### Server Middleware (`@dotdo/rpc`)

**Location:** `core/src/middleware.ts`

The server middleware system provides hooks for intercepting RPC calls inside the Durable Object. It runs on the server and has access to request context, environment bindings, and authentication state.

**Core Types:**
```typescript
export interface MiddlewareContext {
  env: unknown
  request?: Request
}

export interface ServerMiddleware {
  onRequest?(method: string, args: unknown[], ctx: MiddlewareContext): void | Promise<void>
  onResponse?(method: string, result: unknown, ctx: MiddlewareContext): void | Promise<void>
  onError?(method: string, error: unknown, ctx: MiddlewareContext): void | Promise<void>
}
```

---

## Interface Comparison

| Aspect | Client (`RpcClientMiddleware`) | Server (`ServerMiddleware`) |
|--------|-------------------------------|----------------------------|
| **Hook: onRequest** | `(method, args)` | `(method, args, ctx)` |
| **Hook: onResponse** | `(method, result)` | `(method, result, ctx)` |
| **Hook: onError** | `(method, error)` | `(method, error, ctx)` |
| **Context Parameter** | No | Yes (`MiddlewareContext`) |
| **Context.env** | N/A | `unknown` |
| **Context.request** | N/A | `Request \| undefined` |
| **Execution Order (onRequest)** | Sequential, in order | Sequential, in order |
| **Execution Order (onResponse)** | Sequential, in order | Sequential, in order |
| **Execution Order (onError)** | Sequential, in order | **Reverse order** |
| **Error Handling** | Errors propagate | Errors logged, not propagated |
| **Type Name** | `RpcClientMiddleware` | `ServerMiddleware` |

### Key Differences

1. **Context Parameter**
   - Server middleware receives a `MiddlewareContext` with `env` and `request`
   - Client middleware has no context (operates at transport level)

2. **Error Hook Execution Order**
   - Server: Reverse order (like catch blocks)
   - Client: Forward order (sequential)

3. **Error Propagation in onResponse/onError**
   - Server: Errors in hooks are caught and logged, not propagated
   - Client: Errors in hooks propagate normally

4. **Request Object Access**
   - Server: Full access to `Request` object
   - Client: No access to request (already serialized to RPC call)

---

## Implementation Differences

### Logging Middleware

| Feature | Client | Server |
|---------|--------|--------|
| Location | `src/middleware/logging.ts` | `core/src/middleware.ts` |
| Factory Function | `loggingMiddleware(options)` | `serverLoggingMiddleware(options)` |
| Options Interface | `LoggingOptions` | `ServerLoggingOptions` |

**Options (identical):**
```typescript
interface LoggingOptions {
  log?: (message: string, ...args: unknown[]) => void
  error?: (message: string, ...args: unknown[]) => void
  prefix?: string      // default: '[RPC]'
  logArgs?: boolean    // default: true
  logResult?: boolean  // default: true
}
```

### Timing Middleware

| Feature | Client | Server |
|---------|--------|--------|
| Location | `src/middleware/timing.ts` | `core/src/middleware.ts` |
| Factory Function | `timingMiddleware(options)` | `serverTimingMiddleware(options)` |
| Options Interface | `TimingOptions` | `ServerTimingOptions` |

**Client-specific Options:**
```typescript
interface TimingOptions {
  log?: (message: string) => void
  prefix?: string           // default: '[RPC Timing]'
  threshold?: number        // default: 0
  onTiming?: (method: string, durationMs: number) => void
  ttl?: number             // TTL for cleanup (client only)
  cleanupInterval?: number // Cleanup interval (client only)
}
```

**Server Options (subset):**
```typescript
interface ServerTimingOptions {
  log?: (message: string) => void
  prefix?: string           // default: '[RPC Timing]'
  threshold?: number        // default: 0
  onTiming?: (method: string, durationMs: number) => void
}
```

**Note:** Client timing middleware includes TTL-based cleanup to prevent memory leaks from dropped requests (not needed on server where requests have bounded lifetime).

### Retry Middleware

| Feature | Client | Server |
|---------|--------|--------|
| Available | Yes | No |
| Location | `src/middleware/retry.ts` | N/A |

Server-side retry doesn't make sense (the request already reached the server).

---

## Type System Analysis

### Shared Concepts (Candidates for Extraction)

1. **Base Hook Signature**
   ```typescript
   type MiddlewareHook<TContext = void> = TContext extends void
     ? (method: string, args: unknown[]) => void | Promise<void>
     : (method: string, args: unknown[], ctx: TContext) => void | Promise<void>
   ```

2. **Logging Options**
   ```typescript
   interface BaseLoggingOptions {
     log?: (message: string, ...args: unknown[]) => void
     error?: (message: string, ...args: unknown[]) => void
     prefix?: string
     logArgs?: boolean
     logResult?: boolean
   }
   ```

3. **Timing Options**
   ```typescript
   interface BaseTimingOptions {
     log?: (message: string) => void
     prefix?: string
     threshold?: number
     onTiming?: (method: string, durationMs: number) => void
   }
   ```

### Package-Specific Types

**Client-specific:**
- `RpcClientMiddleware` - no context parameter
- `RetryOptions` - retry configuration
- `TimingOptions.ttl`, `TimingOptions.cleanupInterval` - memory management

**Server-specific:**
- `ServerMiddleware` - includes context parameter
- `MiddlewareContext` - server environment/request access

---

## Recommended Consolidation Approach

### Option A: Shared Base Types in @dotdo/types (Recommended)

Move shared option interfaces to `@dotdo/types` while keeping middleware interfaces package-specific:

```
@dotdo/types/middleware
  |-- BaseLoggingOptions     // Shared logging configuration
  |-- BaseTimingOptions      // Shared timing configuration
  |-- MiddlewareHookResult   // void | Promise<void>

rpc.do (client)
  |-- RpcClientMiddleware    // Uses base options, no context
  |-- LoggingOptions extends BaseLoggingOptions
  |-- TimingOptions extends BaseTimingOptions

@dotdo/rpc (server)
  |-- ServerMiddleware       // Uses base options, has context
  |-- MiddlewareContext      // Server-specific
  |-- ServerLoggingOptions extends BaseLoggingOptions
  |-- ServerTimingOptions extends BaseTimingOptions
```

**Pros:**
- Clean separation of concerns
- Shared options reduce duplication
- Middleware interfaces remain package-specific (appropriate given different contexts)
- No breaking changes to existing APIs

**Cons:**
- Slight increase in complexity (one more package to consider)

### Option B: Adapter Pattern

Create adapters that convert between client and server middleware:

```typescript
// Convert server middleware to client (strip context)
function serverToClient(mw: ServerMiddleware): RpcClientMiddleware {
  return {
    onRequest: mw.onRequest
      ? (method, args) => mw.onRequest?.(method, args, {} as any)
      : undefined,
    // ...
  }
}

// Convert client middleware to server (add default context)
function clientToServer(mw: RpcClientMiddleware): ServerMiddleware {
  return {
    onRequest: mw.onRequest
      ? (method, args, _ctx) => mw.onRequest?.(method, args)
      : undefined,
    // ...
  }
}
```

**Pros:**
- Allows middleware reuse across client/server

**Cons:**
- Context mismatch (server middleware expects context, client doesn't provide it)
- Limited practical value (middleware logic often depends on side)

### Option C: Unified Middleware Interface

Create a single interface that works on both sides:

```typescript
interface UnifiedMiddleware<TContext = unknown> {
  onRequest?(method: string, args: unknown[], ctx?: TContext): void | Promise<void>
  onResponse?(method: string, result: unknown, ctx?: TContext): void | Promise<void>
  onError?(method: string, error: unknown, ctx?: TContext): void | Promise<void>
}
```

**Cons:**
- Forces optional context on client (unnecessary complexity)
- Loses type safety for server context

---

## Implementation Plan

### Phase 1: Extract Shared Types (Low Risk)

1. Create `src/middleware/types.ts` with shared option interfaces:
   ```typescript
   // Base options shared between client and server
   export interface BaseLoggingOptions {
     log?: (message: string, ...args: unknown[]) => void
     error?: (message: string, ...args: unknown[]) => void
     prefix?: string
     logArgs?: boolean
     logResult?: boolean
   }

   export interface BaseTimingOptions {
     log?: (message: string) => void
     prefix?: string
     threshold?: number
     onTiming?: (method: string, durationMs: number) => void
   }
   ```

2. Update `src/middleware/logging.ts` and `src/middleware/timing.ts` to extend base types

3. Export from `src/middleware/index.ts`

### Phase 2: Consider @dotdo/types Migration (Future)

If the shared types prove useful, consider:
1. Moving `BaseLoggingOptions` and `BaseTimingOptions` to `@dotdo/types`
2. Having both packages import from the shared location

### Phase 3: Documentation (Future)

Document the middleware patterns and best practices for each side.

---

## Summary

| Recommendation | Priority | Risk | Impact |
|----------------|----------|------|--------|
| Extract shared option types to `types.ts` | High | Low | Reduces duplication, improves maintainability |
| Keep middleware interfaces separate | - | - | Already implemented correctly |
| Add adapters | Low | Low | Limited practical value |
| Migrate to @dotdo/types | Medium | Low | Better for ecosystem-wide sharing |

The current separation between client and server middleware is appropriate given their different execution contexts. The main opportunity for consolidation is in the shared option types (logging, timing), which can be extracted without breaking changes.

---

## Appendix: File References

### Client Middleware Files
- `/Users/nathanclevenger/projects/rpc.do/src/middleware/index.ts`
- `/Users/nathanclevenger/projects/rpc.do/src/middleware/logging.ts`
- `/Users/nathanclevenger/projects/rpc.do/src/middleware/timing.ts`
- `/Users/nathanclevenger/projects/rpc.do/src/middleware/retry.ts`
- `/Users/nathanclevenger/projects/rpc.do/src/index.ts` (RpcClientMiddleware type)

### Server Middleware Files
- `/Users/nathanclevenger/projects/rpc.do/core/src/middleware.ts`
- `/Users/nathanclevenger/projects/rpc.do/core/src/index.ts` (exports)
