# Observability Guide

This guide covers how to add comprehensive observability to your rpc.do applications, including distributed tracing, metrics collection, and structured logging. We focus on OpenTelemetry as the primary standard, with guidance for integrating with popular observability platforms.

---

## Table of Contents

- [Why Observability Matters for RPC](#why-observability-matters-for-rpc)
- [Tracing RPC Calls](#tracing-rpc-calls)
  - [Span Attributes](#span-attributes)
  - [OpenTelemetry Middleware Implementation](#opentelemetry-middleware-implementation)
- [Metrics to Track](#metrics-to-track)
  - [Latency Histogram](#latency-histogram)
  - [Error Rate](#error-rate)
  - [Throughput](#throughput)
  - [OpenTelemetry Metrics Middleware](#opentelemetry-metrics-middleware)
- [Custom Logging Middleware](#custom-logging-middleware)
  - [Structured Logging Example](#structured-logging-example)
  - [Log Levels and Sampling](#log-levels-and-sampling)
- [Integration with Popular Tools](#integration-with-popular-tools)
  - [Datadog](#datadog)
  - [Honeycomb](#honeycomb)
  - [Grafana Stack](#grafana-stack)
- [Best Practices](#best-practices)
- [Complete Example: Full Observability Stack](#complete-example-full-observability-stack)

---

## Why Observability Matters for RPC

Remote Procedure Calls introduce complexity that local function calls do not have:

1. **Network Latency**: RPC calls traverse network boundaries, introducing variable latency that can impact user experience and system performance.

2. **Partial Failures**: Unlike local calls, RPC can fail in ways that are invisible to either party (network partitions, timeouts, connection drops).

3. **Distributed State**: When RPC calls span multiple services or Durable Objects, understanding the full request flow requires distributed tracing.

4. **Capacity Planning**: Understanding RPC throughput and error rates helps with scaling decisions and SLA compliance.

5. **Debugging Production Issues**: When something goes wrong, traces and metrics provide the forensic data needed to diagnose issues quickly.

Observability for RPC should answer these questions:

- How long do RPC calls take? What's the p50/p95/p99 latency?
- Which methods are failing? What errors are occurring?
- How many requests per second is each method handling?
- When a request is slow, where did it spend its time?
- How do retries affect overall success rates?

---

## Tracing RPC Calls

Distributed tracing creates a timeline of events across service boundaries. Each RPC call should generate a **span** that captures when the call started, how long it took, whether it succeeded, and relevant metadata.

### Span Attributes

Follow OpenTelemetry semantic conventions for RPC:

| Attribute | Description | Example |
|-----------|-------------|---------|
| `rpc.system` | RPC system identifier | `"rpc.do"` |
| `rpc.service` | Service namespace | `"users"` |
| `rpc.method` | Method name | `"getById"` |
| `rpc.grpc.status_code` | gRPC-style status code | `0` (OK), `2` (UNKNOWN) |
| `network.peer.address` | Server address | `"my-do.workers.dev"` |
| `network.protocol.name` | Protocol used | `"http"`, `"websocket"` |
| `error` | Boolean error flag | `true` |
| `error.type` | Error class name | `"RPCError"` |
| `error.message` | Error message | `"Not found"` |

### OpenTelemetry Middleware Implementation

Here is a complete OpenTelemetry tracing middleware for rpc.do:

```typescript
import type { RpcClientMiddleware } from 'rpc.do'
import {
  trace,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
  context,
  propagation,
} from '@opentelemetry/api'

/**
 * Options for OpenTelemetry tracing middleware
 */
export interface OtelTracingOptions {
  /** Tracer instance (default: uses global tracer provider) */
  tracer?: Tracer
  /** Service name for spans (default: 'rpc.do-client') */
  serviceName?: string
  /** Target server URL for span attributes */
  serverUrl?: string
  /** Whether to record request arguments (default: false for security) */
  recordArgs?: boolean
  /** Whether to record response data (default: false for performance) */
  recordResult?: boolean
  /** Maximum size of recorded args/result (default: 1024 bytes) */
  maxRecordSize?: number
  /** Custom span name formatter */
  formatSpanName?: (method: string) => string
}

/**
 * Create an OpenTelemetry tracing middleware
 *
 * This middleware creates a span for each RPC call, recording timing,
 * status, and configurable request/response data.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { otelTracingMiddleware } from './observability'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [
 *     otelTracingMiddleware({
 *       serviceName: 'my-app',
 *       serverUrl: 'https://my-do.workers.dev',
 *     })
 *   ]
 * })
 * ```
 */
export function otelTracingMiddleware(options: OtelTracingOptions = {}): RpcClientMiddleware {
  const {
    tracer = trace.getTracer('rpc.do-client', '1.0.0'),
    serviceName = 'rpc.do-client',
    serverUrl,
    recordArgs = false,
    recordResult = false,
    maxRecordSize = 1024,
    formatSpanName = (method) => `RPC ${method}`,
  } = options

  // Track active spans by request (keyed by method + incrementing ID)
  const activeSpans = new Map<string, { span: Span; id: number }>()
  let requestId = 0

  /**
   * Safely serialize a value for span attributes
   */
  function safeSerialize(value: unknown): string {
    try {
      const json = JSON.stringify(value)
      if (json.length > maxRecordSize) {
        return json.slice(0, maxRecordSize) + '...[truncated]'
      }
      return json
    } catch {
      return '[unserializable]'
    }
  }

  /**
   * Parse method into service and method components
   */
  function parseMethod(method: string): { service: string; methodName: string } {
    const parts = method.split('.')
    if (parts.length >= 2) {
      const methodName = parts.pop()!
      const service = parts.join('.')
      return { service, methodName }
    }
    return { service: 'default', methodName: method }
  }

  return {
    onRequest(method: string, args: unknown[]): void {
      const { service, methodName } = parseMethod(method)
      const spanName = formatSpanName(method)

      const span = tracer.startSpan(spanName, {
        kind: SpanKind.CLIENT,
        attributes: {
          'rpc.system': 'rpc.do',
          'rpc.service': service,
          'rpc.method': methodName,
          'service.name': serviceName,
          ...(serverUrl && { 'network.peer.address': serverUrl }),
        },
      })

      // Record arguments if enabled
      if (recordArgs && args.length > 0) {
        span.setAttribute('rpc.request.args', safeSerialize(args))
      }

      // Store span for later retrieval
      const id = ++requestId
      const key = `${method}:${id}`
      activeSpans.set(key, { span, id })

      // Store the key in span for retrieval (using a non-standard attribute)
      span.setAttribute('_internal.span_key', key)
    },

    onResponse(method: string, result: unknown): void {
      // Find the oldest span for this method (FIFO)
      let spanEntry: { span: Span; id: number; key: string } | undefined

      for (const [key, entry] of activeSpans) {
        if (key.startsWith(`${method}:`)) {
          if (!spanEntry || entry.id < spanEntry.id) {
            spanEntry = { ...entry, key }
          }
        }
      }

      if (!spanEntry) return

      const { span, key } = spanEntry
      activeSpans.delete(key)

      // Record result if enabled
      if (recordResult && result !== undefined) {
        span.setAttribute('rpc.response.result', safeSerialize(result))
      }

      // Mark span as successful
      span.setStatus({ code: SpanStatusCode.OK })
      span.end()
    },

    onError(method: string, error: unknown): void {
      // Find the oldest span for this method (FIFO)
      let spanEntry: { span: Span; id: number; key: string } | undefined

      for (const [key, entry] of activeSpans) {
        if (key.startsWith(`${method}:`)) {
          if (!spanEntry || entry.id < spanEntry.id) {
            spanEntry = { ...entry, key }
          }
        }
      }

      if (!spanEntry) return

      const { span, key } = spanEntry
      activeSpans.delete(key)

      // Record error details
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      })

      span.setAttribute('error', true)

      if (error instanceof Error) {
        span.setAttribute('error.type', error.constructor.name)
        span.setAttribute('error.message', error.message)
        if (error.stack) {
          span.setAttribute('error.stack', error.stack.slice(0, maxRecordSize))
        }
        // Record error code if present (RPCError, ConnectionError)
        if ('code' in error && typeof error.code === 'string') {
          span.setAttribute('rpc.error.code', error.code)
        }
      }

      span.recordException(error instanceof Error ? error : new Error(String(error)))
      span.end()
    },
  }
}
```

---

## Metrics to Track

Effective RPC observability requires tracking three key metrics: latency, error rate, and throughput.

### Latency Histogram

Latency histograms show the distribution of response times. Use buckets that match your SLA requirements:

```typescript
// Recommended histogram buckets for RPC latency (in milliseconds)
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
```

Track separate histograms for:
- **Client-side latency**: Total time including network round-trip
- **Server-side latency**: Processing time on the Durable Object

### Error Rate

Error rate is the percentage of requests that fail. Track by:
- Method name
- Error type (network error vs application error)
- Error code

### Throughput

Throughput is requests per second. Track:
- Total requests
- Successful requests
- Failed requests

### OpenTelemetry Metrics Middleware

Here is a complete metrics middleware implementation:

```typescript
import type { RpcClientMiddleware } from 'rpc.do'
import { metrics, type Meter, type Counter, type Histogram } from '@opentelemetry/api'

/**
 * Options for OpenTelemetry metrics middleware
 */
export interface OtelMetricsOptions {
  /** Meter instance (default: uses global meter provider) */
  meter?: Meter
  /** Metric name prefix (default: 'rpc.do') */
  prefix?: string
  /** Histogram buckets for latency in milliseconds */
  latencyBuckets?: number[]
}

/**
 * Timing context stored per request
 */
interface MetricsTimingContext {
  method: string
  startTime: number
}

/**
 * Create an OpenTelemetry metrics middleware
 *
 * This middleware records:
 * - `rpc.do.requests.total` - Counter of total requests
 * - `rpc.do.requests.duration` - Histogram of request latency
 * - `rpc.do.requests.errors` - Counter of failed requests
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { otelMetricsMiddleware } from './observability'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [otelMetricsMiddleware()]
 * })
 * ```
 */
export function otelMetricsMiddleware(options: OtelMetricsOptions = {}): RpcClientMiddleware {
  const {
    meter = metrics.getMeter('rpc.do-client', '1.0.0'),
    prefix = 'rpc.do',
    latencyBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  } = options

  // Create metrics instruments
  const requestCounter: Counter = meter.createCounter(`${prefix}.requests.total`, {
    description: 'Total number of RPC requests',
    unit: '1',
  })

  const errorCounter: Counter = meter.createCounter(`${prefix}.requests.errors`, {
    description: 'Number of failed RPC requests',
    unit: '1',
  })

  const latencyHistogram: Histogram = meter.createHistogram(`${prefix}.requests.duration`, {
    description: 'Duration of RPC requests in milliseconds',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: latencyBuckets,
    },
  })

  // Track timing per request (FIFO for concurrent calls)
  const timings = new Map<number, MetricsTimingContext>()
  let nextId = 0

  /**
   * Parse method into service and method components
   */
  function parseMethod(method: string): { service: string; methodName: string } {
    const parts = method.split('.')
    if (parts.length >= 2) {
      const methodName = parts.pop()!
      const service = parts.join('.')
      return { service, methodName }
    }
    return { service: 'default', methodName: method }
  }

  /**
   * Find and remove the oldest timing entry for a method
   */
  function findAndRemoveTiming(method: string): MetricsTimingContext | undefined {
    for (const [id, ctx] of timings) {
      if (ctx.method === method) {
        timings.delete(id)
        return ctx
      }
    }
    return undefined
  }

  return {
    onRequest(method: string, _args: unknown[]): void {
      const id = nextId++
      timings.set(id, {
        method,
        startTime: performance.now(),
      })
    },

    onResponse(method: string, _result: unknown): void {
      const endTime = performance.now()
      const timing = findAndRemoveTiming(method)

      if (!timing) return

      const durationMs = endTime - timing.startTime
      const { service, methodName } = parseMethod(method)
      const attributes = {
        'rpc.service': service,
        'rpc.method': methodName,
        'rpc.status': 'ok',
      }

      // Record metrics
      requestCounter.add(1, attributes)
      latencyHistogram.record(durationMs, attributes)
    },

    onError(method: string, error: unknown): void {
      const endTime = performance.now()
      const timing = findAndRemoveTiming(method)

      if (!timing) return

      const durationMs = endTime - timing.startTime
      const { service, methodName } = parseMethod(method)

      // Determine error type
      let errorType = 'unknown'
      let errorCode = 'unknown'

      if (error instanceof Error) {
        errorType = error.constructor.name
        if ('code' in error && typeof error.code === 'string') {
          errorCode = error.code
        }
      }

      const attributes = {
        'rpc.service': service,
        'rpc.method': methodName,
        'rpc.status': 'error',
        'error.type': errorType,
        'error.code': errorCode,
      }

      // Record metrics
      requestCounter.add(1, attributes)
      errorCounter.add(1, attributes)
      latencyHistogram.record(durationMs, attributes)
    },
  }
}
```

---

## Custom Logging Middleware

The built-in `loggingMiddleware` is great for development, but production systems often need structured logging with specific formats, sampling, and integration with centralized logging systems.

### Structured Logging Example

Here is a structured logging middleware that outputs JSON logs suitable for log aggregation:

```typescript
import type { RpcClientMiddleware } from 'rpc.do'

/**
 * Log levels for RPC operations
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * Structured log entry
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  service: string
  method: string
  durationMs?: number
  error?: {
    type: string
    message: string
    code?: string
    stack?: string
  }
  requestId?: string
  traceId?: string
  spanId?: string
  [key: string]: unknown
}

/**
 * Options for structured logging middleware
 */
export interface StructuredLoggingOptions {
  /** Service name for log entries */
  serviceName?: string
  /** Minimum log level (default: 'info') */
  minLevel?: LogLevel
  /** Custom log output function (default: console.log with JSON.stringify) */
  output?: (entry: LogEntry) => void
  /** Whether to log successful responses (default: true) */
  logSuccess?: boolean
  /** Whether to include stack traces in error logs (default: false in production) */
  includeStackTrace?: boolean
  /** Additional context to include in all log entries */
  context?: Record<string, unknown>
  /** Generate a unique request ID */
  generateRequestId?: () => string
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Create a structured logging middleware
 *
 * Outputs JSON-formatted log entries suitable for log aggregation systems
 * like Datadog Logs, Splunk, or the ELK stack.
 *
 * @example
 * ```typescript
 * import { RPC } from 'rpc.do'
 * import { structuredLoggingMiddleware } from './observability'
 *
 * const $ = RPC('https://my-do.workers.dev', {
 *   middleware: [
 *     structuredLoggingMiddleware({
 *       serviceName: 'my-app',
 *       minLevel: 'info',
 *       context: {
 *         environment: process.env.NODE_ENV,
 *         version: process.env.APP_VERSION,
 *       }
 *     })
 *   ]
 * })
 * ```
 */
export function structuredLoggingMiddleware(
  options: StructuredLoggingOptions = {}
): RpcClientMiddleware {
  const {
    serviceName = 'rpc-client',
    minLevel = 'info',
    output = (entry) => console.log(JSON.stringify(entry)),
    logSuccess = true,
    includeStackTrace = process.env.NODE_ENV !== 'production',
    context = {},
    generateRequestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
  } = options

  // Track request timing and IDs
  interface RequestContext {
    method: string
    startTime: number
    requestId: string
  }

  const requests = new Map<number, RequestContext>()
  let nextId = 0

  /**
   * Check if a log level should be output
   */
  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
  }

  /**
   * Emit a log entry
   */
  function log(level: LogLevel, entry: Partial<LogEntry>): void {
    if (!shouldLog(level)) return

    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: entry.message || '',
      service: serviceName,
      method: entry.method || 'unknown',
      ...context,
      ...entry,
    }

    output(fullEntry)
  }

  /**
   * Parse method into components
   */
  function parseMethod(method: string): { service: string; methodName: string } {
    const parts = method.split('.')
    if (parts.length >= 2) {
      return {
        methodName: parts.pop()!,
        service: parts.join('.'),
      }
    }
    return { service: 'default', methodName: method }
  }

  /**
   * Find and remove timing context for a method
   */
  function findAndRemove(method: string): RequestContext | undefined {
    for (const [id, ctx] of requests) {
      if (ctx.method === method) {
        requests.delete(id)
        return ctx
      }
    }
    return undefined
  }

  return {
    onRequest(method: string, args: unknown[]): void {
      const id = nextId++
      const requestId = generateRequestId()

      requests.set(id, {
        method,
        startTime: performance.now(),
        requestId,
      })

      const { service, methodName } = parseMethod(method)

      log('debug', {
        message: `RPC request started: ${method}`,
        method,
        rpcService: service,
        rpcMethod: methodName,
        requestId,
        argsCount: args.length,
      })
    },

    onResponse(method: string, result: unknown): void {
      const ctx = findAndRemove(method)
      if (!ctx) return

      const durationMs = performance.now() - ctx.startTime
      const { service, methodName } = parseMethod(method)

      if (logSuccess) {
        log('info', {
          message: `RPC request completed: ${method}`,
          method,
          rpcService: service,
          rpcMethod: methodName,
          requestId: ctx.requestId,
          durationMs: Math.round(durationMs * 100) / 100,
          status: 'success',
        })
      }
    },

    onError(method: string, error: unknown): void {
      const ctx = findAndRemove(method)
      if (!ctx) return

      const durationMs = performance.now() - ctx.startTime
      const { service, methodName } = parseMethod(method)

      const errorInfo: LogEntry['error'] = {
        type: 'unknown',
        message: String(error),
      }

      if (error instanceof Error) {
        errorInfo.type = error.constructor.name
        errorInfo.message = error.message
        if (includeStackTrace && error.stack) {
          errorInfo.stack = error.stack
        }
        if ('code' in error && typeof error.code === 'string') {
          errorInfo.code = error.code
        }
      }

      log('error', {
        message: `RPC request failed: ${method}`,
        method,
        rpcService: service,
        rpcMethod: methodName,
        requestId: ctx.requestId,
        durationMs: Math.round(durationMs * 100) / 100,
        status: 'error',
        error: errorInfo,
      })
    },
  }
}
```

### Log Levels and Sampling

For high-throughput systems, logging every request can be expensive. Implement sampling:

```typescript
/**
 * Options for sampled logging
 */
export interface SampledLoggingOptions extends StructuredLoggingOptions {
  /** Sample rate for successful requests (0.0 to 1.0, default: 1.0) */
  successSampleRate?: number
  /** Sample rate for errors (0.0 to 1.0, default: 1.0 - always log errors) */
  errorSampleRate?: number
  /** Always log requests slower than this threshold (ms) */
  slowRequestThreshold?: number
}

/**
 * Create a sampled logging middleware
 *
 * Reduces log volume by sampling successful requests while still
 * capturing all errors and slow requests.
 */
export function sampledLoggingMiddleware(
  options: SampledLoggingOptions = {}
): RpcClientMiddleware {
  const {
    successSampleRate = 0.1,  // Log 10% of successful requests
    errorSampleRate = 1.0,     // Log all errors
    slowRequestThreshold = 1000, // Always log requests > 1 second
    ...loggingOptions
  } = options

  const baseMiddleware = structuredLoggingMiddleware({
    ...loggingOptions,
    logSuccess: false, // We'll handle this manually
  })

  // Track which requests should be logged
  const shouldLogRequest = new Map<string, boolean>()

  return {
    onRequest(method: string, args: unknown[]): void {
      // Decide sampling at request time
      const shouldSample = Math.random() < successSampleRate
      shouldLogRequest.set(method, shouldSample)

      baseMiddleware.onRequest?.(method, args)
    },

    onResponse(method: string, result: unknown): void {
      const shouldSample = shouldLogRequest.get(method)
      shouldLogRequest.delete(method)

      // Get timing to check for slow requests
      // Note: This requires access to the timing context
      // In practice, you'd integrate this with your timing middleware
      if (shouldSample) {
        baseMiddleware.onResponse?.(method, result)
      }
    },

    onError(method: string, error: unknown): void {
      shouldLogRequest.delete(method)

      // Always log errors based on sample rate
      if (Math.random() < errorSampleRate) {
        baseMiddleware.onError?.(method, error)
      }
    },
  }
}
```

---

## Integration with Popular Tools

### Datadog

Datadog provides APM tracing and metrics collection. Use the OpenTelemetry SDK with Datadog's exporter:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { RPC } from 'rpc.do'
import { otelTracingMiddleware, otelMetricsMiddleware } from './observability'

// Configure OpenTelemetry SDK for Datadog
const sdk = new NodeSDK({
  serviceName: 'my-rpc-service',
  traceExporter: new OTLPTraceExporter({
    url: 'https://trace.agent.datadoghq.com/v0.4/traces',
    headers: {
      'DD-API-KEY': process.env.DD_API_KEY!,
    },
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'https://api.datadoghq.com/api/v2/series',
      headers: {
        'DD-API-KEY': process.env.DD_API_KEY!,
      },
    }),
    exportIntervalMillis: 60000,
  }),
})

sdk.start()

// Create RPC client with observability
const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    otelTracingMiddleware({ serviceName: 'my-rpc-service' }),
    otelMetricsMiddleware(),
  ],
})
```

For Datadog-specific features, you can also use their native SDK:

```typescript
import tracer from 'dd-trace'
import type { RpcClientMiddleware } from 'rpc.do'

tracer.init({
  service: 'my-rpc-service',
  env: process.env.NODE_ENV,
})

/**
 * Datadog-native tracing middleware
 */
export function datadogTracingMiddleware(): RpcClientMiddleware {
  const activeSpans = new Map<string, ReturnType<typeof tracer.startSpan>>()
  let requestId = 0

  return {
    onRequest(method: string, args: unknown[]): void {
      const span = tracer.startSpan('rpc.request', {
        tags: {
          'resource.name': method,
          'span.type': 'http',
          'rpc.system': 'rpc.do',
          'rpc.method': method,
        },
      })

      const id = ++requestId
      activeSpans.set(`${method}:${id}`, span)
    },

    onResponse(method: string, _result: unknown): void {
      for (const [key, span] of activeSpans) {
        if (key.startsWith(`${method}:`)) {
          activeSpans.delete(key)
          span.finish()
          break
        }
      }
    },

    onError(method: string, error: unknown): void {
      for (const [key, span] of activeSpans) {
        if (key.startsWith(`${method}:`)) {
          activeSpans.delete(key)
          span.setTag('error', true)
          if (error instanceof Error) {
            span.setTag('error.message', error.message)
            span.setTag('error.type', error.constructor.name)
          }
          span.finish()
          break
        }
      }
    },
  }
}
```

### Honeycomb

Honeycomb excels at high-cardinality observability. Use OpenTelemetry with Honeycomb's exporter:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { RPC } from 'rpc.do'
import { otelTracingMiddleware } from './observability'

const sdk = new NodeSDK({
  serviceName: 'my-rpc-service',
  traceExporter: new OTLPTraceExporter({
    url: 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': process.env.HONEYCOMB_API_KEY!,
      'x-honeycomb-dataset': 'my-rpc-service',
    },
  }),
})

sdk.start()

const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    otelTracingMiddleware({
      serviceName: 'my-rpc-service',
      recordArgs: true,  // Honeycomb handles high-cardinality well
      recordResult: true,
    }),
  ],
})
```

### Grafana Stack

For the Grafana stack (Tempo for traces, Prometheus for metrics, Loki for logs):

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { RPC } from 'rpc.do'
import { otelTracingMiddleware, otelMetricsMiddleware, structuredLoggingMiddleware } from './observability'

// Prometheus metrics exporter (scrape endpoint)
const prometheusExporter = new PrometheusExporter({
  port: 9464,
  endpoint: '/metrics',
})

const sdk = new NodeSDK({
  serviceName: 'my-rpc-service',
  traceExporter: new OTLPTraceExporter({
    url: 'http://tempo:4318/v1/traces', // Grafana Tempo
  }),
  metricReader: prometheusExporter,
})

sdk.start()

// Structured logging for Loki
const lokiLogging = structuredLoggingMiddleware({
  serviceName: 'my-rpc-service',
  output: (entry) => {
    // Format for Loki ingestion
    console.log(JSON.stringify({
      streams: [{
        stream: {
          service: entry.service,
          level: entry.level,
        },
        values: [[
          String(Date.now() * 1000000), // Nanoseconds
          JSON.stringify(entry),
        ]],
      }],
    }))
  },
})

const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    otelTracingMiddleware({ serviceName: 'my-rpc-service' }),
    otelMetricsMiddleware(),
    lokiLogging,
  ],
})
```

---

## Best Practices

### 1. Use Semantic Conventions

Follow OpenTelemetry semantic conventions for consistent attribute names across your organization:

```typescript
// Good: Uses standard RPC semantic conventions
span.setAttribute('rpc.system', 'rpc.do')
span.setAttribute('rpc.service', 'users')
span.setAttribute('rpc.method', 'getById')

// Bad: Custom attribute names
span.setAttribute('my_rpc_method', 'users.getById')
```

### 2. Avoid Logging Sensitive Data

Never log passwords, tokens, PII, or other sensitive data:

```typescript
const middleware = otelTracingMiddleware({
  recordArgs: false,  // Don't record arguments by default
  recordResult: false, // Don't record results by default
})

// If you must log args, sanitize them first
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      const sanitized = { ...arg }
      // Remove sensitive fields
      delete (sanitized as Record<string, unknown>).password
      delete (sanitized as Record<string, unknown>).token
      delete (sanitized as Record<string, unknown>).apiKey
      return sanitized
    }
    return arg
  })
}
```

### 3. Set Appropriate Cardinality

High-cardinality attributes (like user IDs or request IDs) should be used carefully:

```typescript
// Good: Low cardinality - useful for aggregation
span.setAttribute('rpc.method', 'users.getById')
span.setAttribute('rpc.status', 'ok')

// Use carefully: High cardinality - use for specific investigations
span.setAttribute('user.id', userId) // OK for traces, not for metric labels

// Bad: Unbounded cardinality in metric labels
latencyHistogram.record(duration, { userId }) // Will explode metric storage
```

### 4. Sample Appropriately

For high-throughput services, sample traces to control costs:

```typescript
import { TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base'

const sdk = new NodeSDK({
  sampler: new TraceIdRatioBasedSampler(0.1), // Sample 10% of traces
})
```

### 5. Correlate Logs with Traces

Include trace and span IDs in log entries for correlation:

```typescript
import { trace, context } from '@opentelemetry/api'

function getTraceContext(): { traceId?: string; spanId?: string } {
  const span = trace.getSpan(context.active())
  if (!span) return {}

  const spanContext = span.spanContext()
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  }
}

const loggingMiddleware = structuredLoggingMiddleware({
  output: (entry) => {
    const traceContext = getTraceContext()
    console.log(JSON.stringify({
      ...entry,
      ...traceContext,
    }))
  },
})
```

### 6. Monitor Client and Server Separately

Instrument both client and server middleware for full visibility:

```typescript
// Client-side
import { RPC } from 'rpc.do'
import { otelTracingMiddleware } from './observability'

const $ = RPC('https://my-do.workers.dev', {
  middleware: [
    otelTracingMiddleware({ serviceName: 'my-client-app' }),
  ],
})

// Server-side (in Durable Object)
import { DurableRPC } from '@dotdo/rpc'

export class MyDO extends DurableRPC {
  middleware = [
    serverOtelTracingMiddleware({ serviceName: 'my-durable-object' }),
  ]
}
```

### 7. Set Up Alerts

Configure alerts for key metrics:

```yaml
# Example Prometheus alerting rules
groups:
  - name: rpc-alerts
    rules:
      - alert: HighRPCErrorRate
        expr: |
          sum(rate(rpc_do_requests_errors_total[5m]))
          / sum(rate(rpc_do_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "RPC error rate exceeds 5%"

      - alert: HighRPCLatency
        expr: |
          histogram_quantile(0.95, rate(rpc_do_requests_duration_bucket[5m])) > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RPC p95 latency exceeds 1 second"
```

---

## Complete Example: Full Observability Stack

Here is a complete example combining all observability components:

```typescript
import { RPC } from 'rpc.do'
import { http } from 'rpc.do/transports'
import { withRetry, withMiddleware, timingMiddleware } from 'rpc.do/middleware'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'

// Import our observability middleware
import {
  otelTracingMiddleware,
  otelMetricsMiddleware,
  structuredLoggingMiddleware,
} from './observability'

// ============================================================================
// Initialize OpenTelemetry SDK
// ============================================================================

const prometheusExporter = new PrometheusExporter({ port: 9464 })

const sdk = new NodeSDK({
  serviceName: 'my-rpc-client',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  metricReader: prometheusExporter,
})

sdk.start()

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('OpenTelemetry SDK shut down'))
    .catch((err) => console.error('Error shutting down SDK', err))
    .finally(() => process.exit(0))
})

// ============================================================================
// Create Instrumented RPC Client
// ============================================================================

// Layer 1: Base transport with retry
const baseTransport = withRetry(
  http('https://my-do.workers.dev'),
  {
    maxAttempts: 3,
    onRetry: (method, error, attempt, delay) => {
      console.warn(`Retry ${attempt} for ${method} after ${delay}ms`, error)
    },
  }
)

// Layer 2: Add observability middleware
const observedTransport = withMiddleware(baseTransport, [
  // Tracing - creates spans for each call
  otelTracingMiddleware({
    serviceName: 'my-rpc-client',
    serverUrl: 'https://my-do.workers.dev',
  }),

  // Metrics - records latency histograms and counters
  otelMetricsMiddleware({
    prefix: 'myapp.rpc',
  }),

  // Structured logging - outputs JSON logs
  structuredLoggingMiddleware({
    serviceName: 'my-rpc-client',
    minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    context: {
      environment: process.env.NODE_ENV,
      version: process.env.APP_VERSION,
    },
  }),

  // Built-in timing for console output during development
  ...(process.env.NODE_ENV !== 'production'
    ? [timingMiddleware({ threshold: 100 })]
    : []),
])

// Create the RPC client
export const rpc = RPC(observedTransport)

// ============================================================================
// Usage Example
// ============================================================================

async function main() {
  try {
    // All calls are now fully instrumented
    const users = await rpc.users.list()
    console.log('Users:', users)

    const user = await rpc.users.getById('123')
    console.log('User:', user)

    // Concurrent calls are batched and individually traced
    const [posts, comments] = await Promise.all([
      rpc.posts.recent(),
      rpc.comments.count(),
    ])
    console.log('Posts:', posts, 'Comments:', comments)

  } catch (error) {
    // Errors are automatically logged and traced
    console.error('RPC call failed:', error)
  }
}

main()
```

This setup provides:

- **Distributed tracing** via OpenTelemetry, exportable to any OTLP-compatible backend
- **Metrics** exposed on a Prometheus scrape endpoint
- **Structured logging** in JSON format for log aggregation
- **Automatic retries** with observability hooks
- **Development-friendly** console timing output

The observability middleware composes cleanly with other rpc.do features like batching, validation, and retry transport wrappers.
