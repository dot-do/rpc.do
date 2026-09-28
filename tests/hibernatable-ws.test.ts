/**
 * HibernatableWebSocketTransport / TransportRegistry, carried in rpc.do
 *
 * These two classes were the only runtime addition the @dotdo/capnweb fork made over upstream
 * capnweb. rpc.do now depends on upstream `capnweb` and carries them itself, as two identical
 * copies (core/src for @dotdo/rpc, src for rpc.do/server). This file:
 *
 * - fails if the two copies drift;
 * - ports the fork's transport-in-isolation and registry tests
 *   (dot-do/capnweb __tests__/hibernation.test.ts) to Node, with a fake socket;
 * - runs a real upstream capnweb RpcSession over the transport, which is the check that the
 *   transport still satisfies upstream's RpcTransport contract.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RpcSession, RpcTarget } from 'capnweb'
import * as rpcDoCopy from '../src/hibernatable-ws'
import * as server from '../src/server'
import * as coreCopy from '../core/src/hibernatable-ws'

const { HibernatableWebSocketTransport, TransportRegistry } = rpcDoCopy

/** A stand-in for a hibernatable server-side WebSocket: records sends and closes. */
class FakeSocket {
  sent: string[] = []
  closed: { code: number; reason: string } | null = null
  onSend: ((message: string) => void) | null = null
  throwOnSend: Error | null = null

  send(message: string): void {
    if (this.throwOnSend) throw this.throwOnSend
    this.sent.push(message)
    this.onSend?.(message)
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }
}

function transportOn(socket: FakeSocket, id?: string): rpcDoCopy.HibernatableWebSocketTransport {
  return new HibernatableWebSocketTransport(socket as unknown as WebSocket, id)
}

describe('the two copies', () => {
  it('core/src/hibernatable-ws.ts and src/hibernatable-ws.ts are byte-identical', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const read = (p: string) => readFileSync(join(root, p), 'utf8')
    expect(read('src/hibernatable-ws.ts')).toBe(read('core/src/hibernatable-ws.ts'))
  })

  it('rpc.do/server re-exports the rpc.do copy', () => {
    expect(server.HibernatableWebSocketTransport).toBe(HibernatableWebSocketTransport)
    expect(server.TransportRegistry).toBe(TransportRegistry)
  })
})

