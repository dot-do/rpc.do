/**
 * batchSession - one capnweb HTTP batch, with the session stub itself
 *
 * `http()` and `capnweb()` expose rpc.do's `Transport.call(method, args)`, which awaits each
 * call, so the result of one call cannot be passed into the next without a round trip.
 * `batchSession()` hands back capnweb's pipelining stub for exactly one HTTP batch instead:
 * every call made on `remote` before the batch is sent goes out as ONE request, and an
 * unresolved result (`a.$id`) can be passed into a later call of the same batch.
 *
 * Compared with capnweb's own `newHttpBatchRpcSession()`, it adds:
 * - `fetch`: send through a service binding or Durable Object stub instead of global fetch;
 * - `headers`: e.g. `Authorization`;
 * - `flush()`: send now instead of at the next macrotask, `sent`, and `abort()`.
 *
 * @example
 * ```typescript
 * import { batchSession } from 'rpc.do/transports'
 *
 * const batch = await batchSession<Api>('https://api.example.com/rpc', {
 *   headers: { Authorization: `Bearer ${token}` },
 * })
 * const user = batch.remote.users.create({ name: 'Ada' })       // not awaited
 * const post = batch.remote.posts.create({ author: user.id })    // pipelined into the same batch
 * console.log(await post)                                        // one HTTP request for both
 * ```
 */

import type { RpcTransport, RpcSessionOptions } from 'capnweb'
import { loadCapnweb } from '../capnweb-loader.js'

/** A fetch-compatible function: global fetch, a service binding's fetch, or a DO stub's fetch */
export type BatchFetch = (url: string, init: RequestInit) => Promise<Response>

export interface BatchSessionOptions {
  /** Defaults to global fetch */
  fetch?: BatchFetch
  /** Headers sent with the batch request */
  headers?: Record<string, string>
  /** Passed to capnweb's RpcSession (e.g. `limits`) */
  sessionOptions?: RpcSessionOptions
}

export interface BatchSession<T = unknown> {
  /** capnweb's pipelining stub for this batch */
  readonly remote: T
  /** True once the batch request has left */
  readonly sent: boolean
  /**
   * Send the batch now rather than at the next macrotask. capnweb requests a call's result only
   * once that promise is `.then()`ed (or awaited), so take the results you want first: one that
   * nothing has awaited by the time the batch leaves rejects with "Batch RPC request ended."
   */
  flush(): void
  /** Fail the batch: if it has not been sent, it never is, and every call rejects with `reason` */
  abort(reason?: unknown): void
  [Symbol.dispose](): void
}

const macrotask: () => Promise<void> =
  typeof setImmediate === 'function'
    ? () => new Promise((resolve) => setImmediate(resolve))
    : () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Client side of one HTTP batch. Same contract as capnweb's internal BatchClientTransport
 * (collect until a macrotask, send once, then replay the response lines), plus a flush kick.
 */
class BatchClientTransport implements RpcTransport {
  #out: string[] | null = []
  #in: string[] | null = null
  #aborted: unknown = undefined
  #kick!: () => void
  readonly #ready: Promise<void>

  constructor(sendBatch: (lines: string[]) => Promise<string[]>) {
    const kicked = new Promise<void>((resolve) => { this.#kick = resolve })
    this.#ready = (async () => {
      await Promise.race([macrotask(), kicked])
      const lines = this.#out ?? []
      this.#out = null
      if (this.#aborted !== undefined) throw this.#aborted
      this.#in = await sendBatch(lines)
    })()
    this.#ready.catch(() => {})
  }

  get sent(): boolean {
    return this.#out === null
  }

  flush(): void {
    this.#kick()
  }

  send(message: string): void {
    // After the batch has left, drop the message; receive() then ends the session.
    this.#out?.push(message)
  }

  async receive(): Promise<string> {
    if (!this.#in) await this.#ready
    const message = this.#in?.shift()
    if (message !== undefined) return message
    throw new Error('Batch RPC request ended.')
  }

  abort(reason: unknown): void {
    if (this.#aborted === undefined) this.#aborted = reason ?? new Error('Batch aborted')
    this.#kick()
  }
}

/**
 * Open one capnweb HTTP batch against `url`. See the module docs.
 */
export async function batchSession<T = unknown>(
  url: string,
  options: BatchSessionOptions = {}
): Promise<BatchSession<T>> {
  const { RpcSession } = await loadCapnweb()
  const doFetch: BatchFetch = options.fetch ?? ((u, init) => fetch(u, init))

  const transport = new BatchClientTransport(async (lines) => {
    const init: RequestInit = { method: 'POST', body: lines.join('\n') }
    if (options.headers) init.headers = options.headers
    const response = await doFetch(url, init)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`)
    }
    const body = await response.text()
    return body === '' ? [] : body.split('\n')
  })

  const session = new RpcSession(transport, undefined, options.sessionOptions)
  const remote = session.getRemoteMain() as T & Partial<Disposable>

  return {
    remote,
    get sent() {
      return transport.sent
    },
    flush: () => transport.flush(),
    abort: (reason?: unknown) => transport.abort(reason),
    [Symbol.dispose]: () => remote[Symbol.dispose]?.(),
  }
}
