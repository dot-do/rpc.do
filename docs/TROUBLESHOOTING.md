# Troubleshooting Guide

Common issues and solutions when working with rpc.do.

---

## Table of Contents

1. [Connection Issues](#1-connection-issues)
   - [WebSocket Connection Failures](#websocket-connection-failures)
   - [HTTP Timeout Errors](#http-timeout-errors)
   - [Service Binding Errors](#service-binding-errors)
2. [Authentication](#2-authentication)
   - [Token Refresh Issues](#token-refresh-issues)
   - [oauth.do Integration Problems](#oauthdo-integration-problems)
3. [Type Issues](#3-type-issues)
   - [Type Inference Not Working](#type-inference-not-working)
   - [Generic Type Errors](#generic-type-errors)
4. [WebSocket/Hibernation](#4-websockethibernation)
   - [Reconnection Not Working](#reconnection-not-working)
   - [State Lost After Hibernation](#state-lost-after-hibernation)
5. [SQLite/Collections](#5-sqlitecollections)
   - [Query Errors](#query-errors)
   - [Migration Issues](#migration-issues)

---

## 1. Connection Issues

### WebSocket Connection Failures

#### Symptom: `ConnectionError` with code `CONNECTION_LOST`

```
ConnectionError: WebSocket connection failed
  code: 'CONNECTION_LOST'
  retryable: true
```

**Causes & Solutions:**

1. **Wrong protocol** - Using `http://` instead of `ws://` or `wss://`

   ```typescript
   // Wrong
   const rpc = RPC(capnweb('http://api.example.com/rpc', { websocket: true }))

   // Correct - use wss:// for secure WebSocket
   const rpc = RPC(capnweb('wss://api.example.com/rpc'))
   ```

2. **CORS blocking WebSocket upgrade** - Server must allow WebSocket connections

   ```typescript
   // On your Cloudflare Worker server
   export default {
     fetch(request: Request, env: Env) {
       // Check for WebSocket upgrade
       if (request.headers.get('Upgrade') === 'websocket') {
         return handleWebSocket(request, env)
       }
       return handleHttp(request, env)
     }
   }
   ```

3. **Firewall or proxy blocking WebSockets** - Try falling back to HTTP

   ```typescript
   import { RPC, composite, capnweb, http } from 'rpc.do'

   // Try WebSocket first, fall back to HTTP
   const rpc = RPC(composite(
     capnweb('wss://api.example.com/rpc'),
     http('https://api.example.com/rpc')
   ))
   ```

#### Symptom: `ConnectionError` with code `INSECURE_CONNECTION`

```
ConnectionError: SECURITY ERROR: Refusing to send authentication token over insecure ws:// connection.
  code: 'INSECURE_CONNECTION'
  retryable: false
```

**Cause:** Attempting to send auth tokens over unencrypted `ws://` connection.

**Solutions:**

1. **Use secure WebSocket (`wss://`)** - Always use TLS in production

   ```typescript
   // Wrong
   const rpc = RPC(capnweb('ws://api.example.com/rpc', {
     auth: oauthProvider()
   }))

   // Correct
   const rpc = RPC(capnweb('wss://api.example.com/rpc', {
     auth: oauthProvider()
   }))
   ```

2. **For local development only** - Explicitly allow insecure auth

   ```typescript
   const rpc = RPC(capnweb('ws://localhost:8787/rpc', {
     auth: oauthProvider(),
     allowInsecureAuth: true  // WARNING: Never use in production!
   }))
   ```

---

### HTTP Timeout Errors

#### Symptom: `ConnectionError` with code `REQUEST_TIMEOUT`

```
ConnectionError: Request timeout after 30000ms
  code: 'REQUEST_TIMEOUT'
  retryable: true
```

**Solutions:**

1. **Increase timeout** for slow operations

   ```typescript
   import { RPC, http } from 'rpc.do'

   // Increase timeout to 60 seconds
   const rpc = RPC(http('https://api.example.com/rpc', { timeout: 60000 }))
   ```

2. **Handle timeout gracefully**

   ```typescript
   import { ConnectionError } from 'rpc.do/errors'

   try {
     await rpc.slowOperation()
   } catch (error) {
     if (error instanceof ConnectionError && error.code === 'REQUEST_TIMEOUT') {
       // Retry with exponential backoff
       await retryWithBackoff(() => rpc.slowOperation())
     }
   }
   ```

3. **Break large operations into smaller chunks**

   ```typescript
   // Instead of processing all at once
   // await rpc.processAll(largeArray)

   // Process in batches
   const batchSize = 100
   for (let i = 0; i < largeArray.length; i += batchSize) {
     const batch = largeArray.slice(i, i + batchSize)
     await rpc.processBatch(batch)
   }
   ```

---

### Service Binding Errors

#### Symptom: `RPCError` with code `UNKNOWN_NAMESPACE` or `UNKNOWN_METHOD`

```
RPCError: Unknown namespace: myService.users
  code: 'UNKNOWN_NAMESPACE'
```

**Solutions:**

1. **Verify binding name in wrangler.toml**

   ```toml
   # wrangler.toml
   [[services]]
   binding = "MY_SERVICE"  # Must match env.MY_SERVICE
   service = "my-service-worker"
   ```

2. **Ensure the bound worker exposes `getRpcTarget()`**

   ```typescript
   // In your bound worker
   import { expose } from 'rpc.do'

   const api = {
     users: {
       list: () => [{ id: '1', name: 'Alice' }],
       get: (id: string) => ({ id, name: 'Alice' })
     }
   }

   export default expose(() => api)
   ```

3. **Use the correct binding reference**

   ```typescript
   import { RPC, binding } from 'rpc.do'

   export default {
     fetch: async (req, env) => {
       // Correct - use the binding name from wrangler.toml
       const rpc = RPC(binding(env.MY_SERVICE))

       const users = await rpc.users.list()
       return Response.json(users)
     }
   }
   ```

---

## 2. Authentication

### Token Refresh Issues

#### Symptom: `AuthenticationError` after token expires

```
AuthenticationError: Authentication failed
  status: 401
```

**Solutions:**

1. **Use cached auth provider with proactive refresh**

   ```typescript
   import { cachedAuth } from 'rpc.do/auth'

   const auth = cachedAuth(getToken, {
     ttl: 300000,        // 5 minute cache
     refreshBuffer: 60000  // Refresh 1 minute before expiry
   })

   const rpc = RPC(http('https://api.example.com/rpc', auth))
   ```

2. **Handle 401 and retry with fresh token**

   ```typescript
   import { AuthenticationError } from 'rpc.do/errors'

   async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
     try {
       return await fn()
     } catch (error) {
       if (error instanceof AuthenticationError) {
         // Force token refresh
         await refreshToken()
         return await fn()
       }
       throw error
     }
   }

   const user = await callWithRetry(() => rpc.users.get({ id: '123' }))
   ```

3. **Use WebSocket with reconnection for automatic re-auth**

   ```typescript
   const rpc = RPC(capnweb('wss://api.example.com/rpc', {
     auth: oauthProvider(),
     reconnect: true,  // Re-authenticates on reconnection
     reconnectOptions: {
       onReconnecting: (attempt) => console.log('Reconnecting...', attempt),
     }
   }))
   ```

---

### oauth.do Integration Problems

#### Symptom: Token is always `null`

**Causes & Solutions:**

1. **oauth.do not installed** - Add as dependency

   ```bash
   npm install oauth.do
   ```

2. **oauth.do not initialized** - Initialize before using

   ```typescript
   // In your app entry point
   import { init } from 'oauth.do'

   init({
     clientId: 'your-client-id',
     // Other options...
   })

   // Then use in RPC
   import { oauthProvider } from 'rpc.do/auth'
   const rpc = RPC(http('https://api.example.com/rpc', oauthProvider()))
   ```

3. **User not logged in** - Use fallback token

   ```typescript
   const rpc = RPC(http('https://api.example.com/rpc', oauthProvider({
     fallbackToken: process.env.API_TOKEN  // Use API key when user not logged in
   })))
   ```

4. **Use composite auth for multiple sources**

   ```typescript
   import { compositeAuth, oauthProvider, staticAuth } from 'rpc.do/auth'

   const auth = compositeAuth([
     oauthProvider(),                              // Try oauth.do first
     staticAuth(() => process.env.DO_TOKEN),      // Then env var
     staticAuth(() => localStorage.getItem('token'))  // Then localStorage
   ])

   const rpc = RPC(http('https://api.example.com/rpc', auth))
   ```

---

## 3. Type Issues

### Type Inference Not Working

#### Symptom: Methods show as `any` type

```typescript
const rpc = RPC(http('https://api.example.com/rpc'))
const user = await rpc.users.get({ id: '123' })
//    ^-- user is 'any'
```

**Solution:** Define your API interface and pass it as generic

```typescript
// Define your API types
interface MyAPI {
  users: {
    get: (args: { id: string }) => { id: string; name: string; email: string }
    list: () => Array<{ id: string; name: string }>
    create: (args: { name: string; email: string }) => { id: string }
  }
  posts: {
    getByUser: (args: { userId: string }) => Array<{ id: string; title: string }>
  }
}

// Pass the type as generic parameter
const rpc = RPC<MyAPI>(http('https://api.example.com/rpc'))

// Now you get full autocomplete and type checking
const user = await rpc.users.get({ id: '123' })
//    ^-- user is { id: string; name: string; email: string }
```

#### Symptom: "Type instantiation is excessively deep"

**Cause:** Deeply nested or recursive type definitions.

**Solutions:**

1. **Flatten nested namespaces**

   ```typescript
   // Instead of deeply nested
   interface API {
     a: { b: { c: { d: { e: { method: () => void } } } } }
   }

   // Use flatter structure
   interface API {
     'a.b.c.d.e': { method: () => void }
   }
   ```

2. **Use type assertions for problematic paths**

   ```typescript
   const result = await (rpc.deeply.nested.path as any).method()
   ```

---

### Generic Type Errors

#### Symptom: "Argument of type X is not assignable to parameter of type Y"

```typescript
interface API {
  users: {
    create: (args: { name: string; email: string }) => { id: string }
  }
}

const rpc = RPC<API>(http('...'))

// Error: Argument of type '{ name: string }' is not assignable...
await rpc.users.create({ name: 'Alice' })
```

**Solution:** Provide all required properties

```typescript
await rpc.users.create({ name: 'Alice', email: 'alice@example.com' })
```

#### Symptom: Return type is `Promise<unknown>` instead of expected type

**Cause:** API interface methods should NOT be wrapped in `Promise<>` - rpc.do handles that automatically.

```typescript
// Wrong - don't wrap in Promise
interface API {
  users: {
    get: (args: { id: string }) => Promise<{ id: string; name: string }>
  }
}

// Correct - return type without Promise
interface API {
  users: {
    get: (args: { id: string }) => { id: string; name: string }
  }
}

// rpc.do automatically wraps in Promise when called
const user = await rpc.users.get({ id: '123' })  // Returns Promise<{ id: string; name: string }>
```

---

## 4. WebSocket/Hibernation

### Reconnection Not Working

#### Symptom: WebSocket disconnects and doesn't reconnect

**Solutions:**

1. **Enable reconnection in capnweb transport**

   ```typescript
   const rpc = RPC(capnweb('wss://api.example.com/rpc', {
     reconnect: true,  // Enable automatic reconnection
     reconnectOptions: {
       maxReconnectAttempts: 10,      // Default: Infinity
       reconnectBackoff: 1000,        // Start at 1s
       maxReconnectBackoff: 30000,    // Cap at 30s
     }
   }))
   ```

2. **Add connection event handlers for debugging**

   ```typescript
   const rpc = RPC(capnweb('wss://api.example.com/rpc', {
     reconnect: true,
     reconnectOptions: {
       onConnect: () => console.log('Connected!'),
       onDisconnect: (reason) => console.log('Disconnected:', reason),
       onReconnecting: (attempt, max) => console.log(`Reconnecting ${attempt}/${max}`),
       onError: (error) => console.error('Connection error:', error),
     }
   }))
   ```

3. **Check if max reconnect attempts reached**

   ```
   ConnectionError: Failed to reconnect after 10 attempts
     code: 'RECONNECT_FAILED'
     retryable: false
   ```

   Increase `maxReconnectAttempts` or set to `Infinity`:

   ```typescript
   reconnectOptions: {
     maxReconnectAttempts: Infinity,  // Never stop trying
   }
   ```

#### Symptom: `ConnectionError` with code `HEARTBEAT_TIMEOUT`

```
ConnectionError: Connection heartbeat timeout - server not responding
  code: 'HEARTBEAT_TIMEOUT'
  retryable: true
```

**Cause:** Server not responding to ping messages within timeout period.

**Solutions:**

1. **Increase heartbeat timeout**

   ```typescript
   reconnectOptions: {
     heartbeatInterval: 30000,  // Send ping every 30s
     heartbeatTimeout: 10000,   // Wait 10s for pong (increase if needed)
   }
   ```

2. **Ensure server handles ping/pong**

   ```typescript
   // In your DurableObject
   webSocketMessage(ws: WebSocket, message: string) {
     try {
       const msg = JSON.parse(message)
       if (msg.type === 'ping') {
         ws.send(JSON.stringify({ type: 'pong' }))
         return
       }
     } catch {
       // Handle as regular message
     }
     // ... handle other messages
   }
   ```

---

### State Lost After Hibernation

#### Symptom: Data not persisted when Durable Object hibernates

**Cause:** In-memory state is lost during hibernation. Only SQLite storage persists.

**Solutions:**

1. **Use collections for persistent storage**

   ```typescript
   import { DurableRPC } from 'rpc.do'

   export class MyDO extends DurableRPC {
     // This persists to SQLite - survives hibernation
     users = this.collection<User>('users')

     // NOT this - lost on hibernation
     // private cache = new Map<string, User>()

     async createUser(data: User) {
       // Data is persisted to SQLite
       this.users.put(data.id, data)
     }
   }
   ```

2. **Persist events before hibernation**

   ```typescript
   import { createEventEmitter } from '@dotdo/rpc/events'

   export class MyDO extends DurableRPC {
     events = createEventEmitter({
       ctx: this.ctx,
       env: this.env
     })

     // Call before hibernation
     async beforeHibernate() {
       await this.events.persistBatch()
     }
   }
   ```

3. **Use storage APIs for non-collection state**

   ```typescript
   export class MyDO extends DurableRPC {
     async setState(key: string, value: unknown) {
       await this.ctx.storage.put(key, value)
     }

     async getState(key: string) {
       return await this.ctx.storage.get(key)
     }
   }
   ```

---

## 5. SQLite/Collections

### Query Errors

#### Symptom: "Invalid field name" error

```
Error: Invalid field name: user'; DROP TABLE _collections; --
```

**Cause:** Field names in filters must be alphanumeric with underscores and dots only. SQL injection attempts are blocked.

**Solution:** Use valid field names

```typescript
// Wrong - SQL injection attempt blocked
users.find({ "user'; DROP TABLE --": 'value' })

// Correct - use valid field names
users.find({ userName: 'value' })
users.find({ 'metadata.level': 5 })  // Nested fields use dot notation
```

#### Symptom: "offset requires limit to be specified" error

```
Error: offset requires limit to be specified
```

**Cause:** SQLite requires LIMIT when using OFFSET.

**Solution:** Always provide `limit` when using `offset`

```typescript
// Wrong
const results = users.find({}, { offset: 10 })

// Correct
const results = users.find({}, { offset: 10, limit: 100 })

// For pagination
const page1 = users.find({}, { limit: 20, offset: 0 })
const page2 = users.find({}, { limit: 20, offset: 20 })
```

#### Symptom: "Document ID must be a non-empty string"

```
Error: Document ID must be a non-empty string
```

**Solution:** Ensure IDs are valid strings

```typescript
// Wrong
users.put('', { name: 'Alice' })
users.put(null, { name: 'Alice' })
users.put(123, { name: 'Alice' })

// Correct
users.put('user-123', { name: 'Alice' })
users.put(crypto.randomUUID(), { name: 'Alice' })
```

#### Symptom: "Document must be a non-null object"

```
Error: Document must be a non-null object
```

**Solution:** Ensure documents are plain objects

```typescript
// Wrong
users.put('id', null)
users.put('id', 'string')
users.put('id', ['array'])
users.put('id', 123)

// Correct
users.put('id', { name: 'Alice', email: 'alice@example.com' })
```

---

### Migration Issues

#### Symptom: Collections schema not created

**Cause:** Schema initialization happens on first collection operation.

**Solution:** Ensure at least one collection operation is performed

```typescript
// Schema is auto-initialized when you first access a collection
const users = this.collection('users')
users.put('init', { test: true })  // This triggers schema creation
users.delete('init')               // Clean up
```

#### Symptom: Data from old schema not compatible

**Solution:** Manually migrate data

```typescript
// In your DO
async migrate() {
  const users = this.collection('users')

  // Get all documents
  const allUsers = users.list()

  // Update to new schema
  for (const user of allUsers) {
    const id = users.keys().find(k => users.get(k) === user)
    if (id) {
      users.put(id, {
        ...user,
        // Add new required fields
        createdAt: user.createdAt ?? Date.now(),
        version: 2
      })
    }
  }
}
```

#### Symptom: Collection data conflicts between instances

**Cause:** Multiple Durable Object instances writing to different SQLite databases.

**Solution:** Ensure you're accessing the correct DO instance

```typescript
// Each DO instance has its own SQLite database
const id = env.MY_DO.idFromName('user-123')  // Consistent ID
const stub = env.MY_DO.get(id)

// All operations go to the same instance
await stub.users.put('doc1', { ... })
await stub.users.get('doc1')  // Same instance, same data
```

---

## Getting Help

If you're still having issues:

1. **Check the error code** - Each error has a unique code for programmatic handling
2. **Enable debug mode** - Set `debug: true` in transport options for detailed logs
3. **Check the tests** - The test files in `src/**/*.test.ts` show expected behavior
4. **Open an issue** - Include the error message, code, and minimal reproduction

```typescript
// Enable debug logging for troubleshooting
const rpc = RPC(capnweb('wss://api.example.com/rpc', {
  reconnect: true,
  reconnectOptions: {
    debug: true  // Logs all connection events
  }
}))
```
