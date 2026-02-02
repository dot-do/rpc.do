---
title: Testing
description: Testing utilities and patterns for rpc.do applications
---

rpc.do provides testing utilities to help you write fast, reliable tests for your RPC applications.

## Test Utilities

Import from `rpc.do/testing`:

```typescript
import {
  mockRPC,
  mockTransport,
  TestServer,
  waitFor,
  deferred,
  createSpy,
} from 'rpc.do/testing'
```

## Mock RPC Client

Create a mock RPC client that calls handler functions directly:

```typescript
import { mockRPC } from 'rpc.do/testing'

interface UserAPI {
  users: {
    get: (id: string) => Promise<User>
    create: (data: CreateUserInput) => Promise<User>
    list: () => Promise<User[]>
  }
}

const mock$ = mockRPC<UserAPI>({
  users: {
    get: (id) => ({ id, name: 'Test User', email: 'test@example.com' }),
    create: (data) => ({ id: 'new-123', ...data }),
    list: () => [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ],
  }
})

// Use in tests
test('get user', async () => {
  const user = await mock$.users.get('123')
  expect(user.name).toBe('Test User')
})

test('create user', async () => {
  const user = await mock$.users.create({ name: 'Charlie', email: 'charlie@example.com' })
  expect(user.id).toBe('new-123')
})
```

### Async Handlers

Handlers can be async for more complex scenarios:

```typescript
const mock$ = mockRPC<UserAPI>({
  users: {
    get: async (id) => {
      await someAsyncSetup()
      return { id, name: 'Async User', email: 'async@example.com' }
    }
  }
})
```

### Throwing Errors

Test error handling by throwing from handlers:

```typescript
import { RPCError } from 'rpc.do/errors'

const mock$ = mockRPC<UserAPI>({
  users: {
    get: (id) => {
      if (id === 'not-found') {
        throw new RPCError('User not found', 'NOT_FOUND')
      }
      return { id, name: 'Test User', email: 'test@example.com' }
    }
  }
})

test('handles not found', async () => {
  await expect(mock$.users.get('not-found')).rejects.toThrow('User not found')
})
```

## Mock Transport

Create a transport that returns predefined responses:

```typescript
import { RPC } from 'rpc.do'
import { mockTransport } from 'rpc.do/testing'

const transport = mockTransport({
  'users.get': { id: '123', name: 'Test User' },
  'users.list': [{ id: '1' }, { id: '2' }],
  'users.create': (data) => ({ id: 'new-123', ...data }),
  'users.delete': { error: 'User not found' },
})

const $ = RPC(transport)

test('get user', async () => {
  const user = await $.users.get('123')
  expect(user.name).toBe('Test User')
})

test('handles errors', async () => {
  await expect($.users.delete('123')).rejects.toThrow('User not found')
})
```

### Track Calls

The mock transport tracks all calls:

```typescript
const transport = mockTransport({ 'users.get': { id: '123' } })
const $ = RPC(transport)

await $.users.get('123')
await $.users.get('456')

// Get all calls
const calls = transport.getCalls()
expect(calls).toHaveLength(2)

// Get calls for a specific method
const userGetCalls = transport.getCallsFor('users.get')
expect(userGetCalls).toHaveLength(2)
expect(userGetCalls[0].args).toEqual(['123'])
expect(userGetCalls[1].args).toEqual(['456'])

// Reset for next test
transport.reset()
```

## Test Server

For integration tests, create a real HTTP server:

```typescript
import { RPC, http } from 'rpc.do'
import { TestServer } from 'rpc.do/testing'

const server = new TestServer(async (req) => {
  const body = await req.json()

  // Echo the request back
  return Response.json({ echo: body })
})

beforeAll(async () => {
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

test('makes HTTP request', async () => {
  const $ = RPC(http(server.url))
  const result = await $.echo({ message: 'hello' })
  expect(result.echo).toEqual({ message: 'hello' })
})
```

## Test Utilities

### waitFor

Wait for a condition to be true:

```typescript
import { waitFor } from 'rpc.do/testing'

test('async operation completes', async () => {
  const results: string[] = []

  $.subscribe((event) => results.push(event))

  await $.trigger('test-event')

  await waitFor(() => results.length > 0)
  expect(results).toContain('test-event')
})
```

### deferred

Create a controllable promise:

```typescript
import { deferred } from 'rpc.do/testing'

test('handles pending state', async () => {
  const { promise, resolve } = deferred<string>()

  const transport = mockTransport({
    'slow.operation': () => promise
  })

  const $ = RPC(transport)
  const resultPromise = $.slow.operation()

  // Still pending...
  expect(transport.getCallCount()).toBe(1)

  // Resolve it
  resolve('done')

  const result = await resultPromise
  expect(result).toBe('done')
})
```

### createSpy

Create a spy function for testing:

```typescript
import { createSpy } from 'rpc.do/testing'

test('middleware is called', async () => {
  const onRequest = createSpy()

  const $ = RPC('https://api.example.com', {
    middleware: [{ onRequest }]
  })

  await $.users.get('123')

  expect(onRequest.calls).toHaveLength(1)
  expect(onRequest.calls[0]).toEqual(['users.get', ['123']])
})
```

## Testing Durable Objects

Test your DurableRPC classes directly:

```typescript
import { DurableRPC } from '@dotdo/rpc'
import { createMockDOState } from '@dotdo/rpc/testing'

class UserService extends DurableRPC {
  users = this.collection<User>('users')

  async createUser(id: string, data: User) {
    this.users.put(id, data)
    return { id, ...data }
  }
}

test('creates user', async () => {
  const mockState = createMockDOState()
  const do = new UserService(mockState, {})

  const user = await do.createUser('123', { name: 'Alice', email: 'alice@example.com' })

  expect(user.id).toBe('123')
  expect(await do.users.get('123')).toEqual({ name: 'Alice', email: 'alice@example.com' })
})
```

## Integration Testing

Full end-to-end tests with Miniflare:

```typescript
import { Miniflare } from 'miniflare'
import { RPC } from 'rpc.do'

let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await readFile('./dist/worker.js', 'utf-8'),
    durableObjects: {
      USER_DO: 'UserService'
    }
  })
})

afterAll(async () => {
  await mf.dispose()
})

test('e2e user creation', async () => {
  const response = await mf.dispatchFetch('http://localhost/users/default', {
    method: 'POST',
    body: JSON.stringify({
      method: 'createUser',
      params: ['123', { name: 'Alice' }]
    })
  })

  const result = await response.json()
  expect(result.id).toBe('123')
})
```

## Best Practices

1. **Use mockRPC for unit tests** - Fast, no network, deterministic
2. **Use mockTransport for transport tests** - Test middleware, error handling
3. **Use TestServer for integration** - Real HTTP, but no external dependencies
4. **Use Miniflare for E2E** - Full Cloudflare Workers environment
5. **Reset state between tests** - Use `transport.reset()` or fresh mocks
6. **Test error paths** - Mock errors to verify error handling
7. **Test async behavior** - Use `deferred` and `waitFor` for async flows
