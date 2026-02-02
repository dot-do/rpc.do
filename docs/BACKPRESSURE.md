# WebSocket Backpressure Guide

This guide explains how to handle backpressure in WebSocket connections using the `ReconnectingWebSocketTransport` from rpc.do.

## Table of Contents

- [What is Backpressure?](#what-is-backpressure)
- [The QueueFullBehavior Option](#the-queuefullbehavior-option)
- [Behavior Comparison](#behavior-comparison)
- [Code Examples](#code-examples)
- [Monitoring Queue Depth](#monitoring-queue-depth)
- [Best Practices](#best-practices)

## What is Backpressure?

Backpressure occurs when messages are produced faster than they can be consumed. In WebSocket connections, this typically happens when:

- **Network is slow**: Messages queue up waiting to be sent
- **Server is overloaded**: Responses cannot be processed fast enough
- **Temporary disconnections**: Messages accumulate while reconnecting
- **Burst traffic**: Sudden spikes in message volume

Without proper backpressure handling, unbounded queues can lead to:

- Memory exhaustion (OOM crashes)
- Stale data being processed
- Unpredictable latency
- Lost messages without notification

The `ReconnectingWebSocketTransport` provides three configurable behaviors to handle queue overflow, giving you control over the trade-offs between data integrity, memory safety, and error handling.

## The QueueFullBehavior Option

The `queueFullBehavior` option determines what happens when either the send or receive message queue reaches `maxQueueSize` (default: 1000 messages).

### `'error'` (Default)

Throws a `ConnectionError` with code `'QUEUE_FULL'` when the queue is full.

**When to use:**

- Data integrity is critical (financial transactions, audit logs)
- You need explicit notification of backpressure
- You have upstream flow control mechanisms
- You want to fail fast and let the caller decide

**Example scenarios:**

- Payment processing systems
- Order management systems
- Audit trail logging
- Distributed transactions

### `'drop-oldest'`

Removes the oldest message from the queue to make room for new messages.

**When to use:**

- Latest data is more important than historical data
- Real-time dashboards and monitoring
- Live feeds where stale data has no value
- Streaming updates where only current state matters

**Example scenarios:**

- Stock ticker feeds
- Live sensor data
- Real-time collaboration cursors
- Game state synchronization

### `'drop-newest'`

Discards the incoming message, keeping the existing queue intact.

**When to use:**

- First-in messages are more important
- Processing order must be preserved
- You want to rate-limit at the source
- Duplicate/redundant messages are acceptable to drop

**Example scenarios:**

- Command queues where order matters
- Sequential processing pipelines
- Idempotent operations with retries
- Event sourcing where early events are critical

## Behavior Comparison

| Behavior | Memory Safe | Data Loss | Error Notification | Processing Order | Best For |
|----------|------------|-----------|-------------------|------------------|----------|
| `'error'` | Yes | No* | Yes (throws) | Preserved | Critical data, explicit flow control |
| `'drop-oldest'` | Yes | Yes (old) | No (silent) | Oldest dropped | Real-time feeds, latest-wins scenarios |
| `'drop-newest'` | Yes | Yes (new) | No (silent) | Preserved | Ordered queues, rate limiting |

*The `'error'` behavior prevents data loss by failing the operation, allowing the caller to handle it appropriately.

### Trade-offs Summary

```
                    Data Integrity
                         ^
                         |
           'error' ------+------ Most Integrity
                         |
                         |
          'drop-newest' -+------ Medium (preserves order)
                         |
                         |
          'drop-oldest' -+------ Least (favors freshness)
                         |
                         +----------------> Throughput
```

## Code Examples

### Using 'error' Behavior (Default)

```typescript
import { reconnectingWs, ConnectionError } from 'rpc.do'

const transport = reconnectingWs('wss://api.example.com/rpc', {
  maxQueueSize: 100,
  queueFullBehavior: 'error', // This is the default
})

// Handle queue full errors explicitly
async function sendWithBackpressure(message: string) {
  try {
    await transport.send(message)
  } catch (error) {
    if (error instanceof ConnectionError && error.code === 'QUEUE_FULL') {
      // Implement your backpressure strategy:
      console.warn('Queue is full, backing off...')

      // Option 1: Exponential backoff
      await delay(calculateBackoff())
      return sendWithBackpressure(message)

      // Option 2: Drop and log
      // logger.warn('Dropped message due to backpressure', { message })

      // Option 3: Persist to disk/database for later
      // await persistQueue.add(message)
    }
    throw error
  }
}
```

### Using 'drop-oldest' for Real-Time Feeds

```typescript
import { reconnectingWs } from 'rpc.do'

// Real-time stock ticker - only latest prices matter
const transport = reconnectingWs('wss://api.example.com/feed', {
  maxQueueSize: 50,
  queueFullBehavior: 'drop-oldest',

  onConnect: () => console.log('Connected to feed'),
  onError: (error) => console.error('Feed error:', error),
})

// Subscribe to price updates
const { api } = await createRpcSession<FeedAPI>('wss://api.example.com/feed', {
  maxQueueSize: 50,
  queueFullBehavior: 'drop-oldest',
})

// Old prices are automatically dropped if we can't process fast enough
api.subscribePrices(['AAPL', 'GOOGL', 'MSFT'])
```

### Using 'drop-newest' for Rate Limiting

```typescript
import { reconnectingWs } from 'rpc.do'

// Command queue where order matters
const transport = reconnectingWs('wss://api.example.com/commands', {
  maxQueueSize: 1000,
  queueFullBehavior: 'drop-newest',
})

// If queue is full, new commands are dropped (rate limited)
// Existing queued commands maintain their order
async function sendCommand(cmd: Command) {
  // The transport will silently drop if queue is full
  // For commands that MUST succeed, check queue depth first:
  const { send, maxSize } = transport.getQueueDepth()

  if (send >= maxSize) {
    throw new Error('Command queue full - try again later')
  }

  await transport.send(JSON.stringify(cmd))
}
```

### Combining with Custom Flow Control

```typescript
import { reconnectingWs } from 'rpc.do'

const transport = reconnectingWs('wss://api.example.com/rpc', {
  maxQueueSize: 500,
  queueFullBehavior: 'error',
})

class FlowController {
  private paused = false
  private pendingMessages: string[] = []

  async send(message: string) {
    if (this.paused) {
      this.pendingMessages.push(message)
      return
    }

    const depth = transport.getQueueDepth()

    // Pause if queue is getting full
    if (depth.send > depth.maxSize * 0.8) {
      this.paused = true
      console.warn('Flow control: pausing sends')
      this.scheduleDrain()
    }

    try {
      await transport.send(message)
    } catch (error) {
      if (error instanceof ConnectionError && error.code === 'QUEUE_FULL') {
        this.pendingMessages.push(message)
        this.paused = true
        this.scheduleDrain()
      } else {
        throw error
      }
    }
  }

  private scheduleDrain() {
    setTimeout(() => this.tryDrain(), 1000)
  }

  private async tryDrain() {
    const depth = transport.getQueueDepth()

    if (depth.send < depth.maxSize * 0.5) {
      this.paused = false

      // Flush pending messages
      while (this.pendingMessages.length > 0 && !this.paused) {
        const msg = this.pendingMessages.shift()!
        await this.send(msg)
      }
    } else {
      this.scheduleDrain()
    }
  }
}
```

## Monitoring Queue Depth

The `getQueueDepth()` method returns real-time information about queue utilization:

```typescript
const transport = reconnectingWs('wss://api.example.com/rpc', {
  maxQueueSize: 1000,
  queueFullBehavior: 'drop-oldest',
})

// Get current queue state
const depth = transport.getQueueDepth()
console.log(`Send queue: ${depth.send}/${depth.maxSize}`)
console.log(`Receive queue: ${depth.receive}/${depth.maxSize}`)
```

### Setting Up Monitoring

```typescript
// Periodic monitoring
setInterval(() => {
  const { send, receive, maxSize } = transport.getQueueDepth()

  // Log metrics (e.g., to Prometheus, DataDog, etc.)
  metrics.gauge('ws.queue.send', send)
  metrics.gauge('ws.queue.receive', receive)
  metrics.gauge('ws.queue.utilization', Math.max(send, receive) / maxSize)

  // Alert on high utilization
  const utilization = Math.max(send, receive) / maxSize
  if (utilization > 0.9) {
    alerting.warn('WebSocket queue near capacity', { send, receive, maxSize })
  }
}, 5000)
```

### Implementing Backpressure Signals

```typescript
// Use queue depth to implement backpressure signals
function getBackpressureLevel(): 'none' | 'moderate' | 'severe' {
  const { send, receive, maxSize } = transport.getQueueDepth()
  const utilization = Math.max(send, receive) / maxSize

  if (utilization > 0.9) return 'severe'
  if (utilization > 0.7) return 'moderate'
  return 'none'
}

// Adjust behavior based on backpressure
async function handleRequest(data: unknown) {
  const level = getBackpressureLevel()

  switch (level) {
    case 'severe':
      // Reject new requests
      throw new Error('Service temporarily unavailable')

    case 'moderate':
      // Add delay to slow down
      await delay(100)
      break

    case 'none':
      // Process normally
      break
  }

  return processData(data)
}
```

## Best Practices

### 1. Choose the Right Behavior for Your Use Case

```typescript
// Critical data - use 'error' and handle explicitly
const criticalTransport = reconnectingWs(url, {
  queueFullBehavior: 'error',
  maxQueueSize: 1000,
})

// Real-time feeds - use 'drop-oldest'
const realtimeTransport = reconnectingWs(url, {
  queueFullBehavior: 'drop-oldest',
  maxQueueSize: 100, // Smaller queue for freshness
})

// Rate-limited commands - use 'drop-newest'
const commandTransport = reconnectingWs(url, {
  queueFullBehavior: 'drop-newest',
  maxQueueSize: 500,
})
```

### 2. Size Your Queues Appropriately

```typescript
// Consider:
// - Expected message rate
// - Typical disconnection duration
// - Memory constraints
// - Acceptable latency

// High-frequency, low-latency: smaller queue
const lowLatencyTransport = reconnectingWs(url, {
  maxQueueSize: 100,
  queueFullBehavior: 'drop-oldest',
})

// Batch processing, reliability: larger queue
const batchTransport = reconnectingWs(url, {
  maxQueueSize: 10000,
  queueFullBehavior: 'error',
})
```

### 3. Monitor and Alert

```typescript
// Always monitor queue depth in production
function setupMonitoring(transport: ReconnectingWebSocketTransport) {
  const WARNING_THRESHOLD = 0.7
  const CRITICAL_THRESHOLD = 0.9

  setInterval(() => {
    const { send, receive, maxSize } = transport.getQueueDepth()
    const utilization = Math.max(send, receive) / maxSize

    if (utilization > CRITICAL_THRESHOLD) {
      logger.error('Queue critically full', { send, receive, maxSize })
    } else if (utilization > WARNING_THRESHOLD) {
      logger.warn('Queue filling up', { send, receive, maxSize })
    }
  }, 1000)
}
```

### 4. Implement Graceful Degradation

```typescript
// Degrade gracefully under pressure
class GracefulClient {
  private transport: ReconnectingWebSocketTransport

  async sendWithGracefulDegradation(message: string, priority: 'high' | 'normal' | 'low') {
    const { send, maxSize } = this.transport.getQueueDepth()
    const utilization = send / maxSize

    // Drop low-priority messages under moderate load
    if (priority === 'low' && utilization > 0.5) {
      logger.debug('Dropping low-priority message due to load')
      return
    }

    // Drop normal-priority messages under high load
    if (priority === 'normal' && utilization > 0.8) {
      logger.info('Dropping normal-priority message due to high load')
      return
    }

    // High-priority messages always attempt to send
    await this.transport.send(message)
  }
}
```

### 5. Test Backpressure Scenarios

```typescript
// Test your backpressure handling
describe('backpressure handling', () => {
  it('should handle queue full gracefully', async () => {
    const transport = reconnectingWs('wss://test.example.com', {
      maxQueueSize: 10,
      queueFullBehavior: 'error',
    })

    // Fill the queue
    const promises = []
    for (let i = 0; i < 15; i++) {
      promises.push(
        transport.send(`message-${i}`).catch(e => e)
      )
    }

    const results = await Promise.all(promises)
    const errors = results.filter(r => r instanceof Error)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].code).toBe('QUEUE_FULL')
  })
})
```

## Related Documentation

- [API Reference](./API_REFERENCE.md) - Full API documentation
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
- [Getting Started](./GETTING_STARTED.md) - Quick start guide
