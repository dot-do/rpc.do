/**
 * events.workers.do - Event Ingestion Worker
 *
 * Receives events from DurableRPC instances via Snippets/fetch
 * Streams to R2 for lakehouse queries, optional real-time via Queues
 *
 * Architecture:
 * ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
 * │ DurableRPC  │────▶│ events.workers.do │────▶│ R2 Bucket   │
 * │   (DOs)     │     │   (this worker)   │     │ (lakehouse) │
 * └─────────────┘     └────────┬─────────┘     └─────────────┘
 *                              │
 *                              ▼
 *                     ┌───────────────┐
 *                     │ Queue (opt.)  │──▶ Real-time consumers
 *                     └───────────────┘
 *
 * Query with DuckDB:
 *   SELECT * FROM read_json_auto('r2://events/2024/**/*.jsonl')
 *   WHERE type = 'rpc.call' AND do.colo = 'SJC'
 */

interface Env {
  EVENTS_BUCKET: R2Bucket
  EVENTS_QUEUE?: Queue<EventBatch>  // Optional real-time streaming
  AUTH_TOKEN?: string               // Optional auth
}

interface DurableEvent {
  type: string
  ts: string
  do: {
    id: string
    name?: string
    class?: string
    colo?: string
    worker?: string
  }
  [key: string]: unknown
}

interface EventBatch {
  events: DurableEvent[]
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', ts: new Date().toISOString() })
    }

    // Ingest endpoint
    if (url.pathname === '/ingest' && request.method === 'POST') {
      return handleIngest(request, env)
    }

    // Query endpoint (generates DuckDB SQL)
    if (url.pathname === '/query' && request.method === 'POST') {
      return handleQuery(request, env)
    }

    // List recent events (for debugging)
    if (url.pathname === '/recent') {
      return handleRecent(request, env)
    }

    return new Response('Not found', { status: 404 })
  },
}

// ============================================================================
// Ingest Handler
// ============================================================================

