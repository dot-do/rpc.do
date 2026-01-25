# WebSocket Fetch Bypass POC

## Hypothesis

Cloudflare Workers have a limit of **6 simultaneous outbound fetch requests** per invocation. This limit applies to the `fetch()` API.

**We hypothesize that by multiplexing fetch requests over a single WebSocket connection to a proxy worker, we can bypass this limit.** The rationale:

1. A WebSocket connection counts as a single "subrequest" to establish
2. Once established, the WebSocket is a bidirectional channel
3. Messages sent over the WebSocket are not individual subrequests
4. The proxy worker receives requests via WebSocket and makes the actual fetches
5. The proxy worker has its own limit of 6 concurrent fetches, but multiple proxies could be used, or requests could be serialized on the proxy side

## Architecture

```
┌─────────────────────┐        WebSocket        ┌─────────────────────┐
│   Client Worker     │ ───────────────────────▶│   Proxy Worker      │
│                     │                         │                     │
│  fetchViaWs(url)    │   { id, url, method }   │  Receives WS msg    │
│  - multiplex many   │   ─────────────────▶    │  - calls fetch()    │
│    requests over    │                         │  - returns response │
│    single WS conn   │   { id, status, body }  │                     │
│                     │   ◀─────────────────    │                     │
└─────────────────────┘                         └─────────────────────┘
         │                                                │
         │ (limited to 6 concurrent)                      │ (its own 6 limit)
         ▼                                                ▼
    Direct fetches                                   Actual fetches
    to external APIs                                 to external APIs
```

## Files

- **proxy-worker.ts** - Worker that accepts WebSocket connections and proxies fetch requests
- **client-worker.ts** - Worker that tests making concurrent requests via WS proxy
- **test-harness.ts** - Local script for testing outside Workers environment
- **wrangler.toml** - Wrangler configuration for both workers

## Setup Instructions

### 1. Install Dependencies

```bash
cd experiments/ws-fetch-bypass
npm install wrangler typescript --save-dev
```

### 2. Deploy Proxy Worker

```bash
# Start proxy worker locally
npx wrangler dev proxy-worker.ts

# Or deploy to Cloudflare
npx wrangler deploy
```

### 3. Update Client Configuration

After deploying the proxy worker, update the `PROXY_URL` in `wrangler.toml`:

```toml
[env.client.vars]
PROXY_URL = "wss://ws-fetch-proxy.YOUR_SUBDOMAIN.workers.dev"
```

### 4. Deploy Client Worker

```bash
# Start client worker locally (connects to local or remote proxy)
npx wrangler dev --env client

# Or deploy to Cloudflare
npx wrangler deploy --env client
```

### 5. Run Tests

**Local test harness (outside Workers):**
```bash
# Start proxy worker in one terminal
npx wrangler dev proxy-worker.ts

# Run test harness in another terminal
npx tsx test-harness.ts ws://localhost:8787 https://httpbin.org/delay/1 10
```

**Deployed workers:**
```bash
# Access the client worker endpoint
curl "https://ws-fetch-client.YOUR_SUBDOMAIN.workers.dev/?count=10&target=https://httpbin.org/delay/1"
```

## Expected Results

### Direct Fetches (without proxy)
- Requests 1-6: Should succeed
- Request 7+: Should fail with "Too many subrequests" error

### WebSocket Proxied Fetches
- All requests should succeed (up to the proxy's own limits)
- Latency will be higher due to the extra hop

## Actual Results

*Fill in after running the experiments*

### Local Testing
```
Date:
Environment:
Results:
```

### Workers Testing
```
Date:
Environment:
Results:
```

## Conclusions

*Fill in based on actual results*

### Did it work?
- [ ] Yes - WebSocket proxying bypasses the 6 concurrent fetch limit
- [ ] No - The limit still applies somehow
- [ ] Partial - Works but with caveats

### Notes


## Potential Extensions

1. **Connection pooling**: Open multiple WebSocket connections to distribute load
2. **Request queuing**: Queue requests on the proxy and process in batches of 6
3. **Multiple proxy workers**: Use multiple proxy worker instances for higher throughput
4. **Binary protocol**: Use a more efficient protocol than JSON for lower latency
5. **Streaming responses**: Support streaming responses for large payloads

## Related Cloudflare Limits

| Limit | Free | Paid |
|-------|------|------|
| Subrequests per request | 50 | 1000 |
| **Simultaneous outbound connections** | **6** | **6** |
| WebSocket connections | 1 | 1 |
| Request duration | 50ms CPU | Unlimited |

Reference: https://developers.cloudflare.com/workers/platform/limits/
