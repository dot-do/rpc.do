/**
 * Test Durable Object for WebSocket waitUntil experiment
 *
 * This DO:
 * 1. Accepts WebSocket connections
 * 2. When it receives a "start" message, sends a message every second for 10 seconds
 * 3. Logs all received messages with timestamps
 */

export class TestDO implements DurableObject {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { id: string; startTime: number }>;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.sessions = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/websocket') {
      // Handle WebSocket upgrade
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 });
      }

      // Create WebSocket pair
      const [client, server] = Object.values(new WebSocketPair());

      // Accept the server side
      this.state.acceptWebSocket(server);

      console.log('[TestDO] WebSocket connection accepted');

      // Return the client side to the caller
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('TestDO - Use /websocket to connect', { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const messageStr = typeof message === 'string' ? message : 'binary data';
    console.log(`[TestDO] Received message: ${messageStr}`);

    try {
      const data = JSON.parse(messageStr);

      if (data.action === 'start') {
        const connectionId = data.connectionId || 'unknown';
        const startTime = Date.now();

        this.sessions.set(ws, { id: connectionId, startTime });

        console.log(`[TestDO] Starting message sequence for ${connectionId}`);

        // Send 10 messages, one per second
        for (let i = 1; i <= 10; i++) {
          // Use alarm-based timing for accuracy, but setTimeout works for POC
          await this.delay(1000);

          const now = Date.now();
          const elapsed = now - startTime;

          const messagePayload = {
            messageNumber: i,
            totalMessages: 10,
            timestamp: now,
            elapsedMs: elapsed,
            connectionId,
            note: `Message ${i} sent ${elapsed}ms after connection start`,
          };

          try {
            ws.send(JSON.stringify(messagePayload));
            console.log(`[TestDO] Sent message ${i}/10 to ${connectionId} at +${elapsed}ms`);
          } catch (err) {
            console.error(`[TestDO] Failed to send message ${i}:`, err);
            break;
          }
        }

        console.log(`[TestDO] Completed message sequence for ${connectionId}`);

        // Send completion message
        ws.send(JSON.stringify({
          action: 'complete',
          totalMessages: 10,
          connectionId,
          duration: Date.now() - startTime,
        }));
      }
    } catch (err) {
      console.log(`[TestDO] Non-JSON message or parse error: ${messageStr}`);
      // Echo back for simple testing
      ws.send(`Echo: ${messageStr}`);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const session = this.sessions.get(ws);
    const id = session?.id || 'unknown';

    console.log(`[TestDO] WebSocket closed for ${id}: code=${code}, reason=${reason}, wasClean=${wasClean}`);

    this.sessions.delete(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const session = this.sessions.get(ws);
    const id = session?.id || 'unknown';

    console.error(`[TestDO] WebSocket error for ${id}:`, error);

    this.sessions.delete(ws);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
