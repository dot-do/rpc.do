# Versioning Policy

This document describes our commitment to semantic versioning and API stability for `rpc.do` and `@dotdo/rpc`.

## Semantic Versioning Commitment

Starting with v1.0.0, we strictly follow [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes to public API
- **MINOR** (0.x.0): New features, backwards-compatible
- **PATCH** (0.0.x): Bug fixes, backwards-compatible

### What We Consider Public API

The following are part of our stable public API and covered by semver:

**rpc.do (client library):**
- `RPC()` function and its return type
- All exports from the main entry point (`rpc.do`)
- All exports from subpath entries (`rpc.do/transports`, `rpc.do/auth`, `rpc.do/errors`, etc.)
- TypeScript type exports

**@dotdo/rpc (server library):**
- `DurableRPC` class and its public methods/properties
- All exports from the main entry point (`@dotdo/rpc`)
- All exports from subpath entries (`@dotdo/rpc/lite`, `@dotdo/rpc/collections`, `@dotdo/rpc/events`)
- TypeScript type exports

### What Is NOT Public API

The following may change without a major version bump:

- Properties/methods prefixed with `_` or `__` (internal)
- Anything explicitly marked `@internal` in JSDoc
- Debug/logging output format
- Error message text (use error codes for programmatic handling)
- Performance characteristics (though we avoid regressions)

---

## Breaking Change Policy

### Before Making Breaking Changes

1. **Deprecation Warning**: Feature will be deprecated for at least 1 minor version
2. **Migration Guide**: Documentation provided for transitioning
3. **Changelog Entry**: Breaking changes clearly documented

### Deprecation Timeline

1. **v1.x.0**: Feature deprecated with console warning + JSDoc `@deprecated`
2. **v2.0.0**: Feature removed (earliest)

Example deprecation:
```typescript
/**
 * @deprecated Use `RPC(url, options)` instead. Will be removed in v2.0.
 */
export function createRPCClient(options: RPCClientOptions): RPCProxy {
  console.warn('createRPCClient is deprecated. Use RPC(url, options) instead.')
  return RPC(options.baseUrl, { auth: options.auth })
}
```

### Exception: Security Fixes

Security vulnerabilities may require breaking changes without the standard deprecation period. These will be:
- Clearly documented in CHANGELOG
- Announced via GitHub Security Advisory
- Backported to supported versions where possible

---

## Long-Term Support (LTS)

| Version | Status | End of Life |
|---------|--------|-------------|
| v1.x | Active | TBD (when v2.0 released) |
| v0.x | Maintenance | 6 months after v1.0 release |

**Maintenance mode** means:
- Security fixes only
- No new features
- Critical bug fixes on case-by-case basis

---

## Migration Guide Template

When upgrading between major versions, use this template as a guide:

### Upgrading from v0.x to v1.0

#### Step 1: Update Dependencies

```bash
npm install rpc.do@^1.0.0 @dotdo/rpc@^1.0.0 @dotdo/capnweb@^0.4.0
```

#### Step 2: Update Import Paths (if needed)

No import path changes from v0.2.x to v1.0.

#### Step 3: Replace Deprecated APIs

```typescript
// Before (deprecated)
import { createRPCClient } from 'rpc.do'
const client = createRPCClient({ baseUrl: 'https://example.com', auth: 'token' })

// After (recommended)
import { RPC } from 'rpc.do'
const $ = RPC('https://example.com', { auth: 'token' })
```

#### Step 4: Update Transport Usage (if using explicit transports)

```typescript
// Before (v0.1.x)
import { ws, http } from 'rpc.do/transports'

// After (v0.2.x+)
import { capnweb, http } from 'rpc.do/transports'

// capnweb supports both WebSocket and HTTP:
const wsTransport = capnweb('wss://example.com')
const httpTransport = capnweb('https://example.com', { websocket: false })
```

#### Step 5: Verify TypeScript Types

Run type checking to catch any API changes:
```bash
npx tsc --noEmit
```

---

## Version Support Matrix

| rpc.do | @dotdo/rpc | @dotdo/capnweb | Node.js | Cloudflare Workers |
|--------|------------|----------------|---------|-------------------|
| 1.x | 1.x | 0.4.x | 18+ | Supported |
| 0.2.x | 0.2.x | 0.4.x | 18+ | Supported |
| 0.1.x | 0.1.x | 0.3.x | 18+ | Supported |

---

## Reporting Issues

If you encounter a breaking change that wasn't documented:

1. Check [CHANGELOG.md](../CHANGELOG.md) for known changes
2. Search [GitHub Issues](https://github.com/dot-do/rpc.do/issues)
3. Open a new issue with:
   - Previous version and new version
   - Code that worked before but doesn't now
   - Error message or unexpected behavior

We take accidental breaking changes seriously and will:
- Issue a patch release if possible
- Document the change retroactively
- Provide migration guidance
