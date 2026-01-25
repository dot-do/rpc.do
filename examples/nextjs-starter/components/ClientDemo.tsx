'use client'

/**
 * Client Component Demo
 *
 * Demonstrates using rpc.do in a Client Component with React state.
 */

import { useState } from 'react'
import { rpc } from '@/lib/rpc'
import type { GreetingOutput, User } from '@/lib/rpc-types'

export function ClientDemo() {
  const [name, setName] = useState('')
  const [greeting, setGreeting] = useState<GreetingOutput | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /**
   * Call the greeting RPC method
   */
  const handleGreet = async () => {
    if (!name.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await rpc.greeting.sayHello({ name })
      setGreeting(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Fetch users list
   */
  const handleFetchUsers = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await rpc.users.list({ limit: 10 })
      setUsers(result.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Demonstrate error handling
   */
  const handleError = async (type: 'validation' | 'not_found' | 'server') => {
    setLoading(true)
    setError(null)

    try {
      await rpc.errors.simulate({ type })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>Client Component Demo</h2>

      {/* Greeting Section */}
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Greeting RPC</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <button
            onClick={handleGreet}
            disabled={loading || !name.trim()}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#0070f3',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading || !name.trim() ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading...' : 'Say Hello'}
          </button>
        </div>
        {greeting && (
          <div style={{ padding: '1rem', backgroundColor: '#f0f9ff', borderRadius: '4px' }}>
            <p><strong>Message:</strong> {greeting.message}</p>
            <p><strong>Timestamp:</strong> {greeting.timestamp}</p>
          </div>
        )}
      </section>

      {/* Users Section */}
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Data Fetching RPC</h3>
        <button
          onClick={handleFetchUsers}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: '#10b981',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            marginBottom: '1rem',
          }}
        >
          {loading ? 'Loading...' : 'Fetch Users'}
        </button>
        {users.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {users.map((user) => (
              <li
                key={user.id}
                style={{
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  backgroundColor: '#f9fafb',
                  borderRadius: '4px',
                }}
              >
                <strong>{user.name}</strong> ({user.email})
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Error Handling Section */}
      <section style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>Error Handling Demo</h3>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            onClick={() => handleError('validation')}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#ef4444',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Validation Error
          </button>
          <button
            onClick={() => handleError('not_found')}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#f59e0b',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Not Found Error
          </button>
          <button
            onClick={() => handleError('server')}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#8b5cf6',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Server Error
          </button>
        </div>
      </section>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            color: '#dc2626',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}
