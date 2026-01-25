/**
 * E2E Test Worker
 *
 * Routes requests to TestDO Durable Objects for E2E testing.
 */

import { TestDO } from './test-do'

export { TestDO }

export interface Env {
  TEST_DO: DurableObjectNamespace<TestDO>
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // CORS headers for browser clients
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Upgrade',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { headers: corsHeaders })
    }

    // API info
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify(
          {
            name: 'rpc.do E2E Test Worker',
            version: '1.0.0',
            endpoints: {
              health: '/health',
              do: '/do/:id',
              doDefault: '/do (uses default ID)',
            },
          },
          null,
          2
        ),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      )
    }

    // Route to DO
    // URL format: /do/:id or /do (uses default)
    const doMatch = url.pathname.match(/^\/do(?:\/([^\/]+))?(\/.*)?$/)

    if (doMatch) {
      const doId = doMatch[1] || 'default'

      // Get or create the Durable Object
      const id = env.TEST_DO.idFromName(doId)
      const stub = env.TEST_DO.get(id)

      // Forward the request to the Durable Object
      // Strip the /do/:id prefix from the path
      const forwardUrl = new URL(request.url)
      forwardUrl.pathname = doMatch[2] || '/'

      const forwardRequest = new Request(forwardUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })

      const response = await stub.fetch(forwardRequest)

      // Add CORS headers to response
      const newHeaders = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value)
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
        webSocket: response.webSocket,
      })
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  },
}