// The behavioural tests run against both copies (rpc.do/server and @dotdo/rpc).
describe.each([
  ['rpc.do (src)', rpcDoCopy],
  // The classes are identical but declare private fields, so TypeScript treats them as nominal.
  ['@dotdo/rpc (core/src)', coreCopy as unknown as typeof rpcDoCopy],
] as const)('%s copy', (_name, mod) => {
  const transportOn = (socket: FakeSocket, id?: string) =>
    new mod.HibernatableWebSocketTransport(socket as unknown as WebSocket, id)
  const TransportRegistry = mod.TransportRegistry

  describe('the transport in isolation', () => {
    it('uses the given id, or mints one', () => {
      expect(transportOn(new FakeSocket(), 'fixed').id).toBe('fixed')
      const a = transportOn(new FakeSocket())
      const b = transportOn(new FakeSocket())
      expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(a.id).not.toBe(b.id)
    })

    it('delivers an enqueued message to a pending receive()', async () => {
      const transport = transportOn(new FakeSocket())
      const received = transport.receive()
      transport.enqueueMessage('hello')
      expect(await received).toBe('hello')
    })

    it('queues a message that arrives before receive() is called', async () => {
      const transport = transportOn(new FakeSocket())
      transport.enqueueMessage('first')
      transport.enqueueMessage('second')
      expect(await transport.receive()).toBe('first')
      expect(await transport.receive()).toBe('second')
    })

    it('rejects a pending receive() when the socket closes, and stays closed', async () => {
      const transport = transportOn(new FakeSocket())
      const received = transport.receive()
      transport.handleClose(1001, 'going away')
      await expect(received).rejects.toThrow(/1001 going away/)
      expect(transport.isClosed).toBe(true)
      // A message arriving after close is dropped rather than queued for a future receive().
      transport.enqueueMessage('too late')
      await expect(transport.receive()).rejects.toThrow(/1001 going away/)
      await expect(transport.send('x')).rejects.toThrow(/1001 going away/)
    })

    it('sends through the socket, and a failing send closes the transport', async () => {
      const socket = new FakeSocket()
      const transport = transportOn(socket)
      await transport.send('one')
      expect(socket.sent).toEqual(['one'])

      socket.throwOnSend = new Error('socket gone')
      await expect(transport.send('two')).rejects.toThrow('socket gone')
      expect(transport.isClosed).toBe(true)
      await expect(transport.receive()).rejects.toThrow('socket gone')
    })

    it('abort() closes the socket with 1011 and a reason cut to 123 bytes', async () => {
      const socket = new FakeSocket()
      const transport = transportOn(socket)
      const pending = transport.receive()
      transport.abort('x'.repeat(500))
      await expect(pending).rejects.toThrow()
      expect(socket.closed?.code).toBe(1011)
      expect(socket.closed?.reason.length).toBe(123)
      expect(transport.getWebSocket()).toBe(socket)
    })

    it('abort() keeps an Error reason, and survives a socket that throws on close', async () => {
      const socket = new FakeSocket()
      socket.close = () => {
        throw new Error('already closed')
      }
      const transport = transportOn(socket)
      const pending = transport.receive()
      expect(() => transport.abort(new Error('session broke'))).not.toThrow()
      await expect(pending).rejects.toThrow('session broke')
      // A second close report after the abort is ignored.
      transport.handleClose(1000, 'late')
      await expect(transport.receive()).rejects.toThrow('session broke')
    })
  })

  describe('the registry', () => {
    it('registers, looks up, lists, removes and clears transports', () => {
      const registry = new TransportRegistry()
      const a = transportOn(new FakeSocket(), 'a')
      const b = transportOn(new FakeSocket(), 'b')
      registry.register(a)
      registry.register(b)
      expect(registry.size).toBe(2)
      expect(registry.get('a')).toBe(a)
      expect(registry.all()).toEqual([a, b])
      expect(registry.remove('a')).toBe(true)
      expect(registry.remove('a')).toBe(false)
      expect(registry.get('a')).toBeUndefined()
      registry.clear()
      expect(registry.size).toBe(0)
    })

    it("is per-instance memory: a new registry does not see the old registry's transports", () => {
      // A wake from hibernation constructs the Durable Object class again, so the woken instance
      // holds a new, empty registry. See the header note in src/hibernatable-ws.ts.
      const transport = transportOn(new FakeSocket())
      const before = new TransportRegistry()
      before.register(transport)
      expect(before.get(transport.id)).toBe(transport)
      const afterWake = new TransportRegistry()
      expect(afterWake.get(transport.id)).toBeUndefined()
      expect(afterWake.size).toBe(0)
    })
  })
})

describe('a live upstream capnweb session over the transport', () => {
  class Api extends RpcTarget {
    ping(): string {
      return 'pong'
    }
    add(a: number, b: number): number {
      return a + b
    }
  }

  it('answers RPC calls in both directions of a socket pair', async () => {
    const serverSocket = new FakeSocket()
    const clientSocket = new FakeSocket()
    const serverTransport = transportOn(serverSocket)
    const clientTransport = transportOn(clientSocket)
    // Wire the pair: what one end sends, the other end's webSocketMessage handler enqueues.
    serverSocket.onSend = (m) => clientTransport.enqueueMessage(m)
    clientSocket.onSend = (m) => serverTransport.enqueueMessage(m)

    const serverSession = new RpcSession(serverTransport, new Api())
    const clientSession = new RpcSession<Api>(clientTransport)
    const api = clientSession.getRemoteMain()

    expect(await api.ping()).toBe('pong')
    expect(await api.add(2, 3)).toBe(5)
    expect(serverSession.getStats().exports).toBeGreaterThanOrEqual(1)

    serverTransport.handleClose(1000, 'done')
    clientTransport.handleClose(1000, 'done')
  })
})
