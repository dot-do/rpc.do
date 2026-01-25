/**
 * Chat Worker
 *
 * Routes requests to ChatRoom Durable Objects.
 * Handles WebSocket upgrades and HTTP requests.
 */

import { ChatRoom } from './ChatRoom'

export { ChatRoom }

export interface Env {
  CHAT_ROOM: DurableObjectNamespace<ChatRoom>
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // CORS headers for browser clients
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { headers: corsHeaders })
    }

    // Route to chat room
    // URL format: /room/:roomId or /room/:roomId/rpc
    const roomMatch = url.pathname.match(/^\/room\/([^\/]+)(\/.*)?$/)

    if (roomMatch) {
      const roomId = roomMatch[1]

      // Get or create the Durable Object for this room
      const id = env.CHAT_ROOM.idFromName(roomId)
      const room = env.CHAT_ROOM.get(id)

      // Forward the request to the Durable Object
      const response = await room.fetch(request)

      // Add CORS headers to response
      const newHeaders = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value)
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
        webSocket: response.webSocket
      })
    }

    // Landing page with usage instructions
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify({
          name: 'rpc.do Chat Example',
          version: '1.0.0',
          endpoints: {
            health: '/health',
            room: '/room/:roomId',
          },
          usage: {
            websocket: 'Connect to wss://your-worker.workers.dev/room/my-room',
            methods: ['join(username)', 'sendMessage(text)', 'getHistory(limit)', 'leave()'],
          },
        }, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  }
}
