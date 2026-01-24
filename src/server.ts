/**
 * rpc.do server - Lightweight RPC request handler
 *
 * Works with any router/framework - just provides the handler logic
 */

export type RpcContext = {
  token?: string
  user?: Record<string, unknown>
  [key: string]: unknown
}

export type RpcDispatcher = (
  method: string,
  args: unknown[],
  ctx: RpcContext
) => Promise<unknown>

export type AuthMiddleware = (
  request: Request
) => Promise<{ authorized: boolean; error?: string; context?: RpcContext }>

export interface RpcServerOptions {
  dispatch: RpcDispatcher
  auth?: AuthMiddleware
}

/**
 * Create an RPC request handler
 */
export function createRpcHandler(options: RpcServerOptions) {
  const { dispatch, auth } = options

  return async function handleRpc(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, dispatch, auth)
    }

    // Authenticate
    let ctx: RpcContext = {}
    if (auth) {
      const result = await auth(request)
      if (!result.authorized) {
        return Response.json(
          { error: result.error || 'Unauthorized' },
          { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
        )
      }
      ctx = result.context || {}
    }

    // Parse request
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Validate request body structure
    const validationError = validateRpcRequestBody(body)
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 })
    }

    // After validation, we know body has the required shape
    const { path, args } = body as { path: string; args?: unknown[] }

    try {
      const result = await dispatch(path, args || [], ctx)
      return Response.json(result)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'RPC error'
      return Response.json(
        { error: errorMessage },
        { status: 500 }
      )
    }
  }
}

/**
 * Validates RPC request body and returns error message if invalid
 * Returns null if the body is valid
 */
function validateRpcRequestBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return 'Invalid request body'
  }

  const bodyObj = body as Record<string, unknown>

  if (!('path' in bodyObj)) {
    return 'Missing path'
  }

  if (typeof bodyObj.path !== 'string') {
    return 'Invalid path: must be a string'
  }

  return null
}

/**
 * Type guard for WebSocket RPC message
 */
function isWebSocketRpcMessage(data: unknown): data is { id?: unknown; path: string; args?: unknown[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'path' in data &&
    typeof (data as Record<string, unknown>).path === 'string'
  )
}

/**
 * Handle WebSocket RPC connections
 */
async function handleWebSocket(
  request: Request,
  dispatch: RpcDispatcher,
  auth?: AuthMiddleware
): Promise<Response> {
  // Authenticate
  let ctx: RpcContext = {}
  if (auth) {
    const result = await auth(request)
    if (!result.authorized) {
      return new Response('Unauthorized', { status: 401 })
    }
    ctx = result.context || {}
  }

  const pair = new WebSocketPair()
  const [client, server] = Object.values(pair)

  server.accept()

  server.addEventListener('message', async (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.data as string)
      if (!isWebSocketRpcMessage(data)) {
        server.send(JSON.stringify({ error: 'Invalid message format' }))
        return
      }
      const { id, path, args } = data
      const result = await dispatch(path, args || [], ctx)
      server.send(JSON.stringify({ id, result }))
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'RPC error'
      server.send(JSON.stringify({ error: errorMessage }))
    }
  })

  return new Response(null, { status: 101, webSocket: client })
}

/**
 * Bearer token auth middleware
 */
export function bearerAuth(
  validateToken: (token: string) => Promise<RpcContext | null>
): AuthMiddleware {
  return async (request: Request) => {
    const header = request.headers.get('Authorization')
    const url = new URL(request.url)
    const queryToken = url.searchParams.get('token')

    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1] || queryToken

    if (!token) {
      return { authorized: false, error: 'Missing token' }
    }

    const context = await validateToken(token)
    if (!context) {
      return { authorized: false, error: 'Invalid token' }
    }

    return { authorized: true, context: { ...context, token } }
  }
}

/**
 * No-auth middleware (for internal/trusted traffic)
 */
export function noAuth(): AuthMiddleware {
  return async () => ({ authorized: true })
}
