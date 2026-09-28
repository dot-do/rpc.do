/**
 * batchSession(): one capnweb HTTP batch with the pipelining stub, custom fetch and headers.
 */

import { describe, it, expect, vi } from 'vitest'
import { RpcTarget, newHttpBatchRpcResponse } from 'capnweb'
import { batchSession, type BatchFetch } from '../src/transports'
import { batchSession as fromRoot } from '../src/index'

class User extends RpcTarget {
  constructor(readonly userId: string) {
    super()
  }
  get id() {
    return this.userId
  }
}

class Api extends RpcTarget {
  created: string[] = []
  createUser(name: string) {
    this.created.push(name)
    return new User(`u-${name}`)
  }
  createPost(authorId: string, title: string) {
    return { authorId, title }
  }
  echo(value: unknown) {
    return value
  }
}

interface ApiShape {
  createUser(name: string): Promise<{ id: string }> & { id: Promise<string> }
  createPost(authorId: string | Promise<string>, title: string): Promise<{ authorId: string; title: string }>
  echo<V>(value: V): Promise<V>
}

function server(api = new Api()) {
  const requests: Request[] = []
  const fetchImpl = vi.fn<BatchFetch>(async (url, init) => {
    const request = new Request(url, init)
    requests.push(request.clone())
    return newHttpBatchRpcResponse(request, api)
  })
  return { api, requests, fetchImpl }
}

const URL_ = 'https://api.example.com/rpc'

/**
 * capnweb RpcPromises are callable proxies, and expect(fn).rejects invokes a function it is
 * given, so turn the RpcPromise into a native promise before asserting on it.
 */
const settle = <V>(p: PromiseLike<V>): Promise<V> => new Promise<V>((resolve, reject) => p.then(resolve, reject))

describe('batchSession()', () => {
  it('is exported from rpc.do and rpc.do/transports', () => {
    expect(fromRoot).toBe(batchSession)
  })

  it('pipelines a result into a later call of the same batch, in one request', async () => {
    const { fetchImpl, requests } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })

    const user = batch.remote.createUser('ada')
    const post = batch.remote.createPost(user.id, 'hello')

    expect(await post).toEqual({ authorId: 'u-ada', title: 'hello' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(requests[0]!.method).toBe('POST')
    expect(batch.sent).toBe(true)
  })

  it('sends the configured headers through the given fetch', async () => {
    const { fetchImpl, requests } = server()
    const batch = await batchSession<ApiShape>(URL_, {
      fetch: fetchImpl,
      headers: { Authorization: 'Bearer t0k' },
    })
    expect(await batch.remote.echo(42)).toBe(42)
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer t0k')
  })

  it('uses global fetch by default', async () => {
    const { fetchImpl } = server()
    const original = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchImpl(String(input), init ?? {})) as typeof fetch
    try {
      const batch = await batchSession<ApiShape>(URL_)
      expect(await batch.remote.echo('x')).toBe('x')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('flush() sends before the next macrotask', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    // capnweb asks for a result only once it is .then()ed, so take it before flushing.
    const result = batch.remote.echo('now').then((v) => v)
    expect(batch.sent).toBe(false)
    batch.flush()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(batch.sent).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await result).toBe('now')
  })

  it('a result not yet awaited when flush() sends it is not delivered', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    const late = batch.remote.echo('late')
    batch.flush()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    await expect(settle(late)).rejects.toThrow('Batch RPC request ended.')
  })

  it('a call made after the batch left rejects instead of hanging', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    expect(await batch.remote.echo(1)).toBe(1)
    await expect(settle(batch.remote.echo(2))).rejects.toThrow('Batch RPC request ended.')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('abort() before sending rejects every call and sends nothing', async () => {
    const { fetchImpl, api } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    const a = batch.remote.createUser('ada')
    const b = batch.remote.echo('b')
    batch.abort(new Error('changed my mind'))
    await expect(settle(a)).rejects.toThrow('changed my mind')
    await expect(settle(b)).rejects.toThrow('changed my mind')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(api.created).toEqual([])
  })

  it('abort() without a reason rejects with a default error', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    const a = batch.remote.echo('a')
    batch.abort()
    await expect(settle(a)).rejects.toThrow('Batch aborted')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes sessionOptions to the capnweb session', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, {
      fetch: fetchImpl,
      sessionOptions: { limits: { maxMessageSize: 64 } },
    })
    // The reply is larger than the 64-byte receive limit, so the client rejects it.
    await expect(settle(batch.remote.echo('x'.repeat(200)))).rejects.toThrow(/exceeds maximum size of 64/)
  })

  it('rejects every call when the server answers with an HTTP error', async () => {
    const fetchImpl = vi.fn<BatchFetch>(async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' }))
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    await expect(settle(batch.remote.echo(1))).rejects.toThrow('RPC request failed: 503 Service Unavailable')
  })

  it('disposes without throwing', async () => {
    const { fetchImpl } = server()
    const batch = await batchSession<ApiShape>(URL_, { fetch: fetchImpl })
    expect(await batch.remote.echo(1)).toBe(1)
    expect(() => batch[Symbol.dispose]()).not.toThrow()
  })
})
