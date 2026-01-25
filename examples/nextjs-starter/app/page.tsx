/**
 * Home Page - RPC Demo
 *
 * Demonstrates rpc.do usage in both Server Components (SSR)
 * and Client Components (interactive).
 */

import { rpc } from '@/lib/rpc'
import { ClientDemo } from '@/components/ClientDemo'

/**
 * Server Component - fetches data at build/request time
 */
export default async function Home() {
  // Server-side RPC call (runs during SSR)
  const greeting = await rpc.greeting.sayHello({ name: 'Server' })
  const { users, total } = await rpc.users.list({ limit: 3 })

  return (
    <main>
      <h1>rpc.do Next.js Starter</h1>
      <p>
        A type-safe RPC solution for Next.js applications.
        This demo shows rpc.do usage in both Server and Client Components.
      </p>

      {/* Server Component Section */}
      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Server Component Data (SSR)</h2>
        <p>This data was fetched on the server during page render:</p>

        <div style={{ padding: '1rem', backgroundColor: '#f0fdf4', borderRadius: '4px', marginBottom: '1rem' }}>
          <h3>Greeting Response</h3>
          <p><strong>Message:</strong> {greeting.message}</p>
          <p><strong>Timestamp:</strong> {greeting.timestamp}</p>
        </div>

        <div style={{ padding: '1rem', backgroundColor: '#fef3c7', borderRadius: '4px' }}>
          <h3>Users (Total: {total})</h3>
          <ul>
            {users.map((user) => (
              <li key={user.id}>
                <strong>{user.name}</strong> - {user.email}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Client Component Section */}
      <ClientDemo />

      {/* Code Examples */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Code Examples</h2>

        <h3>Server Component Usage</h3>
        <pre style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`// app/page.tsx (Server Component)
import { rpc } from '@/lib/rpc'

export default async function Page() {
  const result = await rpc.greeting.sayHello({ name: 'World' })
  return <div>{result.message}</div>
}`}
        </pre>

        <h3>Client Component Usage</h3>
        <pre style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`// components/MyComponent.tsx
'use client'
import { useState } from 'react'
import { rpc } from '@/lib/rpc'

export function MyComponent() {
  const [data, setData] = useState(null)

  const fetchData = async () => {
    const result = await rpc.users.list({ limit: 10 })
    setData(result.users)
  }

  return <button onClick={fetchData}>Load Users</button>
}`}
        </pre>

        <h3>Adding New RPC Methods</h3>
        <pre style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '1rem', borderRadius: '8px', overflow: 'auto' }}>
{`// 1. Define types in lib/rpc-types.ts
export interface TodoInput { title: string }
export interface TodoOutput { id: string; title: string }

// 2. Add to RPCAPI interface
export interface RPCAPI {
  todos: {
    create: (input: TodoInput) => TodoOutput
  }
}

// 3. Implement in lib/rpc-methods.ts
export const todoMethods = {
  create: async (input: TodoInput): Promise<TodoOutput> => {
    return { id: crypto.randomUUID(), title: input.title }
  }
}

// 4. Add case to dispatch function
case 'todos':
  if (methodName === 'create') {
    return todoMethods.create(input as TodoInput)
  }`}
        </pre>
      </section>
    </main>
  )
}