async function handleIngest(request: Request, env: Env): Promise<Response> {
  // Optional auth
  if (env.AUTH_TOKEN) {
    const auth = request.headers.get('Authorization')
    if (auth !== `Bearer ${env.AUTH_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  let batch: EventBatch
  try {
    batch = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!batch.events || !Array.isArray(batch.events)) {
    return Response.json({ error: 'Missing events array' }, { status: 400 })
  }

  // Group events by hour bucket for efficient R2 organization
  const buckets = groupByTimeBucket(batch.events)

  // Write to R2 (parallel)
  const writes = Object.entries(buckets).map(async ([bucket, events]) => {
    const key = `events/${bucket}/${crypto.randomUUID()}.jsonl`
    const body = events.map(e => JSON.stringify(e)).join('\n')

    await env.EVENTS_BUCKET.put(key, body, {
      httpMetadata: { contentType: 'application/x-ndjson' },
      customMetadata: {
        eventCount: String(events.length),
        firstTs: events[0].ts,
        lastTs: events[events.length - 1].ts,
      },
    })

    return { key, count: events.length }
  })

  const results = await Promise.all(writes)

  // Optionally send to Queue for real-time consumers
  if (env.EVENTS_QUEUE) {
    await env.EVENTS_QUEUE.send(batch)
  }

  return Response.json({
    ok: true,
    received: batch.events.length,
    written: results,
  })
}

/**
 * Group events by time bucket (YYYY/MM/DD/HH)
 */
function groupByTimeBucket(events: DurableEvent[]): Record<string, DurableEvent[]> {
  const buckets: Record<string, DurableEvent[]> = {}

  for (const event of events) {
    const date = new Date(event.ts)
    const bucket = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
      String(date.getUTCHours()).padStart(2, '0'),
    ].join('/')

    if (!buckets[bucket]) {
      buckets[bucket] = []
    }
    buckets[bucket].push(event)
  }

  return buckets
}

// ============================================================================
// Query Helper
// ============================================================================

interface QueryRequest {
  dateRange?: { start: string; end: string }
  doId?: string
  doClass?: string
  eventTypes?: string[]
  collection?: string
  colo?: string
  limit?: number
}

async function handleQuery(request: Request, env: Env): Promise<Response> {
  const query: QueryRequest = await request.json()

  // Build DuckDB query
  const sql = buildDuckDBQuery(query)

  return Response.json({ sql })
}

function buildDuckDBQuery(query: QueryRequest): string {
  const conditions: string[] = []
  let pathPattern = 'events/'

  // Optimize path based on date range
  if (query.dateRange) {
    const start = new Date(query.dateRange.start)
    const end = new Date(query.dateRange.end)

    // If same year/month/day, narrow the path
    if (start.getFullYear() === end.getFullYear()) {
      pathPattern += `${start.getFullYear()}/`
      if (start.getMonth() === end.getMonth()) {
        pathPattern += `${String(start.getMonth() + 1).padStart(2, '0')}/`
        if (start.getDate() === end.getDate()) {
          pathPattern += `${String(start.getDate()).padStart(2, '0')}/`
        } else {
          pathPattern += '*/'
        }
      } else {
        pathPattern += '*/'
      }
    } else {
      pathPattern += '*/'
    }
  } else {
    pathPattern += '**/'
  }
  pathPattern += '*.jsonl'

  // Build conditions
  if (query.doId) {
    conditions.push(`"do".id = '${query.doId}'`)
  }
  if (query.doClass) {
    conditions.push(`"do".class = '${query.doClass}'`)
  }
  if (query.colo) {
    conditions.push(`"do".colo = '${query.colo}'`)
  }
  if (query.eventTypes?.length) {
    conditions.push(`type IN (${query.eventTypes.map(t => `'${t}'`).join(', ')})`)
  }
  if (query.collection) {
    conditions.push(`collection = '${query.collection}'`)
  }
  if (query.dateRange) {
    conditions.push(`ts >= '${query.dateRange.start}'`)
    conditions.push(`ts <= '${query.dateRange.end}'`)
  }

  let sql = `SELECT *
FROM read_json_auto('${pathPattern}',
  filename=true,
  hive_partitioning=false
)`

  if (conditions.length > 0) {
    sql += `\nWHERE ${conditions.join('\n  AND ')}`
  }

  sql += `\nORDER BY ts DESC`

  if (query.limit) {
    sql += `\nLIMIT ${query.limit}`
  }

  return sql
}

// ============================================================================
// Debug: Recent Events
// ============================================================================

async function handleRecent(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const limit = parseInt(url.searchParams.get('limit') ?? '100')

  // List recent files
  const now = new Date()
  const hourPath = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
  ].join('/')

  const listed = await env.EVENTS_BUCKET.list({
    prefix: `events/${hourPath}/`,
    limit: 10,
  })

  const events: DurableEvent[] = []

  for (const obj of listed.objects) {
    const data = await env.EVENTS_BUCKET.get(obj.key)
    if (data) {
      const text = await data.text()
      const lines = text.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          events.push(JSON.parse(line))
        } catch {
          // Skip malformed lines
        }
      }
    }
    if (events.length >= limit) break
  }

  return Response.json({
    events: events.slice(0, limit),
    count: events.length,
    bucket: hourPath,
  })
}

// ============================================================================
// Queue Consumer (for real-time)
// ============================================================================

export const queue = {
  async queue(batch: MessageBatch<EventBatch>, env: Env): Promise<void> {
    // Process real-time events here
    // Could forward to:
    // - WebSocket connections
    // - Analytics service
    // - Alert system
    // - etc.

    for (const message of batch.messages) {
      const { events } = message.body

      // Example: Log high-latency RPC calls
      for (const event of events) {
        if (event.type === 'rpc.call' && (event as any).durationMs > 1000) {
          console.warn(`Slow RPC: ${(event as any).method} took ${(event as any).durationMs}ms`, event.do)
        }
      }

      message.ack()
    }
  },
}
