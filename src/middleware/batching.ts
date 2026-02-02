/**
 * Request batching transport wrapper for RPC client.
 *
 * Collects multiple RPC requests within a configurable time window and sends
 * them as a single batch request for improved efficiency.
 *
 * JSON-RPC batching sends an array of requests and receives an array of responses.
 * Each request/response is matched by an `id` field.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { withBatching } from 'rpc.do/middleware'
 * import { http } from 'rpc.do/transports'
 *
 * const transport = withBatching(http('https://api.example.com'), {
 *   windowMs: 10,    // Collect requests for 10ms
 *   maxBatchSize: 50 // Send batch when 50 requests accumulate
 * })
 *
 * const $ = RPC(transport)
 *
 * // These concurrent calls will be batched into a single HTTP request
 * const [users, posts, comments] = await Promise.all([
 *   $.users.list(),
 *   $.posts.recent(),
 *   $.comments.count()
 * ])
 * ```
 */

/**
 * Options for request batching
 */
export interface BatchingOptions {
  /**
   * Time window in milliseconds to collect requests before sending batch.
   * Requests made within this window will be grouped together.
   * @default 10
   */
  windowMs?: number

  /**
   * Maximum number of requests to include in a single batch.
   * When this limit is reached, the batch is sent immediately.
   * @default 100
   */
  maxBatchSize?: number

  /**
   * Callback when a batch is about to be sent.
   * Useful for logging and debugging.
   */
  onBatch?: (requests: BatchedRequest[]) => void
}

/**
 * Represents a single request in a batch
 */
export interface BatchedRequest {
  /** Unique identifier for matching response to request */
  id: number
  /** RPC method name (e.g., "users.list") */
  method: string
  /** Arguments passed to the method */
  args: unknown[]
}

/**
 * Represents a single response in a batch
 */
export interface BatchedResponse {
  /** Matches the request id */
  id: number
  /** Result if successful */
  result?: unknown
  /** Error if failed */
  error?: { message: string; code?: string | number; data?: unknown }
}

/**
 * Internal pending request with resolver/rejector
 */
interface PendingRequest {
  id: number
  method: string
  args: unknown[]
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * Create a batching transport wrapper
 *
 * This wraps a transport to batch multiple RPC requests into a single call.
 * Requests are collected within a time window and sent together, improving
 * efficiency for high-throughput scenarios.
 *
 * The underlying transport's `call` method is invoked with a special
 * `__batch` method name and an array of request objects. The transport
 * should return an array of response objects.
 *
 * @param transport - The transport to wrap
 * @param options - Batching configuration options
 * @returns A new transport with batching support
 *
 * @example
 * ```typescript
 * import { http } from 'rpc.do/transports'
 * import { withBatching } from 'rpc.do/middleware'
 *
 * const transport = withBatching(http('https://api.example.com'), {
 *   windowMs: 10,
 *   maxBatchSize: 50
 * })
 *
 * const $ = RPC(transport)
 *
 * // Multiple concurrent requests get batched
 * await Promise.all([
 *   $.users.get('1'),
 *   $.users.get('2'),
 *   $.users.get('3')
 * ])
 * ```
 */
export function withBatching(
  transport: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void },
  options: BatchingOptions = {}
): { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } {
  const { windowMs = 10, maxBatchSize = 100, onBatch } = options

  // State for collecting requests
  let pendingRequests: PendingRequest[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let requestIdCounter = 0

  /**
   * Flush the current batch of requests
   */
  async function flushBatch(): Promise<void> {
    // Clear the timer
    if (batchTimer !== null) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    // Get current batch and reset
    const batch = pendingRequests
    pendingRequests = []

    if (batch.length === 0) {
      return
    }

    // Prepare batch request
    const batchRequest: BatchedRequest[] = batch.map((req) => ({
      id: req.id,
      method: req.method,
      args: req.args,
    }))

    // Call onBatch callback if provided
    if (onBatch) {
      onBatch(batchRequest)
    }

    try {
      // Send batch request to transport
      // Use special __batch method to signal batch mode
      const responses = (await transport.call('__batch', [batchRequest])) as BatchedResponse[]

      // Create a map of responses by id for efficient lookup
      const responseMap = new Map<number, BatchedResponse>()
      for (const response of responses) {
        responseMap.set(response.id, response)
      }

      // Resolve/reject each pending request
      for (const request of batch) {
        const response = responseMap.get(request.id)

        if (!response) {
          // No matching response - reject with error
          request.reject(new Error(`No response received for request ${request.id}`))
        } else if (response.error) {
          // Error response - reject with error
          const error = new Error(response.error.message)
          if (response.error.code !== undefined) {
            (error as Error & { code?: string | number }).code = response.error.code
          }
          if (response.error.data !== undefined) {
            (error as Error & { data?: unknown }).data = response.error.data
          }
          request.reject(error)
        } else {
          // Success - resolve with result
          request.resolve(response.result)
        }
      }
    } catch (error) {
      // Transport-level error - reject all pending requests
      for (const request of batch) {
        request.reject(error)
      }
    }
  }

  /**
   * Schedule a batch flush after the window timeout
   */
  function scheduleBatchFlush(): void {
    if (batchTimer === null) {
      batchTimer = setTimeout(() => {
        void flushBatch()
      }, windowMs)
    }
  }

  const wrapped: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } = {
    call(method: string, args: unknown[]): Promise<unknown> {
      return new Promise((resolve, reject) => {
        // Assign unique ID and add to pending batch
        const id = ++requestIdCounter

        pendingRequests.push({
          id,
          method,
          args,
          resolve,
          reject,
        })

        // Check if we've hit max batch size
        if (pendingRequests.length >= maxBatchSize) {
          void flushBatch()
        } else {
          // Schedule flush after window
          scheduleBatchFlush()
        }
      })
    },
  }

  // Add close method that flushes pending requests first
  wrapped.close = () => {
    // Flush any pending requests
    if (pendingRequests.length > 0) {
      void flushBatch()
    }

    // Call underlying transport close
    transport.close?.()
  }

  return wrapped
}

