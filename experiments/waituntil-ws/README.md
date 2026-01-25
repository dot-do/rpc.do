# WebSocket + ctx.waitUntil POC

## What We're Testing

**Key Question:** Can we return a response from a fetch handler and continue processing WebSocket messages that arrive AFTER the response was sent?

This is crucial for RPC patterns where we want to:
1. Open a WebSocket connection to a backend service
2. Return a response to the client immediately
3. Continue receiving and processing WebSocket messages in the background

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Worker                                  │
│                                                                 │
│  ┌─────────────────┐                                           │
│  │  fetch handler  │                                           │
│  │                 │──────────────────────────────────────┐    │
│  │  1. Open WS     │                                      │    │
│  │  2. waitUntil() │──┐                                   │    │
│  │  3. Return resp │  │                                   │    │
│  └─────────────────┘  │                                   │    │
│           │           │                                   │    │
│           ▼           │                                   │    │
│    Response sent      │                                   │    │
│    to client          │                                   ▼    │
│                       │           ┌─────────────────────────┐  │
│                       │           │    Durable Object       │  │
│                       │           │                         │  │
│                       │◀──────────│  Sends messages every   │  │
│                       │    WS     │  second for 10 seconds  │  │
│                       │           │                         │  │
│                       │           └─────────────────────────┘  │
│                       │                                        │
│                       ▼                                        │
│           ┌───────────────────────┐                           │
│           │  WS Processor         │                           │
│           │  (kept alive by       │                           │
│           │   waitUntil)          │                           │
│           │                       │                           │
│           │  Receives messages    │                           │
│           │  AFTER response sent  │                           │
│           └───────────────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Expected Behavior

### If waitUntil DOES keep WebSocket alive:
1. `/test` returns immediately with response
2. Worker logs show messages arriving over the next 10 seconds
3. `/status` shows 10 messages received, all with `delayFromResponse > 0`

### If waitUntil does NOT keep WebSocket alive:
1. `/test` returns immediately
2. WebSocket is closed when fetch handler completes
3. `/status` shows 0-1 messages (only ones that arrived before response)

## Files

- `worker.ts` - Main worker that opens WebSocket and uses waitUntil
- `test-do.ts` - Durable Object that sends timed messages
- `wrangler.toml` - Configuration with DO binding

## How to Test

### 1. Deploy the worker

```bash
cd experiments/waituntil-ws
wrangler deploy
```

### 2. Run the test

```bash
# Start the test - returns immediately
curl https://waituntil-ws-experiment.<your-subdomain>.workers.dev/test

# Wait 12 seconds for all messages to be sent
sleep 12

# Check what messages were received
curl https://waituntil-ws-experiment.<your-subdomain>.workers.dev/status
```

### 3. Check logs

```bash
wrangler tail
```

You should see logs like:
```
[conn-xxx] Returning response at 1234567890
[conn-xxx] WS MESSAGE RECEIVED:
  - Message #1: {"messageNumber":1,...}
  - Time since response: 1002ms
  *** PROOF: This message arrived 1002ms AFTER response was sent! ***
```

## Interpretation

### Success Criteria

The test SUCCEEDS if `/status` shows:
```json
{
  "messagesReceived": 10,
  "messages": [
    { "delayFromResponse": 1002, ... },
    { "delayFromResponse": 2005, ... },
    // ... messages with increasing delays
  ]
}
```

### Failure Criteria

The test FAILS if `/status` shows:
```json
{
  "messagesReceived": 0,
  "messages": []
}
```

## Alternative Test: Local Development

```bash
wrangler dev
```

Then in another terminal:
```bash
curl http://localhost:8787/test
sleep 12
curl http://localhost:8787/status
```

## Known Limitations

1. **Module-level state**: Workers may be recycled, losing the state. Each `/test` creates fresh state.

2. **waitUntil timeout**: There's a maximum time for waitUntil (typically 30 seconds). Our 10-second test is well within limits.

3. **WebSocket hibernation**: For long-lived connections, Durable Objects with WebSocket hibernation would be more appropriate.

## Implications for RPC

If this works, it means we CAN:
- Open a single WebSocket to a backend from a Worker
- Use it for multiple request/response cycles
- Keep it alive across fetch handler invocations (within the same isolate)

This enables efficient connection pooling patterns without needing to hold the response open.
