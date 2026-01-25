/**
 * RPC API Route Handler
 *
 * This Edge Runtime handler processes all RPC requests.
 * It validates the request, dispatches to the appropriate method,
 * and returns the result.
 */

import { dispatch } from '@/lib/rpc-methods'

export const runtime = 'edge'

/**
 * RPC Request Body Shape
 */
interface RpcRequest {
  method: string
  path: string
  args?: unknown[]
}

/**
 * Type guard for RPC request validation
 */
function isValidRpcRequest(body: unknown): body is RpcRequest {
  if (typeof body !== 'object' || body === null) {
    return false
  }
  const obj = body as Record<string, unknown>
  return typeof obj.path === 'string'
}

/**
 * Handle POST requests for RPC calls
 */
export async function POST(request: Request): Promise<Response> {
  // Parse request body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Invalid JSON in request body' },
      { status: 400 }
    )
  }

  // Validate request structure
  if (!isValidRpcRequest(body)) {
    return Response.json(
      { error: 'Invalid request: missing path' },
      { status: 400 }
    )
  }

  const { path, args = [] } = body

  try {
    // Dispatch to the appropriate handler
    const result = await dispatch(path, args)

    // Return successful result
    return Response.json(result)
  } catch (error) {
    // Handle errors
    const message = error instanceof Error ? error.message : 'Unknown error'

    console.error(`RPC Error [${path}]:`, message)

    return Response.json(
      { error: message },
      { status: 500 }
    )
  }
}

/**
 * Handle OPTIONS for CORS preflight
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