/**
 * Create a debounced batching transport wrapper
 *
 * Unlike `withBatching`, this variant resets the timer on each new request,
 * waiting for a period of inactivity before flushing. This is useful when
 * you want to wait for all requests in a "burst" to complete.
 *
 * @param transport - The transport to wrap
 * @param options - Batching configuration options
 * @returns A new transport with debounced batching support
 *
 * @example
 * ```typescript
 * import { http } from 'rpc.do/transports'
 * import { withDebouncedBatching } from 'rpc.do/middleware'
 *
 * // Wait until 20ms of inactivity before sending batch
 * const transport = withDebouncedBatching(http('https://api.example.com'), {
 *   windowMs: 20,
 * })
 * ```
 */
export function withDebouncedBatching(
  transport: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void },
  options: BatchingOptions = {}
): { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } {
  const { windowMs = 10, maxBatchSize = 100, onBatch } = options

  // State for collecting requests
  let pendingRequests: PendingRequest[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let requestIdCounter = 0

  /**
   * Flush the current batch of requests
   */
  async function flushBatch(): Promise<void> {
    // Clear the timer
    if (batchTimer !== null) {
      clearTimeout(batchTimer)
      batchTimer = null
    }

    // Get current batch and reset
    const batch = pendingRequests
    pendingRequests = []

    if (batch.length === 0) {
      return
    }

    // Prepare batch request
    const batchRequest: BatchedRequest[] = batch.map((req) => ({
      id: req.id,
      method: req.method,
      args: req.args,
    }))

    // Call onBatch callback if provided
    if (onBatch) {
      onBatch(batchRequest)
    }

    try {
      // Send batch request to transport
      const responses = (await transport.call('__batch', [batchRequest])) as BatchedResponse[]

      // Create a map of responses by id for efficient lookup
      const responseMap = new Map<number, BatchedResponse>()
      for (const response of responses) {
        responseMap.set(response.id, response)
      }

      // Resolve/reject each pending request
      for (const request of batch) {
        const response = responseMap.get(request.id)

        if (!response) {
          request.reject(new Error(`No response received for request ${request.id}`))
        } else if (response.error) {
          const error = new Error(response.error.message)
          if (response.error.code !== undefined) {
            (error as Error & { code?: string | number }).code = response.error.code
          }
          if (response.error.data !== undefined) {
            (error as Error & { data?: unknown }).data = response.error.data
          }
          request.reject(error)
        } else {
          request.resolve(response.result)
        }
      }
    } catch (error) {
      for (const request of batch) {
        request.reject(error)
      }
    }
  }

  /**
   * Reset and schedule a batch flush (debounced behavior)
   */
  function resetBatchTimer(): void {
    if (batchTimer !== null) {
      clearTimeout(batchTimer)
    }
    batchTimer = setTimeout(() => {
      void flushBatch()
    }, windowMs)
  }

  const wrapped: { call: (method: string, args: unknown[]) => Promise<unknown>; close?: () => void } = {
    call(method: string, args: unknown[]): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = ++requestIdCounter

        pendingRequests.push({
          id,
          method,
          args,
          resolve,
          reject,
        })

        // Check if we've hit max batch size
        if (pendingRequests.length >= maxBatchSize) {
          void flushBatch()
        } else {
          // Reset timer (debounce behavior)
          resetBatchTimer()
        }
      })
    },
  }

  wrapped.close = () => {
    if (pendingRequests.length > 0) {
      void flushBatch()
    }
    transport.close?.()
  }

  return wrapped
}

export default withBatching
