---
title: doctor
description: Diagnose RPC connection and configuration issues
---

The `doctor` command helps diagnose connection issues and verify your rpc.do setup.

## Usage

```bash
# Check local configuration
npx rpc.do doctor

# Check a specific endpoint
npx rpc.do doctor --url https://my-do.workers.dev
```

## Options

| Option | Description |
|--------|-------------|
| `--url <url>` | RPC endpoint URL to check |

## Checks Performed

### Configuration Checks

When run without `--url`:

- **Wrangler config detection** - Looks for `wrangler.toml` or `wrangler.jsonc`
- **Durable Objects bindings** - Validates DO configuration
- **Source files** - Checks if DO source files exist
- **TypeScript config** - Validates `tsconfig.json`

### Endpoint Checks

When run with `--url`:

- **Basic connectivity** - Can reach the endpoint
- **HTTP response** - Valid response code and headers
- **Schema endpoint** - `/\__schema` is accessible
- **Schema format** - Response is valid rpc.do schema
- **WebSocket** - WebSocket upgrade works (if applicable)
- **Authentication** - Token validation (if provided)

## Example Output

### Checking Local Config

```
$ npx rpc.do doctor

rpc.do doctor v0.2.0

Configuration
  ✓ Found wrangler.toml
  ✓ Durable Objects configured: 2 bindings
    - CHAT → ChatDO
    - USERS → UserService
  ✓ Source files found
    - src/ChatDO.ts
    - src/UserService.ts
  ✓ TypeScript config valid

Summary: All checks passed
```

### Checking an Endpoint

```
$ npx rpc.do doctor --url https://chat.workers.dev

rpc.do doctor v0.2.0

Endpoint: https://chat.workers.dev

Connectivity
  ✓ DNS resolution successful
  ✓ TCP connection established
  ✓ TLS handshake completed

HTTP
  ✓ GET / returns 200
  ✓ Content-Type: application/json

Schema
  ✓ GET /__schema returns 200
  ✓ Valid schema format (version 1)
  ✓ 5 methods discovered
  ✓ 2 namespaces discovered

WebSocket
  ✓ Upgrade request accepted
  ✓ Connection established

Summary: All checks passed
```

### With Errors

```
$ npx rpc.do doctor --url https://broken.workers.dev

rpc.do doctor v0.2.0

Endpoint: https://broken.workers.dev

Connectivity
  ✓ DNS resolution successful
  ✓ TCP connection established
  ✓ TLS handshake completed

HTTP
  ✓ GET / returns 200
  ✓ Content-Type: application/json

Schema
  ✗ GET /__schema returns 404
    The server does not expose a schema endpoint.
    Ensure your DO extends DurableRPC from @dotdo/rpc.

WebSocket
  ✗ Upgrade request failed (400 Bad Request)
    WebSocket connections may not be enabled.

Summary: 2 issues found

Recommendations:
  1. Ensure your Durable Object extends DurableRPC
  2. Check that your Worker routes to the DO correctly
  3. Verify wrangler.toml has correct DO bindings
```

## Common Issues

### "Schema endpoint not found"

The server is not exposing the `/__schema` endpoint. Ensure:

1. Your DO extends `DurableRPC` from `@dotdo/rpc`
2. Your Worker correctly routes to the DO
3. The URL path matches your routing configuration

### "Connection refused"

The server is not reachable. Check:

1. The URL is correct (no typos)
2. The Worker is deployed (`wrangler deploy`)
3. The domain is properly configured

### "WebSocket upgrade failed"

WebSocket support may not be enabled. Verify:

1. Your DO handles WebSocket connections
2. The Worker passes through WebSocket upgrade requests
3. No proxy is blocking WebSocket upgrades

### "Invalid schema format"

The endpoint returns something, but it's not a valid rpc.do schema. This happens when:

1. The endpoint is not an rpc.do service
2. There's a version mismatch
3. A different service is responding

## Verbose Mode

For detailed debugging information:

```bash
npx rpc.do doctor --url https://my-do.workers.dev --verbose
```

This shows:
- Full request/response headers
- Response bodies
- Timing information
- TLS certificate details

## Integration with CI

Use doctor in CI to verify deployments:

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    steps:
      - run: wrangler deploy
      - name: Verify deployment
        run: npx rpc.do doctor --url ${{ vars.WORKER_URL }}
```
