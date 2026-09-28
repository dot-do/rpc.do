/**
 * HTTP batch session lifetime
 *
 * A capnweb HTTP batch session is single-use: it sends one HTTP request carrying every call
 * made on it before the batch flushes, and after that the session is finished. A transport
 * that hands the same session to a call made after the flush sends that call into a dead
 * session. These tests drive one http() / capnweb({ websocket: false }) transport through
 * several batches:
 *
 * - two sequential awaited calls;
 * - two calls in separate ticks, the second made while the first batch is still in flight;
 * - calls made in the same tick, which must still share one batch (one HTTP request).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RpcTarget, newHttpBatchRpcResponse } from 'capnweb'
import { http, capnweb } from '../src/transports'
import type { Transport } from '../src/types'

class EchoTarget extends RpcTarget {
  echo(value: unknown) {
    return value
  }
}

let originalFetch: typeof globalThis.fetch
let requests = 0
let gate: Promise<void> | null = null

beforeEach(() => {
  originalFetch = globalThis.fetch
  requests = 0
  gate = null
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
    requests++
    if (gate) await gate
    return newHttpBatchRpcResponse(request, new EchoTarget())
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 1))
  }
}

const transports: Array<[string, () => Transport]> = [
  ['http()', () => http('https://api.example.com/rpc')],
  ['capnweb({ websocket: false })', () => capnweb('https://api.example.com/rpc', { websocket: false })],
]

describe.each(transports)('%s across batches', (_name, make) => {
  it('serves two sequential awaited calls', async () => {
    const t = make()
    expect(await t.call('echo', [1])).toBe(1)
    expect(await t.call('echo', [2])).toBe(2)
    expect(requests).toBe(2)
  })

  it('serves a call made in a later tick while the first batch is still in flight', async () => {
    const t = make()
    let release!: () => void
    gate = new Promise<void>((r) => { release = r })

    const first = t.call('echo', ['first'])
    await until(() => requests === 1) // batch 1 is on the wire; its session is spent

    const second = t.call('echo', ['second'])
    await new Promise((r) => setTimeout(r, 5))
    release()

    expect(await first).toBe('first')
    expect(await second).toBe('second')
    expect(requests).toBe(2)
  })

  it('serves calls made in two separate ticks', async () => {
    const t = make()
    const a = t.call('echo', ['a'])
    await new Promise((r) => setTimeout(r, 0))
    const b = t.call('echo', ['b'])
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
  })

  it('still sends calls made in the same tick as one batch', async () => {
    const t = make()
    const results = await Promise.all([t.call('echo', [1]), t.call('echo', [2]), t.call('echo', [3])])
    expect(results).toEqual([1, 2, 3])
    expect(requests).toBe(1)
  })
})

describe('RPC() over http()', () => {
  it('sends calls made together through the RPC proxy as one batch', async () => {
    const { RPC } = await import('../src/index')
    const rpc = RPC(http('https://api.example.com/rpc')) as unknown as {
      echo(v: unknown): Promise<unknown>
    }
    const results = await Promise.all([rpc.echo('a'), rpc.echo('b')])
    expect(results).toEqual(['a', 'b'])
    expect(requests).toBe(1)
  })

  it('batches calls issued across microtasks of one tick, and starts a new batch once one has left', async () => {
    const t = http('https://api.example.com/rpc')
    const a = t.call('echo', ['a'])
    await Promise.resolve()
    await Promise.resolve()
    const b = t.call('echo', ['b'])
    expect(await Promise.all([a, b])).toEqual(['a', 'b'])
    expect(requests).toBe(1)

    const c = t.call('echo', ['c'])
    await until(() => requests === 2) // c's batch has left
    const d = t.call('echo', ['d'])
    expect(await Promise.all([c, d])).toEqual(['c', 'd'])
    expect(requests).toBe(3)
  })
})
