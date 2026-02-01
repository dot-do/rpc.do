# Security Policy

This document outlines the security policy for rpc.do, including how to report vulnerabilities and security best practices when using the library.

## Supported Versions

The following versions of rpc.do receive security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :x:                |
| < 0.1   | :x:                |

We recommend always using the latest version to benefit from security patches and improvements.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in rpc.do, please report it by emailing:

**security@platform.do**

Please include:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact assessment
4. Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Assessment**: We will assess the vulnerability and determine its severity
- **Updates**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical vulnerabilities within 7 days
- **Credit**: We will credit you in the security advisory (unless you prefer anonymity)

## Security Considerations

rpc.do implements several security measures to protect your applications.

### Authentication Token Handling

rpc.do uses **first-message authentication** rather than including tokens in URLs:

```typescript
// Tokens are sent in the first WebSocket message, NOT in the URL
const transport = capnweb('wss://api.example.com/rpc', {
  auth: () => getToken()
})
```

**Why this matters:**
- URLs are logged in server access logs, browser history, and referrer headers
- Tokens in URLs can be exposed through screenshots or copy/paste
- First-message auth keeps credentials out of logs and URLs

### SQL Injection Protection

rpc.do's Collections API uses **parameterized queries** to prevent SQL injection:

```typescript
// Safe - values are parameterized, not interpolated
const results = users.find({
  name: { $eq: userInput },
  age: { $gt: ageInput }
})

// Field names are validated against injection patterns
// Invalid field names like "name'; DROP TABLE --" are rejected
```

The library:
- Uses SQLite prepared statements with bound parameters
- Validates field names against alphanumeric patterns
- Escapes SQL identifiers using proper quoting

See `core/src/collections.test.ts` for comprehensive SQL injection prevention tests.

### Prototype Pollution Protection

rpc.do protects against prototype pollution by skipping dangerous properties when wrapping objects:

```typescript
// src/utils/wrap-target.ts
export const DEFAULT_SKIP_PROPS = new Set([
  'constructor',
  'toString',
  'valueOf',
  'toJSON',
  'then',
  'catch',
  'finally',
])
```

This prevents attackers from:
- Calling `constructor` to access `Object.prototype`
- Manipulating prototype chain through RPC
- Accessing promise-like methods that could cause unexpected behavior

Properties starting with `_` are also automatically skipped to prevent access to internal/private methods.

### WebSocket Security

rpc.do enforces secure WebSocket connections by default:

```typescript
// By default, sending tokens over ws:// is BLOCKED
const transport = capnweb('ws://insecure.example.com/rpc', {
  auth: () => getToken()  // Will throw INSECURE_CONNECTION error
})

// Error: SECURITY ERROR: Refusing to send authentication token over
// insecure ws:// connection. Use wss:// for secure connections.
```

The `allowInsecureAuth` flag can override this for local development only:

```typescript
// ONLY for local development - NEVER in production
const transport = capnweb('ws://localhost:8787/rpc', {
  auth: () => getToken(),
  allowInsecureAuth: true  // WARNING: Only for local dev
})
```

**Security errors are non-retryable** - the connection will not automatically retry to avoid repeatedly sending credentials over insecure channels.

## Security Best Practices

### 1. Always Use HTTPS/WSS in Production

```typescript
// Production - always use wss://
const rpc = RPC(capnweb('wss://api.example.com/rpc', { ... }))

// Never use ws:// in production, even with allowInsecureAuth
// allowInsecureAuth should ONLY be used for local development
```

### 2. Use oauth.do or Proper Auth Providers

rpc.do integrates with oauth.do for secure token management:

```typescript
import { oauthProvider } from 'rpc.do/auth'

// Recommended: Use oauth.do integration
const rpc = RPC(capnweb('wss://api.example.com/rpc', {
  auth: oauthProvider()
}))

// Or use compositeAuth for fallback patterns
import { compositeAuth, oauthProvider, staticAuth } from 'rpc.do/auth'

const auth = compositeAuth([
  oauthProvider(),                           // Try oauth.do first
  staticAuth(() => process.env.API_TOKEN),   // Fall back to env var
])
```

Benefits of oauth.do:
- Automatic token refresh
- Secure token storage
- Built-in caching with configurable TTL
- Browser and server support

### 3. Don't Expose Internal Methods

rpc.do automatically skips properties starting with `_`, but you should also:

```typescript
// Bad - exposing sensitive methods
class MyService extends RpcTarget {
  getAdminConfig() { ... }  // Exposed to all clients
  deleteAllData() { ... }   // Dangerous if called by attackers
}

// Good - separate public and internal methods
class MyService extends RpcTarget {
  // Public API
  getData() { ... }

  // Not exposed (starts with _)
  _internalHelper() { ... }
}

// Better - use authorization middleware
class MyService extends RpcTarget {
  async deleteData(ctx: Context) {
    if (!ctx.user?.isAdmin) {
      throw new Error('Unauthorized')
    }
    // ... proceed with deletion
  }
}
```

### 4. Validate Input on Server Side

Never trust client input - always validate on the server:

```typescript
import { RpcTarget } from 'rpc.do/server'

class UserService extends RpcTarget {
  async updateProfile(data: unknown) {
    // Validate input
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid input')
    }

    const { name, email } = data as Record<string, unknown>

    // Validate fields
    if (typeof name !== 'string' || name.length > 100) {
      throw new Error('Invalid name')
    }

    if (typeof email !== 'string' || !isValidEmail(email)) {
      throw new Error('Invalid email')
    }

    // Safe to proceed
    return this.db.updateUser({ name, email })
  }
}
```

Consider using a validation library like Zod:

```typescript
import { z } from 'zod'

const UpdateProfileSchema = z.object({
  name: z.string().max(100),
  email: z.string().email(),
})

class UserService extends RpcTarget {
  async updateProfile(data: unknown) {
    const validated = UpdateProfileSchema.parse(data)
    return this.db.updateUser(validated)
  }
}
```

### 5. Use Rate Limiting

Protect your RPC endpoints from abuse:

```typescript
// rpc.do surfaces RateLimitError (HTTP 429) from the server
import { RateLimitError } from 'rpc.do/errors'

try {
  await rpc.api.someMethod()
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter} seconds`)
    // Implement backoff strategy
  }
}
```

Implement rate limiting on your server using Cloudflare Workers rate limiting or similar solutions.

### 6. Monitor for Security Errors

Log and monitor security-related errors:

```typescript
transport.on('error', (error) => {
  if (error instanceof ConnectionError) {
    if (error.code === 'INSECURE_CONNECTION') {
      // Alert: Someone tried to use insecure connection with auth
      console.error('Security violation:', error.message)
    }
    if (error.code === 'AUTH_FAILED') {
      // Log authentication failures for anomaly detection
      console.warn('Auth failed:', error.message)
    }
  }
})
```

## Additional Resources

- [Cloudflare Workers Security Best Practices](https://developers.cloudflare.com/workers/learning/security-model/)
- [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#websockets)
- [oauth.do Documentation](https://oauth.do)

## Security Changelog

| Date       | Description                                           |
| ---------- | ----------------------------------------------------- |
| 2024-01-XX | Added insecure connection blocking (`ws://` + auth)   |
| 2024-01-XX | Added prototype pollution protection via SKIP_PROPS   |
| 2024-01-XX | Added SQL injection protection in Collections API     |
