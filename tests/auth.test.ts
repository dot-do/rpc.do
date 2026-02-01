/**
 * Auth Utilities Tests
 *
 * Tests for cachedAuth, oauthProvider, staticAuth, and compositeAuth
 * from src/auth.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cachedAuth, oauthProvider, staticAuth, compositeAuth } from '../src/auth'

// ============================================================================
// cachedAuth Tests
// ============================================================================

describe('cachedAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call underlying function and cache result', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('test-token')

    // Use TTL of 300000 (5 min) and refreshBuffer of 60000 (1 min, default)
    // This means token is valid without refresh for 240 seconds
    const auth = cachedAuth(mockGetToken, { ttl: 300000, refreshBuffer: 60000 })

    // First call
    const token1 = await auth()
    expect(token1).toBe('test-token')
    expect(mockGetToken).toHaveBeenCalledTimes(1)

    // Second call should use cache (we're at time 0, well within the 240s window)
    const token2 = await auth()
    expect(token2).toBe('test-token')
    expect(mockGetToken).toHaveBeenCalledTimes(1)
  })

  it('should return cached token within TTL', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('cached-token')

    const auth = cachedAuth(mockGetToken, { ttl: 300000, refreshBuffer: 60000 })

    // Initial call
    await auth()
    expect(mockGetToken).toHaveBeenCalledTimes(1)

    // Advance time but stay within TTL minus refreshBuffer
    await vi.advanceTimersByTimeAsync(200000) // 200 seconds < 300-60 = 240 seconds

    const token = await auth()
    expect(token).toBe('cached-token')
    expect(mockGetToken).toHaveBeenCalledTimes(1) // Still only called once
  })

  it('should refresh token when approaching expiry (within refreshBuffer)', async () => {
    let tokenVersion = 1
    const mockGetToken = vi.fn().mockImplementation(async () => `token-v${tokenVersion++}`)

    const auth = cachedAuth(mockGetToken, { ttl: 300000, refreshBuffer: 60000 })

    // Initial call
    const token1 = await auth()
    expect(token1).toBe('token-v1')
    expect(mockGetToken).toHaveBeenCalledTimes(1)

    // Advance time to within refreshBuffer (300000 - 60000 = 240000ms threshold)
    await vi.advanceTimersByTimeAsync(250000) // 250 seconds, within refresh buffer

    // This call should trigger a background refresh but return current token
    const token2 = await auth()
    expect(token2).toBe('token-v1') // Returns current cached token
    expect(mockGetToken).toHaveBeenCalledTimes(2) // Background refresh triggered

    // Let the background refresh complete
    await vi.advanceTimersByTimeAsync(0)

    // Next call should return the new token
    const token3 = await auth()
    expect(token3).toBe('token-v2')
  })

  it('should not block return during background refresh', async () => {
    let resolveRefresh: (value: string) => void
    const slowRefresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })

    let callCount = 0
    const mockGetToken = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve('initial-token')
      }
      return slowRefresh
    })

    const auth = cachedAuth(mockGetToken, { ttl: 300000, refreshBuffer: 60000 })

    // Initial call
    await auth()

    // Advance to refresh buffer zone
    await vi.advanceTimersByTimeAsync(250000)

    // This call should return immediately with cached token
    const start = Date.now()
    const token = await auth()
    const elapsed = Date.now() - start

    expect(token).toBe('initial-token')
    expect(elapsed).toBeLessThan(100) // Should be nearly instant

    // Resolve the slow refresh later
    resolveRefresh!('refreshed-token')
    await vi.advanceTimersByTimeAsync(0)
  })

  it('should handle errors in refresh gracefully', async () => {
    let callCount = 0
    const mockGetToken = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return 'initial-token'
      }
      throw new Error('Refresh failed')
    })

    const auth = cachedAuth(mockGetToken, { ttl: 300000, refreshBuffer: 60000 })

    // Initial call
    await auth()

    // Advance to refresh buffer zone
    await vi.advanceTimersByTimeAsync(250000)

    // This call should trigger refresh but handle error gracefully
    const token = await auth()
    expect(token).toBe('initial-token') // Returns cached token

    // Let the error be caught
    await vi.advanceTimersByTimeAsync(0)

    // Should still be able to get cached token
    const token2 = await auth()
    expect(token2).toBe('initial-token')
  })

  it('should fetch new token when cache is expired', async () => {
    let tokenVersion = 1
    const mockGetToken = vi.fn().mockImplementation(async () => `token-v${tokenVersion++}`)

    const auth = cachedAuth(mockGetToken, { ttl: 60000, refreshBuffer: 10000 })

    // Initial call
    const token1 = await auth()
    expect(token1).toBe('token-v1')

    // Advance past TTL
    await vi.advanceTimersByTimeAsync(70000)

    // This should fetch a new token
    const token2 = await auth()
    expect(token2).toBe('token-v2')
    expect(mockGetToken).toHaveBeenCalledTimes(2)
  })

  it('should handle null token from provider', async () => {
    const mockGetToken = vi.fn().mockResolvedValue(null)

    const auth = cachedAuth(mockGetToken)
    const token = await auth()

    expect(token).toBeNull()
  })

  it('should propagate errors from initial fetch', async () => {
    const mockGetToken = vi.fn().mockRejectedValue(new Error('Token fetch failed'))

    const auth = cachedAuth(mockGetToken)

    await expect(auth()).rejects.toThrow('Token fetch failed')
  })
})

// ============================================================================
// oauthProvider Tests
// ============================================================================

describe('oauthProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return fallbackToken if oauth.do not available', async () => {
    // Mock the dynamic import to fail
    vi.doMock('oauth.do', () => {
      throw new Error('Module not found')
    })

    // Re-import to get fresh module with mocked dependency
    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider({ fallbackToken: 'fallback-token-123' })
    const token = await auth()

    expect(token).toBe('fallback-token-123')
  })

  it('should lazy load oauth.do getToken', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('oauth-token')

    vi.doMock('oauth.do', () => ({
      getToken: mockGetToken,
    }))

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider()

    // oauth.do should not be loaded yet
    expect(mockGetToken).not.toHaveBeenCalled()

    // First call triggers load
    await auth()

    expect(mockGetToken).toHaveBeenCalled()
  })

  it('should cache loaded function', async () => {
    let importCount = 0
    const mockGetToken = vi.fn().mockResolvedValue('oauth-token')

    vi.doMock('oauth.do', () => {
      importCount++
      return { getToken: mockGetToken }
    })

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider()

    // Multiple calls should only import once
    await auth()
    await auth()
    await auth()

    expect(importCount).toBe(1)
  })

  it('should return null if oauth.do unavailable and no fallback', async () => {
    vi.doMock('oauth.do', () => {
      throw new Error('Module not found')
    })

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider() // No fallback token
    const token = await auth()

    expect(token).toBeNull()
  })

  it('should use oauth.do token over fallback when available', async () => {
    const mockGetToken = vi.fn().mockResolvedValue('oauth-token')

    vi.doMock('oauth.do', () => ({
      getToken: mockGetToken,
    }))

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider({ fallbackToken: 'fallback-token' })
    const token = await auth()

    expect(token).toBe('oauth-token')
  })

  it('should fall back when oauth.do returns null', async () => {
    const mockGetToken = vi.fn().mockResolvedValue(null)

    vi.doMock('oauth.do', () => ({
      getToken: mockGetToken,
    }))

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider({ fallbackToken: 'fallback-token' })
    const token = await auth()

    expect(token).toBe('fallback-token')
  })

  it('should respect TTL and refreshBuffer options', async () => {
    let tokenVersion = 1
    const mockGetToken = vi.fn().mockImplementation(async () => `oauth-v${tokenVersion++}`)

    vi.doMock('oauth.do', () => ({
      getToken: mockGetToken,
    }))

    const { oauthProvider: freshOauthProvider } = await import('../src/auth')

    const auth = freshOauthProvider({ ttl: 60000, refreshBuffer: 10000 })

    // First call
    const token1 = await auth()
    expect(token1).toBe('oauth-v1')

    // Within cache period
    await vi.advanceTimersByTimeAsync(40000)
    const token2 = await auth()
    expect(token2).toBe('oauth-v1')
    expect(mockGetToken).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// staticAuth Tests
// ============================================================================

describe('staticAuth', () => {
  it('should return static string token', () => {
    const auth = staticAuth('my-static-token')
    const token = auth()

    expect(token).toBe('my-static-token')
  })

  it('should return the same token on multiple calls', () => {
    const auth = staticAuth('static-token-123')

    expect(auth()).toBe('static-token-123')
    expect(auth()).toBe('static-token-123')
    expect(auth()).toBe('static-token-123')
  })

  it('should call function if provided', () => {
    const tokenFn = vi.fn().mockReturnValue('dynamic-token')

    const auth = staticAuth(tokenFn)

    expect(auth()).toBe('dynamic-token')
    expect(tokenFn).toHaveBeenCalledTimes(1)

    // Each call invokes the function
    expect(auth()).toBe('dynamic-token')
    expect(tokenFn).toHaveBeenCalledTimes(2)
  })

  it('should return null if function returns undefined', () => {
    const tokenFn = vi.fn().mockReturnValue(undefined)

    const auth = staticAuth(tokenFn)
    const token = auth()

    expect(token).toBeNull()
  })

  it('should work with environment variables pattern', () => {
    // Simulate environment variable pattern
    const envTokens: Record<string, string | undefined> = {
      API_TOKEN: 'env-token-value',
    }

    const auth = staticAuth(() => envTokens['API_TOKEN'])
    expect(auth()).toBe('env-token-value')

    // Simulate env var change
    envTokens['API_TOKEN'] = 'new-token-value'
    expect(auth()).toBe('new-token-value')
  })
})

// ============================================================================
// compositeAuth Tests
// ============================================================================

describe('compositeAuth', () => {
  it('should return first non-null token from providers', async () => {
    const provider1 = vi.fn().mockResolvedValue(null)
    const provider2 = vi.fn().mockResolvedValue('token-from-second')
    const provider3 = vi.fn().mockResolvedValue('token-from-third')

    const auth = compositeAuth([provider1, provider2, provider3])
    const token = await auth()

    expect(token).toBe('token-from-second')
    expect(provider1).toHaveBeenCalledTimes(1)
    expect(provider2).toHaveBeenCalledTimes(1)
    expect(provider3).not.toHaveBeenCalled() // Should stop after finding token
  })

  it('should try providers in order', async () => {
    const callOrder: number[] = []

    const provider1 = vi.fn().mockImplementation(async () => {
      callOrder.push(1)
      return null
    })
    const provider2 = vi.fn().mockImplementation(async () => {
      callOrder.push(2)
      return null
    })
    const provider3 = vi.fn().mockImplementation(async () => {
      callOrder.push(3)
      return 'token'
    })

    const auth = compositeAuth([provider1, provider2, provider3])
    await auth()

    expect(callOrder).toEqual([1, 2, 3])
  })

  it('should return null if all providers return null', async () => {
    const provider1 = vi.fn().mockResolvedValue(null)
    const provider2 = vi.fn().mockResolvedValue(null)
    const provider3 = vi.fn().mockResolvedValue(null)

    const auth = compositeAuth([provider1, provider2, provider3])
    const token = await auth()

    expect(token).toBeNull()
    expect(provider1).toHaveBeenCalledTimes(1)
    expect(provider2).toHaveBeenCalledTimes(1)
    expect(provider3).toHaveBeenCalledTimes(1)
  })

  it('should skip provider that throws error and continue', async () => {
    const provider1 = vi.fn().mockRejectedValue(new Error('Provider 1 failed'))
    const provider2 = vi.fn().mockResolvedValue('fallback-token')

    const auth = compositeAuth([provider1, provider2])
    const token = await auth()

    expect(token).toBe('fallback-token')
    expect(provider1).toHaveBeenCalledTimes(1)
    expect(provider2).toHaveBeenCalledTimes(1)
  })

  it('should return null if all providers throw errors', async () => {
    const provider1 = vi.fn().mockRejectedValue(new Error('Error 1'))
    const provider2 = vi.fn().mockRejectedValue(new Error('Error 2'))

    const auth = compositeAuth([provider1, provider2])
    const token = await auth()

    expect(token).toBeNull()
  })

  it('should work with empty providers array', async () => {
    const auth = compositeAuth([])
    const token = await auth()

    expect(token).toBeNull()
  })

  it('should return first provider token immediately', async () => {
    const provider1 = vi.fn().mockResolvedValue('first-token')
    const provider2 = vi.fn().mockResolvedValue('second-token')

    const auth = compositeAuth([provider1, provider2])
    const token = await auth()

    expect(token).toBe('first-token')
    expect(provider1).toHaveBeenCalledTimes(1)
    expect(provider2).not.toHaveBeenCalled()
  })

  it('should work with sync and async providers mixed', async () => {
    const syncProvider = () => null
    const asyncProvider = vi.fn().mockResolvedValue('async-token')

    const auth = compositeAuth([syncProvider, asyncProvider])
    const token = await auth()

    expect(token).toBe('async-token')
  })

  it('should handle undefined return values as falsy', async () => {
    const provider1 = vi.fn().mockResolvedValue(undefined)
    const provider2 = vi.fn().mockResolvedValue('valid-token')

    const auth = compositeAuth([provider1, provider2])
    const token = await auth()

    expect(token).toBe('valid-token')
  })
})

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Error Recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('cachedAuth - Cache Refresh After Auth Expiry', () => {
    it('should successfully refresh token after expiry', async () => {
      let tokenVersion = 1
      const mockGetToken = vi.fn().mockImplementation(async () => `token-v${tokenVersion++}`)

      const auth = cachedAuth(mockGetToken, { ttl: 60000, refreshBuffer: 10000 })

      // Initial call
      const token1 = await auth()
      expect(token1).toBe('token-v1')
      expect(mockGetToken).toHaveBeenCalledTimes(1)

      // Advance past TTL (token is now expired)
      await vi.advanceTimersByTimeAsync(70000)

      // Should fetch new token since cached one is expired
      const token2 = await auth()
      expect(token2).toBe('token-v2')
      expect(mockGetToken).toHaveBeenCalledTimes(2)

      // New token should be cached
      const token3 = await auth()
      expect(token3).toBe('token-v2')
      expect(mockGetToken).toHaveBeenCalledTimes(2)
    })

    it('should recover from failed background refresh and retry on next call', async () => {
      let callCount = 0
      const mockGetToken = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return 'initial-token'
        }
        if (callCount === 2) {
          throw new Error('Refresh failed')
        }
        return 'recovered-token'
      })

      const auth = cachedAuth(mockGetToken, { ttl: 60000, refreshBuffer: 10000 })

      // Initial call
      const token1 = await auth()
      expect(token1).toBe('initial-token')

      // Advance to refresh buffer zone (triggers background refresh that fails)
      await vi.advanceTimersByTimeAsync(55000)
      const token2 = await auth()
      expect(token2).toBe('initial-token') // Returns cached while refresh fails

      // Let the failed refresh complete
      await vi.advanceTimersByTimeAsync(0)
      expect(mockGetToken).toHaveBeenCalledTimes(2)

      // Advance past TTL (token expired, must fetch new)
      await vi.advanceTimersByTimeAsync(10000)

      // This should try again and succeed
      const token3 = await auth()
      expect(token3).toBe('recovered-token')
      expect(mockGetToken).toHaveBeenCalledTimes(3)
    })

    it('should handle multiple sequential calls during refresh window', async () => {
      let callCount = 0

      const mockGetToken = vi.fn().mockImplementation(async () => {
        callCount++
        return `token-v${callCount}`
      })

      const auth = cachedAuth(mockGetToken, { ttl: 60000, refreshBuffer: 10000 })

      // Initial call
      const initialToken = await auth()
      expect(initialToken).toBe('token-v1')
      expect(mockGetToken).toHaveBeenCalledTimes(1)

      // Advance to refresh zone
      await vi.advanceTimersByTimeAsync(55000)

      // First call in refresh zone triggers background refresh but returns cached
      const t1 = await auth()
      expect(t1).toBe('token-v1') // Returns current cached while refreshing
      expect(mockGetToken).toHaveBeenCalledTimes(2) // Background refresh triggered

      // Let the background refresh complete
      await vi.advanceTimersByTimeAsync(0)

      // Next call should get the refreshed token
      const t2 = await auth()
      expect(t2).toBe('token-v2')
      expect(mockGetToken).toHaveBeenCalledTimes(2) // No new call, using refreshed cache
    })

    it('should recover from expired cache when initial refresh fails', async () => {
      let callCount = 0
      const mockGetToken = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('First recovery attempt failed')
        }
        if (callCount === 3) {
          throw new Error('Second recovery attempt failed')
        }
        return `token-v${callCount}`
      })

      const auth = cachedAuth(mockGetToken, { ttl: 60000, refreshBuffer: 10000 })

      // Initial call
      const token1 = await auth()
      expect(token1).toBe('token-v1')

      // Advance past TTL
      await vi.advanceTimersByTimeAsync(70000)

      // First attempt to get new token fails
      await expect(auth()).rejects.toThrow('First recovery attempt failed')

      // Second attempt also fails
      await expect(auth()).rejects.toThrow('Second recovery attempt failed')

      // Third attempt succeeds
      const token4 = await auth()
      expect(token4).toBe('token-v4')
    })
  })

  describe('compositeAuth - Provider Retry on Failure', () => {
    it('should recover by trying next provider when first fails', async () => {
      let firstProviderCalls = 0
      const firstProvider = vi.fn().mockImplementation(async () => {
        firstProviderCalls++
        throw new Error(`First provider error #${firstProviderCalls}`)
      })
      const secondProvider = vi.fn().mockResolvedValue('fallback-token')

      const auth = compositeAuth([firstProvider, secondProvider])

      // First provider fails, second provides token
      const token = await auth()
      expect(token).toBe('fallback-token')
      expect(firstProvider).toHaveBeenCalledTimes(1)
      expect(secondProvider).toHaveBeenCalledTimes(1)

      // Subsequent calls continue to try first (it might recover)
      const token2 = await auth()
      expect(token2).toBe('fallback-token')
      expect(firstProvider).toHaveBeenCalledTimes(2)
    })

    it('should handle all providers failing then one recovering', async () => {
      let attemptCount = 0
      const flakeyProvider = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Temporary failure')
        }
        return 'recovered-token'
      })
      const alwaysFailsProvider = vi.fn().mockRejectedValue(new Error('Always fails'))

      const auth = compositeAuth([flakeyProvider, alwaysFailsProvider])

      // First two attempts: all providers fail
      const token1 = await auth()
      expect(token1).toBeNull() // Both failed

      const token2 = await auth()
      expect(token2).toBeNull() // Both failed again

      // Third attempt: first provider recovers
      const token3 = await auth()
      expect(token3).toBe('recovered-token')
    })

    it('should continue trying providers in order on each call', async () => {
      const callOrder: string[] = []

      const provider1 = vi.fn().mockImplementation(async () => {
        callOrder.push('p1')
        return null
      })
      const provider2 = vi.fn().mockImplementation(async () => {
        callOrder.push('p2')
        throw new Error('Provider 2 error')
      })
      const provider3 = vi.fn().mockImplementation(async () => {
        callOrder.push('p3')
        return 'token-from-p3'
      })

      const auth = compositeAuth([provider1, provider2, provider3])

      // Multiple calls should always try in order
      await auth()
      await auth()
      await auth()

      expect(callOrder).toEqual([
        'p1', 'p2', 'p3',
        'p1', 'p2', 'p3',
        'p1', 'p2', 'p3',
      ])
    })

    it('should handle provider recovering mid-session', async () => {
      let primaryCalls = 0
      const primaryProvider = vi.fn().mockImplementation(async () => {
        primaryCalls++
        if (primaryCalls <= 2) {
          throw new Error('Primary down')
        }
        return 'primary-token'
      })
      const backupProvider = vi.fn().mockResolvedValue('backup-token')

      const auth = compositeAuth([primaryProvider, backupProvider])

      // First call: primary fails, uses backup
      const token1 = await auth()
      expect(token1).toBe('backup-token')

      // Second call: primary still fails
      const token2 = await auth()
      expect(token2).toBe('backup-token')

      // Third call: primary recovered!
      const token3 = await auth()
      expect(token3).toBe('primary-token')

      // Fourth call: primary continues working
      const token4 = await auth()
      expect(token4).toBe('primary-token')
      expect(backupProvider).toHaveBeenCalledTimes(2) // Only called when primary failed
    })
  })

  describe('cachedAuth + compositeAuth - Combined Recovery', () => {
    it('should cache recovered token from fallback provider', async () => {
      const primaryProvider = vi.fn().mockRejectedValue(new Error('Primary down'))
      const fallbackProvider = vi.fn().mockResolvedValue('fallback-token')

      const composedAuth = compositeAuth([primaryProvider, fallbackProvider])
      const auth = cachedAuth(composedAuth, { ttl: 60000, refreshBuffer: 10000 })

      // First call: primary fails, fallback works, result cached
      const token1 = await auth()
      expect(token1).toBe('fallback-token')
      expect(primaryProvider).toHaveBeenCalledTimes(1)
      expect(fallbackProvider).toHaveBeenCalledTimes(1)

      // Second call: uses cached token
      const token2 = await auth()
      expect(token2).toBe('fallback-token')
      expect(primaryProvider).toHaveBeenCalledTimes(1) // Not called again
      expect(fallbackProvider).toHaveBeenCalledTimes(1) // Not called again
    })

    it('should refresh with recovered primary after cache expires', async () => {
      let primaryCalls = 0
      const primaryProvider = vi.fn().mockImplementation(async () => {
        primaryCalls++
        if (primaryCalls === 1) {
          throw new Error('Primary down initially')
        }
        return 'primary-recovered-token'
      })
      const fallbackProvider = vi.fn().mockResolvedValue('fallback-token')

      const composedAuth = compositeAuth([primaryProvider, fallbackProvider])
      const auth = cachedAuth(composedAuth, { ttl: 60000, refreshBuffer: 10000 })

      // First call: primary fails, fallback works
      const token1 = await auth()
      expect(token1).toBe('fallback-token')

      // Advance past TTL
      await vi.advanceTimersByTimeAsync(70000)

      // Second call: primary has recovered
      const token2 = await auth()
      expect(token2).toBe('primary-recovered-token')
      expect(primaryProvider).toHaveBeenCalledTimes(2)
      // Fallback not called on refresh since primary succeeded
    })
  })
})
